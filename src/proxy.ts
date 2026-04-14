/**
 * Next.js 16 proxy (formerly "middleware") — API auth gate.
 *
 * Protects /api/* against unauthenticated access. Allowlist below covers
 * endpoints that have their own gate (SEED_TOKEN) or are intentionally public
 * (health check, login).
 *
 * For every other /api/* request we require a valid signed session cookie.
 * Invalid/missing cookie → 401 JSON.
 *
 * This is layer 1 (server cookie). Layer 2 (role-based page filtering) is
 * still enforced client-side in dashboard.html. Layer 3 (bcrypt + real
 * invalidation) is Deploy 3.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Exact paths OR prefixes that skip auth.
// These have their own gate (SEED_TOKEN) or are intentionally public.
const ALLOW_PREFIXES = [
  "/api/health",
  "/api/auth/session", // login endpoint itself
  "/api/seed",         // SEED_TOKEN gated
  "/api/import/",      // SEED_TOKEN gated
];

// Simple in-memory rate limiter — 120 req / 60s per IP.
// Good enough to deter casual abuse; not a replacement for Vercel WAF.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { ok: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const bucket = hits.get(ip);
  if (!bucket || bucket.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, remaining: RATE_LIMIT - 1, resetIn: RATE_WINDOW_MS };
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= RATE_LIMIT,
    remaining: Math.max(0, RATE_LIMIT - bucket.count),
    resetIn: bucket.resetAt - now,
  };
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rate limit everything under /api (before auth check)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfterMs: rl.resetIn },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.resetIn / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // Allowlist — let public endpoints through
  if (ALLOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Require a valid session cookie for every other /api/* request
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required.", code: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Forward auth'd user info to route handlers via request headers
  const h = new Headers(req.headers);
  h.set("x-user-id", session.userId);
  h.set("x-user-email", session.email);
  h.set("x-user-role", session.role);

  return NextResponse.next({ request: { headers: h } });
}

// Only run on /api/* — don't run on pages, static assets, or _next internals.
export const config = {
  matcher: ["/api/:path*"],
};
