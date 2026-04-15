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

  const [
    vehicleStatuses,
    driverStatuses,
    tripsAll,
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
      _sum: { fare: true, distance: true },
      _avg: { fare: true, rating: true, duration: true },
      where: { status: "COMPLETED" },
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

  // Fleet P&L for today: revenue minus a prorated monthly fixed-cost slice.
  // Prorate = monthly total / 30. Trip-variable costs (fuel, payouts) are
  // already inside totalRevenue-net-of-commission when the import sets fare
  // to the gross amount; we don't have that split reliably so this is a
  // best-effort view. Fields are sized so a client can override or refine.
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
    netRevenue: round(grossRevenueToday), // commission split not modeled yet
    netProfit: round(netProfitToday),
    marginPct: round2(marginPct),
    breakEven: round(dailyFixedShare),
    tripsToday,
    avgTripFare: round2(avgTripFare),
    driversTotal,
    driversActive,
    vehiclesTotal,
    vehiclesOnRoad,
    vehiclesShop,
    vehiclesIdle,

    // ── Raw aggregates for deeper pages ────────────────────────────
    vehicles,
    drivers,
    trips: {
      completed: tripsAll._count,
      totalRevenue: tripsAll._sum.fare ?? 0,
      totalDistance: tripsAll._sum.distance ?? 0,
      avgFare: tripsAll._avg.fare ?? 0,
      avgRating: tripsAll._avg.rating ?? 0,
      avgDuration: tripsAll._avg.duration ?? 0,
    },
    maintenance: Object.fromEntries(maintenanceStats.map((m) => [m.status, m._count])),
    fuel: {
      totalCost: fuelStats._sum.totalCost ?? 0,
      totalLiters: fuelStats._sum.liters ?? 0,
    },
    recentRevenue: {
      revenue: recentRevenue._sum.fare ?? 0,
      trips: recentRevenue._count,
    },
    fixedCosts: {
      monthlyTotalNok: monthlyFixed,
      dailyShareNok: dailyFixedShare,
    },
  });
}

function round(n: number): number { return Math.round(n); }
function round2(n: number): number { return Math.round(n * 100) / 100; }
