/**
 * POST /api/import/bulk — multi-section importer.
 *
 * Accepts either fleet-setup.csv (DRIVER/VEHICLE/FIXED_COST rows) or
 * weekly-operations.csv (SHIFT/TRIP/FUEL/MAINTENANCE rows) in a single
 * upload. Rows are discriminated by the `record_type` column.
 *
 * Comment rows start with `#` in the first cell and are ignored. Empty
 * rows are ignored. Unknown record_type values collect into report.errors.
 *
 * Dependency order enforced within a single upload:
 *   DRIVER, VEHICLE, FIXED_COST → in that order (setup file)
 *   SHIFT,  TRIP,    FUEL,  MAINTENANCE → any order (operations file)
 * If both setups and operations are mixed in one file, setup rows run first.
 *
 * Per-row isolation: one bad row doesn't abort the import. Full per-row
 * errors returned in the response.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asInt, asFloat, asDate } from "@/lib/csv";
import { requireAdmin, readCsvBody, writeAudit } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, string>;
type Report = {
  ok: boolean;
  counts: Record<string, { inserted: number; skipped: number; errors: number }>;
  errors: { row: number; type: string; message: string }[];
  durationMs: number;
};

const VALID_CATEGORIES = new Set([
  "LEASE", "INSURANCE", "FINANCING", "PARKING", "WASH", "LOYVE",
  "TAXIMETER", "REGISTRATION", "DEPRECIATION", "OFFICE", "SOFTWARE",
  "SALARY", "EMPLOYER_NI", "ACCOUNTING", "OTHER",
]);
const VALID_FREQ = new Set(["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"]);
const ORDER = ["DRIVER", "VEHICLE", "FIXED_COST", "SHIFT", "TRIP", "FUEL", "MAINTENANCE"];

function newBucket() { return { inserted: 0, skipped: 0, errors: 0 }; }

async function resolveDriverId(email: string | null): Promise<string | null> {
  if (!email) return null;
  const d = await prisma.driver.findUnique({ where: { email: email.toLowerCase() } });
  return d?.id ?? null;
}
async function resolveVehicleId(carId: string | null): Promise<string | null> {
  if (!carId) return null;
  const v =
    (await prisma.vehicle.findUnique({ where: { carId } })) ||
    (await prisma.vehicle.findUnique({ where: { plateNumber: carId } }));
  return v?.id ?? null;
}

async function importDriver(r: Row): Promise<void> {
  const email = asStr(r.email)?.toLowerCase();
  const name = asStr(r.name);
  if (!email || !name) throw new Error("DRIVER row missing name or email");
  await prisma.driver.upsert({
    where: { email },
    update: {
      name,
      phone: asStr(r.phone) || "",
      licenseNumber: asStr(r.license_number) || email,
      licenseExpiry: asDate(r.license_expiry) || new Date(Date.now() + 365 * 24 * 3600_000),
      address: asStr(r.address),
      status: (asStr(r.status) || "ACTIVE").toUpperCase(),
    },
    create: {
      name,
      email,
      phone: asStr(r.phone) || "",
      licenseNumber: asStr(r.license_number) || email,
      licenseExpiry: asDate(r.license_expiry) || new Date(Date.now() + 365 * 24 * 3600_000),
      address: asStr(r.address),
      status: (asStr(r.status) || "ACTIVE").toUpperCase(),
      joinedAt: asDate(r.hire_date) || new Date(),
    },
  });
}

async function importVehicle(r: Row): Promise<void> {
  const carId = asStr(r.car_id);
  if (!carId) throw new Error("VEHICLE row missing car_id");
  const plate = asStr(r.plate_number) || carId;
  const common = {
    make: asStr(r.make) || "",
    model: asStr(r.model) || "",
    year: asInt(r.year) || new Date().getFullYear(),
    color: asStr(r.color) || "",
    plateNumber: plate,
    fuelType: asStr(r.fuel_type) || "Electric",
    status: (asStr(r.status) || "ACTIVE").toUpperCase(),
    purchasePriceNok: asFloat(r.purchase_price_nok),
    purchaseDate: asDate(r.purchase_date),
    leaseMonthlyNok: asFloat(r.lease_monthly_nok),
    insuranceMonthlyNok: asFloat(r.insurance_monthly_nok),
  };
  await prisma.vehicle.upsert({
    where: { carId },
    update: { ...common, ...(asInt(r.current_mileage_km) != null ? { mileage: asInt(r.current_mileage_km)! } : {}) },
    create: { carId, ...common, mileage: asInt(r.current_mileage_km) ?? 0 },
  });
}

async function importFixedCost(r: Row): Promise<void> {
  const category = (asStr(r.category) || "OTHER").toUpperCase();
  const description = asStr(r.description);
  const amount = asFloat(r.amount_nok);
  const start = asDate(r.start_date);
  const frequency = (asStr(r.frequency) || "MONTHLY").toUpperCase();
  if (!description || amount === null || !start)
    throw new Error("FIXED_COST missing description, amount_nok, or start_date");
  if (!VALID_CATEGORIES.has(category)) throw new Error(`Unknown category ${category}`);
  if (!VALID_FREQ.has(frequency)) throw new Error(`Unknown frequency ${frequency}`);
  let vehicleId: string | null = null;
  if (asStr(r.car_id)) vehicleId = await resolveVehicleId(asStr(r.car_id));
  const fc = (prisma as unknown as { fixedCost: { create: (a: unknown) => Promise<unknown> } }).fixedCost;
  await fc.create({
    data: {
      vehicleId,
      category,
      description,
      amountNok: amount,
      frequency,
      startDate: start,
      endDate: asDate(r.end_date),
      vendor: asStr(r.vendor),
      notes: asStr(r.notes),
    } as Record<string, unknown>,
  });
}

async function importShift(r: Row): Promise<void> {
  const date = asDate(r.date);
  const email = asStr(r.driver_email)?.toLowerCase() ?? null;
  const carId = asStr(r.car_id);
  if (!date || !email || !carId) throw new Error("SHIFT missing date, driver_email, or car_id");
  const [driverId, vehicleId] = await Promise.all([resolveDriverId(email), resolveVehicleId(carId)]);
  if (!driverId) throw new Error(`Unknown driver_email ${email}`);
  if (!vehicleId) throw new Error(`Unknown car_id ${carId}`);
  const sh = (prisma as unknown as { shift: { create: (a: unknown) => Promise<unknown> } }).shift;
  await sh.create({
    data: {
      driverId,
      vehicleId,
      shiftDate: date,
      startTime: asStr(r.shift_start) || "00:00",
      endTime: asStr(r.shift_end) || "00:00",
      hoursOnline: asFloat(r.hours_online),
      zone: asStr(r.zone),
      platformPrimary: asStr(r.platform),
      status: (asStr(r.status) || "completed").toLowerCase(),
    } as Record<string, unknown>,
  });
}

async function importTrip(r: Row): Promise<{ inserted: boolean }> {
  const date = asDate(r.date);
  const time = asStr(r.time) || "00:00";
  const email = asStr(r.driver_email)?.toLowerCase() ?? null;
  const carId = asStr(r.car_id);
  if (!date || !email || !carId) throw new Error("TRIP missing date, driver_email, or car_id");
  const [driverId, vehicleId] = await Promise.all([resolveDriverId(email), resolveVehicleId(carId)]);
  if (!driverId) throw new Error(`Unknown driver_email ${email}`);
  if (!vehicleId) throw new Error(`Unknown car_id ${carId}`);
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  const startedAt = new Date(date);
  if (Number.isFinite(hh) && Number.isFinite(mm)) startedAt.setUTCHours(hh, mm);

  // Idempotency — 10s window same as /api/import/trips
  const dupe = await prisma.trip.findFirst({
    where: {
      driverId, vehicleId,
      startedAt: {
        gte: new Date(startedAt.getTime() - 10_000),
        lte: new Date(startedAt.getTime() + 10_000),
      },
    },
    select: { id: true },
  });
  if (dupe) return { inserted: false };

  const duration = asInt(r.duration_min);
  await prisma.trip.create({
    data: {
      driverId,
      vehicleId,
      pickupAddress: asStr(r.pickup_address) || "",
      dropoffAddress: asStr(r.dropoff_address) || "",
      distance: asFloat(r.distance_km),
      duration,
      fare: asFloat(r.fare_nok),
      paymentMethod: (asStr(r.payment_method) || "CARD").toUpperCase(),
      platform: asStr(r.platform),
      tipsNok: asFloat(r.tips_nok),
      rating: asFloat(r.rating),
      status: (asStr(r.status) || "COMPLETED").toUpperCase(),
      startedAt,
      completedAt: duration ? new Date(startedAt.getTime() + duration * 60_000) : null,
    },
  });
  return { inserted: true };
}

async function importFuel(r: Row): Promise<void> {
  const date = asDate(r.date);
  const carId = asStr(r.car_id);
  if (!date || !carId) throw new Error("FUEL missing date or car_id");
  const vehicleId = await resolveVehicleId(carId);
  if (!vehicleId) throw new Error(`Unknown car_id ${carId}`);
  await prisma.fuelLog.create({
    data: {
      vehicleId,
      filledAt: date,
      liters: asFloat(r.liters_or_kwh) || 0,
      pricePerLiter: asFloat(r.price_per_unit_nok) || 0,
      totalCost: asFloat(r.total_cost_nok) || 0,
      mileageAtFill: asInt(r.mileage_km) || 0,
      station: asStr(r.station),
    },
  });
}

async function importMaintenance(r: Row): Promise<void> {
  const date = asDate(r.date);
  const carId = asStr(r.car_id);
  if (!date || !carId) throw new Error("MAINTENANCE missing date or car_id");
  const vehicleId = await resolveVehicleId(carId);
  if (!vehicleId) throw new Error(`Unknown car_id ${carId}`);
  const status = (asStr(r.status) || "COMPLETED").toUpperCase();
  await prisma.maintenance.create({
    data: {
      vehicleId,
      type: (asStr(r.type) || "OTHER").toUpperCase(),
      description: asStr(r.description) || "",
      cost: asFloat(r.total_cost_nok),
      scheduledAt: date,
      completedAt: status === "COMPLETED" ? date : null,
      status,
      notes: asStr(r.notes),
    },
  });
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (gate) return gate;
  const start = Date.now();
  const report: Report = {
    ok: true,
    counts: Object.fromEntries(ORDER.map((t) => [t, newBucket()])),
    errors: [],
    durationMs: 0,
  };

  try {
    const csv = await readCsvBody(req);
    const rows = parseCsv(csv);

    // Filter out comment/blank rows and sort by record_type so dependencies
    // resolve correctly (drivers + vehicles before trips + shifts).
    const typed = rows
      .map((r, idx) => ({ r, idx, type: (r.record_type || "").trim().toUpperCase() }))
      .filter((x) => x.type && !x.type.startsWith("#"));
    typed.sort((a, b) => {
      const ai = ORDER.indexOf(a.type);
      const bi = ORDER.indexOf(b.type);
      // Unknown types bubble to the end where they collect as errors
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const { r, idx, type } of typed) {
      const bucket = report.counts[type] ?? (report.counts[type] = newBucket());
      try {
        switch (type) {
          case "DRIVER":       await importDriver(r); bucket.inserted++; break;
          case "VEHICLE":      await importVehicle(r); bucket.inserted++; break;
          case "FIXED_COST":   await importFixedCost(r); bucket.inserted++; break;
          case "SHIFT":        await importShift(r); bucket.inserted++; break;
          case "TRIP":         {
            const { inserted } = await importTrip(r);
            if (inserted) bucket.inserted++; else bucket.skipped++;
            break;
          }
          case "FUEL":         await importFuel(r); bucket.inserted++; break;
          case "MAINTENANCE":  await importMaintenance(r); bucket.inserted++; break;
          default:
            throw new Error(`Unknown record_type '${type}'. Accepted: ${ORDER.join(", ")}`);
        }
      } catch (err) {
        bucket.errors++;
        report.errors.push({
          row: idx + 2,
          type,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    report.durationMs = Date.now() - start;
    report.ok = report.errors.length === 0;

    await writeAudit({
      action: "import.bulk",
      target: "bulk",
      ok: report.ok,
      actorEmail: req.headers.get("x-user-email"),
      actorId: req.headers.get("x-user-id"),
      meta: { counts: report.counts, errorCount: report.errors.length, durationMs: report.durationMs },
    });

    return NextResponse.json(report);
  } catch (err) {
    report.ok = false;
    report.durationMs = Date.now() - start;
    report.errors.push({
      row: 0, type: "N/A",
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(report, { status: 500 });
  }
}
