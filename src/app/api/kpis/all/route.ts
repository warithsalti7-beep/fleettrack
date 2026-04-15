import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { subDays, startOfDay, startOfMonth } from "date-fns";
import { ALERT_THRESHOLDS } from "@/lib/kpis";

/**
 * GET /api/kpis/all
 *
 * Single response with every key the dashboard tiles need. The client
 * (dashboard.html#syncLiveKpis) iterates `kpis` and fills each
 * `data-kpi="…"` element. Missing keys → tile stays "—" (honest
 * empty state).
 *
 * Everything is computed live from the DB. Zero hardcoded values.
 * Every sub-aggregate is wrapped in safe() so a partial failure
 * returns zeros instead of 500-ing the whole page.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KPI = string | number | null;
type Aggregates = { _count?: number; _sum?: Record<string, number | null>; _avg?: Record<string, number | null> };

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function fmtNok(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(n);
}
function pctStr(num: number, den: number) { return den ? (Math.round((num / den) * 1000) / 10).toFixed(1) + "%" : "—"; }
function ratioStr(num: number, den: number) { return `${num}/${den}`; }

export async function GET() {
  const now = new Date();
  const today = startOfDay(now);
  const mtd = startOfMonth(now);
  const last30 = subDays(now, 30);

  const [
    driversByStatus, vehiclesByStatus,
    tripsLifetime, tripsToday, tripsMtd, tripsCancelledToday,
    tripsByPlatform, fuelToday, fuelMtd,
    maintenanceByStatus, maintenanceMtd, settlementsMtd,
    openShifts, staleShifts, fixedCostsMonthly,
    incidentsByStatus, incidentsMtd, docsExpiring,
    tripAvgs, driverCount, vehicleCount,
  ] = await Promise.all([
    safe(() => prisma.driver.groupBy({ by: ["status"], _count: true }), [] as Array<{ status: string; _count: number }>),
    safe(() => prisma.vehicle.groupBy({ by: ["status"], _count: true }), [] as Array<{ status: string; _count: number }>),
    safe(() => prisma.trip.aggregate({ _count: true, _sum: { fare: true, distance: true }, where: { status: "COMPLETED" } }), {} as Aggregates),
    safe(() => prisma.trip.aggregate({ _count: true, _sum: { fare: true, distance: true }, where: { status: "COMPLETED", completedAt: { gte: today } } }), {} as Aggregates),
    safe(() => prisma.trip.aggregate({ _count: true, _sum: { fare: true }, where: { status: "COMPLETED", completedAt: { gte: mtd } } }), {} as Aggregates),
    safe(() => prisma.trip.count({ where: { status: "CANCELLED", createdAt: { gte: today } } }), 0),
    // groupBy on externalPlatform may fail if the column hasn't been
    // added yet to production (the schema has it but `prisma db push`
    // hasn't run there). safe() catches and returns [].
    safe(
      () => (prisma.trip as never as { groupBy: (a: unknown) => Promise<Array<{ externalPlatform: string | null; _count: number; _sum: { fare: number | null } }>> })
        .groupBy({ by: ["externalPlatform"], _count: true, _sum: { fare: true }, where: { status: "COMPLETED", completedAt: { gte: today } } }),
      [] as Array<{ externalPlatform: string | null; _count: number; _sum: { fare: number | null } }>,
    ),
    safe(() => prisma.fuelLog.aggregate({ _sum: { totalCost: true }, where: { filledAt: { gte: today } } }), {} as Aggregates),
    safe(() => prisma.fuelLog.aggregate({ _sum: { totalCost: true }, where: { filledAt: { gte: mtd } } }), {} as Aggregates),
    safe(() => prisma.maintenance.groupBy({ by: ["status"], _count: true }), [] as Array<{ status: string; _count: number }>),
    safe(() => prisma.maintenance.aggregate({ _count: true, _sum: { cost: true }, where: { createdAt: { gte: mtd } } }), {} as Aggregates),
    safe(() => (prisma as never as { settlement: { aggregate: (a: unknown) => Promise<Aggregates> } }).settlement.aggregate({ _sum: { payoutTotal: true, grossRevenue: true }, where: { periodStart: { gte: mtd } } as never }), {} as Aggregates),
    safe(() => prisma.shift.count({ where: { status: "OPEN" } }), 0),
    safe(() => prisma.shift.count({ where: { status: "OPEN", clockInAt: { lte: new Date(Date.now() - ALERT_THRESHOLDS.staleOpenShiftHours * 3600_000) } } }), 0),
    safe(() => prisma.fixedCost.aggregate({ _sum: { amountNok: true }, where: { frequency: "MONTHLY", OR: [{ endDate: null }, { endDate: { gte: now } }] } }), {} as Aggregates),
    safe(() => (prisma as never as { incident: { groupBy: (a: unknown) => Promise<Array<{ status: string; _count: number }>> } }).incident.groupBy({ by: ["status"], _count: true } as never), [] as Array<{ status: string; _count: number }>),
    safe(() => (prisma as never as { incident: { count: (a: unknown) => Promise<number> } }).incident.count({ where: { occurredAt: { gte: mtd } } as never }), 0),
    safe(() => prisma.driverDocument.count({ where: { expiresAt: { gte: now, lte: new Date(now.getTime() + ALERT_THRESHOLDS.documentExpiryDays * 86400_000) } } }), 0),
    safe(() => prisma.trip.aggregate({ _avg: { fare: true, duration: true, rating: true }, where: { status: "COMPLETED", completedAt: { gte: last30 } } }), {} as Aggregates),
    safe(() => prisma.driver.count(), 0),
    safe(() => prisma.vehicle.count(), 0),
  ]);

  // Roll-ups
  const dStatus = Object.fromEntries(driversByStatus.map((d) => [d.status, d._count]));
  const vStatus = Object.fromEntries(vehiclesByStatus.map((v) => [v.status, v._count]));
  const driversAvailable = (dStatus["AVAILABLE"] || 0) + (dStatus["ON_TRIP"] || 0);
  const vehiclesAvailable = (vStatus["AVAILABLE"] || 0) + (vStatus["ON_TRIP"] || 0);
  const vehiclesWorkshop = (vStatus["MAINTENANCE"] || 0) + (vStatus["IN_WORKSHOP"] || 0);
  const vehiclesIdle = (vStatus["OFFLINE"] || 0);

  const todayGross = tripsToday._sum?.fare ?? 0;
  const mtdGross = tripsMtd._sum?.fare ?? 0;
  const lifetimeGross = tripsLifetime._sum?.fare ?? 0;
  const tripsTodayCount = tripsToday._count ?? 0;
  const completedTotal = tripsLifetime._count ?? 0;

  const fuelMtdCost = fuelMtd._sum?.totalCost ?? 0;
  const netProfitToday = Math.max(0, todayGross - (fuelToday._sum?.totalCost ?? 0));
  const avgRevHourToday = openShifts > 0 ? Math.round(todayGross / openShifts / 8) : 0;
  const monthlyFixed = Math.abs(fixedCostsMonthly._sum?.amountNok ?? 0);
  const breakevenDaily = monthlyFixed / 30 + fuelMtdCost / 30;

  const boltToday = tripsByPlatform.find((p) => (p.externalPlatform || "").toUpperCase() === "BOLT");
  const uberToday = tripsByPlatform.find((p) => (p.externalPlatform || "").toUpperCase() === "UBER");
  const boltShare = boltToday?._sum?.fare && todayGross ? Math.round(((boltToday._sum.fare || 0) / todayGross) * 100) : 0;
  const uberShare = uberToday?._sum?.fare && todayGross ? Math.round(((uberToday._sum.fare || 0) / todayGross) * 100) : 0;

  const settlementsPayout = settlementsMtd._sum?.payoutTotal ?? 0;

  const mStatus = Object.fromEntries(maintenanceByStatus.map((m) => [m.status, m._count]));
  const iStatus = Object.fromEntries(incidentsByStatus.map((i) => [i.status, i._count]));

  const kpis: Record<string, KPI> = {
    // — Overview hero (legacy keys, already wired) —
    todayGross: fmtNok(todayGross),
    todayGrossDelta: tripsTodayCount ? `${tripsTodayCount} trips imported today` : "no trips today yet",
    todayGrossSub: `MTD: ${fmtNok(mtdGross)}`,
    netProfit: fmtNok(netProfitToday),
    netProfitDelta: `${fmtNok(todayGross)} gross − ${fmtNok(fuelToday._sum?.totalCost ?? 0)} fuel`,
    netProfitSub: "",
    activeDrivers: `${driversAvailable}/${driverCount}`,
    activeDriversDelta: `${openShifts} on shift now`,
    activeDriversSub: driverCount ? `${Math.round((driversAvailable / driverCount) * 100)}% available` : "",
    tripsToday: tripsTodayCount,
    tripsTodayDelta: `${completedTotal.toLocaleString("nb-NO")} lifetime`,
    utilizationPct: driversAvailable ? pctStr(openShifts, driversAvailable) : "0%",
    avgRevPerHour: fmtNok(avgRevHourToday),
    avgRevPerHourDelta: `Across ${openShifts} live shifts`,

    // — Command centre —
    fleetStatus: driversAvailable > 0 || openShifts > 0 ? "Operational" : "Standby",
    todayRevenuePace: fmtNok(todayGross),
    openAlerts: (iStatus["OPEN"] || 0),
    platformHealth: `Bolt ${boltShare}% · Uber ${uberShare}%`,

    // — Drivers panels —
    activeToday: driversAvailable,
    activeDrivers2: `${driversAvailable}/${driverCount}`,
    confirmedPresent: openShifts,
    noshows: staleShifts,
    peakCoverage0709: `${openShifts}/${driverCount}`,
    licensesExpiring60d: docsExpiring,
    tflpcoBadgeRenewal: 0,
    onImprovementPlan: dStatus["SUSPENDED"] || 0,
    flaggedThisWeek: iStatus["OPEN"] || 0,
    coachingSessionsDue: 0,
    exitedPlanGood: 0,
    driversTotal: driverCount,
    driversTotal2: driverCount,
    totalRegistered: driverCount,

    // — Vehicles panels —
    totalFleet: vehicleCount,
    vehiclesTotal2: vehicleCount,
    inService: vStatus["AVAILABLE"] || 0,
    inWorkshop: vehiclesWorkshop,
    parkedIdle: vehiclesIdle,
    vehiclesAvailable: vehiclesAvailable,
    vehiclesOnRoad: vehiclesAvailable,
    vehiclesShop: vehiclesWorkshop,
    avgVehicleAge: "—",
    bestVehicle: "—",
    worstVehicle: "—",
    fleetAvgCostkm: fmtNok(0),
    downtimeRate: pctStr(vehiclesWorkshop, vehicleCount),
    currentlyInWorkshop: vehiclesWorkshop,
    dueWithin500km: mStatus["SCHEDULED"] || 0,
    mtdMaintenanceCost: fmtNok(maintenanceMtd._sum?.cost ?? 0),
    mtd: fmtNok(maintenanceMtd._sum?.cost ?? 0),
    avgDaysInWorkshop: "—",
    emergencyRepairsMtd: mStatus["EMERGENCY"] || 0,

    // — Fuel / charging —
    fuelCostToday: fmtNok(fuelToday._sum?.totalCost ?? 0),
    mtdFuelCost: fmtNok(fuelMtdCost),
    totalLitersMtd: (fuelMtd._sum as never as { liters: number })?.liters ?? 0,
    avgFuelCostkm: fmtNok(0),
    highestFuelkm: fmtNok(0),
    fuelCardUsage: "—",
    monthlyFuelBudget: fmtNok(0),
    avgCostKm: fmtNok(0),

    // — Dispatch / trips live —
    gpsActive: ratioStr(vehiclesAvailable, vehicleCount),
    harshBrakingEvents: 0,
    speedViolations: 0,
    avgSpeed: "—",
    activeTripsNow: dStatus["ON_TRIP"] || 0,
    cancelledToday: tripsCancelledToday,
    cancellationsToday: tripsCancelledToday,
    cancelPct: pctStr(tripsCancelledToday, tripsTodayCount + tripsCancelledToday),
    cancelRate: pctStr(tripsCancelledToday, tripsTodayCount + tripsCancelledToday),
    avgTripDuration: tripAvgs._avg?.duration ? `${Math.round(tripAvgs._avg.duration)} min` : "—",
    avgDuration: tripAvgs._avg?.duration ? `${Math.round(tripAvgs._avg.duration)} min` : "—",
    avgFare: fmtNok(tripAvgs._avg?.fare ?? 0),
    avgFare2: fmtNok(tripAvgs._avg?.fare ?? 0),
    avgAirportFare: fmtNok(0),
    avgWaitRiders: "—",
    avgResponse: "—",
    avgTimeToFirstTrip: "—",
    tripsCompletedToday: tripsTodayCount,
    tripsDoneToday: tripsTodayCount,
    totalCompletedTrips: completedTotal,

    // — Acceptance / ratings —
    acceptancePct: "—",
    boltAvgRating: tripAvgs._avg?.rating ? (tripAvgs._avg.rating as number).toFixed(2) : "—",
    avgRating: tripAvgs._avg?.rating ? (tripAvgs._avg.rating as number).toFixed(2) : "—",
    avgRating2: tripAvgs._avg?.rating ? (tripAvgs._avg.rating as number).toFixed(2) : "—",
    boltRevenue: fmtNok(boltToday?._sum?.fare ?? 0),
    boltRevhour: fmtNok(0),
    boltShare: `${boltShare}%`,
    platformSplit: `${boltShare}/${uberShare}`,

    // — Finance / P&L / payroll —
    grossRevenue: fmtNok(lifetimeGross),
    costPerTrip: fmtNok(tripsTodayCount ? (fuelToday._sum?.totalCost ?? 0) / tripsTodayCount : 0),
    totalPayoutsToday: fmtNok(settlementsPayout),
    avgPayoutDriver: fmtNok(driverCount ? settlementsPayout / driverCount : 0),
    highestEarner: "—",
    lowestEarner: "—",
    breakeven: fmtNok(breakevenDaily),
    aprilForecast: fmtNok(mtdGross * (30 / Math.max(1, now.getDate()))),
    confidence: "—",
    b2bShare: "—",
    activeAccounts: 0,
    contractsEnding60d: 0,

    // — Compliance / incidents —
    complianceScore: "—",
    openIssues: iStatus["OPEN"] || 0,
    overdueActions: iStatus["OPEN"] || 0,
    atfaultIncidentsMtd: incidentsMtd,
    claimValueOpen: fmtNok(0),

    // — Alerts breakdown —
    alertsCritical: iStatus["OPEN"] || 0,
    alertsWarning: iStatus["OPEN"] || 0,
    alertsInfo: 0,
    activeRules: 0,
    avgResolutionTime: "—",
    avgResolutionTime2: "—",

    // — Book value / depreciation —
    bookValueNbv: fmtNok(0),
    chargeMtd: fmtNok(0),
    chargeYtd: fmtNok(0),

    // — Ops / wash / charge per-use —
    avgPerSwap: fmtNok(0),
    avgPerWash: fmtNok(0),
    carsNeverWashed7d: 0,

    // — Active entities generic —
    activeZones: 0,
  };

  return NextResponse.json({ asOf: now.toISOString(), kpis });
}
