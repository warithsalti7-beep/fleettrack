/**
 * Central KPI / formula library.
 *
 * BEFORE this file existed, formulas were duplicated:
 *   - driver-score in public/dashboard.html (scoreV2, ~line 4640)
 *   - revenue/profit/utilisation rollups in /api/stats and dashboard.html
 *   - commission split logic in driver-profile.html demo data
 *
 * ALL of those should now import from here (or, on the client, fetch
 * the constants via /api/kpis/config). One change here = one change
 * everywhere; no more silent client/server drift.
 *
 * Pure functions only. No I/O, no Prisma. Safe to import from both
 * Node routes and (eventually) Edge handlers.
 */

// ────────────── canonical thresholds & weights ──────────────

export const SCORE_WEIGHTS_V2 = {
  revPerHour:    0.30, // capped contribution
  utilisation:   0.15,
  acceptance:    0.15,
  tripsPerHour:  0.10,
  cancelPenalty: 0.10,
  rating:        0.10, // NEW vs v1
  safety:        0.10, // NEW vs v1
  peakOverlap:   0.05, // NEW vs v1
  punctuality:   0.05, // NEW vs v1
} as const;

export const REV_PER_HOUR_CAP_NOK = 25; // 25 kr/h normalised to 100 pts
export const TRIPS_PER_HOUR_CAP   = 2.5;

export const PEAK_HOURS = [
  // Local-time half-open intervals [startHour, endHour). Used for
  // peak-overlap scoring and demand-aligned scheduling rules.
  { start: 7,  end: 9.5  }, // 07:00–09:30
  { start: 17, end: 20   }, // 17:00–20:00
];

// Static alert thresholds — these correspond to the alert-row
// definitions on the admin Overview page. Keep them here so the
// thresholds can be read by both the UI badge and the diagnostics
// engine (Phase 9).
export const ALERT_THRESHOLDS = {
  driverScoreCritical: 50,
  driverScoreWarning:  60,
  acceptancePctCritical: 70,
  acceptancePctWarning:  80,
  cancelPctCritical: 10,
  idlePctWarning:    40,
  revPerHrWarningNok: 175,
  documentExpiryDays: 60,
  staleActiveDriverDays: 30,
  staleOpenShiftHours: 14, // open shift older than this → flag
} as const;

// ────────────── helpers ──────────────

export function clamp(n: number, a: number, b: number): number {
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

export function pct(num: number, den: number): number {
  if (!den) return 0;
  return clamp((num / den) * 100, 0, 100);
}

// ────────────── revenue / payout primitives ──────────────

/**
 * Net revenue after platform fees. Always non-negative.
 */
export function netRevenue(grossNok: number, platformFeeNok: number): number {
  return Math.max(0, (grossNok || 0) - (platformFeeNok || 0));
}

/**
 * Driver share of net revenue.
 *   commissionPct ∈ [0, 1]  (0.65 = driver keeps 65%)
 */
export function driverShare(netRevenueNok: number, commissionPct: number): number {
  return Math.round((netRevenueNok || 0) * clamp(commissionPct, 0, 1));
}

/**
 * Final payout = driver share + bonuses − deductions (charge-backs,
 * fines applied to driver, etc.). Never negative; if deductions exceed
 * gross they roll forward to the next settlement.
 */
export function driverPayout(opts: {
  netRevenueNok: number;
  commissionPct: number;
  bonusesNok?: number;
  deductionsNok?: number;
}): number {
  const base = driverShare(opts.netRevenueNok, opts.commissionPct);
  return Math.max(
    0,
    base + (opts.bonusesNok || 0) - (opts.deductionsNok || 0),
  );
}

// ────────────── operational rollups ──────────────

export function revenuePerHour(grossNok: number, hoursOnline: number): number {
  if (!hoursOnline || hoursOnline <= 0) return 0;
  return Math.round((grossNok || 0) / hoursOnline);
}

export function tripsPerHour(tripCount: number, hoursOnline: number): number {
  if (!hoursOnline || hoursOnline <= 0) return 0;
  return +(tripCount / hoursOnline).toFixed(2);
}

export function utilisationPct(busyMinutes: number, onlineMinutes: number): number {
  if (!onlineMinutes) return 0;
  return clamp((busyMinutes / onlineMinutes) * 100, 0, 100);
}

/**
 * Fraction of a driver's online time that fell inside a peak window.
 * Used by the v2 driver score's peakOverlap term.
 */
export function peakOverlapPct(
  intervals: { startMs: number; endMs: number }[],
): number {
  let online = 0;
  let inPeak = 0;
  for (const iv of intervals) {
    const dur = Math.max(0, iv.endMs - iv.startMs);
    online += dur;
    inPeak += peakOverlapMs(iv.startMs, iv.endMs);
  }
  if (!online) return 0;
  return +((inPeak / online) * 100).toFixed(1);
}

function peakOverlapMs(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  const start = new Date(startMs);
  const end = new Date(endMs);
  let total = 0;
  // Iterate day-by-day so multi-day shifts (rare) still bucket correctly.
  const dayMs = 24 * 3600 * 1000;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cursor.getTime() <= end.getTime()) {
    for (const p of PEAK_HOURS) {
      const peakStart = cursor.getTime() + p.start * 3600_000;
      const peakEnd = cursor.getTime() + p.end * 3600_000;
      const a = Math.max(startMs, peakStart);
      const b = Math.min(endMs, peakEnd);
      if (b > a) total += b - a;
    }
    cursor = new Date(cursor.getTime() + dayMs);
  }
  return total;
}

// ────────────── driver score v2 (mirror of dashboard.html) ──────────────

export type ScoreInputs = {
  revhr?: number | null;       // NOK / hour
  util?: number | null;        // %
  acc?: number | null;         // % acceptance
  triphr?: number | null;      // trips / hour
  can?: number | null;         // % cancellation
  rating?: number | null;      // 1..5
  safetyPenalty?: number | null; // count of harsh events / 30 d
  peakHourPct?: number | null; // %
  avgLateMin?: number | null;  // minutes
};

export function driverScore(d: ScoreInputs): number {
  const w = SCORE_WEIGHTS_V2;
  const rating = clamp(((d.rating ?? 4.6) / 5) * 100, 0, 100);
  const safetyRaw = typeof d.safetyPenalty === "number" ? d.safetyPenalty : null;
  const safety = safetyRaw === null ? 85 : clamp(100 - safetyRaw * 3, 0, 100);
  const peak = typeof d.peakHourPct === "number" ? clamp(d.peakHourPct, 0, 100) : 60;
  const lateMin = typeof d.avgLateMin === "number" ? d.avgLateMin : 2;
  const punctuality = clamp(100 - lateMin * 2, 0, 100);

  return Math.round(
    clamp(((d.revhr ?? 0) / REV_PER_HOUR_CAP_NOK) * 100, 0, 100) * w.revPerHour +
      clamp(d.util ?? 0, 0, 100) * w.utilisation +
      clamp(d.acc ?? 0, 0, 100) * w.acceptance +
      clamp(((d.triphr ?? 0) / TRIPS_PER_HOUR_CAP) * 100, 0, 100) * w.tripsPerHour +
      clamp(100 - (d.can ?? 0) * 5, 0, 100) * w.cancelPenalty +
      rating * w.rating +
      safety * w.safety +
      peak * w.peakOverlap +
      punctuality * w.punctuality,
  );
}

export function driverScoreTier(score: number): "TOP" | "AVG" | "LOW" {
  if (score >= 80) return "TOP";
  if (score >= 60) return "AVG";
  return "LOW";
}

// ────────────── reconciliation primitive ──────────────

/**
 * Returns the relative drift (0..1) between two totals that should
 * agree. >0.05 (5%) is the default threshold that the diagnostics
 * engine flags as a TOTALS_MISMATCH issue.
 */
export function relativeDrift(a: number, b: number): number {
  if (!a && !b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
}
