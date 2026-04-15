/**
 * GET /api/stats/per-driver — aggregates Trip + Shift data per driver.
 *
 * Query params:
 *   ?days=7     — lookback window (default 7, max 90)
 *   ?limit=100  — row cap (default 100, max 500)
 *
 * Response: Array<{
 *   driverId, name, email,
 *   trips: number,
 *   completedTrips: number,
 *   cancelledTrips: number,
 *   revenueNok: number,                  // sum of fare on completed trips
 *   distanceKm: number,                  // sum of distance on completed
 *   onlineHours: number,                 // sum of shift.hoursOnline
 *   revenuePerHour: number,              // revenueNok / onlineHours
 *   tripsPerHour: number,                // completedTrips / onlineHours
 *   acceptanceRate: number,              // (completed + in-progress) / (offered) in %
 *   avgFare: number, avgRating: number,
 *   score: number (0..100)               // composite; see formula below
 * }>
 *
 * Composite score weights (documented here so the UI and server agree):
 *   revenuePerHour (normalised /200 NOK/hr) : 30%
 *   utilisation   (onlineHours/9h target)   : 25%
 *   acceptance    (%)                       : 20%
 *   tripsPerHour  (normalised /2.5)         : 15%
 *   reliability   (100 - 2*cancellation%)   : 10%
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { subDays } from "date-fns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Target daily online hours per driver — used to normalise utilisation.
const DAILY_ONLINE_TARGET_H = 9;
// Revenue-per-hour target (NOK) above which the driver scores 100.
const REV_PER_HOUR_TARGET = 200;
// Trips-per-hour target above which the driver scores 100.
const TRIPS_PER_HOUR_TARGET = 2.5;

export async function GET(request: NextRequest) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const rangeStart = subDays(new Date(), days);

  // Single round-trip; Prisma fans out to one query per relation-include.
  const drivers = await prisma.driver.findMany({
    take: limit,
    orderBy: { name: "asc" },
    include: {
      trips: {
        where: { createdAt: { gte: rangeStart } },
        select: { status: true, fare: true, distance: true, rating: true },
      },
      shifts: {
        where: { shiftDate: { gte: rangeStart } },
        select: { hoursOnline: true },
      },
    },
  });

  const result = drivers.map((d) => {
    const offered = d.trips.length;
    const completed = d.trips.filter((t) => t.status === "COMPLETED");
    const cancelled = d.trips.filter((t) => t.status === "CANCELLED").length;
    const revenueNok = completed.reduce((s, t) => s + Number(t.fare ?? 0), 0);
    const distanceKm = completed.reduce((s, t) => s + Number(t.distance ?? 0), 0);
    const avgFare = completed.length ? revenueNok / completed.length : 0;
    const avgRating =
      completed.length && completed.some((t) => t.rating != null)
        ? completed.reduce((s, t) => s + Number(t.rating ?? 0), 0) /
          completed.filter((t) => t.rating != null).length
        : 0;

    const onlineHours = d.shifts.reduce((s, sh) => s + Number(sh.hoursOnline ?? 0), 0);
    const revenuePerHour = onlineHours > 0 ? revenueNok / onlineHours : 0;
    const tripsPerHour = onlineHours > 0 ? completed.length / onlineHours : 0;
    const acceptanceRate = offered > 0 ? ((offered - cancelled) / offered) * 100 : 0;
    const cancellationRate = offered > 0 ? (cancelled / offered) * 100 : 0;

    // Composite score; each component capped at 100 and weighted.
    const cScore =
      Math.min(100, (revenuePerHour / REV_PER_HOUR_TARGET) * 100) * 0.30 +
      Math.min(100, (onlineHours / (DAILY_ONLINE_TARGET_H * days)) * 100) * 0.25 +
      Math.min(100, acceptanceRate) * 0.20 +
      Math.min(100, (tripsPerHour / TRIPS_PER_HOUR_TARGET) * 100) * 0.15 +
      Math.max(0, 100 - cancellationRate * 2) * 0.10;

    return {
      driverId: d.id,
      name: d.name,
      email: d.email,
      trips: offered,
      completedTrips: completed.length,
      cancelledTrips: cancelled,
      revenueNok: Math.round(revenueNok),
      distanceKm: Math.round(distanceKm * 10) / 10,
      onlineHours: Math.round(onlineHours * 10) / 10,
      revenuePerHour: Math.round(revenuePerHour),
      tripsPerHour: Math.round(tripsPerHour * 10) / 10,
      acceptanceRate: Math.round(acceptanceRate),
      cancellationRate: Math.round(cancellationRate),
      avgFare: Math.round(avgFare),
      avgRating: Math.round(avgRating * 10) / 10,
      score: Math.round(cScore),
    };
  });

  // Highest earners first.
  result.sort((a, b) => b.revenueNok - a.revenueNok);

  return NextResponse.json({
    rangeDays: days,
    drivers: result,
  });
}
