import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/shifts/current?driverId=...
 *
 * Returns the caller's open shift if any, plus today's running totals
 * (trip count, gross fare, hours online so far). Powers the
 * Driver Portal's sticky shift banner so a hard refresh restores
 * the same state — no localStorage required.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const driverId =
    url.searchParams.get("driverId") || req.headers.get("x-user-id");
  if (!driverId) {
    return NextResponse.json({ error: "driverId required" }, { status: 400 });
  }

  const open = await prisma.shift
    .findFirst({
      where: { driverId, status: "OPEN" },
      orderBy: { clockInAt: "desc" },
    })
    .catch(() => null);

  // Today's bounds in UTC. UI displays in browser TZ.
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayTrips = await prisma.trip
    .findMany({
      where: { driverId, completedAt: { gte: startOfDay } },
      select: { fare: true, distance: true, completedAt: true },
    })
    .catch(() => []);

  const todayGross = todayTrips.reduce((s, t) => s + (t.fare ?? 0), 0);
  const todayKm = todayTrips.reduce((s, t) => s + (t.distance ?? 0), 0);
  const hoursSoFar = open?.clockInAt
    ? +(((Date.now() - new Date(open.clockInAt).getTime()) / 3600_000).toFixed(2))
    : 0;

  return NextResponse.json({
    shift: open,
    today: {
      tripCount: todayTrips.length,
      grossNok: Math.round(todayGross),
      distanceKm: +todayKm.toFixed(1),
      hoursSoFar,
    },
  });
}
