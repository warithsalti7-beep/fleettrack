/**
 * Fuzzy-match helpers shared by every per-source import route.
 *
 * The golden rule: these helpers NEVER create new entities on their
 * own. They return the best existing match (or null) and let the
 * caller decide whether to auto-create. That keeps deduplication
 * logic in one place and makes matching behaviour easy to unit-test.
 */
import { prisma } from "./prisma";

// ───────── plate normalisation ─────────
// Norwegian plates are usually "AB 12345" or "AB12345"; EU leased
// plates sometimes have a dash ("DE-AB1234"); Bolt/Uber sheets
// occasionally lower-case them. We uppercase, strip every character
// that isn't A-Z / 0-9, and keep the order so "EL 12 345", "el12345",
// and "EL-12345" all match.
export function normalizePlate(input: string | null | undefined): string | null {
  if (!input) return null;
  const out = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return out.length >= 4 ? out : null;
}

// ───────── driver-name normalisation ─────────
// Lower-case, strip diacritics, collapse whitespace. Used as a
// secondary match when no email / externalDriverCode is available.
export function normalizeName(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ───────── driver match ─────────
// Match order, per spec §4.2:
//   1. externalDriverCode exact
//   2. email (unique index already)
//   3. normalized full name + phone OR email
// Returns { driver, confidence: HIGH | MEDIUM | LOW | NONE, reason }.
export type DriverMatch = {
  driverId: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  reason: string;
};

export async function matchDriver(query: {
  externalDriverCode?: string | null;
  email?: string | null;
  fullName?: string | null;
  phone?: string | null;
}): Promise<DriverMatch> {
  if (query.externalDriverCode) {
    const d = await prisma.driver
      .findUnique({ where: { externalDriverCode: query.externalDriverCode } })
      .catch(() => null);
    if (d) return { driverId: d.id, confidence: "HIGH", reason: "externalDriverCode" };
  }
  if (query.email) {
    const d = await prisma.driver.findUnique({
      where: { email: query.email.toLowerCase() },
    });
    if (d) return { driverId: d.id, confidence: "HIGH", reason: "email" };
  }
  if (query.fullName) {
    const norm = normalizeName(query.fullName);
    const candidates = await prisma.driver.findMany({
      where: query.phone ? { OR: [{ phone: query.phone }] } : {},
      select: { id: true, name: true, phone: true },
      take: 50,
    });
    const byName = candidates.find((c) => normalizeName(c.name) === norm);
    if (byName) {
      return {
        driverId: byName.id,
        confidence: query.phone && byName.phone === query.phone ? "HIGH" : "MEDIUM",
        reason: query.phone ? "name+phone" : "name",
      };
    }
  }
  return { driverId: null, confidence: "NONE", reason: "no-match" };
}

// ───────── vehicle match ─────────
// Match order:
//   1. normalised plate
//   2. VIN
// Returns the vehicle id + which key matched.
export type VehicleMatch = {
  vehicleId: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  reason: string;
};

export async function matchVehicle(query: {
  plate?: string | null;
  vin?: string | null;
  carId?: string | null;
}): Promise<VehicleMatch> {
  if (query.carId) {
    const v = await prisma.vehicle.findUnique({ where: { carId: query.carId } });
    if (v) return { vehicleId: v.id, confidence: "HIGH", reason: "carId" };
  }
  const plateN = normalizePlate(query.plate);
  if (plateN) {
    const byNorm = await prisma.vehicle
      .findUnique({ where: { plateNormalized: plateN } })
      .catch(() => null);
    if (byNorm) return { vehicleId: byNorm.id, confidence: "HIGH", reason: "plateNormalized" };
    // Legacy fallback for rows imported before plateNormalized was added.
    const byRaw = await prisma.vehicle.findFirst({
      where: {
        OR: [
          { plateNumber: query.plate ?? "" },
          { plateNumber: plateN },
        ],
      },
    });
    if (byRaw) return { vehicleId: byRaw.id, confidence: "HIGH", reason: "plateNumber" };
  }
  if (query.vin) {
    const v = await prisma.vehicle.findUnique({ where: { vin: query.vin } }).catch(() => null);
    if (v) return { vehicleId: v.id, confidence: "HIGH", reason: "vin" };
  }
  return { vehicleId: null, confidence: "NONE", reason: "no-match" };
}

// ───────── trip dedupe hash ─────────
// Spec §4.1 fallback: when no source_trip_id is present, hash the
// trip's stable identity. Any later re-import of the same raw row
// hashes identically and the upsert skips.
export function tripDedupeHash(parts: {
  source: string;
  startedAt: Date | string | null;
  fare: number | null;
  driverId: string | null;
  vehicleId: string | null;
  pickup?: string | null;
  dropoff?: string | null;
}): string {
  const iso = parts.startedAt
    ? new Date(parts.startedAt).toISOString().slice(0, 16) // minute precision
    : "";
  return [
    parts.source,
    iso,
    (parts.fare ?? 0).toFixed(2),
    parts.driverId ?? "",
    parts.vehicleId ?? "",
    (parts.pickup ?? "").slice(0, 40),
    (parts.dropoff ?? "").slice(0, 40),
  ].join("|");
}

/**
 * Utility: safely upsert `plateNormalized` onto an existing Vehicle
 * when older rows were created before the column existed. Called
 * opportunistically by matchVehicle fallback + by the Vehicles import
 * route. Never fails if Prisma client hasn't been regenerated.
 */
export async function backfillPlateNormalized(vehicleId: string, plate: string) {
  const n = normalizePlate(plate);
  if (!n) return;
  try {
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { plateNormalized: n } as never,
    });
  } catch {
    /* column not yet migrated — ignore */
  }
}
