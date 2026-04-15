/**
 * Shared per-source trip-import pipeline.
 *
 *   parseRows()         — CSV-row → ParsedRow (source-shape mapping)
 *   stageRaw()          — write the parsed row to the source's RawTrip table
 *   normalizeIntoTrip() — match driver/vehicle, upsert into Trip, link back
 *
 * Each per-source route plugs in its own column-mapping function and
 * gets idempotent ingestion + raw-row preservation for free.
 *
 * Two-stage design (raw → normalized) means:
 *   - The raw row is *always* kept even if normalisation fails, so the
 *     operator can see what came in and re-run after fixing data.
 *   - Re-uploading the same Uber export second time is a no-op because
 *     (externalPlatform, externalId) is unique on Trip AND
 *     (uberTripUuid|boltOrderId|meterReceiptId) is unique on the raw
 *     table — both layers reject duplicates independently.
 */
import { prisma } from "./prisma";
import {
  matchDriver,
  matchVehicle,
  tripDedupeHash,
  normalizePlate,
} from "./matching";
import type { ImportReport } from "./import";

export type Source = "UBER" | "BOLT" | "TAXI";

export type ParsedRow = {
  rowNumber: number;
  raw: Record<string, unknown>;
  // Source-native id used as primary dedupe key (preferred).
  sourceTripId?: string | null;
  driverEmail?: string | null;
  driverName?: string | null;
  externalDriverCode?: string | null;
  vehiclePlate?: string | null;
  tripStartAt?: Date | null;
  tripEndAt?: Date | null;
  grossFare?: number | null;
  platformFee?: number | null;
  driverEarnings?: number | null;
  tips?: number | null;
  tolls?: number | null;
  distanceKm?: number | null;
  durationMin?: number | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  paymentType?: string | null;
  cancellationFee?: number | null;
  currency?: string | null;
};

/**
 * Stage one parsed row in the source's raw table. Returns
 * { staged, isDuplicateRaw } so the caller can short-circuit
 * normalisation when the row is already there.
 */
export async function stageRaw(
  source: Source,
  importBatchId: string,
  fileName: string | null,
  row: ParsedRow,
): Promise<{ rawId: string | null; isDuplicateRaw: boolean; error?: string }> {
  const common = {
    importBatchId,
    fileName,
    rowNumber: row.rowNumber,
    rawPayload: row.raw as never,
    parseStatus: "PARSED" as const,
    normalizationStatus: "PENDING" as const,
    driverEmail: row.driverEmail ?? null,
    driverName: row.driverName ?? null,
    vehiclePlate: row.vehiclePlate ?? null,
    tripStartAt: row.tripStartAt ?? null,
    tripEndAt: row.tripEndAt ?? null,
    grossFare: row.grossFare ?? null,
    platformFee: row.platformFee ?? null,
    driverEarnings: row.driverEarnings ?? null,
    tips: row.tips ?? null,
    tolls: row.tolls ?? null,
    distanceKm: row.distanceKm ?? null,
    durationMin: row.durationMin ?? null,
    pickupAddress: row.pickupAddress ?? null,
    dropoffAddress: row.dropoffAddress ?? null,
    currency: row.currency ?? null,
  };
  try {
    if (source === "UBER") {
      if (row.sourceTripId) {
        const dup = await (prisma as never as { uberRawTrip: { findUnique: (a: unknown) => Promise<unknown> } })
          .uberRawTrip.findUnique({ where: { uberTripUuid: row.sourceTripId } })
          .catch(() => null);
        if (dup) return { rawId: (dup as { id: string }).id, isDuplicateRaw: true };
      }
      const created = await (prisma as never as { uberRawTrip: { create: (a: unknown) => Promise<{ id: string }> } })
        .uberRawTrip.create({
          data: { ...common, uberTripUuid: row.sourceTripId ?? null },
        });
      return { rawId: created.id, isDuplicateRaw: false };
    }
    if (source === "BOLT") {
      if (row.sourceTripId) {
        const dup = await (prisma as never as { boltRawTrip: { findUnique: (a: unknown) => Promise<unknown> } })
          .boltRawTrip.findUnique({ where: { boltOrderId: row.sourceTripId } })
          .catch(() => null);
        if (dup) return { rawId: (dup as { id: string }).id, isDuplicateRaw: true };
      }
      const created = await (prisma as never as { boltRawTrip: { create: (a: unknown) => Promise<{ id: string }> } })
        .boltRawTrip.create({
          data: {
            ...common,
            boltOrderId: row.sourceTripId ?? null,
            cancellationFee: row.cancellationFee ?? null,
          },
        });
      return { rawId: created.id, isDuplicateRaw: false };
    }
    // TAXI
    if (row.sourceTripId) {
      const dup = await (prisma as never as { taxiRawTrip: { findUnique: (a: unknown) => Promise<unknown> } })
        .taxiRawTrip.findUnique({ where: { meterReceiptId: row.sourceTripId } })
        .catch(() => null);
      if (dup) return { rawId: (dup as { id: string }).id, isDuplicateRaw: true };
    }
    const created = await (prisma as never as { taxiRawTrip: { create: (a: unknown) => Promise<{ id: string }> } })
      .taxiRawTrip.create({
        data: {
          ...common,
          meterReceiptId: row.sourceTripId ?? null,
          paymentType: row.paymentType ?? null,
        },
      });
    return { rawId: created.id, isDuplicateRaw: false };
  } catch (e) {
    return {
      rawId: null,
      isDuplicateRaw: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Find driver+vehicle for the parsed row and upsert into the
 * normalised Trip table. Auto-creates a Driver/Vehicle stub with
 * status=AVAILABLE per spec §4 ("If a new driver or vehicle appears in
 * imported files and does not exist, add it automatically with
 * status = active by default unless the file says otherwise").
 *
 * Returns the Trip id + which dedupe key matched, plus a boolean for
 * whether the row was new (true) vs updated (false).
 */
export async function normalizeIntoTrip(
  source: Source,
  rawId: string,
  row: ParsedRow,
  report: ImportReport,
): Promise<void> {
  const externalPlatform = source;
  const externalId = row.sourceTripId ?? null;

  // 1. Match or auto-create driver
  const dm = await matchDriver({
    externalDriverCode: row.externalDriverCode,
    email: row.driverEmail ?? null,
    fullName: row.driverName ?? null,
  });
  let driverId = dm.driverId;
  if (!driverId) {
    if (row.driverName || row.driverEmail) {
      const created = await prisma.driver.create({
        data: {
          name: row.driverName || row.driverEmail || `auto-${rawId.slice(0, 6)}`,
          email:
            row.driverEmail?.toLowerCase() ||
            `auto-${rawId.slice(0, 6)}@unknown.local`,
          phone: "",
          licenseNumber: `auto-${rawId.slice(0, 8)}`,
          licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
          status: "AVAILABLE",
          externalDriverCode: row.externalDriverCode ?? null,
        } as never,
      }).catch(() => null);
      driverId = created?.id ?? null;
    }
  }

  // 2. Match or auto-create vehicle
  const vm = await matchVehicle({ plate: row.vehiclePlate });
  let vehicleId = vm.vehicleId;
  if (!vehicleId && row.vehiclePlate) {
    const plateN = normalizePlate(row.vehiclePlate);
    const created = await prisma.vehicle.create({
      data: {
        plateNumber: row.vehiclePlate,
        plateNormalized: plateN,
        make: "Unknown",
        model: "Unknown",
        year: new Date().getFullYear(),
        color: "—",
        status: "AVAILABLE",
      } as never,
    }).catch(() => null);
    vehicleId = created?.id ?? null;
  }

  // 3. Upsert Trip
  if (!driverId || !vehicleId) {
    report.errors.push({
      row: row.rowNumber,
      message: `Could not match or create ${!driverId ? "driver" : "vehicle"} for raw ${rawId}`,
    });
    await markRaw(source, rawId, "FAILED", "no driver/vehicle match");
    return;
  }

  const data = {
    driverId,
    vehicleId,
    externalPlatform,
    externalId,
    pickupAddress: row.pickupAddress ?? "",
    dropoffAddress: row.dropoffAddress ?? "",
    distance: row.distanceKm ?? null,
    duration: row.durationMin ?? null,
    fare: row.grossFare ?? null,
    paymentMethod: (row.paymentType ?? "CARD").toUpperCase(),
    status: "COMPLETED",
    startedAt: row.tripStartAt ?? null,
    completedAt: row.tripEndAt ?? null,
  };

  let tripId: string | null = null;
  if (externalId) {
    const existing = await prisma.trip
      .findUnique({ where: { externalPlatform_externalId: { externalPlatform, externalId } } })
      .catch(() => null);
    if (existing) {
      await prisma.trip.update({ where: { id: existing.id }, data });
      report.updated++;
      tripId = existing.id;
    } else {
      const created = await prisma.trip.create({ data });
      report.inserted++;
      tripId = created.id;
    }
  } else {
    // Fallback: hash-based dedupe over the last 7 days
    const hash = tripDedupeHash({
      source,
      startedAt: row.tripStartAt ?? null,
      fare: row.grossFare ?? null,
      driverId,
      vehicleId,
      pickup: row.pickupAddress ?? null,
      dropoff: row.dropoffAddress ?? null,
    });
    const sevenDays = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const candidate = await prisma.trip.findFirst({
      where: {
        driverId,
        vehicleId,
        startedAt: { gte: sevenDays },
        fare: row.grossFare ?? undefined,
      },
    });
    if (candidate && tripDedupeHash({
      source,
      startedAt: candidate.startedAt,
      fare: candidate.fare,
      driverId,
      vehicleId,
      pickup: candidate.pickupAddress,
      dropoff: candidate.dropoffAddress,
    }) === hash) {
      report.skipped++;
      tripId = candidate.id;
    } else {
      const created = await prisma.trip.create({ data });
      report.inserted++;
      tripId = created.id;
    }
  }

  // 4. Tip the raw row to NORMALIZED + link back
  await markRaw(source, rawId, "NORMALIZED", null, tripId);
}

async function markRaw(
  source: Source,
  rawId: string,
  status: "NORMALIZED" | "FAILED",
  errorMessage: string | null,
  tripId?: string | null,
) {
  const data = {
    normalizationStatus: status,
    errorMessage: errorMessage ?? undefined,
    normalizedTripId: tripId ?? undefined,
  };
  try {
    if (source === "UBER") {
      await (prisma as never as { uberRawTrip: { update: (a: unknown) => Promise<unknown> } })
        .uberRawTrip.update({ where: { id: rawId }, data });
    } else if (source === "BOLT") {
      await (prisma as never as { boltRawTrip: { update: (a: unknown) => Promise<unknown> } })
        .boltRawTrip.update({ where: { id: rawId }, data });
    } else {
      await (prisma as never as { taxiRawTrip: { update: (a: unknown) => Promise<unknown> } })
        .taxiRawTrip.update({ where: { id: rawId }, data });
    }
  } catch {
    /* raw table not migrated yet — ignore */
  }
}
