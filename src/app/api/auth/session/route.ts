/**
 * POST   /api/auth/session  — login with {email, password}, set cookie
 * GET    /api/auth/session  — whoami (reads cookie, returns user or 401)
 * DELETE /api/auth/session  — logout, clears cookie
 *
 * Cookie is signed HMAC-SHA256, httpOnly, 8h TTL. See src/lib/session.ts.
 *
 * Validation sources, in order:
 *   1. DEMO_USERS (hardcoded 3 accounts)
 *   2. Neon User table (created via admin Users & Permissions page)
 *
 * Passwords are plain-text today. Deploy 3 migrates to bcrypt.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findDemoUser } from "@/lib/demo-users";
import {
  signSession,
  verifySession,
  cookieHeader,
  clearCookieHeader,
  SESSION_COOKIE,
} from "@/lib/session";
import { captureError } from "@/lib/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required." }, { status: 400 });
    }

    // 1) Try demo users
    const demo = findDemoUser(email, password);
    let user: { id: string; email: string; name: string; role: "admin" | "employee" | "driver" } | null =
      demo
        ? { id: demo.id, email: demo.email, name: demo.name, role: demo.role }
        : null;

    // 2) Try Neon User table (only if demo missed)
    if (!user) {
      const dbUser = await prisma.user
        .findUnique({ where: { email: email.toLowerCase().trim() } })
        .catch(() => null);
      if (dbUser && dbUser.password === password) {
        const role = (dbUser.role as "admin" | "employee" | "driver") || "employee";
        user = { id: dbUser.id, email: dbUser.email, name: dbUser.name || dbUser.email, role };
      }
    }

    if (!user) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const token = await signSession({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return new NextResponse(
      JSON.stringify({ ok: true, user }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookieHeader(token),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    await captureError(err, { route: "/api/auth/session POST" });
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: session.userId,
      email: session.email,
      role: session.role,
      name: session.name || null,
    },
    expiresAt: session.exp,
  });
}

export async function DELETE() {
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearCookieHeader(),
    },
  });
}
