/**
 * ScoringService — pure, stateless logic.
 *
 * No database calls, no HTTP calls, no injected dependencies.
 * Every public method takes plain data and returns plain results.
 * All FleetConfig parameters are optional — tests pass without supplying them.
 *
 * BACKWARD COMPAT NOTE
 * All existing call sites continue to work unchanged because:
 *   - config parameters default to DEFAULT_CONFIG
 *   - ChargingRecommendation & FleetAlert interfaces are strictly extended
 *     (new fields added, nothing removed)
 */

import { Injectable } from '@nestjs/common';
import {
  DEFAULT_CONFIG,
  GRADE_BOUNDARIES,
  FleetConfig,
  HealthGrade,
  UrgencyLevel,
  AlertType,
  AlertSeverity,
  AlertPriority,
} from './intelligence.constants';

// ─── Health score types ───────────────────────────────────────────────────────

export interface HealthScoreInput {
  vehicleId: string;
  batteryLevel: number | null;
  fuelLevel: number | null;
  fuelType: string;
  telematicsEnabled: boolean;
  lastLogAt: Date | null;
  recentTripCount: number;
  obdCodes: string[];
  hasOverdueMaintenance: boolean;
  overduePriority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL' | null;
}

export interface HealthScoreComponents {
  energy: number;
  freshness: number;
  utilization: number;
  diagnostics: number;
  maintenance: number;
}

export interface HealthScoreResult {
  vehicleId: string;
  score: number;
  grade: HealthGrade;
  components: HealthScoreComponents;
  flags: string[];
}

// ─── Charging types ───────────────────────────────────────────────────────────

export interface ChargingInput {
  vehicleId: string;
  plateNumber: string;
  make: string;
  model: string;
  batteryLevel: number | null;
  batteryRange: number | null;
  isCharging: boolean;
  status: string;
  upcomingTripCount: number;
}

export interface ChargingRecommendation {
  vehicleId: string;
  plateNumber: string;
  make: string;
  model: string;
  batteryLevel: number;
  batteryRangeKm: number | null;
  urgency: UrgencyLevel;
  reason: string;
  suggestedAction: string;
  isCurrentlyCharging: boolean;
  upcomingTrips: number;
}

/** Extended input that includes battery history for predictive drain calculation */
export interface PredictiveChargingInput extends ChargingInput {
  /**
   * Battery readings ordered oldest → newest, fetched from the last 2 h of
   * telematics logs. Minimum 2 entries needed to compute a drain rate.
   */
  batteryHistory: Array<{ timestamp: Date; batteryLevel: number | null }>;
}

/** ChargingRecommendation extended with predictive fields */
export interface PredictiveChargingRecommendation extends ChargingRecommendation {
  /** Estimated minutes until battery reaches the critical threshold */
  timeToDepletionMin: number | null;
  /** ISO timestamp by which charging should start to stay above medium threshold */
  recommendedChargeBy: string | null;
  /** Battery drain in percentage points per hour; null if not enough data */
  drainRatePerHour: number | null;
  /** 'telemetry' — computed from real readings; 'estimated' — default assumption */
  predictionBasis: 'telemetry' | 'estimated';
}

// ─── Trip efficiency types ────────────────────────────────────────────────────

export interface TripEfficiencyInput {
  id: string;
  vehicleId: string;
  driverId: string;
  distanceKm: number | null;
  durationMin: number | null;
  fare: number | null;
}

export interface TripFlag {
  tripId: string;
  vehicleId: string;
  driverId: string;
  distanceKm: number;
  durationMin: number;
  avgSpeedKmh: number;
  farePerKm: number | null;
  flags: string[];
}

export interface TripEfficiencyResult {
  totalTripsAnalyzed: number;
  fleetAvgSpeedKmh: number;
  fleetAvgFarePerKm: number;
  fleetAvgDurationMin: number;
  inefficientTrips: TripFlag[];
  vehicleSummaries: Array<{
    vehicleId: string;
    tripCount: number;
    avgSpeedKmh: number;
    avgFarePerKm: number;
  }>;
}

// ─── Alert types ──────────────────────────────────────────────────────────────

export interface AlertInput {
  vehicleId: string;
  plateNumber: string;
  make: string;
  model: string;
  fuelType: string;
  batteryLevel: number | null;
  status: string;
  telematicsEnabled: boolean;
  lastLocationAt: Date | null;
  lastLogAt: Date | null;
  latestObdCodes: string[];
  hasOverdueMaintenance: boolean;
  overduePriority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL' | null;
}

export interface FleetAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  /** Numeric 0–100 impact score; used for sorting and badge colour */
  severityScore: number;
  /** Human-readable priority level derived from severityScore */
  priority: AlertPriority;
  vehicleId: string;
  plateNumber: string;
  message: string;
  detail: string;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ScoringService {

  // ── Health scoring ────────────────────────────────────────────────────────

  computeHealthScore(
    input: HealthScoreInput,
    config: FleetConfig = DEFAULT_CONFIG,
  ): HealthScoreResult {
    const flags: string[] = [];

    const energy      = this.scoreEnergy(input, config, flags);
    const freshness   = this.scoreFreshness(input, config, flags);
    const utilization = this.scoreUtilization(input, config, flags);
    const diagnostics = this.scoreDiagnostics(input, config, flags);
    const maintenance = this.scoreMaintenance(input, config, flags);

    const score = Math.round(energy + freshness + utilization + diagnostics + maintenance);
    const grade = this.toGrade(score);

    return {
      vehicleId: input.vehicleId,
      score,
      grade,
      components: { energy, freshness, utilization, diagnostics, maintenance },
      flags,
    };
  }

  private scoreEnergy(
    input: HealthScoreInput,
    config: FleetConfig,
    flags: string[],
  ): number {
    const maxPts = config.health.weights.energy;
    const isElectric = input.fuelType === 'ELECTRIC' || input.fuelType === 'HYBRID';
    const level = isElectric ? (input.batteryLevel ?? null) : (input.fuelLevel ?? null);

    if (level === null) {
      if (isElectric) flags.push('Battery level unknown');
      return isElectric ? 0 : Math.round(maxPts / 2);
    }

    if (level <= config.battery.critical) flags.push(`Critical energy level (${level}%)`);
    else if (level <= config.battery.high) flags.push(`Low energy level (${level}%)`);

    return Math.round((level / 100) * maxPts);
  }

  private scoreFreshness(
    input: HealthScoreInput,
    config: FleetConfig,
    flags: string[],
  ): number {
    if (!input.telematicsEnabled) return config.health.weights.freshness;

    if (!input.lastLogAt) {
      flags.push('No telematics data received');
      return 0;
    }

    const ageMin = (Date.now() - input.lastLogAt.getTime()) / 60_000;
    const max = config.health.weights.freshness;

    if (ageMin < 10) return max;
    if (ageMin < 30) return Math.round(max * 0.75);
    if (ageMin < 60) {
      flags.push('Telematics data stale (> 30 min)');
      return Math.round(max * 0.5);
    }
    if (ageMin < config.inactivity.vehicleHours * 60) {
      flags.push('Telematics data stale (> 1 h)');
      return Math.round(max * 0.25);
    }
    flags.push(`No telematics signal for ${Math.round(ageMin / 60)} h`);
    return 0;
  }

  private scoreUtilization(
    input: HealthScoreInput,
    config: FleetConfig,
    flags: string[],
  ): number {
    const n = input.recentTripCount;
    const max = config.health.weights.utilization;

    if (n === 0) { flags.push('No trips in last 7 days'); return Math.round(max * 0.5); }
    if (n <= 5)  return max;
    if (n <= 15) return Math.round(max * 0.75);
    flags.push('Very high utilization (> 15 trips / 7 days)');
    return Math.round(max * 0.5);
  }

  private scoreDiagnostics(
    input: HealthScoreInput,
    config: FleetConfig,
    flags: string[],
  ): number {
    const faultCount = input.obdCodes.length;
    const max = config.health.weights.diagnostics;
    if (faultCount === 0) return max;

    flags.push(`${faultCount} active OBD fault code${faultCount > 1 ? 's' : ''}: ${input.obdCodes.slice(0, 3).join(', ')}`);
    const penalty = Math.min(faultCount * config.health.obdFaultPenalty, config.health.maxObdPenalty);
    return Math.max(0, max - penalty);
  }

  private scoreMaintenance(
    input: HealthScoreInput,
    config: FleetConfig,
    flags: string[],
  ): number {
    const max = config.health.weights.maintenance;
    if (!input.hasOverdueMaintenance) return max;

    const p = input.overduePriority;
    if (p === 'LOW' || p === 'NORMAL') {
      flags.push('Maintenance overdue (normal priority)');
      return Math.round(max * 0.5);
    }
    flags.push(`Maintenance overdue (${p ?? 'HIGH'} priority)`);
    return 0;
  }

  toGrade(score: number): HealthGrade {
    for (const { min, grade } of GRADE_BOUNDARIES) {
      if (score >= min) return grade as HealthGrade;
    }
    return 'F';
  }

  // ── Charging — threshold-based (backward compat) ──────────────────────────

  computeChargingRecommendation(
    input: ChargingInput,
    config: FleetConfig = DEFAULT_CONFIG,
  ): ChargingRecommendation | null {
    const { batteryLevel, isCharging } = input;
    if (batteryLevel === null) return null;
    if (batteryLevel > config.battery.low) return null;

    const urgency = this.chargeUrgency(batteryLevel, config);
    const { reason, suggestedAction } = this.chargeReason(batteryLevel, isCharging, input.upcomingTripCount, config);

    return {
      vehicleId: input.vehicleId,
      plateNumber: input.plateNumber,
      make: input.make,
      model: input.model,
      batteryLevel,
      batteryRangeKm: input.batteryRange,
      urgency,
      reason,
      suggestedAction,
      isCurrentlyCharging: isCharging,
      upcomingTrips: input.upcomingTripCount,
    };
  }

  // ── Charging — predictive (new method, extends base recommendation) ────────

  /**
   * Computes a charging recommendation with predictive depletion timing.
   *
   * Prediction algorithm:
   *   1. Compute drain rate from battery history (oldest vs newest reading in window)
   *   2. timeToDepletion = (current% - critical%) / drainRate * 60 minutes
   *   3. recommendedChargeBy = now + (current% - medium%) / drainRate hours
   *   4. If history is insufficient → fall back to 15%/h conservative estimate
   */
  computePredictiveCharging(
    input: PredictiveChargingInput,
    config: FleetConfig = DEFAULT_CONFIG,
  ): PredictiveChargingRecommendation | null {
    const base = this.computeChargingRecommendation(input, config);
    if (!base) return null;

    const { drainRatePerHour, predictionBasis } = this.estimateDrainRate(input);
    let timeToDepletionMin: number | null = null;
    let recommendedChargeBy: string | null = null;

    const currentBattery = base.batteryLevel;

    if (drainRatePerHour !== null && drainRatePerHour > 0) {
      // Minutes until battery hits critical threshold
      const minutesToCritical = ((currentBattery - config.battery.critical) / drainRatePerHour) * 60;
      timeToDepletionMin = Math.max(0, Math.round(minutesToCritical));

      // Recommend charging before reaching medium threshold
      const minutesToMedium = ((currentBattery - config.battery.medium) / drainRatePerHour) * 60;
      if (minutesToMedium > 0) {
        recommendedChargeBy = new Date(Date.now() + minutesToMedium * 60_000).toISOString();
      } else {
        // Already below medium — recommend charging now
        recommendedChargeBy = new Date().toISOString();
      }

      // Upgrade urgency if depletion is imminent
      const revisedUrgency = this.predictiveUrgency(base.urgency, timeToDepletionMin, currentBattery, config);
      base.urgency = revisedUrgency;
    }

    return {
      ...base,
      timeToDepletionMin,
      recommendedChargeBy,
      drainRatePerHour: drainRatePerHour !== null ? parseFloat(drainRatePerHour.toFixed(2)) : null,
      predictionBasis,
    };
  }

  private estimateDrainRate(
    input: PredictiveChargingInput,
  ): { drainRatePerHour: number | null; predictionBasis: 'telemetry' | 'estimated' } {
    const history = input.batteryHistory.filter((h) => h.batteryLevel !== null);

    if (history.length >= 2) {
      const oldest = history[0];
      const newest = history[history.length - 1];
      const timeDiffHours =
        (newest.timestamp.getTime() - oldest.timestamp.getTime()) / 3_600_000;
      const batteryDrop = (oldest.batteryLevel as number) - (newest.batteryLevel as number);

      // Only use if time window is meaningful (> 6 minutes) and battery is draining
      if (timeDiffHours > 0.1 && batteryDrop > 0) {
        return { drainRatePerHour: batteryDrop / timeDiffHours, predictionBasis: 'telemetry' };
      }
    }

    // Not enough data: conservative 15%/h assumption (common urban EV usage)
    if (input.isCharging) return { drainRatePerHour: null, predictionBasis: 'estimated' };
    return { drainRatePerHour: 15, predictionBasis: 'estimated' };
  }

  private predictiveUrgency(
    base: UrgencyLevel,
    timeToDepletionMin: number,
    batteryLevel: number,
    config: FleetConfig,
  ): UrgencyLevel {
    // If depletion is < 30 min away, escalate to critical regardless of battery %
    if (timeToDepletionMin < 30) return 'critical';
    // If depletion is < 90 min away, escalate to high
    if (timeToDepletionMin < 90 && base === 'medium') return 'high';
    return base;
  }

  private chargeUrgency(level: number, config: FleetConfig): UrgencyLevel {
    if (level <= config.battery.critical) return 'critical';
    if (level <= config.battery.high)    return 'high';
    if (level <= config.battery.medium)  return 'medium';
    return 'low';
  }

  private chargeReason(
    level: number,
    isCharging: boolean,
    upcomingTrips: number,
    config: FleetConfig,
  ) {
    const tripNote = upcomingTrips > 0 ? ` ${upcomingTrips} trip(s) scheduled in the next 4 hours.` : '';

    if (isCharging) {
      return {
        reason: `Currently charging (${level}% SoC).${tripNote}`,
        suggestedAction: 'Continue charging until at least 80%',
      };
    }
    if (level <= config.battery.critical) {
      return {
        reason: `Battery at ${level}% — risk of vehicle shutdown.${tripNote}`,
        suggestedAction: 'Charge immediately',
      };
    }
    if (level <= config.battery.high) {
      return {
        reason: `Battery at ${level}% — insufficient for most trips.${tripNote}`,
        suggestedAction: 'Charge within 1 hour',
      };
    }
    if (level <= config.battery.medium) {
      return {
        reason: `Battery at ${level}% — limited range available.${tripNote}`,
        suggestedAction: 'Charge within 4 hours',
      };
    }
    return {
      reason: `Battery at ${level}% — charge when convenient.${tripNote}`,
      suggestedAction: 'Opportunistic charge recommended',
    };
  }

  sortRecommendations<T extends ChargingRecommendation>(recs: T[]): T[] {
    return [...recs].sort((a, b) => {
      if (a.isCurrentlyCharging !== b.isCurrentlyCharging) {
        return a.isCurrentlyCharging ? 1 : -1;
      }
      return a.batteryLevel - b.batteryLevel;
    });
  }

  // ── Trip efficiency ───────────────────────────────────────────────────────

  computeTripEfficiency(
    trips: TripEfficiencyInput[],
    config: FleetConfig = DEFAULT_CONFIG,
  ): TripEfficiencyResult {
    const usable = trips.filter(
      (t) =>
        t.distanceKm !== null &&
        t.durationMin !== null &&
        t.distanceKm >= config.tripEfficiency.minDistanceKm &&
        t.durationMin > 0,
    ) as Array<TripEfficiencyInput & { distanceKm: number; durationMin: number }>;

    if (usable.length === 0) {
      return { totalTripsAnalyzed: 0, fleetAvgSpeedKmh: 0, fleetAvgFarePerKm: 0, fleetAvgDurationMin: 0, inefficientTrips: [], vehicleSummaries: [] };
    }

    const metrics = usable.map((t) => ({
      ...t,
      avgSpeedKmh: (t.distanceKm / t.durationMin) * 60,
      farePerKm: t.fare !== null ? t.fare / t.distanceKm : null,
    }));

    const fleetAvgSpeedKmh = metrics.reduce((s, m) => s + m.avgSpeedKmh, 0) / metrics.length;
    const fareMetrics = metrics.filter((m) => m.farePerKm !== null);
    const fleetAvgFarePerKm = fareMetrics.length > 0
      ? fareMetrics.reduce((s, m) => s + m.farePerKm!, 0) / fareMetrics.length
      : 0;
    const fleetAvgDurationMin = metrics.reduce((s, m) => s + m.durationMin, 0) / metrics.length;

    const inefficientTrips: TripFlag[] = [];
    for (const m of metrics) {
      const flags: string[] = [];

      if (m.avgSpeedKmh < fleetAvgSpeedKmh * config.tripEfficiency.slowSpeedFactor) {
        flags.push(
          `Avg speed ${m.avgSpeedKmh.toFixed(1)} km/h is below ${Math.round(config.tripEfficiency.slowSpeedFactor * 100)}% of fleet average (${fleetAvgSpeedKmh.toFixed(1)} km/h)`,
        );
      }

      const durationPerKm = m.durationMin / m.distanceKm;
      if (durationPerKm > config.tripEfficiency.excessiveDurationPerKm) {
        flags.push(
          `${durationPerKm.toFixed(1)} min/km — excessive time per distance (threshold: ${config.tripEfficiency.excessiveDurationPerKm} min/km)`,
        );
      }

      if (flags.length > 0) {
        inefficientTrips.push({
          tripId: m.id,
          vehicleId: m.vehicleId,
          driverId: m.driverId,
          distanceKm: m.distanceKm,
          durationMin: m.durationMin,
          avgSpeedKmh: parseFloat(m.avgSpeedKmh.toFixed(2)),
          farePerKm: m.farePerKm !== null ? parseFloat(m.farePerKm.toFixed(3)) : null,
          flags,
        });
      }
    }

    const byVehicle = new Map<string, { speeds: number[]; fares: number[]; count: number }>();
    for (const m of metrics) {
      if (!byVehicle.has(m.vehicleId)) byVehicle.set(m.vehicleId, { speeds: [], fares: [], count: 0 });
      const e = byVehicle.get(m.vehicleId)!;
      e.speeds.push(m.avgSpeedKmh);
      if (m.farePerKm !== null) e.fares.push(m.farePerKm);
      e.count++;
    }

    return {
      totalTripsAnalyzed: usable.length,
      fleetAvgSpeedKmh: parseFloat(fleetAvgSpeedKmh.toFixed(2)),
      fleetAvgFarePerKm: parseFloat(fleetAvgFarePerKm.toFixed(3)),
      fleetAvgDurationMin: parseFloat(fleetAvgDurationMin.toFixed(1)),
      inefficientTrips,
      vehicleSummaries: Array.from(byVehicle.entries())
        .map(([vehicleId, { speeds, fares, count }]) => ({
          vehicleId,
          tripCount: count,
          avgSpeedKmh: parseFloat((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2)),
          avgFarePerKm: fares.length ? parseFloat((fares.reduce((a, b) => a + b, 0) / fares.length).toFixed(3)) : 0,
        }))
        .sort((a, b) => b.avgSpeedKmh - a.avgSpeedKmh),
    };
  }

  // ── Alert engine ──────────────────────────────────────────────────────────

  evaluateAlerts(
    input: AlertInput,
    config: FleetConfig = DEFAULT_CONFIG,
  ): FleetAlert[] {
    const alerts: FleetAlert[] = [];
    const now = new Date();

    // Rule 1: Low battery (EV/Hybrid only)
    const isEv = input.fuelType === 'ELECTRIC' || input.fuelType === 'HYBRID';
    if (isEv && input.batteryLevel !== null && input.batteryLevel <= config.battery.high) {
      const score = this.batteryAlertScore(input.batteryLevel, config);
      const severity: AlertSeverity = input.batteryLevel <= config.battery.critical ? 'critical' : 'warning';
      alerts.push(this.makeAlert('LOW_BATTERY', severity, score, input,
        `Battery at ${input.batteryLevel}%`,
        `Vehicle has ${input.batteryLevel <= config.battery.critical ? 'critically ' : ''}low battery (${input.batteryLevel}%).`,
        { batteryLevel: input.batteryLevel },
      ));
    }

    // Rule 2: Vehicle inactive
    if (input.status !== 'DECOMMISSIONED' && input.status !== 'MAINTENANCE') {
      const locationAge = input.lastLocationAt
        ? (now.getTime() - input.lastLocationAt.getTime()) / 3_600_000
        : Infinity;

      if (locationAge >= config.inactivity.vehicleHours) {
        const score = Math.min(50 + Math.round((locationAge - config.inactivity.vehicleHours) * 3), 75);
        alerts.push(this.makeAlert('VEHICLE_INACTIVE', 'warning', score, input,
          `No location update for ${locationAge === Infinity ? '∞' : locationAge.toFixed(1)} h`,
          `Vehicle has not reported a location in over ${config.inactivity.vehicleHours} hours.`,
          { lastLocationAt: input.lastLocationAt?.toISOString() ?? null },
        ));
      }
    }

    // Rule 3: Telematics gap
    if (input.telematicsEnabled) {
      const logAgeMin = input.lastLogAt
        ? (now.getTime() - input.lastLogAt.getTime()) / 60_000
        : Infinity;

      if (logAgeMin >= config.inactivity.telemetryMinutes) {
        const score = Math.min(40 + Math.round(logAgeMin * 0.3), 70);
        alerts.push(this.makeAlert('TELEMETRY_GAP', 'warning', score, input,
          `Telematics gap: ${logAgeMin === Infinity ? 'no data ever' : `${Math.round(logAgeMin)} min`}`,
          `Telematics enabled but no data received in ${config.inactivity.telemetryMinutes}+ minutes.`,
          { lastLogAt: input.lastLogAt?.toISOString() ?? null, gapMinutes: Math.round(logAgeMin) },
        ));
      }
    }

    // Rule 4: OBD faults
    if (input.latestObdCodes.length > 0) {
      const faultCount = input.latestObdCodes.length;
      const score = Math.min(50 + faultCount * 10, 90);
      const severity: AlertSeverity = faultCount >= 3 ? 'critical' : 'warning';
      alerts.push(this.makeAlert('OBD_FAULT', severity, score, input,
        `${faultCount} OBD fault(s): ${input.latestObdCodes.slice(0, 3).join(', ')}`,
        `Active diagnostic fault codes detected. Inspect before next trip.`,
        { codes: input.latestObdCodes },
      ));
    }

    // Rule 5: Overdue maintenance
    if (input.hasOverdueMaintenance) {
      const score = this.maintenanceAlertScore(input.overduePriority);
      const severity: AlertSeverity =
        input.overduePriority === 'URGENT' || input.overduePriority === 'CRITICAL'
          ? 'critical' : 'warning';
      alerts.push(this.makeAlert('MAINTENANCE_OVERDUE', severity, score, input,
        `Maintenance overdue (${input.overduePriority ?? 'NORMAL'} priority)`,
        `One or more maintenance tasks are past their scheduled date.`,
        { priority: input.overduePriority },
      ));
    }

    return alerts;
  }

  private batteryAlertScore(level: number, config: FleetConfig): number {
    if (level <= config.battery.critical) return 90 + Math.min(config.battery.critical - level, 10);
    return 60 + Math.round((config.battery.high - level) * 2);
  }

  private maintenanceAlertScore(
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL' | null,
  ): number {
    switch (priority) {
      case 'CRITICAL': return 90;
      case 'URGENT':   return 80;
      case 'HIGH':     return 65;
      case 'NORMAL':   return 50;
      default:         return 35;
    }
  }

  private scoreToAlertPriority(score: number): AlertPriority {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  private makeAlert(
    type: AlertType,
    severity: AlertSeverity,
    severityScore: number,
    vehicle: Pick<AlertInput, 'vehicleId' | 'plateNumber'>,
    message: string,
    detail: string,
    metadata: Record<string, unknown>,
  ): FleetAlert {
    return {
      id: `${type}:${vehicle.vehicleId}`,
      type,
      severity,
      severityScore,
      priority: this.scoreToAlertPriority(severityScore),
      vehicleId: vehicle.vehicleId,
      plateNumber: vehicle.plateNumber,
      message,
      detail,
      detectedAt: new Date().toISOString(),
      metadata,
    };
  }
}
