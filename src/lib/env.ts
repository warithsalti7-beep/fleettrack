/**
 * Runtime env validation.
 *
 * Keeps the set of required env vars in one place and gives a clean
 * error message at startup instead of a cryptic "Cannot reach database"
 * later down the stack.
 *
 * Usage from an API route:
 *   import { env } from "@/lib/env";
 *   const pool = new Pool({ connectionString: env.DATABASE_URL });
 */

type RequiredKey = "DATABASE_URL";
type OptionalKey = "SEED_TOKEN" | "AUTH_SECRET" | "OPENAI_API_KEY" | "RESEND_API_KEY";

const REQUIRED: RequiredKey[] = ["DATABASE_URL"];
const OPTIONAL: OptionalKey[] = ["SEED_TOKEN", "AUTH_SECRET", "OPENAI_API_KEY", "RESEND_API_KEY"];

type Env = Record<RequiredKey, string> & Partial<Record<OptionalKey, string>>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const missing: string[] = [];
  const out: Record<string, string | undefined> = {};
  for (const k of REQUIRED) {
    const v = process.env[k];
    if (!v) missing.push(k);
    else out[k] = v;
  }
  for (const k of OPTIONAL) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Set them in your Vercel project or .env file.`,
    );
  }
  cached = out as Env;
  return cached;
}

/**
 * Soft check — returns null instead of throwing. Use in optional code
 * paths (e.g. AI recommendations are only wired if OPENAI_API_KEY is set).
 */
export function envSoft<K extends OptionalKey>(key: K): string | null {
  return process.env[key] ?? null;
}
