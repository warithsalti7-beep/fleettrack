import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/health — lightweight uptime + DB probe.
 *
 * Returns 200 if:
 *   - the API is reachable
 *   - DATABASE_URL is set
 *   - a trivial SELECT 1 succeeds on Neon
 * Returns 503 otherwise.
 *
 * Designed for BetterStack / UptimeRobot / Vercel cron to ping.
 */
export async function GET() {
  const started = Date.now();
  const result: Record<string, unknown> = {
    ok: true,
    status: "ok",
    checks: { api: "ok", env: "ok", db: "ok" },
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
    environment: process.env.VERCEL_ENV || "unknown",
  };

  if (!process.env.DATABASE_URL) {
    result.ok = false;
    result.status = "degraded";
    (result.checks as Record<string, string>).env = "DATABASE_URL not set";
    return NextResponse.json(result, { status: 503 });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    result.ok = false;
    result.status = "degraded";
    (result.checks as Record<string, string>).db =
      err instanceof Error ? err.message : String(err);
    result.latencyMs = Date.now() - started;
    return NextResponse.json(result, { status: 503 });
  }

  result.latencyMs = Date.now() - started;
  return NextResponse.json(result);
}
