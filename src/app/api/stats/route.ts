/**
 * GET /api/stats — fleet-wide KPI envelope consumed by both the React
 * admin pages and the legacy dashboard's data-kpi/data-kpi-cur tiles.
 *
 * Every metric is derived from the same source tables (Trip, Shift,
 * Driver, Vehicle, FuelLog, FixedCost, Maintenance). When a computation
 * has no data to work with (empty fleet, no shifts logged) we return 0
 * — the UI turns 0 into "—" so a fresh install never shows fake numbers.
 *
 * Key formulas (documented here so dashboard + server can't drift):
 *   acceptanceRate  = (offered - cancelled) / offered * 100
 *   cancellationRate = cancelled / offered * 100
 *   tripsPerHour    = completedTrips / SUM(shift.hoursOnline)
 *   revenuePerHour  = SUM(fare) / SUM(shift.hoursOnline)
 *   idlePct         = 100 - utilizationPct (best-effort; needs trip timing)
 *   utilizationPct  = (SUM(trip.duration_min) / SUM(shift.hoursOnline * 60)) * 100
 *   avgTripDistanceKm = SUM(distance) / COUNT(completed)
 *   timeBetweenTripsMin = SUM(shift.hoursOnline * 60 - trip.duration_min) / (COUNT(completed) - 1)
 *   peakCoverage    = count of drivers active in the 07:00-09:00 window
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { subDays, startOfDay } from "date-fns";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";

// Statuses that indicate a vehicle is actively producing revenue.
const VEHICLE_ON_ROAD = new Set(["ON_TRIP", "AVAILABLE"]);
const VEHICLE_SHOP = new Set(["MAINTENANCE"]);

export async function GET(request: NextRequest) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;

  const today = startOfDay(new Date());
  const last30 = subDays(new Date(), 30);

  const [
    vehicleStatuses,
    driverStatuses,
    tripsAll,
    tripsLast30,
    tripsCancelledLast30,
    shiftsLast30,
    maintenanceStats,
    fuelStats,
    recentRevenue,
    todayRevenue,
    fixedCostsMonthly,
  ] = await Promise.all([
    prisma.vehicle.groupBy({ by: ["status"], _count: true }),
    prisma.driver.groupBy({ by: ["status"], _count: true }),
    prisma.trip.aggregate({
      _count: true,
      _sum: { fare: true, distance: true, duration: true },
      _avg: { fare: true, rating: true, duration: true, distance: true },
      where: { status: "COMPLETED" },
    }),
    // Completed trips over the last 30 days — used for rate-based KPIs
    // so daily noise (weekends, holidays) doesn't dominate.
    prisma.trip.aggregate({
      _count: true,
      _sum: { fare: true, distance: true, duration: true },
      where: { status: "COMPLETED", completedAt: { gte: last30 } },
    }),
    // Cancelled trips over the same 30-day window.
    prisma.trip.count({
      where: { status: "CANCELLED", completedAt: { gte: last30 } },
    }),
    // Shifts over the same window. hoursOnline is nullable, so coalesce.
    prisma.shift.aggregate({
      _sum: { hoursOnline: true },
      _count: true,
      where: { shiftDate: { gte: last30 } },
    }),
    prisma.maintenance.groupBy({ by: ["status"], _count: true }),
    prisma.fuelLog.aggregate({ _sum: { totalCost: true, liters: true } }),
    prisma.trip.aggregate({
      _sum: { fare: true },
      _count: true,
      where: { status: "COMPLETED", completedAt: { gte: subDays(new Date(), 7) } },
    }),
    prisma.trip.aggregate({
      _sum: { fare: true, distance: true },
      _count: true,
      _avg: { fare: true },
      where: { status: "COMPLETED", completedAt: { gte: today } },
    }),
    prisma.fixedCost.aggregate({
      _sum: { amountNok: true },
      where: { frequency: "MONTHLY", startDate: { lte: new Date() } },
    }),
  ]);

  const vehicles = Object.fromEntries(vehicleStatuses.map((v) => [v.status, v._count]));
  const drivers = Object.fromEntries(driverStatuses.map((d) => [d.status, d._count]));

  const driversTotal = driverStatuses.reduce((s, d) => s + d._count, 0);
  const driversActive = driverStatuses
    .filter((d) => d.status === "AVAILABLE" || d.status === "ON_TRIP")
    .reduce((s, d) => s + d._count, 0);

  const vehiclesTotal = vehicleStatuses.reduce((s, v) => s + v._count, 0);
  const vehiclesOnRoad = vehicleStatuses
    .filter((v) => VEHICLE_ON_ROAD.has(v.status))
    .reduce((s, v) => s + v._count, 0);
  const vehiclesShop = vehicleStatuses
    .filter((v) => VEHICLE_SHOP.has(v.status))
    .reduce((s, v) => s + v._count, 0);
  const vehiclesIdle = Math.max(0, vehiclesTotal - vehiclesOnRoad - vehiclesShop);

  // ── Fleet-wide performance KPIs (30-day window) ──────────────────
  const completedLast30  = tripsLast30._count ?? 0;
  const cancelledLast30  = tripsCancelledLast30 ?? 0;
  const offeredLast30    = completedLast30 + cancelledLast30;
  const revenueLast30    = Number(tripsLast30._sum.fare ?? 0);
  const distanceLast30Km = Number(tripsLast30._sum.distance ?? 0);
  const durationLast30Min = Number(tripsLast30._sum.duration ?? 0);
  const onlineHoursLast30 = Number(shiftsLast30._sum.hoursOnline ?? 0);
  const onlineMinutesLast30 = onlineHoursLast30 * 60;

  const acceptanceRate = offeredLast30 > 0
    ? ((offeredLast30 - cancelledLast30) / offeredLast30) * 100
    : 0;
  const cancellationRate = offeredLast30 > 0
    ? (cancelledLast30 / offeredLast30) * 100
    : 0;
  const tripsPerHour = onlineHoursLast30 > 0
    ? completedLast30 / onlineHoursLast30
    : 0;
  const revenuePerHour = onlineHoursLast30 > 0
    ? revenueLast30 / onlineHoursLast30
    : 0;
  const utilizationPct = onlineMinutesLast30 > 0
    ? Math.min(100, (durationLast30Min / onlineMinutesLast30) * 100)
    : 0;
  const idlePct = onlineMinutesLast30 > 0 ? Math.max(0, 100 - utilizationPct) : 0;
  const timeBetweenTripsMin = completedLast30 > 1 && onlineMinutesLast30 > 0
    ? Math.max(0, (onlineMinutesLast30 - durationLast30Min) / (completedLast30 - 1))
    : 0;
  const avgTripDistanceKm = completedLast30 > 0
    ? distanceLast30Km / completedLast30
    : 0;

  // Peak coverage (07-09): drivers with any shift that overlaps that
  // window. The start/end are stored as "HH:MM" strings so we do the
  // comparison client-side after pulling today's shifts.
  const peakShifts = await prisma.shift.findMany({
    where: { shiftDate: { gte: today } },
    select: { driverId: true, startTime: true, endTime: true },
  });
  const peakCoverageDrivers = new Set<string>();
  for (const s of peakShifts) {
    if (s.startTime <= "09:00" && s.endTime >= "07:00") {
      peakCoverageDrivers.add(s.driverId);
    }
  }
  const peakCoverageCount = peakCoverageDrivers.size;

  // Fleet P&L for today: revenue minus a prorated monthly fixed-cost slice.
  const grossRevenueToday = todayRevenue._sum.fare ?? 0;
  const tripsToday = todayRevenue._count ?? 0;
  const avgTripFare = todayRevenue._avg.fare ?? 0;
  const monthlyFixed = Math.abs(fixedCostsMonthly._sum.amountNok ?? 0);
  const dailyFixedShare = monthlyFixed / 30;
  const netProfitToday = grossRevenueToday - dailyFixedShare;
  const marginPct = grossRevenueToday > 0 ? (netProfitToday / grossRevenueToday) * 100 : 0;

  return NextResponse.json({
    // ── Canonical dashboard KPI set (matches FleetData.kpis shape) ──
    revenueToday: round(grossRevenueToday),
    netRevenue:   round(grossRevenueToday), // commission split not modelled yet
    netProfit:    round(netProfitToday),
    marginPct:    round2(marginPct),
    breakEven:    round(dailyFixedShare),
    tripsToday,
    avgTripFare:  round2(avgTripFare),
    driversTotal,
    driversActive,
    vehiclesTotal,
    vehiclesOnRoad,
    vehiclesShop,
    vehiclesIdle,

    // ── Fleet performance (30-day window) ──────────────────────────
    acceptanceRate:       pct(acceptanceRate),
    cancellationRate:     pct(cancellationRate),
    tripsPerHour:         round2(tripsPerHour),
    revenuePerHour:       round(revenuePerHour),
    utilizationPct:       pct(utilizationPct),
    idlePct:              pct(idlePct),
    timeBetweenTripsMin:  round1(timeBetweenTripsMin),
    avgTripDistanceKm:    round1(avgTripDistanceKm),
    peakCoverage:         peakCoverageCount > 0
                            ? `${peakCoverageCount} / ${driversTotal}`
                            : "",

    // ── Raw aggregates for deeper pages ────────────────────────────
    vehicles,
    drivers,
    trips: {
      completed: tripsAll._count,
      totalRevenue:  tripsAll._sum.fare ?? 0,
      totalDistance: tripsAll._sum.distance ?? 0,
      avgFare:       tripsAll._avg.fare ?? 0,
      avgRating:     tripsAll._avg.rating ?? 0,
      avgDuration:   tripsAll._avg.duration ?? 0,
    },
    maintenance: Object.fromEntries(maintenanceStats.map((m) => [m.status, m._count])),
    fuel: {
      totalCost:   fuelStats._sum.totalCost ?? 0,
      totalLiters: fuelStats._sum.liters ?? 0,
    },
    recentRevenue: {
      revenue: recentRevenue._sum.fare ?? 0,
      trips:   recentRevenue._count,
    },
    fixedCosts: {
      monthlyTotalNok: monthlyFixed,
      dailyShareNok:   dailyFixedShare,
    },
  });
}

function round(n: number): number { return Math.round(n); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
/** Percent with one decimal, 0-clamped so the KPI never overflows. */
function pct(n: number): number { return Math.max(0, Math.min(100, round1(n))); }
