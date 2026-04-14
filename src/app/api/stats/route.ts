/**
 * GET /api/stats — canonical KPIs computed from Neon.
 *
 * Returns a single envelope the dashboard can render end-to-end. Every
 * branch falls back to 0 when no data exists, so the UI can call this
 * immediately after signup without a "first-import" special case.
 *
 * Shape (truncated for brevity; full in docs/API.md):
 *   {
 *     today:    { revenueNok, trips, activeDrivers, onTripVehicles },
 *     wtd:      { revenueNok, trips, daysElapsed },
 *     mtd:      { revenueNok, fixedCostsNok, variableCostsNok, grossNok,
 *                 netNok, marginPct, breakEvenDay, vatPayableNok },
 *     fleet:    { drivers: {...counts by status}, vehicles: {...}, maint: {...} },
 *     trip:     { avgFareNok, avgDistanceKm, revenuePerKmNok, avgRating },
 *     fuel:     { totalCostNok, totalLiters, pricePerLiterNok },
 *     dataState: "empty" | "partial" | "ready"
 *   }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { subDays, startOfMonth, startOfDay, differenceInDays, getDaysInMonth } from "date-fns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOK_VAT_RATE = 0.12; // Norwegian ride-share reduced VAT rate

/** Normalise a FixedCost row into monthly NOK regardless of its frequency. */
function monthlyAmountNok(row: { amountNok: number; frequency: string }): number {
  const amt = Math.abs(Number(row.amountNok || 0));
  switch (row.frequency) {
    case "MONTHLY":   return amt;
    case "QUARTERLY": return amt / 3;
    case "YEARLY":    return amt / 12;
    case "ONCE":      return 0; // one-offs don't prorate monthly
    default:          return amt;
  }
}

export async function GET() {
  const now = new Date();
  const startToday = startOfDay(now);
  const startWtd = subDays(now, 7);
  const startMtd = startOfMonth(now);

  try {
    const [
      vehiclesByStatus,
      driversByStatus,
      maintByStatus,
      allTimeTrips,
      todayTrips,
      wtdTrips,
      mtdTrips,
      mtdFuel,
      mtdMaint,
      activeFixedCosts,
    ] = await Promise.all([
      prisma.vehicle.groupBy({ by: ["status"], _count: true }).catch(() => []),
      prisma.driver.groupBy({ by: ["status"], _count: true }).catch(() => []),
      prisma.maintenance.groupBy({ by: ["status"], _count: true }).catch(() => []),
      prisma.trip.aggregate({
        _count: true,
        _sum: { fare: true, distance: true },
        _avg: { fare: true, rating: true, duration: true, distance: true },
        where: { status: "COMPLETED" },
      }).catch(() => null),
      prisma.trip.aggregate({
        _count: true,
        _sum: { fare: true },
        where: { status: "COMPLETED", completedAt: { gte: startToday } },
      }).catch(() => null),
      prisma.trip.aggregate({
        _count: true,
        _sum: { fare: true },
        where: { status: "COMPLETED", completedAt: { gte: startWtd } },
      }).catch(() => null),
      prisma.trip.aggregate({
        _count: true,
        _sum: { fare: true, distance: true },
        where: { status: "COMPLETED", completedAt: { gte: startMtd } },
      }).catch(() => null),
      prisma.fuelLog.aggregate({
        _sum: { totalCost: true, liters: true },
        _count: true,
        where: { filledAt: { gte: startMtd } },
      }).catch(() => null),
      prisma.maintenance.aggregate({
        _sum: { cost: true },
        where: { status: "COMPLETED", completedAt: { gte: startMtd } },
      }).catch(() => null),
      // FixedCost may not exist until migration applied; guard defensively.
      (prisma as unknown as { fixedCost?: { findMany: (...a: unknown[]) => Promise<Array<{ amountNok: number; frequency: string; startDate: Date; endDate: Date | null }>> } })
        .fixedCost?.findMany({
          where: {
            startDate: { lte: now },
            OR: [{ endDate: null }, { endDate: { gte: startMtd } }],
          },
          select: { amountNok: true, frequency: true, startDate: true, endDate: true },
        })
        .catch(() => []) ?? Promise.resolve([]),
    ]);

    const tripCount = allTimeTrips?._count ?? 0;
    const hasDb = tripCount > 0 || (driversByStatus?.length ?? 0) > 0;

    // Today
    const todayRevenue = Number(todayTrips?._sum?.fare ?? 0);
    const todayTripCount = Number(todayTrips?._count ?? 0);

    // WTD
    const wtdRevenue = Number(wtdTrips?._sum?.fare ?? 0);
    const wtdTripCount = Number(wtdTrips?._count ?? 0);

    // MTD
    const mtdRevenue = Number(mtdTrips?._sum?.fare ?? 0);
    const mtdDistance = Number(mtdTrips?._sum?.distance ?? 0);
    const mtdTripCount = Number(mtdTrips?._count ?? 0);

    const mtdFuelCost = Number(mtdFuel?._sum?.totalCost ?? 0);
    const mtdMaintCost = Number(mtdMaint?._sum?.cost ?? 0);
    // Normalise each fixed cost to its monthly-equivalent NOK (MONTHLY=x,
    // QUARTERLY=x/3, YEARLY=x/12, ONCE=0). Skip rows that ended before MTD.
    const mtdFixedCosts = (activeFixedCosts || []).reduce(
      (s: number, c: { amountNok: number; frequency: string }) =>
        s + monthlyAmountNok(c),
      0,
    );

    const mtdVariable = mtdFuelCost + mtdMaintCost;
    const mtdGross = mtdRevenue - mtdVariable;
    // Prorate fixed costs by calendar days elapsed in the ACTUAL month length
    const daysElapsed = Math.max(1, differenceInDays(now, startMtd) + 1);
    const daysInMonth = getDaysInMonth(now); // 28/29/30/31 as appropriate
    const prorataFixed = (mtdFixedCosts * daysElapsed) / daysInMonth;
    const mtdNet = mtdGross - prorataFixed;
    const marginPct = mtdRevenue > 0 ? (mtdNet / mtdRevenue) * 100 : 0;

    // Break-even day estimate: day of month where cumulative revenue overtakes fixed+variable costs
    const avgDailyRevenue = mtdRevenue / daysElapsed;
    const avgDailyVariable = mtdVariable / daysElapsed;
    const avgDailyFixed = mtdFixedCosts / daysInMonth;
    const breakEvenDay =
      avgDailyRevenue > avgDailyVariable + avgDailyFixed
        ? Math.ceil((mtdFixedCosts) / Math.max(1, avgDailyRevenue - avgDailyVariable))
        : null;

    const vatPayable = mtdRevenue * NOK_VAT_RATE;

    const avgFare = Number(allTimeTrips?._avg?.fare ?? 0);
    const avgRating = Number(allTimeTrips?._avg?.rating ?? 0);
    const avgDistance = Number(allTimeTrips?._avg?.distance ?? 0);
    const revenuePerKm = mtdDistance > 0 ? mtdRevenue / mtdDistance : 0;
    const pricePerLiter =
      mtdFuel?._sum?.liters && Number(mtdFuel._sum.liters) > 0
        ? mtdFuelCost / Number(mtdFuel._sum.liters)
        : 0;

    const driversMap = Object.fromEntries(
      driversByStatus.map((d: { status: string; _count: number }) => [d.status, d._count]),
    );
    const vehiclesMap = Object.fromEntries(
      vehiclesByStatus.map((v: { status: string; _count: number }) => [v.status, v._count]),
    );

    const totalDrivers = Object.values(driversMap).reduce(
      (s: number, n) => s + (typeof n === "number" ? n : 0),
      0,
    );
    const totalVehicles = Object.values(vehiclesMap).reduce(
      (s: number, n) => s + (typeof n === "number" ? n : 0),
      0,
    );
    const activeDriversToday = driversMap.ACTIVE || driversMap.AVAILABLE || 0;
    const onTripVehicles = vehiclesMap.ACTIVE || vehiclesMap.IN_USE || 0;

    const dataState: "empty" | "partial" | "ready" =
      !hasDb ? "empty" : tripCount < 30 ? "partial" : "ready";

    return NextResponse.json({
      dataState,
      today: {
        revenueNok: Math.round(todayRevenue),
        trips: todayTripCount,
        activeDrivers: activeDriversToday,
        onTripVehicles,
      },
      wtd: {
        revenueNok: Math.round(wtdRevenue),
        trips: wtdTripCount,
        daysElapsed: 7,
      },
      mtd: {
        revenueNok: Math.round(mtdRevenue),
        variableCostsNok: Math.round(mtdVariable),
        fuelCostsNok: Math.round(mtdFuelCost),
        maintCostsNok: Math.round(mtdMaintCost),
        fixedCostsNok: Math.round(mtdFixedCosts),
        fixedCostsProratedNok: Math.round(prorataFixed),
        grossNok: Math.round(mtdGross),
        netNok: Math.round(mtdNet),
        marginPct: Math.round(marginPct * 10) / 10,
        breakEvenDay,
        vatPayableNok: Math.round(vatPayable),
        daysElapsed,
      },
      fleet: {
        drivers: { total: totalDrivers, byStatus: driversMap },
        vehicles: { total: totalVehicles, byStatus: vehiclesMap },
        maint: Object.fromEntries(
          maintByStatus.map((m: { status: string; _count: number }) => [m.status, m._count]),
        ),
      },
      trip: {
        avgFareNok: Math.round(avgFare),
        avgDistanceKm: Math.round(avgDistance * 10) / 10,
        revenuePerKmNok: Math.round(revenuePerKm * 100) / 100,
        avgRating: Math.round(avgRating * 100) / 100,
      },
      fuel: {
        totalCostNok: Math.round(mtdFuelCost),
        totalLiters: Math.round(Number(mtdFuel?._sum?.liters ?? 0)),
        pricePerLiterNok: Math.round(pricePerLiter * 100) / 100,
      },
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "stats failed",
        dataState: "empty",
      },
      { status: 500 },
    );
  }
}
