/**
 * Scheduled agent runs.
 *
 *   daily brief      — licence expiries, overdue maintenance, low fuel
 *   hourly anomalies — fare/mileage/rating outliers over the last hour
 *   weekly digest    — P&L + operational summary
 *
 * Each run gathers numbers from the DB, asks Sonnet to write a terse
 * Telegram-ready summary, and broadcasts to every authorized admin.
 *
 * All three are invoked by Vercel Cron (see vercel.json) but are also
 * callable directly at /api/agent/* for manual triggering.
 */

import { prisma } from "./prisma";
import { callClaude, AGENT_MODEL } from "./anthropic";
import { broadcastToAdmins } from "./telegram";

type AgentKind = "brief" | "anomaly" | "digest";

const SYSTEM_BY_KIND: Record<AgentKind, string> = {
  brief: `You are the overnight ops agent for a small Norwegian taxi fleet. You'll get a JSON snapshot of today's concerns (licence expiries, overdue services, low fuel, idle vehicles). Write a terse Telegram briefing (max ~12 lines) using plain text, NOK, and bullet-like "- " prefixes. Cite specific plate/driver names. Skip anything with zero findings. If nothing is actionable, reply EXACTLY "No action needed this morning.".`,
  anomaly: `You are the realtime anomaly watcher for a small Norwegian taxi fleet. You'll get a JSON diff of the last hour versus the rolling 7-day median (trip fare, distance, rating). Call out ONLY genuine outliers (>2σ or clear data issues). Telegram-friendly, max ~8 lines. If nothing stands out, reply EXACTLY "No anomalies in the last hour.".`,
  digest: `You are the weekly operations analyst for a small Norwegian taxi fleet. You'll get a JSON rollup of the last 7 days (revenue, fuel spend, utilization, underperformers). Write a weekly digest for Telegram in plain text: one headline line, then 4-6 bullet-like "- " lines. Always in NOK. No fluff, no generic KPIs — cite specific numbers.`,
};

// --------- gatherers --------------------------------------------------------

async function gatherBrief() {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400_000);
  const [licencesSoon, dueMaintenance, lowFuel, idleVehicles] = await Promise.all([
    prisma.driver.findMany({
      where: { licenseExpiry: { lte: in30 } },
      orderBy: { licenseExpiry: "asc" },
      take: 15,
      select: { name: true, licenseExpiry: true },
    }),
    prisma.maintenance.findMany({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: { lte: new Date(now.getTime() + 7 * 86400_000) },
      },
      orderBy: { scheduledAt: "asc" },
      take: 15,
      include: { vehicle: { select: { plateNumber: true, carId: true } } },
    }),
    prisma.vehicle.findMany({
      where: { fuelLevel: { lt: 20 } },
      take: 10,
      select: { plateNumber: true, carId: true, fuelLevel: true },
    }),
    prisma.vehicle.findMany({
      where: { status: "AVAILABLE" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { plateNumber: true, carId: true, updatedAt: true },
    }),
  ]);
  return { licencesSoon, dueMaintenance, lowFuel, idleVehicles };
}

async function gatherAnomalies() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
  const [lastHour, baseline] = await Promise.all([
    prisma.trip.findMany({
      where: { createdAt: { gte: oneHourAgo } },
      select: {
        id: true,
        fare: true,
        distance: true,
        rating: true,
        vehicleId: true,
        driverId: true,
      },
    }),
    prisma.trip.aggregate({
      where: { createdAt: { gte: sevenDaysAgo, lt: oneHourAgo } },
      _avg: { fare: true, distance: true, rating: true },
      _count: true,
    }),
  ]);
  return {
    lastHour,
    baseline: {
      avgFareNok: baseline._avg.fare,
      avgDistanceKm: baseline._avg.distance,
      avgRating: baseline._avg.rating,
      trips: baseline._count,
    },
  };
}

async function gatherDigest() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const [trips, fuel, maint, topDrivers, bottomVehicles] = await Promise.all([
    prisma.trip.aggregate({
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: true,
      _sum: { fare: true, distance: true },
      _avg: { rating: true },
    }),
    prisma.fuelLog.aggregate({
      where: { createdAt: { gte: sevenDaysAgo } },
      _sum: { totalCost: true, liters: true },
    }),
    prisma.maintenance.aggregate({
      where: { completedAt: { gte: sevenDaysAgo } },
      _sum: { cost: true },
      _count: true,
    }),
    prisma.trip.groupBy({
      by: ["driverId"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _sum: { fare: true },
      _count: true,
      orderBy: { _sum: { fare: "desc" } },
      take: 5,
    }),
    prisma.trip.groupBy({
      by: ["vehicleId"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _sum: { fare: true },
      _count: true,
      orderBy: { _sum: { fare: "asc" } },
      take: 5,
    }),
  ]);
  return {
    revenueNok: Math.round(Number(trips._sum.fare ?? 0)),
    distanceKm: Math.round(Number(trips._sum.distance ?? 0)),
    trips: trips._count,
    avgRating: trips._avg.rating,
    fuelSpendNok: Math.round(Number(fuel._sum.totalCost ?? 0)),
    fuelLiters: Math.round(Number(fuel._sum.liters ?? 0)),
    maintenanceSpendNok: Math.round(Number(maint._sum.cost ?? 0)),
    maintenanceJobs: maint._count,
    topDrivers,
    bottomVehicles,
  };
}

// --------- runner -----------------------------------------------------------

export async function runAgent(kind: AgentKind) {
  let data: unknown;
  if (kind === "brief") data = await gatherBrief();
  else if (kind === "anomaly") data = await gatherAnomalies();
  else data = await gatherDigest();

  const raw = await callClaude(
    [
      {
        role: "user",
        content:
          `Snapshot:\n${JSON.stringify(data, null, 2)}\n\nWrite the message now.`,
      },
    ],
    {
      model: AGENT_MODEL,
      system: SYSTEM_BY_KIND[kind],
      maxTokens: 700,
      temperature: 0.2,
    },
  );

  const text = raw.trim();
  const silent =
    (kind === "brief" && text === "No action needed this morning.") ||
    (kind === "anomaly" && text === "No anomalies in the last hour.");

  if (!silent) {
    await broadcastToAdmins(`[${kind.toUpperCase()}] ${text}`);
  }
  return { kind, broadcast: !silent, text, data };
}
