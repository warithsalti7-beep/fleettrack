/**
 * Lightweight session signing using HMAC-SHA256 on the Web Crypto API.
 *
 * - Runs on both Edge (middleware) and Node runtimes.
 * - Cookie format: base64url(payload) + "." + base64url(sig)
 * - Payload: { userId, email, role, exp } — exp is a ms epoch.
 *
 * This is NOT a full replacement for a real auth backend. It blocks
 * casual unauthenticated access to the API from outside the browser and
 * gives server-side code a trusted identity claim, but:
 *   - tokens can't be revoked server-side (no server session store yet)
 *   - password verification happens against a hardcoded demo list +
 *     the Neon User table (no bcrypt yet)
 *
 * Both gaps are addressed in the JWT + bcrypt overhaul (Deploy 3).
 */

export type SessionPayload = {
  userId: string;
  email: string;
  role: "admin" | "employee" | "driver";
  name?: string;
  exp: number; // ms epoch
};

const COOKIE_NAME = "ft_session";
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 h

/**
 * Return the HMAC secret. Prefers AUTH_SECRET env var (what you want in
 * production). Falls back to a secret derived from DATABASE_URL + a fixed
 * salt so the app still boots if AUTH_SECRET was forgotten — cookies stay
 * valid within a single deploy, invalidate on redeploy (which is fine).
 *
 * The fallback keeps the app alive rather than throwing on every API call;
 * the loud console error reminds operators to set AUTH_SECRET properly.
 */
let warnedAboutMissingSecret = false;
function getSecret(): string {
  const explicit = process.env.AUTH_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  // Build a deterministic derived secret from other env. Not as secure as
  // a real random secret (DATABASE_URL is long-lived per project) but
  // strictly better than a hardcoded fallback, and cookies remain stable
  // until DATABASE_URL changes.
  const base = (process.env.DATABASE_URL || "") + "|ft-fallback-v1";
  if (base.length < 32) {
    // Genuinely nothing to derive from — last-resort dev default.
    return "dev-insecure-secret-please-set-AUTH_SECRET-in-vercel";
  }
  if (!warnedAboutMissingSecret && process.env.NODE_ENV === "production") {
    warnedAboutMissingSecret = true;
    console.error(
      "[auth] AUTH_SECRET not set (or < 16 chars). Using a derived fallback. " +
      "Add AUTH_SECRET to Vercel env vars (any 32+ char random string) to " +
      "make session cookies cryptographically strong.",
    );
  }
  return base;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function hmac(data: string): Promise<Uint8Array> {
  const secretBytes = enc(getSecret()).slice();
  const dataBytes = enc(data).slice();
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes.buffer);
  return new Uint8Array(sig);
}

export async function signSession(
  payload: Omit<SessionPayload, "exp">,
): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Date.now() + MAX_AGE_MS };
  const head = b64urlEncode(enc(JSON.stringify(full)));
  const sig = b64urlEncode(await hmac(head));
  return `${head}.${sig}`;
}

export async function verifySession(
  token: string | null | undefined,
): Promise<SessionPayload | null> {
  if (!token || typeof token !== "string") return null;
  const [head, sig] = token.split(".");
  if (!head || !sig) return null;
  const expect = b64urlEncode(await hmac(head));
  // constant-time-ish compare
  if (expect.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const json = new TextDecoder().decode(b64urlDecode(head));
    const data = JSON.parse(json) as SessionPayload;
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function cookieHeader(token: string, maxAgeMs = MAX_AGE_MS): string {
  // SameSite=Strict — fleet admin app has no cross-origin embedding use case
  // and Strict blocks the largest class of CSRF attacks.
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    `Max-Age=0`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export const SESSION_COOKIE = COOKIE_NAME;
