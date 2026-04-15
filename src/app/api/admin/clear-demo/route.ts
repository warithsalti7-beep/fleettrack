import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/clear-demo
 *
 * One-click equivalent of `prisma/scripts/clear-demo-data.ts`. Kept
 * behind two gates so it cannot fire by accident:
 *
 *   1. Header `X-Admin-Token: $SEED_TOKEN` MUST match the env var.
 *   2. Body MUST include `{ "confirm": "YES" }` exactly.
 *
 * Preserves: User, Driver, Vehicle (rows + plateNumber + make + model
 * + year + carId + vin + plateNormalized + color).
 *
 * Resets every other Vehicle column (mileage, fuelLevel, gps,
 * insurance details, EU-kontroll, tyres, lease, etc.) to null/defaults.
 *
 * Returns: { ok, deleted: { TableName: rowCount, … }, preserved: { … } }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES: Array<[string, string]> = [
  ["UberRawTrip",        `DELETE FROM "UberRawTrip"`],
  ["BoltRawTrip",        `DELETE FROM "BoltRawTrip"`],
  ["TaxiRawTrip",        `DELETE FROM "TaxiRawTrip"`],
  ["SettlementRawRow",   `DELETE FROM "SettlementRawRow"`],
  ["TripCharge",         `DELETE FROM "TripCharge"`],
  ["TelematicsSample",   `DELETE FROM "TelematicsSample"`],
  ["DriverEvent",        `DELETE FROM "DriverEvent"`],
  ["Incident",           `DELETE FROM "Incident"`],
  ["DataIssue",          `DELETE FROM "DataIssue"`],
  ["AuditLog",           `DELETE FROM "AuditLog"`],
  ["ImportLog",          `DELETE FROM "ImportLog"`],
  ["Trip",               `DELETE FROM "Trip"`],
  ["Shift",              `DELETE FROM "Shift"`],
  ["Settlement",         `DELETE FROM "Settlement"`],
  ["WashEvent",          `DELETE FROM "WashEvent"`],
  ["ChargingSession",    `DELETE FROM "ChargingSession"`],
  ["BatterySwap",        `DELETE FROM "BatterySwap"`],
  ["ExtraKm",            `DELETE FROM "ExtraKm"`],
  ["ParkingTicket",      `DELETE FROM "ParkingTicket"`],
  ["Repair",             `DELETE FROM "Repair"`],
  ["DepreciationEntry",  `DELETE FROM "DepreciationEntry"`],
  ["TaxEntry",           `DELETE FROM "TaxEntry"`],
  ["FuelLog",            `DELETE FROM "FuelLog"`],
  ["Maintenance",        `DELETE FROM "Maintenance"`],
  ["FixedCost",          `DELETE FROM "FixedCost"`],
  ["DriverDocument",     `DELETE FROM "DriverDocument"`],
  ["DriverVehicle",      `DELETE FROM "DriverVehicle"`],
];

const VEHICLE_RESET_SQL = `
  UPDATE "Vehicle" SET
    "status"               = 'AVAILABLE',
    "fuelLevel"            = 100.0,
    "mileage"              = 0,
    "latitude"             = NULL,
    "longitude"            = NULL,
    "lastService"          = NULL,
    "nextService"          = NULL,
    "insuranceProvider"    = NULL,
    "insurancePolicyNumber"= NULL,
    "insuranceExpiry"      = NULL,
    "insuranceMonthlyNok"  = NULL,
    "leaseMonthlyNok"      = NULL,
    "purchasePriceNok"     = NULL,
    "purchaseDate"         = NULL,
    "euKontrollLast"       = NULL,
    "euKontrollNext"       = NULL,
    "tyreSeason"           = NULL,
    "tyreChangedAt"        = NULL,
    "residualValueNok"     = NULL,
    "depreciationYears"    = NULL,
    "depreciationMethod"   = 'DECLINING_24',
    "updatedAt"            = NOW()
`;

export async function POST(req: NextRequest) {
  // Gate 1: SEED_TOKEN header
  const expected = process.env.SEED_TOKEN;
  const provided = req.headers.get("x-admin-token");
  if (!expected) {
    return NextResponse.json({ error: "SEED_TOKEN not configured on server" }, { status: 500 });
  }
  if (provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Gate 2: explicit confirmation in body
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "YES") {
    return NextResponse.json(
      { error: "Body must include {\"confirm\": \"YES\"}" },
      { status: 400 },
    );
  }

  const beforeUsers = await prisma.user.count();
  const beforeDrivers = await prisma.driver.count();
  const beforeVehicles = await prisma.vehicle.count();

  const deleted: Record<string, number> = {};
  let vehiclesReset = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const [name, sql] of TABLES) {
        try {
          const n = await tx.$executeRawUnsafe(sql);
          deleted[name] = typeof n === "number" ? n : 0;
        } catch {
          // table not migrated yet — record and keep going
          deleted[name] = -1;
        }
      }
      try {
        const r = await tx.$executeRawUnsafe(VEHICLE_RESET_SQL);
        vehiclesReset = typeof r === "number" ? r : 0;
      } catch (e) {
        deleted["__vehicle_reset_error__"] = -1;
        void e;
      }
    },
    { timeout: 60_000 },
  );

  const afterUsers = await prisma.user.count();
  const afterDrivers = await prisma.driver.count();
  const afterVehicles = await prisma.vehicle.count();

  const preserved =
    afterUsers === beforeUsers &&
    afterDrivers === beforeDrivers &&
    afterVehicles === beforeVehicles;

  return NextResponse.json({
    ok: preserved,
    preservation: {
      users: { before: beforeUsers, after: afterUsers, ok: afterUsers === beforeUsers },
      drivers: { before: beforeDrivers, after: afterDrivers, ok: afterDrivers === beforeDrivers },
      vehicles: { before: beforeVehicles, after: afterVehicles, ok: afterVehicles === beforeVehicles },
    },
    deleted,
    vehiclesReset,
    note: "Driver, Vehicle (plate/model/year/carId/vin) and User rows preserved. Vehicle operational columns reset to defaults. Re-import via Dashboard → System → Data Import.",
  });
}
