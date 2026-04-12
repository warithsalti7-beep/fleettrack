import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { QueryVehiclesDto } from './dto/query-vehicles.dto';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findAll(query: QueryVehiclesDto) {
    const { status, type, telematicsProvider, page = 1, limit = 50 } = query;

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: {
          deletedAt: null,
          ...(status && { status }),
          ...(type && { type }),
          ...(telematicsProvider && { telematicsProvider }),
        },
        include: {
          drivers: {
            where: { removedAt: null },
            include: { driver: { select: { id: true, name: true, status: true } } },
            take: 1,
          },
          _count: { select: { trips: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicle.count({
        where: {
          deletedAt: null,
          ...(status && { status }),
          ...(type && { type }),
        },
      }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, deletedAt: null },
      include: {
        drivers: {
          where: { removedAt: null },
          include: { driver: true },
        },
        maintenanceLogs: {
          orderBy: { scheduledAt: 'desc' },
          take: 5,
        },
        fuelLogs: {
          orderBy: { filledAt: 'desc' },
          take: 5,
        },
        telematicsLogs: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        _count: { select: { trips: true } },
      },
    });

    if (!vehicle) throw new NotFoundException(`Vehicle ${id} not found`);
    return vehicle;
  }

  async create(dto: CreateVehicleDto) {
    return this.prisma.vehicle.create({ data: dto });
  }

  async update(id: string, dto: UpdateVehicleDto) {
    await this.findOne(id);

    const vehicle = await this.prisma.vehicle.update({
      where: { id },
      data: dto,
    });

    // Invalidate cache
    await this.cache.del(`vehicle:${id}:status`);
    return vehicle;
  }

  async updateLocation(
    id: string,
    data: { lat: number; lng: number; speedKmh?: number; heading?: number },
  ) {
    const { lat, lng, speedKmh, heading } = data;

    const vehicle = await this.prisma.vehicle.update({
      where: { id },
      data: {
        locationLat: lat,
        locationLng: lng,
        locationAt: new Date(),
        speedKmh,
        heading,
      },
      select: { id: true, plateNumber: true, locationLat: true, locationLng: true, status: true },
    });

    // Cache for real-time access (TTL 30s)
    await this.cache.set(
      `vehicle:${id}:location`,
      { lat, lng, speedKmh, heading, updatedAt: new Date() },
      30_000,
    );

    return vehicle;
  }

  async getLiveStatus() {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { deletedAt: null, status: { not: 'DECOMMISSIONED' } },
      select: {
        id: true,
        plateNumber: true,
        make: true,
        model: true,
        status: true,
        batteryLevel: true,
        fuelLevel: true,
        isCharging: true,
        locationLat: true,
        locationLng: true,
        locationAt: true,
        speedKmh: true,
      },
    });

    // Merge with Redis cached telemetry for freshness
    const enriched = await Promise.all(
      vehicles.map(async (v) => {
        const cached = await this.cache.get<any>(`vehicle:${v.id}:location`);
        return cached
          ? { ...v, locationLat: cached.lat, locationLng: cached.lng, speedKmh: cached.speedKmh, _cached: true }
          : { ...v, _cached: false };
      }),
    );

    return enriched;
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.vehicle.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
