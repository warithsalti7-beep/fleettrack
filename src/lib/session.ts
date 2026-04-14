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

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  // In production, refuse to run with a weak/missing secret — otherwise an
  // attacker can forge session cookies trivially. Dev/test falls back so
  // local pnpm dev doesn't require env setup.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET not configured (or < 16 chars). Set AUTH_SECRET in Vercel env vars to a long random string.",
    );
  }
  return "dev-insecure-secret-please-set-AUTH_SECRET";
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
