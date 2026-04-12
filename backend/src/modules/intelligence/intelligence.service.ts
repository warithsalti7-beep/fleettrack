import {
  Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScoringService,
  HealthScoreResult,
  PredictiveChargingRecommendation,
  FleetAlert,
  TripEfficiencyResult,
} from './scoring.service';
import { FleetConfigService } from './fleet-config.service';
import { RecommendationsService, OperationalRecommendation } from './recommendations.service';
import { IntelligenceEventBus } from './intelligence.events';
import { THRESHOLDS, CACHE_KEYS } from './intelligence.constants';

@Injectable()
export class IntelligenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntelligenceService.name);
  private readonly subs: Subscription[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly configSvc: FleetConfigService,
    private readonly recs: RecommendationsService,
    private readonly eventBus: IntelligenceEventBus,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ─── Event subscriptions ────────────────────────────────────────────────────

  onModuleInit(): void {
    // Telemetry received → partial health score recompute for that vehicle + bust alert/charging caches
    this.subs.push(
      this.eventBus.telemetryReceived$.subscribe(({ vehicleId }) => {
        this.recomputeForVehicle(vehicleId).catch((err) =>
          this.logger.error(`recomputeForVehicle(${vehicleId}) failed: ${err.message}`),
        );
      }),
    );

    // Trip completed → flush trip insights + partial health recompute
    this.subs.push(
      this.eventBus.tripCompleted$.subscribe(({ vehicleId }) => {
        // Flush trip-insights cache (we don't know the exact range key, so bust all of them)
        this.burstTripInsightsCache().catch(() => {});
        this.recomputeForVehicle(vehicleId).catch((err) =>
          this.logger.error(`recomputeForVehicle(${vehicleId}) on trip-completed failed: ${err.message}`),
        );
      }),
    );

    this.logger.log('Intelligence event subscriptions active');
  }

  onModuleDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ─── 1. Vehicle Health Scores ───────────────────────────────────────────────

  async getHealthScores(): Promise<HealthScoreResult[]> {
    const cached = await this.cache.get<HealthScoreResult[]>(CACHE_KEYS.healthScores());
    if (cached) return cached;

    const result = await this.computeHealthScores();
    await this.cache.set(CACHE_KEYS.healthScores(), result, THRESHOLDS.cache.healthScores);
    return result;
  }

  async computeHealthScores(): Promise<HealthScoreResult[]> {
    const [vehicles, config] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { deletedAt: null, status: { not: 'DECOMMISSIONED' } },
        select: {
          id: true,
          batteryLevel: true,
          fuelLevel: true,
          fuelType: true,
          telematicsEnabled: true,
          locationAt: true,
          telematicsLogs: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            select: { timestamp: true, obdCodes: true },
          },
          trips: {
            where: {
              status: 'COMPLETED',
              completedAt: { gte: new Date(Date.now() - 7 * 24 * 3_600_000) },
            },
            select: { id: true },
          },
          maintenanceLogs: {
            where: {
              status: { in: ['OVERDUE', 'SCHEDULED'] },
              scheduledAt: { lt: new Date() },
            },
            select: { priority: true },
            orderBy: { priority: 'desc' },
            take: 1,
          },
        },
      }),
      this.configSvc.getConfig(),
    ]);

    return vehicles.map((v) => {
      const latestLog = v.telematicsLogs[0] ?? null;
      const overdueMaint = v.maintenanceLogs[0] ?? null;
      return this.scoring.computeHealthScore({
        vehicleId: v.id,
        batteryLevel: v.batteryLevel,
        fuelLevel: v.fuelLevel,
        fuelType: v.fuelType,
        telematicsEnabled: v.telematicsEnabled,
        lastLogAt: latestLog?.timestamp ?? null,
        recentTripCount: v.trips.length,
        obdCodes: latestLog?.obdCodes ?? [],
        hasOverdueMaintenance: overdueMaint !== null,
        overduePriority: overdueMaint
          ? (overdueMaint.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL')
          : null,
      }, config);
    });
  }

  /**
   * Event-driven partial recompute — O(1) vehicle DB read + O(n) cache array update.
   * Alerts and charging recs are fleet-wide so they are invalidated fully;
   * the next HTTP request (or next cron run) recomputes them fresh.
   */
  async recomputeForVehicle(vehicleId: string): Promise<void> {
    const [newScore, config] = await Promise.all([
      this.computeHealthScoreForVehicle(vehicleId),
      this.configSvc.getConfig(),
    ]);

    if (!newScore) return; // vehicle not found or decommissioned

    // Partial update inside the cached fleet-scores array
    const cachedScores = await this.cache.get<HealthScoreResult[]>(CACHE_KEYS.healthScores());
    if (cachedScores) {
      const idx = cachedScores.findIndex((s) => s.vehicleId === vehicleId);
      if (idx >= 0) {
        cachedScores[idx] = newScore;
        await this.cache.set(CACHE_KEYS.healthScores(), cachedScores, THRESHOLDS.cache.healthScores);
      }
    }

    // Fleet-wide caches need full recompute (only invalidate; cron or next request re-fills)
    await Promise.allSettled([
      this.cache.del(CACHE_KEYS.alerts()),
      this.cache.del(CACHE_KEYS.chargingRecs()),
    ]);

    this.logger.debug(`Partial recompute complete for vehicle ${vehicleId}`);
  }

  private async computeHealthScoreForVehicle(vehicleId: string): Promise<HealthScoreResult | null> {
    const [v, config] = await Promise.all([
      this.prisma.vehicle.findFirst({
        where: { id: vehicleId, deletedAt: null, status: { not: 'DECOMMISSIONED' } },
        select: {
          id: true,
          batteryLevel: true,
          fuelLevel: true,
          fuelType: true,
          telematicsEnabled: true,
          telematicsLogs: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            select: { timestamp: true, obdCodes: true },
          },
          trips: {
            where: { status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - 7 * 24 * 3_600_000) } },
            select: { id: true },
          },
          maintenanceLogs: {
            where: { status: { in: ['OVERDUE', 'SCHEDULED'] }, scheduledAt: { lt: new Date() } },
            select: { priority: true },
            orderBy: { priority: 'desc' },
            take: 1,
          },
        },
      }),
      this.configSvc.getConfig(),
    ]);

    if (!v) return null;
    const latestLog = v.telematicsLogs[0] ?? null;
    const overdueMaint = v.maintenanceLogs[0] ?? null;

    return this.scoring.computeHealthScore({
      vehicleId: v.id,
      batteryLevel: v.batteryLevel,
      fuelLevel: v.fuelLevel,
      fuelType: v.fuelType,
      telematicsEnabled: v.telematicsEnabled,
      lastLogAt: latestLog?.timestamp ?? null,
      recentTripCount: v.trips.length,
      obdCodes: latestLog?.obdCodes ?? [],
      hasOverdueMaintenance: overdueMaint !== null,
      overduePriority: overdueMaint
        ? (overdueMaint.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL')
        : null,
    }, config);
  }

  // ─── 2. Charging Recommendations (predictive) ───────────────────────────────

  async getChargingRecommendations(): Promise<{
    recommendations: PredictiveChargingRecommendation[];
    meta: { total: number; critical: number; high: number; medium: number; low: number };
  }> {
    const cacheKey = CACHE_KEYS.chargingRecs();
    const cached = await this.cache.get<PredictiveChargingRecommendation[]>(cacheKey);

    let recs: PredictiveChargingRecommendation[];
    if (cached) {
      recs = cached;
    } else {
      recs = await this.computeChargingRecommendations();
      await this.cache.set(cacheKey, recs, THRESHOLDS.cache.chargingRecs);
    }

    return {
      recommendations: recs,
      meta: {
        total:    recs.length,
        critical: recs.filter((r) => r.urgency === 'critical').length,
        high:     recs.filter((r) => r.urgency === 'high').length,
        medium:   recs.filter((r) => r.urgency === 'medium').length,
        low:      recs.filter((r) => r.urgency === 'low').length,
      },
    };
  }

  private async computeChargingRecommendations(): Promise<PredictiveChargingRecommendation[]> {
    const [vehicles, config] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: {
          deletedAt: null,
          fuelType: { in: ['ELECTRIC', 'HYBRID'] },
          status: { notIn: ['DECOMMISSIONED', 'OUT_OF_SERVICE'] },
        },
        select: {
          id: true,
          plateNumber: true,
          make: true,
          model: true,
          batteryLevel: true,
          batteryRange: true,
          isCharging: true,
          status: true,
          trips: {
            where: {
              status: { in: ['PENDING', 'DRIVER_ASSIGNED'] },
              scheduledAt: { lte: new Date(Date.now() + 4 * 3_600_000) },
            },
            select: { id: true },
          },
          // Battery history for drain-rate prediction
          telematicsLogs: {
            where: { timestamp: { gte: new Date(Date.now() - 2 * 3_600_000) } },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true, batteryLevel: true },
            take: 20, // enough readings for a 2h window at 10s intervals
          },
        },
      }),
      this.configSvc.getConfig(),
    ]);

    const recs: PredictiveChargingRecommendation[] = [];
    for (const v of vehicles) {
      const rec = this.scoring.computePredictiveCharging({
        vehicleId: v.id,
        plateNumber: v.plateNumber,
        make: v.make,
        model: v.model,
        batteryLevel: v.batteryLevel,
        batteryRange: v.batteryRange,
        isCharging: v.isCharging,
        status: v.status,
        upcomingTripCount: v.trips.length,
        batteryHistory: v.telematicsLogs.map((l) => ({
          timestamp: l.timestamp,
          batteryLevel: l.batteryLevel,
        })),
      }, config);

      if (rec) recs.push(rec);
    }

    return this.scoring.sortRecommendations(recs);
  }

  // ─── 3. Fleet Alerts ────────────────────────────────────────────────────────

  async getAlerts(): Promise<{
    alerts: FleetAlert[];
    meta: { total: number; critical: number; warning: number; info: number };
  }> {
    const cacheKey = CACHE_KEYS.alerts();
    const cached = await this.cache.get<FleetAlert[]>(cacheKey);

    let alerts: FleetAlert[];
    if (cached) {
      alerts = cached;
    } else {
      alerts = await this.computeAlerts();
      await this.cache.set(cacheKey, alerts, THRESHOLDS.cache.alerts);
    }

    return {
      alerts,
      meta: {
        total:    alerts.length,
        critical: alerts.filter((a) => a.severity === 'critical').length,
        warning:  alerts.filter((a) => a.severity === 'warning').length,
        info:     alerts.filter((a) => a.severity === 'info').length,
      },
    };
  }

  private async computeAlerts(): Promise<FleetAlert[]> {
    const [vehicles, config] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { deletedAt: null, status: { not: 'DECOMMISSIONED' } },
        select: {
          id: true,
          plateNumber: true,
          make: true,
          model: true,
          fuelType: true,
          batteryLevel: true,
          status: true,
          telematicsEnabled: true,
          locationAt: true,
          telematicsLogs: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            select: { timestamp: true, obdCodes: true, batteryRange: true },
          },
          maintenanceLogs: {
            where: {
              status: { in: ['OVERDUE', 'SCHEDULED'] },
              scheduledAt: { lt: new Date() },
            },
            select: { priority: true },
            orderBy: { priority: 'desc' },
            take: 1,
          },
        },
      }),
      this.configSvc.getConfig(),
    ]);

    const allAlerts: FleetAlert[] = [];
    for (const v of vehicles) {
      const latestLog = v.telematicsLogs[0] ?? null;
      const overdueMaint = v.maintenanceLogs[0] ?? null;

      const alerts = this.scoring.evaluateAlerts({
        vehicleId: v.id,
        plateNumber: v.plateNumber,
        make: v.make,
        model: v.model,
        fuelType: v.fuelType,
        batteryLevel: v.batteryLevel,
        status: v.status,
        telematicsEnabled: v.telematicsEnabled,
        lastLocationAt: v.locationAt,
        lastLogAt: latestLog?.timestamp ?? null,
        latestObdCodes: latestLog?.obdCodes ?? [],
        hasOverdueMaintenance: overdueMaint !== null,
        overduePriority: overdueMaint
          ? (overdueMaint.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL')
          : null,
      }, config);

      allAlerts.push(...alerts);
    }

    // Sort by severityScore descending (most impactful first)
    return allAlerts.sort((a, b) => b.severityScore - a.severityScore);
  }

  // ─── 4. Trip Efficiency Insights ────────────────────────────────────────────

  async getTripInsights(from?: string, to?: string): Promise<
    TripEfficiencyResult & { queryRange: { from: string; to: string } }
  > {
    const resolvedFrom = from ?? new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const resolvedTo   = to   ?? new Date().toISOString();
    const cacheKey = CACHE_KEYS.tripInsights(resolvedFrom, resolvedTo);

    const cached = await this.cache.get<TripEfficiencyResult>(cacheKey);
    let result: TripEfficiencyResult;
    if (cached) {
      result = cached;
    } else {
      result = await this.computeTripInsights(resolvedFrom, resolvedTo);
      await this.cache.set(cacheKey, result, THRESHOLDS.cache.tripInsights);
    }

    return { ...result, queryRange: { from: resolvedFrom, to: resolvedTo } };
  }

  private async computeTripInsights(from: string, to: string): Promise<TripEfficiencyResult> {
    const [trips, config] = await Promise.all([
      this.prisma.trip.findMany({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: new Date(from), lte: new Date(to) },
          distanceKm: { not: null },
          durationMin: { not: null },
        },
        select: {
          id: true, vehicleId: true, driverId: true,
          distanceKm: true, durationMin: true, fare: true,
        },
      }),
      this.configSvc.getConfig(),
    ]);

    return this.scoring.computeTripEfficiency(trips, config);
  }

  // ─── 5. Actionable Recommendations ─────────────────────────────────────────

  async getRecommendations(): Promise<{
    recommendations: OperationalRecommendation[];
    meta: { total: number; warning: number; info: number };
  }> {
    const cacheKey = CACHE_KEYS.recommendations();
    const cached = await this.cache.get<OperationalRecommendation[]>(cacheKey);

    let recommendations: OperationalRecommendation[];
    if (cached) {
      recommendations = cached;
    } else {
      recommendations = await this.recs.getRecommendations();
      await this.cache.set(cacheKey, recommendations, THRESHOLDS.cache.recommendations);
    }

    return {
      recommendations,
      meta: {
        total:   recommendations.length,
        warning: recommendations.filter((r) => r.severity === 'warning' || r.severity === 'critical').length,
        info:    recommendations.filter((r) => r.severity === 'info').length,
      },
    };
  }

  // ─── Cache management ────────────────────────────────────────────────────────

  async invalidateAll(): Promise<void> {
    await Promise.allSettled([
      this.cache.del(CACHE_KEYS.healthScores()),
      this.cache.del(CACHE_KEYS.chargingRecs()),
      this.cache.del(CACHE_KEYS.alerts()),
      this.cache.del(CACHE_KEYS.recommendations()),
    ]);
    this.logger.log('Intelligence cache invalidated');
  }

  private async burstTripInsightsCache(): Promise<void> {
    // Bust the default 30-day window key
    const defaultFrom = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const defaultTo   = new Date().toISOString();
    await this.cache.del(CACHE_KEYS.tripInsights(defaultFrom, defaultTo)).catch(() => {});
  }
}
