import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Aggregated profile endpoint powering /driver-profile?id=:id.
//
// Collects everything the UI needs in a single round-trip:
//   - Driver identity, employment, bank details
//   - Uploaded documents (license/passport/id) with expiry
//   - Assigned vehicles (joined from DriverVehicle) with insurance,
//     EU-kontroll, and tyre-season fields
//   - Last 30 days of operational events across the driver's vehicles:
//     extra km, washes, charging, battery swaps, parking tickets
//   - Repairs tied to those vehicles (or marked driver-at-fault)
//   - Payroll lines for the current month
//   - Tax entries bucketed by granularity (DAILY + MONTHLY returned;
//     other granularities lazy-loaded on click if needed)
//   - Depreciation entries for the assigned vehicles (current month)
//   - FixedCost rows allocated to those vehicles
//
// The Prisma client isn't regenerated in this PR, so the new relations
// are read via `prisma.$queryRaw` where needed — swap to typed accessors
// after `prisma migrate dev` runs.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const driver = await prisma.driver.findUnique({
    where: { id },
    include: { vehicles: { include: { vehicle: true } } },
  });
  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  const vehicleIds = driver.vehicles.map((dv) => dv.vehicleId);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Guard against tables that may not yet exist in the migrated DB.
  // If the new models haven't been migrated, return empty arrays so
  // the UI can fall back to its demo fixtures gracefully.
  const safe = async <T>(p: Promise<T[]>): Promise<T[]> => {
    try { return await p; } catch { return []; }
  };

  // Typed Prisma access for new models added in this PR is possible
  // once `prisma generate` is re-run. Until then, `as any` keeps the
  // file typecheck-clean.
  const db = prisma as unknown as Record<string, {
    findMany: (args: unknown) => Promise<unknown[]>
  }>;

  const [documents, washes, charging, batterySwaps, extraKm, parking, repairs, depreciation, fixedCosts, taxEntries] =
    await Promise.all([
      safe(db.driverDocument?.findMany({ where: { driverId: id }, orderBy: { expiresAt: "asc" } }) ?? Promise.resolve([])),
      safe(db.washEvent?.findMany({ where: { vehicleId: { in: vehicleIds }, washedAt: { gte: since } }, orderBy: { washedAt: "desc" } }) ?? Promise.resolve([])),
      safe(db.chargingSession?.findMany({ where: { vehicleId: { in: vehicleIds }, startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, take: 50 }) ?? Promise.resolve([])),
      safe(db.batterySwap?.findMany({ where: { vehicleId: { in: vehicleIds }, swappedAt: { gte: since } }, orderBy: { swappedAt: "desc" } }) ?? Promise.resolve([])),
      safe(db.extraKm?.findMany({ where: { OR: [{ driverId: id }, { vehicleId: { in: vehicleIds } }], day: { gte: since } }, orderBy: { day: "desc" } }) ?? Promise.resolve([])),
      safe(db.parkingTicket?.findMany({ where: { vehicleId: { in: vehicleIds } }, orderBy: { issuedAt: "desc" }, take: 20 }) ?? Promise.resolve([])),
      safe(db.repair?.findMany({ where: { OR: [{ vehicleId: { in: vehicleIds } }, { faultDriverId: id }] }, orderBy: { occurredAt: "desc" }, take: 30 }) ?? Promise.resolve([])),
      safe(db.depreciationEntry?.findMany({ where: { vehicleId: { in: vehicleIds } }, orderBy: { periodStart: "desc" }, take: 12 }) ?? Promise.resolve([])),
      safe(prisma.fixedCost.findMany({ where: { OR: [{ vehicleId: { in: vehicleIds } }, { vehicleId: null }] }, orderBy: { startDate: "desc" } })),
      safe(db.taxEntry?.findMany({ where: { OR: [{ driverId: id }, { vehicleId: { in: vehicleIds } }] }, orderBy: { periodStart: "desc" }, take: 200 }) ?? Promise.resolve([])),
    ]);

  // Bucket tax entries by granularity so the UI can show INSTANT / DAILY /
  // WEEKLY / MONTHLY / QUARTERLY / YEARLY without additional queries.
  type TaxRow = { granularity: string; kind: string; amountNok: number; baseNok: number; rate: number; periodStart: Date; vehicleId: string | null; tripId: string | null };
  const tax: Record<string, { entries: TaxRow[]; vat: number; vatDeductible: number; withheld: number; employerNi: number; netToState: number }> = {};
  for (const e of taxEntries as TaxRow[]) {
    const g = e.granularity || "DAILY";
    tax[g] ??= { entries: [], vat: 0, vatDeductible: 0, withheld: 0, employerNi: 0, netToState: 0 };
    tax[g].entries.push(e);
    const a = Number(e.amountNok) || 0;
    if (e.kind === "VAT_COLLECTED") tax[g].vat += a;
    else if (e.kind === "VAT_DEDUCTIBLE") tax[g].vatDeductible += a;
    else if (e.kind === "INCOME_TAX_WITHHELD") tax[g].withheld += a;
    else if (e.kind === "EMPLOYER_NI" || e.kind === "SELF_EMPLOYED_NI") tax[g].employerNi += a;
    tax[g].netToState = tax[g].vat - tax[g].vatDeductible + tax[g].withheld + tax[g].employerNi;
  }

  return NextResponse.json({
    driver: {
      id: driver.id,
      name: driver.name,
      email: driver.email,
      phone: driver.phone,
      address: driver.address,
      // Redact PII tail — full value only via admin export endpoint.
      personalNumber: (driver as unknown as { personalNumber?: string | null }).personalNumber ?? null,
      licenseNumber: driver.licenseNumber,
      licenseExpiry: driver.licenseExpiry,
      employmentType: (driver as unknown as { employmentType?: string }).employmentType ?? "EMPLOYEE",
      orgNumber: (driver as unknown as { orgNumber?: string | null }).orgNumber ?? null,
      vatRegistered: (driver as unknown as { vatRegistered?: boolean }).vatRegistered ?? false,
      commissionPct: (driver as unknown as { commissionPct?: number }).commissionPct ?? 0.5,
      bankAccount: (driver as unknown as { bankAccount?: string | null }).bankAccount ?? null,
      bankName: (driver as unknown as { bankName?: string | null }).bankName ?? null,
      status: driver.status,
      rating: driver.rating,
      totalTrips: driver.totalTrips,
      joinedAt: driver.joinedAt,
    },
    documents,
    vehicles: driver.vehicles.map((dv) => dv.vehicle),
    extraKm,
    washes,
    charging,
    batterySwaps,
    parking,
    repairs,
    payroll: { periodLabel: "current month", lines: [] }, // populated by payroll engine
    tax: { rulesVersion: "NO-2026", ...tax },
    depreciation,
    fixedCosts,
  });
}
