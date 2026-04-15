/**
 * Proxy (formerly middleware) — runs on every /api/* request before the
 * route handler executes. Responsibilities:
 *
 *   1. Rate-limit every request by IP into one of three buckets:
 *        - auth:  /api/auth/*          (tight — brute-force protection)
 *        - write: non-GET methods      (moderate)
 *        - read:  everything else      (generous)
 *   2. Gate session-protected routes: anything under /api/* that isn't in
 *      the PUBLIC_API set must present a valid ft_session cookie.
 *
 * Route handlers must still call `requireSession` for role checks and for
 * safety against Server Function calls that bypass the proxy matcher (see
 * https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit, clientIp } from "./lib/rate-limit";
import { SESSION_COOKIE, verifySession } from "./lib/session";

// Paths that do NOT require a valid session to call.
// Kept deliberately small.
const PUBLIC_API = new Set<string>([
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout", // safe to call without session; idempotent
]);

// Routes gated by the legacy SEED_TOKEN mechanism; they handle their own
// admin check inside the route handler (requireAdmin in src/lib/import.ts,
// and /api/seed does its own token check). Proxy only rate-limits them.
const LEGACY_ADMIN_TOKEN_ROUTES = [
  "/api/import/",
  "/api/seed",
];

function isLegacyAdminToken(pathname: string): boolean {
  return LEGACY_ADMIN_TOKEN_ROUTES.some((p) => pathname.startsWith(p));
}

export async function proxy(request: NextRequest): Promise<NextResponse | undefined> {
  const { pathname } = request.nextUrl;

  // Only act on /api/*. Static HTML pages in /public need no gate — each
  // page calls FleetAuth.requireAuth() client-side which in turn checks
  // /api/auth/me. That's defence-in-depth with the server-side check here.
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const ip = clientIp(request);

  // ── 1. Rate limit ───────────────────────────────────────────────────
  // Three buckets, picked by path + method. Tight limits on auth to
  // blunt credential-stuffing; generous reads; moderate writes.
  let bucket = "read";
  let limit = 120; // req/min
  if (pathname.startsWith("/api/auth/")) {
    bucket = "auth";
    limit = 10; // 10 tries per minute per IP
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    bucket = "write";
    limit = 30;
  }

  const rl = checkRateLimit(ip, { limit, windowMs: 60_000, bucket });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Bucket": bucket,
        },
      },
    );
  }

  // ── 2. Session gate ────────────────────────────────────────────────
  if (PUBLIC_API.has(pathname)) return withRateHeaders(NextResponse.next(), bucket, rl);
  if (isLegacyAdminToken(pathname)) return withRateHeaders(NextResponse.next(), bucket, rl);

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json(
      { error: "unauthorized" },
      {
        status: 401,
        headers: { "X-RateLimit-Bucket": bucket },
      },
    );
  }

  // Forward the verified identity to the route handler via request
  // headers so it doesn't need to re-verify the signature. The route
  // still calls readSession() for type-safety but this is a fast path.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-session-user-id", session.userId);
  forwarded.set("x-session-email", session.email);
  forwarded.set("x-session-role", session.role);
  return withRateHeaders(
    NextResponse.next({ request: { headers: forwarded } }),
    bucket,
    rl,
  );
}

function withRateHeaders(
  res: NextResponse,
  bucket: string,
  rl: { remaining?: number; resetAt: number } & { ok: true } | { ok: false; retryAfterSec: number; resetAt: number },
): NextResponse {
  if ("remaining" in rl && typeof rl.remaining === "number") {
    res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  }
  res.headers.set("X-RateLimit-Bucket", bucket);
  res.headers.set("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
