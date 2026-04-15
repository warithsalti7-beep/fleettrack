/**
 * Password hashing + verification using PBKDF2-SHA256 via Web Crypto.
 *
 * Chosen over bcrypt/argon2 because:
 *   - Works in both the Node runtime and the Edge runtime without a native
 *     binary (bcrypt needs node-gyp; argon2 needs WASM shim).
 *   - Web Crypto PBKDF2 is supported in every runtime Next.js 16 targets.
 *   - OWASP's 2023 recommendation for PBKDF2-SHA256 is >=600 000 iterations;
 *     we use 210 000 as a compromise between security and serverless cold-
 *     start cost. Still ~6 orders of magnitude harder than the plaintext
 *     comparison this replaces.
 *
 * Storage format (single column, no separate salt): `pbkdf2$<iter>$<salt>$<hash>`
 *   - salt: 16 bytes, base64url
 *   - hash: 32 bytes, base64url
 *
 * Rotation story: when we want to raise the iteration count, bump
 * PBKDF2_ITERATIONS; verifyPassword still accepts old hashes because it
 * reads the iteration count from the stored string.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ALGO = "pbkdf2";

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

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations, hash: "SHA-256" },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${ALGO}$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== ALGO) return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  let salt: Uint8Array, expected: Uint8Array;
  try {
    salt = b64urlDecode(parts[2]);
    expected = b64urlDecode(parts[3]);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/**
 * Returns true if the password matches a minimum strength policy.
 * Kept in sync with client-side FleetAuth.validatePassword.
 */
export function passwordStrengthError(password: string): string | null {
  if (!password || password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
  return null;
}
