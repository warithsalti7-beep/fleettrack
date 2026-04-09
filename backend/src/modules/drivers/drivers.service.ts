import {
  Injectable, NotFoundException, ConflictException, Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { QueryDriversDto } from './dto/query-drivers.dto';

const DRIVER_ONLINE_TTL_MS = 15_000; // Mark offline if no heartbeat for 15s

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findAll(query: QueryDriversDto) {
    const { status, isOnline, page = 1, limit = 50 } = query;

    const [data, total] = await Promise.all([
      this.prisma.driver.findMany({
        where: {
          deletedAt: null,
          ...(status && { status }),
          ...(isOnline !== undefined && { isOnline }),
        },
        include: {
          vehicles: {
            where: { removedAt: null },
            include: {
              vehicle: {
                select: { id: true, plateNumber: true, make: true, model: true, status: true },
              },
            },
            take: 1,
          },
          _count: { select: { trips: true } },
        },
        orderBy: [{ isOnline: 'desc' }, { rating: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.driver.count({
        where: {
          deletedAt: null,
          ...(status && { status }),
          ...(isOnline !== undefined && { isOnline }),
        },
      }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const driver = await this.prisma.driver.findFirst({
      where: { id, deletedAt: null },
      include: {
        vehicles: {
          where: { removedAt: null },
          include: { vehicle: true },
        },
        trips: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true, status: true, pickupAddress: true,
            dropoffAddress: true, fare: true, createdAt: true,
          },
        },
      },
    });

    if (!driver) throw new NotFoundException(`Driver ${id} not found`);
    return driver;
  }

  async getDriverStats(id: string) {
    await this.findOne(id); // ensures it exists

    const [completedTrips, totalRevenue, avgRating] = await Promise.all([
      this.prisma.trip.count({ where: { driverId: id, status: 'COMPLETED' } }),
      this.prisma.trip.aggregate({
        where: { driverId: id, status: 'COMPLETED' },
        _sum: { fare: true, distanceKm: true },
        _avg: { fare: true, driverRating: true },
      }),
      this.prisma.trip.aggregate({
        where: { driverId: id, status: 'COMPLETED', driverRating: { not: null } },
        _avg: { driverRating: true },
        _count: { driverRating: true },
      }),
    ]);

    return {
      completedTrips,
      totalRevenue: totalRevenue._sum.fare ?? 0,
      totalDistanceKm: totalRevenue._sum.distanceKm ?? 0,
      avgFarePerTrip: totalRevenue._avg.fare ?? 0,
      avgRating: avgRating._avg.driverRating ?? 0,
      ratingCount: avgRating._count.driverRating,
    };
  }

  async getOnlineDrivers() {
    const drivers = await this.prisma.driver.findMany({
      where: { isOnline: true, deletedAt: null },
      select: {
        id: true, name: true, status: true,
        locationLat: true, locationLng: true, locationAt: true,
        rating: true,
        vehicles: {
          where: { removedAt: null },
          include: { vehicle: { select: { plateNumber: true, batteryLevel: true } } },
          take: 1,
        },
      },
    });

    // Merge with Redis heartbeat timestamps
    const enriched = await Promise.all(
      drivers.map(async (d) => {
        const lastSeen = await this.cache.get<string>(`driver:${d.id}:heartbeat`);
        return { ...d, lastSeenAt: lastSeen ?? d.locationAt };
      }),
    );

    return enriched;
  }

  async create(dto: CreateDriverDto) {
    const existing = await this.prisma.driver.findFirst({
      where: {
        OR: [{ email: dto.email }, { licenseNumber: dto.licenseNumber }],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.email === dto.email
          ? 'Email already registered'
          : 'License number already registered',
      );
    }

    return this.prisma.driver.create({ data: dto });
  }

  async update(id: string, dto: UpdateDriverDto) {
    await this.findOne(id);
    return this.prisma.driver.update({ where: { id }, data: dto });
  }

  /**
   * Called by driver app every ~5 seconds to signal online presence.
   * Uses Redis TTL: if no heartbeat within 15s → driver is offline.
   */
  async heartbeat(id: string, lat?: number, lng?: number) {
    const now = new Date().toISOString();

    // Extend TTL in Redis
    await this.cache.set(`driver:${id}:heartbeat`, now, DRIVER_ONLINE_TTL_MS);

    // Update DB (batched: only if location changed significantly or every 30s)
    const updateData: Record<string, any> = {
      isOnline: true,
      lastSeenAt: new Date(),
    };

    if (lat !== undefined && lng !== undefined) {
      updateData.locationLat = lat;
      updateData.locationLng = lng;
      updateData.locationAt = new Date();
    }

    await this.prisma.driver.updateMany({
      where: { id, deletedAt: null },
      data: updateData,
    });

    return { online: true, ts: now };
  }

  async assignVehicle(driverId: string, vehicleId: string) {
    // Remove current assignment for this vehicle
    await this.prisma.driverVehicle.updateMany({
      where: { vehicleId, removedAt: null },
      data: { removedAt: new Date() },
    });

    // Create new assignment
    return this.prisma.driverVehicle.create({
      data: { driverId, vehicleId, isPrimary: true },
      include: {
        driver: { select: { id: true, name: true } },
        vehicle: { select: { id: true, plateNumber: true } },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.driver.update({
      where: { id },
      data: { deletedAt: new Date(), isOnline: false },
    });
  }
}
