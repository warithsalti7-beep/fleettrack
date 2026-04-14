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
  const envStatus = {
    database: !!process.env.DATABASE_URL,
    authSecret: !!(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16),
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    seedToken: !!process.env.SEED_TOKEN,
    sentryDsn: !!process.env.NEXT_PUBLIC_SENTRY_DSN || !!process.env.SENTRY_DSN,
  };
  const result: Record<string, unknown> = {
    ok: true,
    status: "ok",
    checks: { api: "ok", env: "ok", db: "ok" },
    envConfigured: envStatus,
    warnings: [] as string[],
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
    environment: process.env.VERCEL_ENV || "unknown",
  };

  const warnings = result.warnings as string[];
  if (!envStatus.authSecret) {
    warnings.push(
      "AUTH_SECRET not set — using derived fallback. Add AUTH_SECRET (32+ char random string) to Vercel env vars for proper cookie signing.",
    );
  }
  if (!envStatus.anthropicKey) {
    warnings.push("ANTHROPIC_API_KEY not set — AI recommendations disabled.");
  }
  if (!envStatus.seedToken) {
    warnings.push("SEED_TOKEN not set — /api/seed and /api/import/* endpoints unreachable.");
  }

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
