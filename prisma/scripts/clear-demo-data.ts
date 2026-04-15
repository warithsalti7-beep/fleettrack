/**
 * clear-demo-data.ts
 *
 * Wipes every operational and demo row from the database while
 * PRESERVING:
 *   - User       (auth)
 *   - Driver     (master list — already real)
 *   - Vehicle    (plate + model + carId + make + year — already real)
 *
 * Other Vehicle columns (latitude/longitude, fuelLevel, mileage,
 * insuranceProvider, insurancePolicyNumber, insuranceExpiry,
 * euKontrollLast/Next, tyreSeason, tyreChangedAt, lastService,
 * nextService, leaseMonthlyNok, insuranceMonthlyNok, purchasePriceNok,
 * residualValueNok, depreciationYears) are reset to NULL because they
 * were demo-only and will be re-populated from real CSVs.
 *
 * Usage:
 *   pnpm tsx prisma/scripts/clear-demo-data.ts            # dry-run, prints counts only
 *   pnpm tsx prisma/scripts/clear-demo-data.ts --apply    # actually deletes
 *   DATABASE_URL=…neon://… pnpm tsx prisma/scripts/clear-demo-data.ts --apply
 *
 * Safety:
 *   - Wrapped in a single Prisma $transaction so any error rolls
 *     everything back.
 *   - Refuses to apply unless --apply is passed AND the env var
 *     CLEAR_CONFIRM=YES is set, so a stray invocation does nothing.
 *   - Prints before+after counts so you can verify the wipe.
 *   - Models that may not be migrated yet (raw-trip tables, Settlement,
 *     DataIssue, …) are deleted via $executeRawUnsafe with try/catch
 *     so the script keeps going and never half-commits.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const CONFIRM = process.env.CLEAR_CONFIRM === "YES";

// Tables to truncate IN ORDER. Children before parents so FK refs
// don't block the delete. Each entry is [pretty name, raw SQL DELETE].
// Using DELETE (not TRUNCATE) keeps the migration history table
// untouched and works on Neon free tier.
const TABLES: Array<[string, string]> = [
  // raw-staging tables (FK to nothing or to children we'll clear next)
  ["UberRawTrip",        `DELETE FROM "UberRawTrip"`],
  ["BoltRawTrip",        `DELETE FROM "BoltRawTrip"`],
  ["TaxiRawTrip",        `DELETE FROM "TaxiRawTrip"`],
  ["SettlementRawRow",   `DELETE FROM "SettlementRawRow"`],

  // children of Trip
  ["TripCharge",         `DELETE FROM "TripCharge"`],

  // event/log tables
  ["TelematicsSample",   `DELETE FROM "TelematicsSample"`],
  ["DriverEvent",        `DELETE FROM "DriverEvent"`],
  ["Incident",           `DELETE FROM "Incident"`],
  ["DataIssue",          `DELETE FROM "DataIssue"`],
  ["AuditLog",           `DELETE FROM "AuditLog"`],
  ["ImportLog",          `DELETE FROM "ImportLog"`],

  // operational fact tables
  ["Trip",               `DELETE FROM "Trip"`],
  ["Shift",              `DELETE FROM "Shift"`],
  ["Settlement",         `DELETE FROM "Settlement"`],

  // cost / event tables
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

  // documents (kept entity is Driver; documents are demo)
  ["DriverDocument",     `DELETE FROM "DriverDocument"`],

  // assignment join (drivers + vehicles preserved; the link is demo)
  ["DriverVehicle",      `DELETE FROM "DriverVehicle"`],
];

// Reset Vehicle demo-only columns; KEEP the row + plateNumber/make/
// model/year/color/carId/plateNormalized/vin.
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

async function main() {
  console.log("──────────────────────────────────────────────────");
  console.log("FleetTrack — clear demo data");
  console.log("──────────────────────────────────────────────────");
  console.log(APPLY ? "MODE: APPLY (will delete)" : "MODE: dry-run (no changes)");
  if (APPLY && !CONFIRM) {
    console.error(
      "Refusing to apply without CLEAR_CONFIRM=YES in the environment.",
    );
    process.exit(2);
  }

  // Snapshot counts before
  const beforeDrivers = await prisma.driver.count();
  const beforeVehicles = await prisma.vehicle.count();
  const beforeUsers = await prisma.user.count();
  console.log(`PRESERVING  : User=${beforeUsers}  Driver=${beforeDrivers}  Vehicle=${beforeVehicles}`);

  if (!APPLY) {
    // Show counts of every table we'd wipe.
    for (const [name, sql] of TABLES) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
          `SELECT COUNT(*)::bigint AS c FROM "${name}"`,
        );
        const c = rows[0]?.c ?? BigInt(0);
        console.log(`would delete ${String(c).padStart(6, " ")} rows from  ${name}`);
      } catch {
        console.log(`(skip)        ${name}  — table not migrated`);
      }
      void sql;
    }
    console.log("\nDry run complete. Re-run with --apply and CLEAR_CONFIRM=YES to execute.");
    return;
  }

  // APPLY — single transaction
  await prisma.$transaction(
    async (tx) => {
      let deletedTotal = 0;
      for (const [name, sql] of TABLES) {
        try {
          const r = await tx.$executeRawUnsafe(sql);
          if (typeof r === "number") {
            console.log(`deleted ${String(r).padStart(6, " ")} rows from  ${name}`);
            deletedTotal += r;
          }
        } catch (e) {
          console.log(`(skip)    ${name}  — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      console.log("");
      // Reset Vehicle columns
      const vUpd = await tx.$executeRawUnsafe(VEHICLE_RESET_SQL);
      console.log(`reset    ${String(vUpd).padStart(6, " ")} Vehicle rows (preserved id/plate/model/make/year/carId/vin/plateNormalized)`);
      console.log(`────────  total operational-row deletions: ${deletedTotal}`);
    },
    { timeout: 60_000 },
  );

  // Snapshot counts after — confirms preservation
  const afterDrivers = await prisma.driver.count();
  const afterVehicles = await prisma.vehicle.count();
  const afterUsers = await prisma.user.count();
  const afterTrips = await prisma.trip.count();
  const afterShifts = await prisma.shift.count();
  console.log("");
  console.log("──────────────────────────────────────────────────");
  console.log("AFTER   : User=" + afterUsers + "  Driver=" + afterDrivers + "  Vehicle=" + afterVehicles);
  console.log("           Trip=" + afterTrips + "  Shift=" + afterShifts);
  if (afterDrivers !== beforeDrivers || afterVehicles !== beforeVehicles || afterUsers !== beforeUsers) {
    console.error("⚠  PRESERVATION FAILED — Driver / Vehicle / User counts changed.");
    process.exit(3);
  }
  console.log("✓ Driver, Vehicle and User rows preserved exactly.");
}

main()
  .catch((e) => {
    console.error("Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
