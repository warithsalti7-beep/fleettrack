/**
 * Next.js 16 proxy (formerly "middleware") — API auth gate.
 *
 * Policy (permissive by default to match original app behavior):
 *
 *   1. Public always:             /api/health, /api/auth/session
 *   2. Self-gated (SEED_TOKEN):   /api/seed, /api/import/*
 *   3. Public read-only:          GET /api/{drivers,vehicles,trips,fuel,
 *                                 maintenance,stats}
 *   4. Authenticated only:
 *        - any POST/PUT/PATCH/DELETE on /api/*
 *        - /api/export/*  (contains PII)
 *        - /api/ai/*      (rate-sensitive, cost-sensitive)
 *        - /api/integrations/* (admin config)
 *
 * Rate limit: 120 req/min per IP on everything under /api (best-effort
 * in-memory; real WAF is Vercel's job).
 *
 * When auth is required and missing, return 401 JSON AND clear any stale
 * session cookie so the client can retry cleanly after a secret rotation.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

const PUBLIC_PREFIXES = [
  "/api/health",
  "/api/auth/session",
  "/api/seed",
  "/api/import/",
];

// Routes whose GET is public (matches pre-audit behavior); non-GET still
// requires auth.
const GET_PUBLIC_PREFIXES = [
  "/api/drivers",
  "/api/vehicles",
  "/api/trips",
  "/api/fuel",
  "/api/maintenance",
  "/api/stats",
];

// Always require auth for these, regardless of method.
const STRICT_PREFIXES = [
  "/api/export/",
  "/api/ai/",
  "/api/integrations",
];

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { ok: boolean; resetIn: number } {
  const now = Date.now();
  const bucket = hits.get(ip);
  if (!bucket || bucket.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, resetIn: RATE_WINDOW_MS };
  }
  bucket.count += 1;
  return { ok: bucket.count <= RATE_LIMIT, resetIn: bucket.resetAt - now };
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Rate limit first
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

  // Completely public endpoints
  if (matchesPrefix(pathname, PUBLIC_PREFIXES)) {
    return NextResponse.next();
  }

  // GET-only public endpoints (read-only dashboards)
  if (method === "GET" && matchesPrefix(pathname, GET_PUBLIC_PREFIXES)) {
    // Attach whatever session we have (for optional personalization),
    // but don't require one.
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);
    const h = new Headers(req.headers);
    if (session) {
      h.set("x-user-id", session.userId);
      h.set("x-user-email", session.email);
      h.set("x-user-role", session.role);
    }
    return NextResponse.next({ request: { headers: h } });
  }

  // Everything else on /api/* requires a valid session cookie
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    // If they sent a cookie and it's invalid (probably stale after secret
    // rotation), clear it so the client retries cleanly.
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (token) {
      headers["Set-Cookie"] = `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`;
    }
    const isStrict = matchesPrefix(pathname, STRICT_PREFIXES);
    return NextResponse.json(
      {
        error: "Authentication required.",
        code: "unauthenticated",
        hint: isStrict
          ? "This endpoint requires an authenticated admin session."
          : "Sign in at /login and retry.",
      },
      { status: 401, headers },
    );
  }

  const h = new Headers(req.headers);
  h.set("x-user-id", session.userId);
  h.set("x-user-email", session.email);
  h.set("x-user-role", session.role);
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  matcher: ["/api/:path*"],
};
