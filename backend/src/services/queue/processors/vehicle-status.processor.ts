import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { RealtimeGateway } from '../../../modules/realtime/realtime.gateway';
import { QUEUE_NAMES } from '../queue.module';

export interface VehicleStatusJobData {
  vehicleId: string;
  previousStatus: string;
  newStatus: string;
}

/**
 * VehicleStatusProcessor — handles status change side-effects.
 *
 * When a vehicle changes status (e.g. AVAILABLE → ON_TRIP):
 * - Broadcasts the change via WebSocket to all admin dashboards
 * - Updates fleet statistics
 * - Logs the transition for analytics
 */
@Processor(QUEUE_NAMES.VEHICLE_STATUS)
export class VehicleStatusProcessor {
  private readonly logger = new Logger(VehicleStatusProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    @InjectQueue(QUEUE_NAMES.TELEMATICS_SYNC)
    private readonly telematicsQueue: Queue,
  ) {}

  @Process('status-changed')
  async handleStatusChanged(job: Job<VehicleStatusJobData>) {
    const { vehicleId, previousStatus, newStatus } = job.data;

    this.logger.log(
      `Vehicle ${vehicleId}: ${previousStatus} → ${newStatus}`,
    );

    // Broadcast to WebSocket subscribers
    this.gateway.emitVehicleStatus({
      vehicleId,
      status: newStatus,
    });

    // If vehicle just became available after a trip, trigger immediate sync
    if (newStatus === 'AVAILABLE' && previousStatus === 'ON_TRIP') {
      await this.telematicsQueue.add(
        'sync-all',
        { vehicleIds: [vehicleId] },
        { delay: 2000, priority: 10 },
      );
    }

    return { processed: true };
  }

  /**
   * Every 10 seconds: trigger a telematics sync for all enabled vehicles.
   *
   * NOTE: Polling every 10s only works for small fleets (< 10 vehicles).
   * For larger fleets:
   *   - Tesla: use Fleet Telemetry (streaming WebSocket from Tesla servers)
   *   - Smartcar: use webhooks (push-based, no polling needed)
   *   - Samsara: use their webhook system
   *
   * Adjust TELEMATICS_SYNC_INTERVAL_MS in .env as needed.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async scheduleTelematicsSync() {
    // Don't queue if a sync job is already waiting or active
    const waiting = await this.telematicsQueue.getWaitingCount();
    const active = await this.telematicsQueue.getActiveCount();

    if (waiting + active > 0) {
      this.logger.debug(`Skipping cron sync — ${waiting} waiting, ${active} active`);
      return;
    }

    await this.telematicsQueue.add('sync-all', {}, {
      removeOnComplete: 50,
      removeOnFail: 20,
    });
  }

  /**
   * Every 30 seconds: broadcast live fleet stats to all connected dashboards.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async broadcastFleetStats() {
    const [onlineDrivers, activeTrips, availableVehicles, chargingVehicles] =
      await Promise.all([
        this.prisma.driver.count({ where: { isOnline: true } }),
        this.prisma.trip.count({ where: { status: 'IN_PROGRESS' } }),
        this.prisma.vehicle.count({ where: { status: 'AVAILABLE', deletedAt: null } }),
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
