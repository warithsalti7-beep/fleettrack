/**
 * Presentation formatters — single source for the strings we show.
 * Used by both the RSC pages and any client components under /admin/*.
 *
 * NOK style matches the legacy dashboard's Norwegian thin-space
 * thousand separator so users moving between classic and React see
 * identical numbers.
 */

/** 55430 -> "55 430 kr" (thin-space separator, NOK suffix). */
export function formatNok(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F");
  return (rounded < 0 ? "\u2212" : "") + grouped + "\u00a0kr";
}

/** 0.835 -> "83.5%"; 83.5 -> "83.5%". Accepts both. */
export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const n = Math.abs(value) > 1 ? value : value * 100;
  return `${n.toFixed(fractionDigits)}%`;
}

/** "2026-04-15T12:34:56Z" -> "2026-04-15" */
export function formatDateIso(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

/** Date -> "HH:MM". */
export function formatTimeHm(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** UNDERSCORE_ENUM -> "Underscore enum". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Token->tone map used by the Badge primitive and status chips. */
export type SemanticTone = "brand" | "success" | "danger" | "warn" | "info" | "neutral";

export function driverStatusTone(status: string): SemanticTone {
  switch (status) {
    case "AVAILABLE":   return "success";
    case "ON_TRIP":     return "brand";
    case "MAINTENANCE": return "warn";
    case "OFF_DUTY":    return "neutral";
    default:            return "neutral";
  }
}
export function vehicleStatusTone(status: string): SemanticTone {
  switch (status) {
    case "AVAILABLE":      return "success";
    case "ON_TRIP":        return "brand";
    case "MAINTENANCE":    return "warn";
    case "OUT_OF_SERVICE": return "danger";
    default:               return "neutral";
  }
}
export function tripStatusTone(status: string): SemanticTone {
  switch (status) {
    case "COMPLETED":   return "success";
    case "IN_PROGRESS": return "brand";
    case "PENDING":     return "warn";
    case "CANCELLED":   return "neutral";
    default:            return "neutral";
  }
}
export function roleTone(role: string): SemanticTone {
  switch (role) {
    case "admin":    return "brand";
    case "employee": return "info";
    case "driver":   return "success";
    default:         return "neutral";
  }
}
export function scoreTone(score: number): SemanticTone {
  if (score >= 80) return "success";
  if (score >= 60) return "brand";
  if (score > 0)   return "danger";
  return "neutral";
}
