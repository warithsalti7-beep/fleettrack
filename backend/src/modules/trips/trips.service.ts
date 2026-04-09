import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { MapsService } from '../../services/maps/maps.service';
import { IntelligenceEventBus } from '../intelligence/intelligence.events';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { QueryTripsDto } from './dto/query-trips.dto';

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

const STATUS_TIMESTAMPS: Record<string, string> = {
  DRIVER_ASSIGNED: 'assignedAt',
  DRIVER_EN_ROUTE: 'enRouteAt',
  ARRIVED_PICKUP: 'arrivedAt',
  IN_PROGRESS: 'startedAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt',
};

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    private readonly maps: MapsService,
    private readonly intelligenceEvents: IntelligenceEventBus,
  ) {}

  async findAll(query: QueryTripsDto) {
    const { status, driverId, vehicleId, from, to, page = 1, limit = 50 } = query;

    const where: any = {
      ...(status && { status }),
      ...(driverId && { driverId }),
      ...(vehicleId && { vehicleId }),
      ...(from || to
        ? {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, plateNumber: true, make: true, model: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.trip.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        driver: true,
        vehicle: true,
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    return trip;
  }

  async getActiveTrips() {
    return this.prisma.trip.findMany({
      where: {
        status: {
          in: ['PENDING', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_PICKUP', 'IN_PROGRESS'],
        },
      },
      include: {
        driver: {
          select: {
            id: true, name: true, phone: true,
            locationLat: true, locationLng: true,
          },
        },
        vehicle: {
          select: {
            id: true, plateNumber: true, make: true, model: true,
            locationLat: true, locationLng: true, batteryLevel: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStats(from?: string, to?: string) {
    const where: any = {
      ...(from || to
        ? {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    };

    const [byStatus, revenue, avgMetrics] = await Promise.all([
      this.prisma.trip.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      this.prisma.trip.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { fare: true, distanceKm: true },
        _avg: { fare: true, distanceKm: true, durationMin: true, driverRating: true },
        _count: true,
      }),
      this.prisma.trip.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _avg: { driverRating: true },
      }),
    ]);

    return {
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      completed: revenue._count,
      totalRevenue: revenue._sum.fare ?? 0,
      totalDistanceKm: revenue._sum.distanceKm ?? 0,
      avgFare: revenue._avg.fare ?? 0,
      avgDistanceKm: revenue._avg.distanceKm ?? 0,
      avgDurationMin: revenue._avg.durationMin ?? 0,
      avgDriverRating: avgMetrics._avg.driverRating ?? 0,
    };
  }

  async create(dto: CreateTripDto) {
    // If coordinates are provided, calculate route
    let routeData: any = {};
    if (dto.pickupLat && dto.pickupLng && dto.dropoffLat && dto.dropoffLng) {
      const directions = await this.maps.getDirections(
        { lat: dto.pickupLat, lng: dto.pickupLng },
        { lat: dto.dropoffLat, lng: dto.dropoffLng },
      );
      if (directions) {
        routeData = {
          distanceKm: directions.distanceKm,
          durationMin: directions.durationMin,
          routePolyline: directions.polyline,
          estimatedFare: this.calculateFare(directions.distanceKm, directions.durationMin),
        };
      }
    }

    const trip = await this.prisma.trip.create({
      data: { ...dto, ...routeData },
      include: {
        driver: { select: { id: true, name: true } },
        vehicle: { select: { id: true, plateNumber: true } },
      },
    });

    // Mark driver + vehicle as ON_TRIP
    if (dto.driverId && dto.vehicleId) {
      await Promise.all([
        this.prisma.driver.update({
          where: { id: dto.driverId },
          data: { status: 'ON_TRIP' },
        }),
        this.prisma.vehicle.update({
          where: { id: dto.vehicleId },
          data: { status: 'ON_TRIP' },
        }),
      ]);
    }

    this.gateway.emitTripUpdate({
      tripId: trip.id,
      status: trip.status,
      driverId: trip.driverId,
      vehicleId: trip.vehicleId,
      ts: new Date().toISOString(),
    });

    return trip;
  }

  async updateStatus(
    id: string,
    body: { status: string; fare?: number; distanceKm?: number; durationMin?: number },
  ) {
    const trip = await this.findOne(id);

    if (TERMINAL_STATUSES.includes(trip.status as any)) {
      throw new BadRequestException(`Trip is already ${trip.status}`);
    }

    const timestampField = STATUS_TIMESTAMPS[body.status];
    const data: any = {
      status: body.status,
      ...(timestampField && { [timestampField]: new Date() }),
      ...(body.fare !== undefined && { fare: body.fare }),
      ...(body.distanceKm !== undefined && { distanceKm: body.distanceKm }),
      ...(body.durationMin !== undefined && { durationMin: body.durationMin }),
    };

    // On completion: calculate earnings, update driver metrics
    if (body.status === 'COMPLETED') {
      const fare = body.fare ?? trip.estimatedFare ?? 0;
      const platformFee = fare * 0.15; // 15% platform fee
      data.platformFee = platformFee;
      data.driverEarning = fare - platformFee;
      data.paymentStatus = 'PAID';

      await Promise.all([
        this.prisma.driver.update({
          where: { id: trip.driverId },
          data: {
            status: 'AVAILABLE',
            totalTrips: { increment: 1 },
            totalEarnings: { increment: data.driverEarning },
            totalDistance: { increment: body.distanceKm ?? 0 },
          },
        }),
        this.prisma.vehicle.update({
          where: { id: trip.vehicleId },
          data: { status: 'AVAILABLE' },
        }),
      ]);
    }

    if (body.status === 'CANCELLED') {
      await Promise.all([
        this.prisma.driver.update({
          where: { id: trip.driverId },
          data: { status: 'AVAILABLE' },
        }),
        this.prisma.vehicle.update({
          where: { id: trip.vehicleId },
          data: { status: 'AVAILABLE' },
        }),
      ]);
    }

    const updated = await this.prisma.trip.update({ where: { id }, data });

    this.gateway.emitTripUpdate({
      tripId: id,
      status: body.status,
      driverId: trip.driverId,
      vehicleId: trip.vehicleId,
      ts: new Date().toISOString(),
    });

    // Notify intelligence engine so it can recompute health score + flush trip-insights cache
    if (body.status === 'COMPLETED') {
      this.intelligenceEvents.emitTripCompleted({
        tripId: id,
        vehicleId: trip.vehicleId,
        driverId: trip.driverId,
      });
    }

    return updated;
  }

  async update(id: string, dto: UpdateTripDto) {
    await this.findOne(id);
    return this.prisma.trip.update({ where: { id }, data: dto });
  }

  /** Base fare calculation: $2 flag fall + $1.50/km + $0.25/min */
  private calculateFare(distanceKm: number, durationMin: number): number {
    const base = 2.0;
    const perKm = 1.5;
    const perMin = 0.25;
    return Math.round((base + distanceKm * perKm + durationMin * perMin) * 100) / 100;
  }
}
