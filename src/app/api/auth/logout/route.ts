/**
 * POST /api/auth/logout — clears the ft_session cookie.
 *
 * Idempotent; safe to call with or without an existing session.
 */
import { NextRequest, NextResponse } from "next/server";
import { clearCookieHeader } from "@/lib/session";
import { readSession } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await readSession(req);
  if (session) {
    await writeAudit({
      action: "auth.logout",
      actor: { userId: session.userId, email: session.email },
      ip: clientIp(req),
    });
  }
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearCookieHeader(),
    },
  });
}
