/**
 * ScoringService — pure, stateless logic.
 *
 * No database calls, no HTTP calls, no injected dependencies.
 * Every public method takes plain data objects and returns plain results.
 * This makes the entire file trivially unit-testable.
 */

import { Injectable } from '@nestjs/common';
import {
  THRESHOLDS,
  GRADE_BOUNDARIES,
  HealthGrade,
  UrgencyLevel,
  AlertType,
  AlertSeverity,
} from './intelligence.constants';

// ─── Input / Output types ─────────────────────────────────────────────────────

export interface HealthScoreInput {
  vehicleId: string;
  /** 0–100 State of Charge; null when vehicle has no battery sensor */
  batteryLevel: number | null;
  /** 0–100 fuel level for ICE vehicles */
  fuelLevel: number | null;
  /** 'ELECTRIC' | 'HYBRID' | 'PETROL' | 'DIESEL' | 'HYDROGEN' */
  fuelType: string;
  telematicsEnabled: boolean;
  /** Timestamp of most recent telematics log, or null if none */
  lastLogAt: Date | null;
  /** Number of COMPLETED trips in the last 7 days */
  recentTripCount: number;
  /** Active OBD-II fault codes from the latest telematics log */
  obdCodes: string[];
  /** Whether any maintenance record is currently overdue */
  hasOverdueMaintenance: boolean;
  /** Highest priority of overdue maintenance (null if none) */
  overduePriority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL' | null;
}

export interface HealthScoreComponents {
  /** 0–40 pts: battery / fuel energy level */
  energy: number;
  /** 0–20 pts: how recent the last telematics ping was */
  freshness: number;
  /** 0–20 pts: utilization (trips completed in last 7 days) */
  utilization: number;
  /** 0–10 pts: OBD fault penalty */
  diagnostics: number;
  /** 0–10 pts: maintenance currency */
  maintenance: number;
}

export interface HealthScoreResult {
  vehicleId: string;
  score: number;
  grade: HealthGrade;
  components: HealthScoreComponents;
  /** Human-readable flags surfaced to the operator */
  flags: string[];
}

export interface ChargingInput {
  vehicleId: string;
  plateNumber: string;
  make: string;
  model: string;
  batteryLevel: number | null;
  /** Estimated remaining range in km */
  batteryRange: number | null;
  isCharging: boolean;
  status: string;
  /** Scheduled trips starting within the next 4 hours */
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
  /** Per-vehicle efficiency summary sorted by avg speed desc */
  vehicleSummaries: Array<{
    vehicleId: string;
    tripCount: number;
    avgSpeedKmh: number;
    avgFarePerKm: number;
  }>;
}

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
  /** Deterministic ID — stable for the same vehicle + type so consumers can deduplicate */
  id: string;
  type: AlertType;
  severity: AlertSeverity;
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

  computeHealthScore(input: HealthScoreInput): HealthScoreResult {
    const flags: string[] = [];

    const energy = this.scoreEnergy(input, flags);
    const freshness = this.scoreFreshness(input, flags);
    const utilization = this.scoreUtilization(input, flags);
    const diagnostics = this.scoreDiagnostics(input, flags);
    const maintenance = this.scoreMaintenance(input, flags);

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

  private scoreEnergy(input: HealthScoreInput, flags: string[]): number {
    const isElectric = input.fuelType === 'ELECTRIC' || input.fuelType === 'HYBRID';

    // For EVs use batteryLevel; for ICE use fuelLevel; fall back to 50 (neutral)
    const level = isElectric
      ? (input.batteryLevel ?? null)
      : (input.fuelLevel ?? null);

    if (level === null) {
      if (isElectric) flags.push('Battery level unknown');
      return isElectric ? 0 : 20; // EV unknown = worst case; ICE unknown = neutral
    }

    if (level <= THRESHOLDS.battery.critical) flags.push(`Critical energy level (${level}%)`);
    else if (level <= THRESHOLDS.battery.high) flags.push(`Low energy level (${level}%)`);

    return Math.round((level / 100) * 40);
  }

  private scoreFreshness(input: HealthScoreInput, flags: string[]): number {
    if (!input.telematicsEnabled) return 20; // no telematics expected — full score

    if (!input.lastLogAt) {
      flags.push('No telematics data received');
      return 0;
    }

    const ageMin = (Date.now() - input.lastLogAt.getTime()) / 60_000;

    if (ageMin < 10) return 20;
    if (ageMin < 30) return 15;
    if (ageMin < 60) {
      flags.push('Telematics data stale (> 30 min)');
      return 10;
    }
    if (ageMin < 360) {
      flags.push('Telematics data stale (> 1 h)');
      return 5;
    }
    flags.push(`No telematics signal for ${Math.round(ageMin / 60)} h`);
    return 0;
  }

  private scoreUtilization(input: HealthScoreInput, flags: string[]): number {
    const n = input.recentTripCount;
    if (n === 0) {
      flags.push('No trips in last 7 days');
      return 10; // idle vehicles are technically healthy
    }
    if (n <= 5) return 20;
    if (n <= 15) return 15; // high utilization — slight wear signal
    flags.push('Very high utilization (> 15 trips / 7 days)');
    return 10;
  }

  private scoreDiagnostics(input: HealthScoreInput, flags: string[]): number {
    const faultCount = input.obdCodes.length;
    if (faultCount === 0) return 10;

    flags.push(`${faultCount} active OBD fault code${faultCount > 1 ? 's' : ''}: ${input.obdCodes.slice(0, 3).join(', ')}`);
    const penalty = Math.min(faultCount * THRESHOLDS.health.obdFaultPenalty, THRESHOLDS.health.maxObdPenalty);
    return Math.max(0, 10 - penalty);
  }

  private scoreMaintenance(input: HealthScoreInput, flags: string[]): number {
    if (!input.hasOverdueMaintenance) return 10;

    const p = input.overduePriority;
    if (p === 'LOW' || p === 'NORMAL') {
      flags.push('Maintenance overdue (normal priority)');
      return 5;
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

  // ── Charging recommendations ──────────────────────────────────────────────

  /**
   * Returns a recommendation for a single EV/Hybrid vehicle, or null if
   * charging is not needed or not applicable.
   */
  computeChargingRecommendation(input: ChargingInput): ChargingRecommendation | null {
    const { batteryLevel, isCharging } = input;

    // Skip non-EV vehicles (callers should pre-filter, but guard defensively)
    if (batteryLevel === null) return null;

    // Already adequately charged
    if (batteryLevel > THRESHOLDS.battery.low) return null;

    const urgency = this.chargeUrgency(batteryLevel);
    const { reason, suggestedAction } = this.chargeReason(batteryLevel, isCharging, input.upcomingTripCount);

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

  private chargeUrgency(level: number): UrgencyLevel {
    if (level <= THRESHOLDS.battery.critical) return 'critical';
    if (level <= THRESHOLDS.battery.high)    return 'high';
    if (level <= THRESHOLDS.battery.medium)  return 'medium';
    return 'low';
  }

  private chargeReason(level: number, isCharging: boolean, upcomingTrips: number) {
    const tripNote = upcomingTrips > 0 ? ` ${upcomingTrips} trip(s) scheduled in the next 4 hours.` : '';

    if (isCharging) {
      return {
        reason: `Currently charging (${level}% SoC).${tripNote}`,
        suggestedAction: 'Continue charging until at least 80%',
      };
    }

    if (level <= THRESHOLDS.battery.critical) {
      return {
        reason: `Battery at ${level}% — risk of vehicle shutdown.${tripNote}`,
        suggestedAction: 'Charge immediately',
      };
    }
    if (level <= THRESHOLDS.battery.high) {
      return {
        reason: `Battery at ${level}% — insufficient for most trips.${tripNote}`,
        suggestedAction: 'Charge within 1 hour',
      };
    }
    if (level <= THRESHOLDS.battery.medium) {
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

  /** Sort recommendations: currently-not-charging first, then by battery level ascending */
  sortRecommendations(recs: ChargingRecommendation[]): ChargingRecommendation[] {
    return [...recs].sort((a, b) => {
      // Not charging before charging
      if (a.isCurrentlyCharging !== b.isCurrentlyCharging) {
        return a.isCurrentlyCharging ? 1 : -1;
      }
      // Lower battery first
      return a.batteryLevel - b.batteryLevel;
    });
  }

  // ── Trip efficiency ───────────────────────────────────────────────────────

  computeTripEfficiency(trips: TripEfficiencyInput[]): TripEfficiencyResult {
    // Filter to trips with sufficient data
    const usable = trips.filter(
      (t) =>
        t.distanceKm !== null &&
        t.durationMin !== null &&
        t.distanceKm >= THRESHOLDS.tripEfficiency.minDistanceKm &&
        t.durationMin > 0,
    ) as Array<TripEfficiencyInput & { distanceKm: number; durationMin: number }>;

    if (usable.length === 0) {
      return {
        totalTripsAnalyzed: 0,
        fleetAvgSpeedKmh: 0,
        fleetAvgFarePerKm: 0,
        fleetAvgDurationMin: 0,
        inefficientTrips: [],
        vehicleSummaries: [],
      };
    }

    // Per-trip metrics
    const metrics = usable.map((t) => {
      const avgSpeedKmh = (t.distanceKm / t.durationMin) * 60;
      const farePerKm = t.fare !== null ? t.fare / t.distanceKm : null;
      return { ...t, avgSpeedKmh, farePerKm };
    });

    // Fleet-level aggregates
    const fleetAvgSpeedKmh =
      metrics.reduce((s, m) => s + m.avgSpeedKmh, 0) / metrics.length;

    const fareMetrics = metrics.filter((m) => m.farePerKm !== null);
    const fleetAvgFarePerKm =
      fareMetrics.length > 0
        ? fareMetrics.reduce((s, m) => s + m.farePerKm!, 0) / fareMetrics.length
        : 0;

    const fleetAvgDurationMin =
      metrics.reduce((s, m) => s + m.durationMin, 0) / metrics.length;

    // Flag inefficient trips
    const inefficientTrips: TripFlag[] = [];
    for (const m of metrics) {
      const flags: string[] = [];

      if (m.avgSpeedKmh < fleetAvgSpeedKmh * THRESHOLDS.tripEfficiency.slowSpeedFactor) {
        flags.push(
          `Avg speed ${m.avgSpeedKmh.toFixed(1)} km/h is below 50% of fleet average (${fleetAvgSpeedKmh.toFixed(1)} km/h)`,
        );
      }

      const durationPerKm = m.durationMin / m.distanceKm;
      if (durationPerKm > THRESHOLDS.tripEfficiency.excessiveDurationPerKm) {
        flags.push(
          `${durationPerKm.toFixed(1)} min/km — excessive time per distance (threshold: ${THRESHOLDS.tripEfficiency.excessiveDurationPerKm} min/km)`,
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

    // Per-vehicle summaries
    const byVehicle = new Map<
      string,
      { speeds: number[]; fares: number[]; count: number }
    >();
    for (const m of metrics) {
      if (!byVehicle.has(m.vehicleId)) {
        byVehicle.set(m.vehicleId, { speeds: [], fares: [], count: 0 });
      }
      const entry = byVehicle.get(m.vehicleId)!;
      entry.speeds.push(m.avgSpeedKmh);
      if (m.farePerKm !== null) entry.fares.push(m.farePerKm);
      entry.count++;
    }

    const vehicleSummaries = Array.from(byVehicle.entries())
      .map(([vehicleId, { speeds, fares, count }]) => ({
        vehicleId,
        tripCount: count,
        avgSpeedKmh: parseFloat((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2)),
        avgFarePerKm: fares.length
          ? parseFloat((fares.reduce((a, b) => a + b, 0) / fares.length).toFixed(3))
          : 0,
      }))
      .sort((a, b) => b.avgSpeedKmh - a.avgSpeedKmh);

    return {
      totalTripsAnalyzed: usable.length,
      fleetAvgSpeedKmh: parseFloat(fleetAvgSpeedKmh.toFixed(2)),
      fleetAvgFarePerKm: parseFloat(fleetAvgFarePerKm.toFixed(3)),
      fleetAvgDurationMin: parseFloat(fleetAvgDurationMin.toFixed(1)),
      inefficientTrips,
      vehicleSummaries,
    };
  }

  // ── Alert engine ──────────────────────────────────────────────────────────

  /**
   * Evaluates a single vehicle against all alert rules and returns any
   * triggered alerts. Callers aggregate across the fleet.
   */
  evaluateAlerts(input: AlertInput): FleetAlert[] {
    const alerts: FleetAlert[] = [];
    const now = new Date();

    // Rule 1: Low battery
    const isEv = input.fuelType === 'ELECTRIC' || input.fuelType === 'HYBRID';
    if (isEv && input.batteryLevel !== null && input.batteryLevel <= THRESHOLDS.battery.high) {
      const severity: AlertSeverity =
        input.batteryLevel <= THRESHOLDS.battery.critical ? 'critical' : 'warning';
      alerts.push(
        this.makeAlert(
          'LOW_BATTERY',
          severity,
          input,
          `Battery at ${input.batteryLevel}%`,
          `Vehicle has ${input.batteryLevel <= THRESHOLDS.battery.critical ? 'critically' : ''} low battery (${input.batteryLevel}%). Range: ${input.batteryRange ?? 'unknown'} km.`,
          { batteryLevel: input.batteryLevel },
        ),
      );
    }

    // Rule 2: Vehicle inactive (no GPS update)
    if (input.status !== 'DECOMMISSIONED' && input.status !== 'MAINTENANCE') {
      const locationAge = input.lastLocationAt
        ? (now.getTime() - input.lastLocationAt.getTime()) / 3_600_000
        : Infinity;

      if (locationAge >= THRESHOLDS.inactivity.vehicleHours) {
        alerts.push(
          this.makeAlert(
            'VEHICLE_INACTIVE',
            'warning',
            input,
            `No location update for ${locationAge === Infinity ? '∞' : locationAge.toFixed(1)} h`,
            `Vehicle has not reported a location in over ${THRESHOLDS.inactivity.vehicleHours} hours. It may be offline or out of coverage.`,
            { lastLocationAt: input.lastLocationAt?.toISOString() ?? null },
          ),
        );
      }
    }

    // Rule 3: Telematics gap (enabled vehicle not reporting)
    if (input.telematicsEnabled) {
      const logAgeMin = input.lastLogAt
        ? (now.getTime() - input.lastLogAt.getTime()) / 60_000
        : Infinity;

      if (logAgeMin >= THRESHOLDS.inactivity.telemetryMinutes) {
        alerts.push(
          this.makeAlert(
            'TELEMETRY_GAP',
            'warning',
            input,
            `Telematics gap: ${logAgeMin === Infinity ? 'no data ever' : `${Math.round(logAgeMin)} min`}`,
            `Telematics is enabled but no data received in ${THRESHOLDS.inactivity.telemetryMinutes}+ minutes. Check provider connection.`,
            { lastLogAt: input.lastLogAt?.toISOString() ?? null, gapMinutes: logAgeMin },
          ),
        );
      }
    }

    // Rule 4: Active OBD fault codes
    if (input.latestObdCodes.length > 0) {
      alerts.push(
        this.makeAlert(
          'OBD_FAULT',
          input.latestObdCodes.length >= 3 ? 'critical' : 'warning',
          input,
          `${input.latestObdCodes.length} OBD fault(s): ${input.latestObdCodes.slice(0, 3).join(', ')}`,
          `Active diagnostic fault codes detected. Vehicle should be inspected before next trip.`,
          { codes: input.latestObdCodes },
        ),
      );
    }

    // Rule 5: Overdue maintenance
    if (input.hasOverdueMaintenance) {
      const sev: AlertSeverity =
        input.overduePriority === 'URGENT' || input.overduePriority === 'CRITICAL'
          ? 'critical'
          : 'warning';
      alerts.push(
        this.makeAlert(
          'MAINTENANCE_OVERDUE',
          sev,
          input,
          `Maintenance overdue (${input.overduePriority ?? 'NORMAL'} priority)`,
          `One or more maintenance tasks are past their scheduled date. Prioritise workshop visit.`,
          { priority: input.overduePriority },
        ),
      );
    }

    return alerts;
  }

  private makeAlert(
    type: AlertType,
    severity: AlertSeverity,
    vehicle: Pick<AlertInput, 'vehicleId' | 'plateNumber'> & { batteryRange?: number | null },
    message: string,
    detail: string,
    metadata: Record<string, unknown>,
  ): FleetAlert {
    return {
      id: `${type}:${vehicle.vehicleId}`,
      type,
      severity,
      vehicleId: vehicle.vehicleId,
      plateNumber: vehicle.plateNumber,
      message,
      detail,
      detectedAt: new Date().toISOString(),
      metadata,
    };
  }
}
