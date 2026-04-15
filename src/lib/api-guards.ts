/**
 * Request-scoped guard helpers for `/api/*` routes.
 *
 * Today every CRUD API is open — anyone who can reach the URL gets the
 * data. These helpers fix that without requiring a full rewrite:
 *
 *   const auth = await requireApiSession(req, { roles: ["admin"] });
 *   if (!auth.ok) return auth.response;   // 401 / 403 already built
 *   // ... use auth.session.userId / role ...
 *
 * Works with the existing `ft_session` signed cookie (see session.ts).
 * Falls back gracefully in dev: if `AUTH_REQUIRED=false` the guard
 * returns a synthetic admin session so imports keep working while the
 * demo data is being loaded.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SessionPayload, verifySession } from "./session";

type Role = "admin" | "employee" | "driver";

export type ApiAuthOk = { ok: true; session: SessionPayload };
export type ApiAuthFail = { ok: false; response: NextResponse };
export type ApiAuthResult = ApiAuthOk | ApiAuthFail;

export async function requireApiSession(
  req: NextRequest | Request,
  opts: { roles?: Role[]; allowDev?: boolean } = {},
): Promise<ApiAuthResult> {
  // Dev / demo bypass — set AUTH_REQUIRED=false locally to keep
  // seeding + imports friction-free. Never true in production.
  if (
    (opts.allowDev ?? true) &&
    process.env.AUTH_REQUIRED === "false" &&
    process.env.NODE_ENV !== "production"
  ) {
    return {
      ok: true,
      session: {
        userId: "dev",
        email: "dev@fleettrack.local",
        role: "admin",
        name: "Dev",
        exp: Date.now() + 3600_000,
      },
    };
  }

  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const token = match ? decodeURIComponent(match[1]) : null;
  const session = await verifySession(token);

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not authenticated", code: "AUTH_REQUIRED" },
        { status: 401 },
      ),
    };
  }

  if (opts.roles && !opts.roles.includes(session.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden", code: "ROLE_FORBIDDEN", need: opts.roles, have: session.role },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session };
}

/**
 * Minimal in-memory token-bucket rate limiter. Fine for single-node
 * Vercel edge deploys at small scale; swap for Upstash Redis bucket
 * when we go multi-region.
 *
 *   const rl = await rateLimit(req, { bucket: "import", max: 5, windowMs: 60_000 });
 *   if (!rl.ok) return rl.response;
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  req: NextRequest | Request,
  opts: { bucket: string; max: number; windowMs: number },
): ApiAuthResult {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const key = `${opts.bucket}:${ip}`;
  const now = Date.now();
  const row = buckets.get(key);
  if (!row || row.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, session: { userId: "", email: "", role: "admin", exp: 0 } };
  }
  if (row.count >= opts.max) {
    const retryAfter = Math.max(1, Math.ceil((row.resetAt - now) / 1000));
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit exceeded", retryAfterSec: retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      ),
    };
  }
  row.count++;
  return { ok: true, session: { userId: "", email: "", role: "admin", exp: 0 } };
}

/**
 * Redact PII before it lands in a log, error message, or Sentry event.
 * Handles strings, arrays and plain objects; strips:
 *   - email addresses         → "[email]"
 *   - Norwegian fnr / 11-digit → "[fnr]"
 *   - phone numbers            → "[phone]"
 *   - IBAN / bank account      → "[bank]"
 */
const RE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const RE_FNR = /\b\d{11}\b/g;
const RE_PHONE = /(\+?\d[\s\d-]{6,}\d)/g;
const RE_IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

export function redactPii<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return value
      .replace(RE_EMAIL, "[email]")
      .replace(RE_FNR, "[fnr]")
      .replace(RE_IBAN, "[bank]")
      .replace(RE_PHONE, "[phone]") as unknown as T;
  }
  if (Array.isArray(value)) return value.map(redactPii) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (lk === "personalnumber" || lk === "bankaccount" || lk === "password") {
        out[k] = "[redacted]";
      } else {
        out[k] = redactPii(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}
