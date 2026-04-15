/**
 * GET /api/auth/me — returns the current session payload.
 *
 * 200 { user: { id, email, role, name } }
 * 401 (handled by proxy before it reaches here, but guarded anyway)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireSession(req);
  if (!gate.ok) return gate.response;
  const s = gate.session;
  return NextResponse.json({
    user: {
      id: s.userId,
      email: s.email,
      role: s.role,
      name: s.name ?? null,
    },
  });
}
