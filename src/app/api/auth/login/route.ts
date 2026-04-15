/**
 * POST /api/auth/login — email + password → session cookie.
 *
 * Body: { email: string, password: string }
 * Response: 200 { user: { id, email, role, name } }   — Set-Cookie: ft_session=...
 *           401 { error: "invalid_credentials" }
 *           400 { error: "bad_request" }
 *           429 { error: "rate_limited" }             — set by proxy
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/passwords";
import { cookieHeader, signSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";
import { captureError } from "@/lib/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "employee", "driver"]);

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let email = "", password = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let user: Awaited<ReturnType<typeof prisma.user.findUnique>> = null;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch (err) {
    await captureError(err, { route: "/api/auth/login", step: "lookup" });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Always run verifyPassword even on miss so timing doesn't leak
  // whether the email exists. Dummy hash is a no-match PBKDF2 record.
  const dummy = "pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const hashToCheck = user?.passwordHash || dummy;
  const pwOk = await verifyPassword(password, hashToCheck);

  if (!user || !pwOk) {
    await writeAudit({
      action: "auth.login",
      ok: false,
      target: email,
      meta: { reason: user ? "bad_password" : "no_user" },
      ip,
    });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const role = ALLOWED_ROLES.has(user.role) ? (user.role as "admin" | "employee" | "driver") : "employee";
  const token = await signSession({
    userId: user.id,
    email: user.email,
    role,
    name: user.name ?? undefined,
  });

  // Best-effort: stamp lastLoginAt. Ignore failure.
  prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => {});

  await writeAudit({
    action: "auth.login",
    ok: true,
    actor: { userId: user.id, email: user.email },
    ip,
  });

  return new NextResponse(
    JSON.stringify({
      user: { id: user.id, email: user.email, role, name: user.name },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": cookieHeader(token),
      },
    },
  );
}
