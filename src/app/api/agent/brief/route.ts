/**
 * GET /api/agent/brief  — daily morning brief (Vercel Cron at 06:00 CET)
 *
 * Guarded by the Vercel cron header `x-vercel-cron` OR an explicit bearer
 * matching process.env.AGENT_SECRET for manual triggers.
 */

import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/ai-agent";
import { captureError } from "@/lib/sentry";
import { aiConfigured, AiError } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: NextRequest) {
  if (request.headers.get("x-vercel-cron")) return true;
  const secret = process.env.AGENT_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!aiConfigured()) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }
  try {
    const result = await runAgent("brief");
    return NextResponse.json(result);
  } catch (err) {
    await captureError(err, { route: "/api/agent/brief" });
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}

export const POST = GET;
