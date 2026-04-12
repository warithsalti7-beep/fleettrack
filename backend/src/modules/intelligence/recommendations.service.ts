/**
 * RecommendationsService — transforms fleet analytics into actionable insights.
 *
 * All analysis is deterministic: no ML, no probabilities.
 * Single DB query fetches 30-day trip data; everything else is in-memory.
 *
 * Recommendation types
 * ──────────────────────────────────────────────────────────────────────
 * DRIVER_HIGH_IDLE_RATIO       — driver's min/km > 1.3× fleet avg
 * DRIVER_BELOW_FLEET_SPEED     — driver's avg speed < 80% of fleet avg
 * DRIVER_LOW_COMPLETION_RATE   — < 80% of trips completed (not cancelled)
 * VEHICLE_EFFICIENCY_DECLINE   — vehicle's avg speed in last 7d < 80% of prior 7d
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendationType } from './intelligence.constants';

// ─── Output types ─────────────────────────────────────────────────────────────

export interface OperationalRecommendation {
  /** Deterministic: `{type}:{entityId}` */
  id: string;
  type: RecommendationType;
  entity: {
    type: 'driver' | 'vehicle';
    id: string;
    /** Human-readable label (driver name or plate number) */
    label: string;
  };
  insight: string;
  suggestedAction: string;
  severity: 'info' | 'warning' | 'critical';
  /** Supporting numbers so the frontend can render charts or badges */
  metrics: Record<string, number | string>;
  detectedAt: string;
}

// ─── Internal analysis types ──────────────────────────────────────────────────

interface DriverMetrics {
  driverId: string;
  driverName: string;
  tripCount: number;
  cancelledCount: number;
  completedCount: number;
  totalDistanceKm: number;
  totalDurationMin: number;
  avgSpeedKmh: number;
  avgIdleRatio: number; // durationMin / distanceKm (higher = more idle time per km)
}

interface VehicleWindow {
  vehicleId: string;
  plateNumber: string;
  make: string;
  model: string;
  lastSevenDays: { speeds: number[] };
  priorSevenDays: { speeds: number[] };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRecommendations(): Promise<OperationalRecommendation[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3_600_000);
    const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 3_600_000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3_600_000);

    // Single query: all completed + cancelled trips in last 30 days with driver + vehicle
    const trips = await this.prisma.trip.findMany({
      where: {
        status: { in: ['COMPLETED', 'CANCELLED'] },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        vehicleId: true,
        driverId: true,
        status: true,
        distanceKm: true,
        durationMin: true,
        completedAt: true,
        driver:  { select: { id: true, name: true } },
        vehicle: { select: { id: true, plateNumber: true, make: true, model: true } },
      },
    });

    const recommendations: OperationalRecommendation[] = [];

    // ── Driver analytics ────────────────────────────────────────────────────

    const driverMetrics = this.buildDriverMetrics(trips);
    const fleetAvgSpeed = this.fleetAvg(driverMetrics.map((d) => d.avgSpeedKmh).filter((s) => s > 0));
    const fleetAvgIdleRatio = this.fleetAvg(driverMetrics.map((d) => d.avgIdleRatio).filter((r) => r > 0));

    for (const dm of driverMetrics) {
      if (dm.tripCount < 3) continue; // not enough data for reliable analysis

      // DRIVER_HIGH_IDLE_RATIO: durationMin/km > 1.3× fleet avg
      if (fleetAvgIdleRatio > 0 && dm.avgIdleRatio > fleetAvgIdleRatio * 1.3) {
        const pctAbove = Math.round(((dm.avgIdleRatio / fleetAvgIdleRatio) - 1) * 100);
        recommendations.push({
          id: `DRIVER_HIGH_IDLE_RATIO:${dm.driverId}`,
          type: 'DRIVER_HIGH_IDLE_RATIO',
          entity: { type: 'driver', id: dm.driverId, label: dm.driverName },
          insight: `${dm.driverName} spends ${pctAbove}% more time per km than the fleet average, indicating high idle or stop time.`,
          suggestedAction: 'Review route choices, stop frequency, and idling habits. Consider driver coaching session.',
          severity: pctAbove >= 60 ? 'warning' : 'info',
          metrics: {
            avgMinPerKm: parseFloat(dm.avgIdleRatio.toFixed(2)),
            fleetAvgMinPerKm: parseFloat(fleetAvgIdleRatio.toFixed(2)),
            pctAboveFleetAvg: pctAbove,
            tripsAnalyzed: dm.tripCount,
          },
          detectedAt: new Date().toISOString(),
        });
      }

      // DRIVER_BELOW_FLEET_SPEED: avg speed < 80% of fleet avg
      if (fleetAvgSpeed > 0 && dm.avgSpeedKmh > 0 && dm.avgSpeedKmh < fleetAvgSpeed * 0.8) {
        const pctBelow = Math.round((1 - dm.avgSpeedKmh / fleetAvgSpeed) * 100);
        recommendations.push({
          id: `DRIVER_BELOW_FLEET_SPEED:${dm.driverId}`,
          type: 'DRIVER_BELOW_FLEET_SPEED',
          entity: { type: 'driver', id: dm.driverId, label: dm.driverName },
          insight: `${dm.driverName}'s average speed (${dm.avgSpeedKmh.toFixed(1)} km/h) is ${pctBelow}% below the fleet average (${fleetAvgSpeed.toFixed(1)} km/h).`,
          suggestedAction: 'Check for systematic route issues, traffic patterns, or driving style. Compare against trips in same time windows.',
          severity: pctBelow >= 40 ? 'warning' : 'info',
          metrics: {
            driverAvgSpeedKmh: parseFloat(dm.avgSpeedKmh.toFixed(2)),
            fleetAvgSpeedKmh: parseFloat(fleetAvgSpeed.toFixed(2)),
            pctBelowFleetAvg: pctBelow,
            tripsAnalyzed: dm.tripCount,
          },
          detectedAt: new Date().toISOString(),
        });
      }

      // DRIVER_LOW_COMPLETION_RATE: < 80% of trips completed
      const completionRate = dm.tripCount > 0 ? dm.completedCount / dm.tripCount : 1;
      if (dm.tripCount >= 5 && completionRate < 0.8) {
        const ratePct = Math.round(completionRate * 100);
        recommendations.push({
          id: `DRIVER_LOW_COMPLETION_RATE:${dm.driverId}`,
          type: 'DRIVER_LOW_COMPLETION_RATE',
          entity: { type: 'driver', id: dm.driverName, label: dm.driverName },
          insight: `${dm.driverName} completed only ${ratePct}% of assigned trips (${dm.completedCount}/${dm.tripCount}) in the last 30 days.`,
          suggestedAction: 'Review cancellation reasons. Consider performance review or retraining if pattern persists.',
          severity: ratePct < 60 ? 'warning' : 'info',
          metrics: {
            completionRatePct: ratePct,
            completedTrips: dm.completedCount,
            cancelledTrips: dm.cancelledCount,
            totalTrips: dm.tripCount,
          },
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // ── Vehicle analytics: efficiency decline ────────────────────────────────

    const vehicleWindows = this.buildVehicleWindows(trips, sevenDaysAgo, fourteenDaysAgo);

    for (const vw of vehicleWindows) {
      if (vw.lastSevenDays.speeds.length < 3 || vw.priorSevenDays.speeds.length < 3) continue;

      const recentAvg = this.fleetAvg(vw.lastSevenDays.speeds);
      const priorAvg  = this.fleetAvg(vw.priorSevenDays.speeds);

      if (priorAvg > 0 && recentAvg < priorAvg * 0.8) {
        const declinePct = Math.round((1 - recentAvg / priorAvg) * 100);
        const label = `${vw.make} ${vw.model} (${vw.plateNumber})`;
        recommendations.push({
          id: `VEHICLE_EFFICIENCY_DECLINE:${vw.vehicleId}`,
          type: 'VEHICLE_EFFICIENCY_DECLINE',
          entity: { type: 'vehicle', id: vw.vehicleId, label },
          insight: `${label} shows a ${declinePct}% drop in average trip speed over the last 7 days (${recentAvg.toFixed(1)} km/h) compared to the prior week (${priorAvg.toFixed(1)} km/h).`,
          suggestedAction: 'Inspect vehicle for mechanical issues, tyre pressure, or battery degradation. Schedule a service check.',
          severity: declinePct >= 30 ? 'warning' : 'info',
          metrics: {
            recentAvgSpeedKmh: parseFloat(recentAvg.toFixed(2)),
            priorAvgSpeedKmh: parseFloat(priorAvg.toFixed(2)),
            declinePct,
            recentTripCount: vw.lastSevenDays.speeds.length,
            priorTripCount: vw.priorSevenDays.speeds.length,
          },
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Sort: warning before info, then by insight length (shorter = more focused)
    return recommendations.sort((a, b) => {
      const sOrder = { critical: 0, warning: 1, info: 2 };
      return sOrder[a.severity] - sOrder[b.severity];
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private buildDriverMetrics(trips: any[]): DriverMetrics[] {
    const map = new Map<string, DriverMetrics>();

    for (const t of trips) {
      if (!t.driver) continue;
      if (!map.has(t.driverId)) {
        map.set(t.driverId, {
          driverId: t.driverId,
          driverName: t.driver.name,
          tripCount: 0,
          cancelledCount: 0,
          completedCount: 0,
          totalDistanceKm: 0,
          totalDurationMin: 0,
          avgSpeedKmh: 0,
          avgIdleRatio: 0,
        });
      }

      const m = map.get(t.driverId)!;
      m.tripCount++;

      if (t.status === 'CANCELLED') { m.cancelledCount++; continue; }
      if (t.status !== 'COMPLETED') continue;

      m.completedCount++;
      if (t.distanceKm && t.durationMin && t.distanceKm > 0.5 && t.durationMin > 0) {
        m.totalDistanceKm += t.distanceKm;
        m.totalDurationMin += t.durationMin;
      }
    }

    for (const m of map.values()) {
      if (m.totalDistanceKm > 0 && m.totalDurationMin > 0) {
        m.avgSpeedKmh = (m.totalDistanceKm / m.totalDurationMin) * 60;
        m.avgIdleRatio = m.totalDurationMin / m.totalDistanceKm; // min per km
      }
    }

    return Array.from(map.values());
  }

  private buildVehicleWindows(
    trips: any[],
    sevenDaysAgo: Date,
    fourteenDaysAgo: Date,
  ): VehicleWindow[] {
    const map = new Map<string, VehicleWindow>();

    for (const t of trips) {
      if (t.status !== 'COMPLETED' || !t.vehicle) continue;
      if (!t.distanceKm || !t.durationMin || t.distanceKm < 0.5 || t.durationMin <= 0) continue;

      if (!map.has(t.vehicleId)) {
        map.set(t.vehicleId, {
          vehicleId: t.vehicleId,
          plateNumber: t.vehicle.plateNumber,
          make: t.vehicle.make,
          model: t.vehicle.model,
          lastSevenDays: { speeds: [] },
          priorSevenDays: { speeds: [] },
        });
      }

      const vw = map.get(t.vehicleId)!;
      const speed = (t.distanceKm / t.durationMin) * 60;
      const completedAt = t.completedAt ? new Date(t.completedAt) : null;

      if (!completedAt) continue;

      if (completedAt >= sevenDaysAgo) {
        vw.lastSevenDays.speeds.push(speed);
      } else if (completedAt >= fourteenDaysAgo) {
        vw.priorSevenDays.speeds.push(speed);
      }
    }

    return Array.from(map.values());
  }

  private fleetAvg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}
