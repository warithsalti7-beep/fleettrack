import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TelematicsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLogsForVehicle(
    vehicleId: string,
    from?: string,
    to?: string,
    limit = 100,
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException(`Vehicle ${vehicleId} not found`);

    return this.prisma.telematicsLog.findMany({
      where: {
        vehicleId,
        ...(from || to
          ? {
              recordedAt: {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
              },
            }
          : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }

  async getLatestLog(vehicleId: string) {
    const log = await this.prisma.telematicsLog.findFirst({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
    });
    if (!log) throw new NotFoundException(`No telematics data for vehicle ${vehicleId}`);
    return log;
  }

  async getFleetEvSummary() {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        plateNumber: true,
        make: true,
        model: true,
        fuelType: true,
        batteryLevel: true,
        batteryRangeKm: true,
        chargingState: true,
        status: true,
        locationLat: true,
        locationLng: true,
        lastSeenAt: true,
        telematicsProvider: true,
        telematicsEnabled: true,
      },
    });

    const evVehicles = vehicles.filter(
      (v) => v.fuelType === 'ELECTRIC' || v.fuelType === 'HYBRID',
    );

    const chargingSummary = {
      charging: evVehicles.filter((v) => v.chargingState === 'CHARGING').length,
      complete: evVehicles.filter((v) => v.chargingState === 'COMPLETE').length,
      notCharging: evVehicles.filter((v) => v.chargingState === 'NOT_CHARGING').length,
      unplugged: evVehicles.filter((v) => v.chargingState === 'UNPLUGGED').length,
    };

    const batteryLevels = evVehicles
      .filter((v) => v.batteryLevel !== null)
      .map((v) => v.batteryLevel as number);

    const avgBattery =
      batteryLevels.length > 0
        ? Math.round(batteryLevels.reduce((a, b) => a + b, 0) / batteryLevels.length)
        : null;

    const lowBattery = evVehicles.filter(
      (v) => v.batteryLevel !== null && (v.batteryLevel as number) < 20,
    );

    return {
      totalEvVehicles: evVehicles.length,
      avgBatteryLevel: avgBattery,
      lowBattery: lowBattery.map((v) => ({
        id: v.id,
        plateNumber: v.plateNumber,
        batteryLevel: v.batteryLevel,
        batteryRangeKm: v.batteryRangeKm,
      })),
      chargingSummary,
      providerBreakdown: this.groupByProvider(vehicles),
    };
  }

  async getVehicleBatteryHistory(vehicleId: string, hours = 24) {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);

    const logs = await this.prisma.telematicsLog.findMany({
      where: {
        vehicleId,
        recordedAt: { gte: from },
        batteryLevel: { not: null },
      },
      select: {
        recordedAt: true,
        batteryLevel: true,
        batteryRangeKm: true,
        chargingState: true,
        speedKph: true,
      },
      orderBy: { recordedAt: 'asc' },
    });

    return { vehicleId, hours, dataPoints: logs };
  }

  async getFleetLocationSnapshot() {
    return this.prisma.vehicle.findMany({
      where: {
        deletedAt: null,
        locationLat: { not: null },
        locationLng: { not: null },
      },
      select: {
        id: true,
        plateNumber: true,
        make: true,
        model: true,
        status: true,
        locationLat: true,
        locationLng: true,
        batteryLevel: true,
        chargingState: true,
        lastSeenAt: true,
        driver: {
          where: { active: true },
          select: { driver: { select: { id: true, name: true, phone: true } } },
          take: 1,
        },
      },
    });
  }

  private groupByProvider(vehicles: Array<{ telematicsProvider: string | null }>) {
    const result: Record<string, number> = {};
    for (const v of vehicles) {
      const provider = v.telematicsProvider ?? 'NONE';
      result[provider] = (result[provider] ?? 0) + 1;
    }
    return result;
  }
}
