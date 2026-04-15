/**
 * Lightweight Sentry reporter for our Next.js API routes.
 *
 * We don't pull in @sentry/nextjs to avoid instrumentation hooks that can
 * break the Vercel build (we've been red once this week already). Instead
 * we post directly to Sentry's Store endpoint — good enough to catch any
 * API-side error while keeping the build simple.
 *
 * Usage (inside any route handler):
 *   import { captureError } from "@/lib/sentry";
 *   try { ... } catch (err) { await captureError(err, { route: "/api/foo" }); throw err; }
 */

import { envSoft } from "./env";

const DSN =
  envSoft("SENTRY_DSN") ||
  "https://42763199881812ceccc81884f1381002@o4511217410048000.ingest.us.sentry.io/4511217411686400";

function parseDsn(dsn: string) {
  try {
    const u = new URL(dsn);
    return {
      publicKey: u.username,
      host: u.host,
      projectId: u.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

type ErrorContext = Record<string, unknown> & {
  route?: string;
  userId?: string;
  requestId?: string;
};

export async function captureError(err: unknown, ctx: ErrorContext = {}): Promise<void> {
  const parsed = parseDsn(DSN);
  if (!parsed) return;

  const e = err instanceof Error ? err : new Error(String(err));
  const payload = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    logger: "api",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    tags: {
      route: ctx.route,
    },
    user: ctx.userId ? { id: ctx.userId } : undefined,
    extra: ctx,
    exception: {
      values: [
        {
          type: e.name,
          value: e.message,
          stacktrace: e.stack
            ? {
                frames: e.stack
                  .split("\n")
                  .slice(1, 21)
                  .map((line) => ({ function: line.trim() })),
              }
            : undefined,
        },
      ],
    },
  };

  const endpoint = `https://${parsed.host}/api/${parsed.projectId}/store/`;
  const auth = `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=fleettrack/1.0`;

  try {
    // Fire-and-forget; don't block the response on Sentry ingest.
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": auth,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    // Never let monitoring failure cascade into a user-facing error.
  }
}

/** Wraps a handler so any thrown error is reported before rethrowing. */
export function withSentry<T extends (...args: unknown[]) => Promise<unknown>>(
  route: string,
  handler: T,
): T {
  return (async (...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch (err) {
      await captureError(err, { route });
      throw err;
    }
  }) as T;
}
