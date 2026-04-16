/**
 * POST /api/ai/chat
 *
 * Body: { message: string, principal?: string }
 *
 * Runs one turn against the fleet assistant. Memory is keyed by the
 * caller's ft_session user id, falling back to an explicit `principal`
 * override (used by the seed / tests). Opening a new chat on another
 * device with the same user id loads the same history.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { aiConfigured, AiError } from "@/lib/anthropic";
import { runChatTurn } from "@/lib/ai-chat";
import { webPrincipal, loadRecentMessages } from "@/lib/ai-memory";
import { captureError } from "@/lib/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolvePrincipal(request: NextRequest) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(raw);
  if (session) {
    return { principal: webPrincipal(session.userId), role: session.role };
  }
  // Fallback: explicit principal from body (non-production only)
  const override = request.headers.get("x-ft-principal");
  if (override && process.env.NODE_ENV !== "production") {
    return { principal: webPrincipal(override), role: "admin" as const };
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on server." },
      { status: 503 },
    );
  }

  const who = await resolvePrincipal(request);
  if (!who) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { message?: string };
  try {
    body = (await request.json()) as { message?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  try {
    const result = await runChatTurn({
      principal: who.principal,
      channel: "web",
      userText: message,
      extraSystem: `You are speaking with a FleetTrack ${who.role} over the web dashboard.`,
      allowWrites: who.role === "admin" || who.role === "employee",
    });
    return NextResponse.json(result);
  } catch (err) {
    await captureError(err, { route: "/api/ai/chat" });
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const who = await resolvePrincipal(request);
  if (!who) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const history = await loadRecentMessages(who.principal, 100);
  return NextResponse.json({ principal: who.principal, messages: history });
}
