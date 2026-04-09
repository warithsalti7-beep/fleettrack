/**
 * Fleet Intelligence — configurable thresholds.
 *
 * All values are intentionally exposed as plain constants so operators can
 * override them via environment variables in a future iteration without
 * touching scoring logic.
 */

export const THRESHOLDS = {
  /** Battery / energy level (%) */
  battery: {
    critical: 10,  // charge immediately
    high: 20,      // charge within 1 hour
    medium: 40,    // charge within 4 hours
    low: 60,       // opportunistic — charge when convenient
  },

  /** Inactivity detection */
  inactivity: {
    /** Hours since last GPS update before raising VEHICLE_INACTIVE alert */
    vehicleHours: 6,
    /** Minutes since last telematics log before raising TELEMETRY_GAP alert */
    telemetryMinutes: 30,
  },

  /** Trip efficiency thresholds */
  tripEfficiency: {
    /** Minimum distance (km) — trips shorter than this are skipped in analysis */
    minDistanceKm: 0.5,
    /** Avg speed below this fraction of the fleet average → "slow trip" flag */
    slowSpeedFactor: 0.5,
    /** durationMin / distanceKm > this value → "excessive duration" flag */
    excessiveDurationPerKm: 15, // 15 min/km ≈ 4 km/h (walking speed)
  },

  /** Health score penalties */
  health: {
    /** Points deducted per active OBD fault code (P/U/B/C codes) */
    obdFaultPenalty: 5,
    /** Maximum points that can be lost to OBD faults */
    maxObdPenalty: 10,
  },

  /** Cache TTLs (milliseconds) */
  cache: {
    healthScores: 5 * 60 * 1_000,        // 5 minutes
    chargingRecs: 2 * 60 * 1_000,        // 2 minutes
    alerts: 60 * 1_000,                   // 1 minute
    tripInsights: 10 * 60 * 1_000,       // 10 minutes
  },
} as const;

/** Health score grade boundaries */
export const GRADE_BOUNDARIES = [
  { min: 90, grade: 'A' },
  { min: 75, grade: 'B' },
  { min: 60, grade: 'C' },
  { min: 40, grade: 'D' },
  { min: 0,  grade: 'F' },
] as const;

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertType =
  | 'LOW_BATTERY'
  | 'VEHICLE_INACTIVE'
  | 'TELEMETRY_GAP'
  | 'OBD_FAULT'
  | 'MAINTENANCE_OVERDUE';

/** Cache key factory — keeps cache key logic in one place */
export const CACHE_KEYS = {
  healthScores: () => 'intelligence:health-scores',
  chargingRecs: () => 'intelligence:charging-recommendations',
  alerts: () => 'intelligence:alerts',
  tripInsights: (from: string, to: string) => `intelligence:trip-insights:${from}:${to}`,
} as const;
