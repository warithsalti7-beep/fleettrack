/**
 * TelematicsSyncProcessor — BullMQ job processor for vehicle data polling.
 *
 * DATA PIPELINE:
 * ──────────────────────────────────────────────────────────────
 * 1. A NestJS @Cron job (every 10s) adds a 'sync-all' job to the queue
 * 2. This processor picks it up and:
 *    a. Fetches all telematicsEnabled vehicles from DB
 *    b. For each vehicle, calls the appropriate API (Tesla/Smartcar)
 *    c. Writes a TelematicsLog row to PostgreSQL
 *    d. Updates vehicle lat/lng/battery in the Vehicle table
 *    e. Caches the result in Redis (TTL 30s)
 *    f. Emits a WebSocket event to connected dashboards
 *
 * WHY QUEUES vs CRON?
 * ─────────────────────────────────────────────────────────────
 * - Queue workers can be scaled horizontally (multiple instances)
 * - Failed jobs are retried automatically with exponential backoff
 * - Jobs are distributed across workers (no duplicate processing)
 * - Visibility into job history via Bull Board UI
 *
 * RATE LIMIT HANDLING:
 * ─────────────────────────────────────────────────────────────
 * - Tesla: 1 req/min per vehicle → 25 vehicles needs 25 min to full cycle
 *   Use Tesla Fleet Telemetry (streaming) instead for large fleets
 * - Smartcar: 1 req/s per application → batch with delays
 */

import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { RealtimeGateway } from '../../../modules/realtime/realtime.gateway';
import { TeslaService } from '../../tesla/tesla.service';
import { NioService } from '../../nio/nio.service';
import { QUEUE_NAMES } from '../queue.module';

export interface TelematicsSyncJobData {
  vehicleIds?: string[];  // Optional: sync specific vehicles; undefined = all
}

@Processor(QUEUE_NAMES.TELEMATICS_SYNC)
export class TelematicsSyncProcessor {
  private readonly logger = new Logger(TelematicsSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    private readonly tesla: TeslaService,
    private readonly nio: NioService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  @Process('sync-all')
  async handleSyncAll(job: Job<TelematicsSyncJobData>) {
    this.logger.debug(`Processing telematics-sync job #${job.id}`);

    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        telematicsEnabled: true,
        deletedAt: null,
        status: { not: 'DECOMMISSIONED' },
        ...(job.data.vehicleIds?.length && { id: { in: job.data.vehicleIds } }),
      },
      select: {
        id: true,
        telematicsProvider: true,
        telematicsVehicleId: true,
        plateNumber: true,
      },
    });

    if (vehicles.length === 0) {
      this.logger.debug('No telematics-enabled vehicles to sync');
      return;
    }

    this.logger.debug(`Syncing ${vehicles.length} vehicles`);
    let synced = 0;
    let failed = 0;

    for (const vehicle of vehicles) {
      try {
        await this.syncVehicle(vehicle);
        synced++;
      } catch (error: any) {
        failed++;
        this.logger.error(`Failed to sync ${vehicle.plateNumber}: ${error.message}`);
      }

      // Respectful delay between API calls to stay within rate limits
      // Tesla: ~1 req/min → 60s delay; Smartcar: ~1 req/s → 1.1s delay
      const delayMs =
        vehicle.telematicsProvider === 'TESLA_FLEET' ? 61_000 : 1_100;

      if (vehicles.indexOf(vehicle) < vehicles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.log(`Telematics sync complete: ${synced} OK, ${failed} failed`);

    // Broadcast fleet stats
    await this.broadcastFleetStats();

    return { synced, failed };
  }

  private async syncVehicle(vehicle: {
    id: string;
    telematicsProvider: string;
    telematicsVehicleId: string | null;
    plateNumber: string;
  }) {
    if (!vehicle.telematicsVehicleId) {
      this.logger.warn(`Vehicle ${vehicle.plateNumber} has no telematicsVehicleId`);
      return;
    }

    // Get access token from cache/DB (in production, stored encrypted in DB)
    const accessToken = await this.cache.get<string>(
      `token:${vehicle.telematicsProvider}:${vehicle.id}`,
    );

    if (!accessToken) {
      this.logger.warn(`No access token for vehicle ${vehicle.plateNumber} — skipping`);
      return;
    }

    let telemetry: any = null;

    switch (vehicle.telematicsProvider) {
      case 'TESLA_FLEET':
        telemetry = await this.tesla.getNormalizedTelemetry(
          vehicle.id,
          vehicle.telematicsVehicleId,
          accessToken,
        );
        break;

      case 'SMARTCAR':
        telemetry = await this.nio.getNormalizedTelemetry(
          vehicle.id,
          vehicle.telematicsVehicleId,
          accessToken,
        );
        break;

      default:
        this.logger.warn(`Unknown provider: ${vehicle.telematicsProvider}`);
        return;
    }

    if (!telemetry) return; // Vehicle asleep or rate limited

    // ─── Persist to PostgreSQL ──────────────────────────────────────────────
    await this.prisma.$transaction([
      // Write time-series telematics log
      this.prisma.telematicsLog.create({
        data: {
          vehicleId: vehicle.id,
          latitude: telemetry.latitude,
          longitude: telemetry.longitude,
          speedKmh: telemetry.speedKmh,
          heading: telemetry.heading,
          batteryLevel: telemetry.batteryLevel,
          batteryRange: telemetry.batteryRangeKm,
          isCharging: telemetry.isCharging,
          chargingPower: telemetry.chargingPowerKw,
          odometer: telemetry.odometer,
          provider: vehicle.telematicsProvider as any,
          timestamp: telemetry.timestamp,
        },
      }),

      // Update vehicle record with latest snapshot
      this.prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          locationLat: telemetry.latitude,
          locationLng: telemetry.longitude,
          locationAt: telemetry.timestamp,
          speedKmh: telemetry.speedKmh,
          heading: telemetry.heading,
          batteryLevel: telemetry.batteryLevel,
          batteryRange: telemetry.batteryRangeKm,
          isCharging: telemetry.isCharging,
          mileage: telemetry.odometer,
        },
      }),
    ]);

    // ─── Cache in Redis ─────────────────────────────────────────────────────
    await this.cache.set(
      `vehicle:${vehicle.id}:location`,
      {
        lat: telemetry.latitude,
        lng: telemetry.longitude,
        speedKmh: telemetry.speedKmh,
        heading: telemetry.heading,
        updatedAt: new Date(),
      },
      30_000,
    );

    // ─── Broadcast via WebSocket ────────────────────────────────────────────
    this.gateway.emitVehicleLocation({
      vehicleId: vehicle.id,
      lat: telemetry.latitude,
      lng: telemetry.longitude,
      speedKmh: telemetry.speedKmh,
      heading: telemetry.heading,
      batteryLevel: telemetry.batteryLevel,
      isCharging: telemetry.isCharging,
      ts: new Date().toISOString(),
    });

    if (telemetry.isCharging) {
      this.gateway.emitVehicleCharging({
        vehicleId: vehicle.id,
        isCharging: true,
        chargingPower: telemetry.chargingPowerKw,
        batteryLevel: telemetry.batteryLevel,
      });
    }
  }

  private async broadcastFleetStats() {
    const [onlineDrivers, activeTrips, availableVehicles, chargingVehicles] =
      await Promise.all([
        this.prisma.driver.count({ where: { isOnline: true } }),
        this.prisma.trip.count({ where: { status: 'IN_PROGRESS' } }),
        this.prisma.vehicle.count({ where: { status: 'AVAILABLE' } }),
        this.prisma.vehicle.count({ where: { isCharging: true } }),
      ]);

    this.gateway.emitFleetStats({
      onlineDrivers,
      activeTrips,
      availableVehicles,
      chargingVehicles,
    });
  }
}
