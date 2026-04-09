import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService, HealthScoreResult, ChargingRecommendation, FleetAlert, TripEfficiencyResult } from './scoring.service';
import { THRESHOLDS, CACHE_KEYS } from './intelligence.constants';

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ─── 1. Vehicle Health Scores ───────────────────────────────────────────────

  async getHealthScores(): Promise<HealthScoreResult[]> {
    const cached = await this.cache.get<HealthScoreResult[]>(CACHE_KEYS.healthScores());
    if (cached) return cached;

    const result = await this.computeHealthScores();
    await this.cache.set(CACHE_KEYS.healthScores(), result, THRESHOLDS.cache.healthScores);
    return result;
  }

  async computeHealthScores(): Promise<HealthScoreResult[]> {
    const vehicles = await this.prisma.vehicle.findMany({
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
    });

    return vehicles.map((v) => {
      const latestLog = v.telematicsLogs[0] ?? null;
      const overdueMaint = v.maintenanceLogs[0] ?? null;
      const priorityOrder = ['CRITICAL', 'URGENT', 'HIGH', 'NORMAL', 'LOW'];
      const overduePriority = overdueMaint
        ? (overdueMaint.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL')
        : null;

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
        overduePriority,
      });
    });
  }

  // ─── 2. Charging Recommendations ───────────────────────────────────────────

  async getChargingRecommendations(): Promise<{
    recommendations: ChargingRecommendation[];
    meta: { total: number; critical: number; high: number; medium: number; low: number };
  }> {
    const cacheKey = CACHE_KEYS.chargingRecs();
    const cached = await this.cache.get<ChargingRecommendation[]>(cacheKey);

    let recs: ChargingRecommendation[];
    if (cached) {
      recs = cached;
    } else {
      recs = await this.computeChargingRecommendations();
      await this.cache.set(cacheKey, recs, THRESHOLDS.cache.chargingRecs);
    }

    return {
      recommendations: recs,
      meta: {
        total: recs.length,
        critical: recs.filter((r) => r.urgency === 'critical').length,
        high:     recs.filter((r) => r.urgency === 'high').length,
        medium:   recs.filter((r) => r.urgency === 'medium').length,
        low:      recs.filter((r) => r.urgency === 'low').length,
      },
    };
  }

  private async computeChargingRecommendations(): Promise<ChargingRecommendation[]> {
    const fourHoursFromNow = new Date(Date.now() + 4 * 3_600_000);

    const vehicles = await this.prisma.vehicle.findMany({
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
            scheduledAt: { lte: fourHoursFromNow },
          },
          select: { id: true },
        },
      },
    });

    const recs: ChargingRecommendation[] = [];
    for (const v of vehicles) {
      const rec = this.scoring.computeChargingRecommendation({
        vehicleId: v.id,
        plateNumber: v.plateNumber,
        make: v.make,
        model: v.model,
        batteryLevel: v.batteryLevel,
        batteryRange: v.batteryRange,
        isCharging: v.isCharging,
        status: v.status,
        upcomingTripCount: v.trips.length,
      });
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
    const vehicles = await this.prisma.vehicle.findMany({
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
    });

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
      });

      allAlerts.push(...alerts);
    }

    // Critical alerts first, then warnings, then info; stable sort within severity
    return allAlerts.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
  }

  // ─── 4. Trip Efficiency Insights ────────────────────────────────────────────

  async getTripInsights(from?: string, to?: string): Promise<
    TripEfficiencyResult & {
      queryRange: { from: string; to: string };
    }
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
    const trips = await this.prisma.trip.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: {
          gte: new Date(from),
          lte: new Date(to),
        },
        distanceKm: { not: null },
        durationMin: { not: null },
      },
      select: {
        id: true,
        vehicleId: true,
        driverId: true,
        distanceKm: true,
        durationMin: true,
        fare: true,
      },
    });

    return this.scoring.computeTripEfficiency(trips);
  }

  // ─── Cache invalidation ─────────────────────────────────────────────────────

  async invalidateAll(): Promise<void> {
    await Promise.allSettled([
      this.cache.del(CACHE_KEYS.healthScores()),
      this.cache.del(CACHE_KEYS.chargingRecs()),
      this.cache.del(CACHE_KEYS.alerts()),
    ]);
    this.logger.log('Intelligence cache invalidated');
  }
}
