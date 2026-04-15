/**
 * Server-side helpers for fetching our own /api/* routes from React
 * Server Components. Handles:
 *   - Cookie forwarding so requireSession works server-to-server.
 *   - Absolute-URL construction based on the incoming request host.
 *   - Session resolution (returns the decoded payload or null).
 *
 * Every admin RSC page should call resolveSessionOrRedirect() at the
 * top, then use apiFetch()/apiJson() for subsequent data calls.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, type Role } from "./auth-guard";
import type { SessionPayload } from "./session";

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
}

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** Raw fetch; caller handles the Response. Forwards cookie automatically. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = (await baseUrl()) + (path.startsWith("/") ? path : "/" + path);
  const cookie = await cookieHeader();
  const mergedHeaders = new Headers(init?.headers);
  if (cookie) mergedHeaders.set("cookie", cookie);
  return fetch(url, { ...init, headers: mergedHeaders, cache: "no-store" });
}

/** JSON convenience. Returns null on non-2xx; T on success. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const r = await apiFetch(path, init);
  if (!r.ok) return null;
  try { return (await r.json()) as T; } catch { return null; }
}

/**
 * Reads the session cookie and redirects if invalid or (optionally)
 * if the user's role is not in `allowed`. Returns the session payload.
 */
export async function resolveSessionOrRedirect(
  allowed?: readonly Role[],
): Promise<SessionPayload> {
  const cookie = await cookieHeader();
  // readSession accepts a plain Request; build one with just the cookie.
  const fakeReq = new Request("http://local/", { headers: { cookie } });
  const session = await readSession(fakeReq);
  if (!session) redirect("/login");
  if (allowed && !allowed.includes(session.role)) {
    // Drivers bouncing back to their portal is the existing UX; anyone
    // else lands on the classic dashboard where the nav filter hides
    // what they can't use.
    redirect(session.role === "driver" ? "/driver" : "/dashboard");
  }
  return session;
}
