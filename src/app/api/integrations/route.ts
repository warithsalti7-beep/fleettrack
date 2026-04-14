/**
 * GET /api/integrations
 *   Returns configuration + live status of every provider.
 *   Admin-only. Doesn't leak secrets — only yes/no + provider name.
 *
 * POST /api/integrations?provider=<id>&sinceDays=7
 *   Triggers a sync for one provider. Returns SyncReport. Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { tesla } from "@/lib/integrations/tesla";
import { smartcar } from "@/lib/integrations/smartcar";
import { uber } from "@/lib/integrations/uber";
import { bolt } from "@/lib/integrations/bolt";
import type { FleetIntegration } from "@/lib/integrations/types";
import { writeAudit } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS: Record<string, FleetIntegration> = {
  tesla, smartcar, uber, bolt,
};

function requireAdminRole(req: NextRequest): NextResponse | null {
  // proxy.ts has already validated the session cookie and set x-user-role.
  if (req.headers.get("x-user-role") !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const gate = requireAdminRole(req);
  if (gate) return gate;

  const entries = await Promise.all(
    Object.values(PROVIDERS).map(async (p) => ({
      id: p.id,
      name: p.name,
      configured: p.isConfigured(),
      status: await p.status(),
    })),
  );

  return NextResponse.json({ providers: entries });
}

export async function POST(req: NextRequest) {
  const gate = requireAdminRole(req);
  if (gate) return gate;

  const providerId = req.nextUrl.searchParams.get("provider");
  const sinceDays = parseInt(req.nextUrl.searchParams.get("sinceDays") || "7", 10) || 7;

  if (!providerId || !PROVIDERS[providerId]) {
    return NextResponse.json(
      { error: `Unknown provider '${providerId}'. Valid: ${Object.keys(PROVIDERS).join(", ")}` },
      { status: 400 },
    );
  }

  const provider = PROVIDERS[providerId];
  const report = await provider.sync(sinceDays);

  await writeAudit({
    action: `integration.sync.${providerId}`,
    target: providerId,
    ok: report.ok,
    actorEmail: req.headers.get("x-user-email"),
    actorId: req.headers.get("x-user-id"),
    meta: {
      inserted: report.inserted,
      updated: report.updated,
      skipped: report.skipped,
      error: report.error,
    },
  });

  return NextResponse.json(report, { status: report.ok ? 200 : 502 });
}
