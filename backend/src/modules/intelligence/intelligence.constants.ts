/**
 * Fleet Intelligence — configurable thresholds.
 *
 * THRESHOLDS are the static defaults. FleetConfig is the runtime shape
 * stored in the database and cached in Redis, allowing per-fleet overrides.
 */

// ─── Static defaults (used as fallback when no DB config exists) ─────────────

export const THRESHOLDS = {
  battery: {
    critical: 10,
    high: 20,
    medium: 40,
    low: 60,
  },
  inactivity: {
    vehicleHours: 6,
    telemetryMinutes: 30,
  },
  tripEfficiency: {
    minDistanceKm: 0.5,
    slowSpeedFactor: 0.5,
    excessiveDurationPerKm: 15,
  },
  health: {
    obdFaultPenalty: 5,
    maxObdPenalty: 10,
  },
  cache: {
    healthScores:   5 * 60 * 1_000,
    chargingRecs:   2 * 60 * 1_000,
    alerts:         60 * 1_000,
    tripInsights:   10 * 60 * 1_000,
    fleetConfig:    10 * 60 * 1_000,   // fleet settings from DB
    recommendations: 5 * 60 * 1_000,
  },
} as const;

// ─── Fleet Config — stored in PostgreSQL, cached in Redis ────────────────────

export interface HealthWeights {
  /** Max points for battery/fuel energy level (default 40) */
  energy: number;
  /** Max points for telematics recency (default 20) */
  freshness: number;
  /** Max points for trip utilization (default 20) */
  utilization: number;
  /** Max points for diagnostics (OBD; penalty-based, default 10) */
  diagnostics: number;
  /** Max points for maintenance currency (penalty-based, default 10) */
  maintenance: number;
}

export interface FleetConfig {
  health: {
    weights: HealthWeights;
    obdFaultPenalty: number;
    maxObdPenalty: number;
  };
  battery: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  inactivity: {
    vehicleHours: number;
    telemetryMinutes: number;
  };
  tripEfficiency: {
    minDistanceKm: number;
    slowSpeedFactor: number;
    excessiveDurationPerKm: number;
  };
}

/** Canonical default — derived from THRESHOLDS so there is a single source of truth */
export const DEFAULT_CONFIG: FleetConfig = {
  health: {
    weights: { energy: 40, freshness: 20, utilization: 20, diagnostics: 10, maintenance: 10 },
    obdFaultPenalty: THRESHOLDS.health.obdFaultPenalty,
    maxObdPenalty: THRESHOLDS.health.maxObdPenalty,
  },
  battery: {
    critical: THRESHOLDS.battery.critical,
    high: THRESHOLDS.battery.high,
    medium: THRESHOLDS.battery.medium,
    low: THRESHOLDS.battery.low,
  },
  inactivity: {
    vehicleHours: THRESHOLDS.inactivity.vehicleHours,
    telemetryMinutes: THRESHOLDS.inactivity.telemetryMinutes,
  },
  tripEfficiency: {
    minDistanceKm: THRESHOLDS.tripEfficiency.minDistanceKm,
    slowSpeedFactor: THRESHOLDS.tripEfficiency.slowSpeedFactor,
    excessiveDurationPerKm: THRESHOLDS.tripEfficiency.excessiveDurationPerKm,
  },
};

// ─── Grade boundaries ─────────────────────────────────────────────────────────

export const GRADE_BOUNDARIES = [
  { min: 90, grade: 'A' },
  { min: 75, grade: 'B' },
  { min: 60, grade: 'C' },
  { min: 40, grade: 'D' },
  { min: 0,  grade: 'F' },
] as const;

// ─── Shared types ─────────────────────────────────────────────────────────────

export type HealthGrade    = 'A' | 'B' | 'C' | 'D' | 'F';
export type UrgencyLevel   = 'low' | 'medium' | 'high' | 'critical';
export type AlertSeverity  = 'info' | 'warning' | 'critical';
export type AlertPriority  = 'low' | 'medium' | 'high' | 'critical';
export type AlertType =
  | 'LOW_BATTERY'
  | 'VEHICLE_INACTIVE'
  | 'TELEMETRY_GAP'
  | 'OBD_FAULT'
  | 'MAINTENANCE_OVERDUE';

export type RecommendationType =
  | 'DRIVER_HIGH_IDLE_RATIO'
  | 'DRIVER_BELOW_FLEET_SPEED'
  | 'VEHICLE_EFFICIENCY_DECLINE'
  | 'DRIVER_LOW_COMPLETION_RATE';

// ─── Cache key factory ────────────────────────────────────────────────────────

export const CACHE_KEYS = {
  healthScores:    () => 'intelligence:health-scores',
  chargingRecs:    () => 'intelligence:charging-recommendations',
  alerts:          () => 'intelligence:alerts',
  tripInsights:    (from: string, to: string) => `intelligence:trip-insights:${from}:${to}`,
  fleetConfig:     () => 'intelligence:fleet-config',
  recommendations: () => 'intelligence:recommendations',
} as const;
