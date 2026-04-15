import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/session";

/**
 * Edge middleware that gates every /api/* request behind a valid
 * ft_session cookie. Public exceptions are listed below. The dev bypass
 * `AUTH_REQUIRED=false` lets local seeding/imports run without a login.
 *
 * This is the single line of defence the Phase-1 audit (§4) flagged as
 * missing — `/api/drivers`, `/api/export/*`, `/api/trips`, etc. used to
 * return data to any caller. They now require a signed session.
 */

const PUBLIC_PATHS = [
  "/api/health",
  // `/api/seed` has its own SEED_TOKEN check. Letting it through the
  // guard keeps one-shot provisioning simple.
  "/api/seed",
  // Auth endpoints (login / logout / password reset) need to be
  // reachable pre-session. Add them here once implemented.
  "/api/auth/login",
  "/api/auth/logout",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only gate API routes — HTML pages run their own client-side guard.
  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Dev bypass. Never set this in production.
  if (
    process.env.AUTH_REQUIRED === "false" &&
    process.env.NODE_ENV !== "production"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json(
      { error: "Not authenticated", code: "AUTH_REQUIRED" },
      { status: 401 },
    );
  }

  // Pass the identity downstream via request headers so routes don't
  // have to re-verify. Signed payload, not user-supplied.
  const headers = new Headers(req.headers);
  headers.set("x-user-id", session.userId);
  headers.set("x-user-role", session.role);
  headers.set("x-user-email", session.email);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*"],
};
