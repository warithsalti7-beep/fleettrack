/**
 * POST /api/ai/fleet-summary
 *
 * Claude reads live fleet metrics from Neon and returns 3-5 prioritised
 * recommendations. Shape:
 *   {
 *     headline: "one-line insight",
 *     recommendations: [
 *       { priority: "high"|"medium"|"low", area: "...", title: "...",
 *         body: "...", actionLabel: "...", actionHref: "#page-id" }
 *     ],
 *     generatedAt: "2026-04-14T..."
 *   }
 *
 * Cached in-memory for 10 minutes per process to keep token cost low.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callClaude, parseAiJson, AiError, aiConfigured } from "@/lib/anthropic";
import { captureError } from "@/lib/sentry";
import { requireStaff } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Summary = {
  headline: string;
  recommendations: Array<{
    priority: "high" | "medium" | "low";
    area: string;
    title: string;
    body: string;
    actionLabel?: string;
    actionHref?: string;
  }>;
  generatedAt: string;
};

// In-process cache; on Vercel this means per-lambda-instance.
// 10-minute window is plenty — fleet KPIs don't shift minute to minute.
let cache: { at: number; data: Summary } | null = null;
const CACHE_MS = 10 * 60 * 1000;

const SYSTEM_PROMPT = `You are the operations analyst for a small Norwegian taxi fleet (Bolt + Uber platforms). The exact fleet size is in the metrics JSON — use those numbers, never invent counts.
Your job: read the daily + week-to-date metrics JSON provided by the user, identify the 3-5 most actionable issues, and return them as prioritised recommendations.
If the metrics show zero trips / zero drivers / zero revenue, return a single recommendation telling the operator to import CSVs via /data-import before AI analysis can be meaningful.

Rules:
- Think in NOK (Norwegian kroner). Never use EUR or USD.
- Focus on things the admin can act on within 24 hours: driver coaching, vehicle diagnostics, dispatch routing, cost pruning.
- Skip generic advice like "track your KPIs". Cite specific numbers from the input.
- Every recommendation must have: priority (high/medium/low), area (driver/vehicle/finance/dispatch/compliance), title, body (max 2 sentences), actionLabel, actionHref (a dashboard deep link like #financial or #driver-coaching).
- The headline is one sentence summarising the single biggest issue today.
- Output ONLY JSON. No markdown, no prose outside JSON.`;

async function gatherMetrics() {
  const [driverCount, vehicleCount, tripAggregate, recentMaintenance, recentFuel] = await Promise.all([
    prisma.driver.count().catch(() => 0),
    prisma.vehicle.count().catch(() => 0),
    prisma.trip.aggregate({
      _count: true,
      _sum: { fare: true, distance: true },
      _avg: { rating: true },
    }).catch(() => ({ _count: 0, _sum: { fare: null, distance: null }, _avg: { rating: null } })),
    prisma.maintenance.findMany({
      where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      take: 5,
      orderBy: { scheduledAt: "asc" },
    }).catch(() => []),
    prisma.fuelLog.aggregate({
      _sum: { totalCost: true, liters: true },
      _count: true,
    }).catch(() => ({ _sum: { totalCost: null, liters: null }, _count: 0 })),
  ]);

  const totalFare = Number(tripAggregate._sum?.fare ?? 0);
  const totalTrips = Number(tripAggregate._count ?? 0);

  return {
    drivers: driverCount,
    vehicles: vehicleCount,
    trips: { total: totalTrips, revenueNok: Math.round(totalFare) },
    avgRating: tripAggregate._avg?.rating ?? null,
    pendingMaintenance: recentMaintenance.map((m) => ({
      type: m.type,
      vehicleId: m.vehicleId,
      scheduled: m.scheduledAt.toISOString().slice(0, 10),
      cost: m.cost,
    })),
    fuelSpend: {
      totalNok: Math.round(Number(recentFuel._sum?.totalCost ?? 0)),
      liters: Math.round(Number(recentFuel._sum?.liters ?? 0)),
      refills: recentFuel._count,
    },
    // DB is empty? Tell the model — never invent numbers.
    emptyDatabase: driverCount === 0 && vehicleCount === 0 && totalTrips === 0,
  };
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  if (!aiConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        message: "ANTHROPIC_API_KEY not set on server. Showing static recommendations.",
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  try {
    const metrics = await gatherMetrics();
    const raw = await callClaude(
      [
        {
          role: "user",
          content:
            "Fleet metrics (live):\n" +
            JSON.stringify(metrics, null, 2) +
            "\n\nReturn JSON with schema { headline, recommendations[], generatedAt }.",
        },
      ],
      { system: SYSTEM_PROMPT, json: true, maxTokens: 900 },
    );

    const parsed = parseAiJson<Summary>(raw);
    parsed.generatedAt = new Date().toISOString();
    cache = { at: Date.now(), data: parsed };

    return NextResponse.json({ ...parsed, cached: false });
  } catch (err) {
    await captureError(err, { route: "/api/ai/fleet-summary" });
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, details: err.details, generatedAt: new Date().toISOString() },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error", generatedAt: new Date().toISOString() },
      { status: 500 },
    );
  }
}

export const GET = POST;

