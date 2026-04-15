/**
 * GET /api/stats/hourly — trip volume + revenue bucketed by hour.
 *
 * Query params:
 *   ?days=1 (default) — how far back to bucket, 1..30
 *
 * Response:
 *   {
 *     buckets: Array<{ hour: number (0-23), trips: number, revenueNok: number }>,
 *     totalTrips: number,
 *     totalRevenueNok: number,
 *     rangeStart: ISO string, rangeEnd: ISO string
 *   }
 *
 * Buckets are always 24 elements long (0..23). Missing hours appear as zero
 * so chart code can render without null-handling.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { subDays, startOfDay } from "date-fns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") ?? "1", 10) || 1));
  const rangeEnd = new Date();
  const rangeStart = days === 1 ? startOfDay(rangeEnd) : subDays(rangeEnd, days);

  const trips = await prisma.trip.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { gte: rangeStart, lte: rangeEnd },
    },
    select: { completedAt: true, fare: true },
  });

  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, trips: 0, revenueNok: 0 }));
  let totalTrips = 0;
  let totalRevenueNok = 0;
  for (const t of trips) {
    if (!t.completedAt) continue;
    const h = new Date(t.completedAt).getHours();
    buckets[h].trips++;
    const fare = Number(t.fare ?? 0);
    buckets[h].revenueNok += fare;
    totalTrips++;
    totalRevenueNok += fare;
  }
  // Round revenue to whole NOK for presentation.
  for (const b of buckets) b.revenueNok = Math.round(b.revenueNok);

  return NextResponse.json({
    buckets,
    totalTrips,
    totalRevenueNok: Math.round(totalRevenueNok),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    days,
  });
}
