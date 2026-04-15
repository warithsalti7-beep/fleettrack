/**
 * Lightweight per-IP rate limiter using a fixed-window counter held in memory.
 *
 * Trade-offs (be honest about what this is and isn't):
 *   - Single-process in-memory state: on a multi-instance serverless
 *     deployment each cold lambda has its own counter, so the effective
 *     limit is `buckets * limit`. That's acceptable for MVP defence against
 *     casual scraping and credential-stuffing; NOT a replacement for an
 *     edge-global rate limiter (Upstash Redis, Vercel KV, Cloudflare) when
 *     traffic grows past a handful of servers.
 *   - Fixed windows mean a burst at window boundary can do 2× the limit.
 *     Again: acceptable for MVP.
 *
 * Usage:
 *   const rl = rateLimit(ip, { limit: 60, windowMs: 60_000, bucket: "api" });
 *   if (!rl.ok) return rl.response;
 */

type Entry = { count: number; resetAt: number };

const BUCKETS = new Map<string, Map<string, Entry>>();
// Garbage-collect old entries every minute so the map doesn't grow unbounded.
let lastGc = 0;
function gc(now: number) {
  if (now - lastGc < 60_000) return;
  lastGc = now;
  for (const [bucket, map] of BUCKETS) {
    for (const [ip, e] of map) if (e.resetAt < now) map.delete(ip);
    if (map.size === 0) BUCKETS.delete(bucket);
  }
}

export type RateLimitOptions = {
  /** Max requests per window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Logical bucket name — keeps read vs write vs auth counters separate. */
  bucket: string;
};

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterSec: number; resetAt: number };

export function checkRateLimit(ip: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  gc(now);
  let bucket = BUCKETS.get(opts.bucket);
  if (!bucket) {
    bucket = new Map();
    BUCKETS.set(opts.bucket, bucket);
  }
  const existing = bucket.get(ip);
  if (!existing || existing.resetAt <= now) {
    bucket.set(ip, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, resetAt: now + opts.windowMs };
  }
  if (existing.count >= opts.limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      resetAt: existing.resetAt,
    };
  }
  existing.count++;
  return { ok: true, remaining: opts.limit - existing.count, resetAt: existing.resetAt };
}

/**
 * Extract the client IP from a Next.js Request. Trusts the first entry in
 * X-Forwarded-For when behind Vercel / a CDN, otherwise falls back to a
 * constant so local dev doesn't all bucket under "unknown".
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return "local";
}
