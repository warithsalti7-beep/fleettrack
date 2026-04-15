import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { subDays, startOfDay, startOfMonth } from "date-fns";

/**
 * GET /api/stats
 *
 * One-stop fleet snapshot consumed by `dashboard.html#syncLiveKpis()`.
 * Adds today/MTD windows and platform splits on top of the original
 * lifetime aggregates so the dashboard's hardcoded NOK numbers can
 * all be replaced with live values.
 *
 * Every aggregate is wrapped in Promise.allSettled so a partial
 * outage on one query doesn't break the whole response — the UI
 * shows zeros for whatever field is missing.
 */
export async function GET() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const sevenAgo = subDays(now, 7);

  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  const [
    vehicles,
    drivers,
    tripsLifetime,
    tripsToday,
    tripsMtd,
    tripsByPlatform,
    maintenanceStats,
    fuelStats,
    recentRevenue,
    openShifts,
  ] = await Promise.all([
    safe(() => prisma.vehicle.groupBy({ by: ["status"], _count: true }), [] as Array<{ status: string; _count: number }>),
    safe(() => prisma.driver.groupBy({ by: ["status"], _count: true }), [] as Array<{ status: string; _count: number }>),
    safe(() => prisma.trip.aggregate({
      _count: true,
      _sum: { fare: true, distance: true },
      _avg: { fare: true, rating: true, duration: true },
      where: { status: "COMPLETED" },
    }), { _count: 0, _sum: { fare: 0, distance: 0 }, _avg: { fare: 0, rating: 0, duration: 0 } } as never),
    safe(() => prisma.trip.aggregate({
      _count: true,
      _sum: { fare: true, distance: true },
      where: { status: "COMPLETED", completedAt: { gte: todayStart } },
    }), { _count: 0, _sum: { fare: 0, distance: 0 } } as never),
    safe(() => prisma.trip.aggregate({
      _count: true,
      _sum: { fare: true },
      where: { status: "COMPLETED", completedAt: { gte: monthStart } },
    }), { _count: 0, _sum: { fare: 0 } } as never),
    safe(() =>
      // Group today's trips by platform so the Overview platform-split
      // donut can render without baked-in 58/42 demo numbers.
      prisma.trip.groupBy({
        by: ["externalPlatform" as never],
        _count: true,
        _sum: { fare: true },
        where: { status: "COMPLETED", completedAt: { gte: todayStart } },
      }) as never,
      [] as Array<{ externalPlatform: string | null; _count: number; _sum: { fare: number | null } }>,
    ),
    safe(() => prisma.maintenance.groupBy({ by: ["status"], _count: true }), [] as Array<{ status: string; _count: number }>),
    safe(() => prisma.fuelLog.aggregate({ _sum: { totalCost: true, liters: true } }), { _sum: { totalCost: 0, liters: 0 } } as never),
    safe(() => prisma.trip.aggregate({
      _sum: { fare: true },
      _count: true,
      where: { status: "COMPLETED", completedAt: { gte: sevenAgo } },
    }), { _sum: { fare: 0 }, _count: 0 } as never),
    safe(() => prisma.shift.count({ where: { status: "OPEN" } }), 0),
  ]);

  return NextResponse.json({
    asOf: now.toISOString(),
    vehicles: Object.fromEntries(vehicles.map((v) => [v.status, v._count])),
    drivers: Object.fromEntries(drivers.map((d) => [d.status, d._count])),
    trips: {
      completed:    tripsLifetime._count,
      totalRevenue: tripsLifetime._sum.fare ?? 0,
      totalDistance:tripsLifetime._sum.distance ?? 0,
      avgFare:      tripsLifetime._avg.fare ?? 0,
      avgRating:    tripsLifetime._avg.rating ?? 0,
      avgDuration:  tripsLifetime._avg.duration ?? 0,
    },
    today: {
      tripCount:    tripsToday._count,
      grossNok:     tripsToday._sum.fare ?? 0,
      distanceKm:   tripsToday._sum.distance ?? 0,
    },
    mtd: {
      tripCount:    tripsMtd._count,
      grossNok:     tripsMtd._sum.fare ?? 0,
    },
    platformSplit: tripsByPlatform.map((p) => ({
      platform: p.externalPlatform ?? "MANUAL",
      tripCount: p._count,
      grossNok: p._sum.fare ?? 0,
    })),
    maintenance: Object.fromEntries(maintenanceStats.map((m) => [m.status, m._count])),
    fuel: {
      totalCost:   fuelStats._sum.totalCost ?? 0,
      totalLiters: fuelStats._sum.liters ?? 0,
    },
    recentRevenue: {
      revenue: recentRevenue._sum.fare ?? 0,
      trips:   recentRevenue._count,
    },
    liveShifts: openShifts,
  });
}
