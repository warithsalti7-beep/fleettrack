import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";

export async function GET() {
  const [
    vehicles,
    drivers,
    trips,
    maintenanceStats,
    fuelStats,
    recentRevenue,
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
      where: {
        status: "COMPLETED",
        completedAt: { gte: subDays(new Date(), 7) },
      },
    }),
  ]);

  return NextResponse.json({
    vehicles: Object.fromEntries(vehicles.map((v) => [v.status, v._count])),
    drivers: Object.fromEntries(drivers.map((d) => [d.status, d._count])),
    trips: {
      completed: trips._count,
      totalRevenue: trips._sum.fare ?? 0,
      totalDistance: trips._sum.distance ?? 0,
      avgFare: trips._avg.fare ?? 0,
      avgRating: trips._avg.rating ?? 0,
      avgDuration: trips._avg.duration ?? 0,
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
  });
}
