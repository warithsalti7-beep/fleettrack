/**
 * Typed coercion helpers for inbound API payloads.
 *
 * Each helper returns a narrowed value OR null (field was absent/empty)
 * OR throws a FieldError with a stable error message the caller can
 * surface to the client verbatim.
 *
 * Designed for "PATCH with partial fields" semantics: `optStr(b, "name")`
 * returns undefined when the key is missing, null when explicitly null
 * (client wants to clear), or the trimmed string.
 */

export class FieldError extends Error {
  field: string;
  code: string;
  constructor(field: string, code: string, message?: string) {
    super(message ?? `${field}: ${code}`);
    this.field = field;
    this.code = code;
  }
}

type Body = Record<string, unknown>;

const MISSING = Symbol("missing");

function read(body: Body, key: string): unknown | typeof MISSING {
  if (!(key in body)) return MISSING;
  return body[key];
}

// ── Strings ─────────────────────────────────────────────────────────
export function optStr(body: Body, key: string, opts?: { min?: number; max?: number; lowercase?: boolean; trim?: boolean }):
  string | null | undefined {
  const v = read(body, key);
  if (v === MISSING) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new FieldError(key, "not_a_string", `${key} must be a string`);
  let s = v;
  if (opts?.trim !== false) s = s.trim();
  if (opts?.lowercase) s = s.toLowerCase();
  if (opts?.min !== undefined && s.length < opts.min)
    throw new FieldError(key, "too_short", `${key} must be at least ${opts.min} characters`);
  if (opts?.max !== undefined && s.length > opts.max)
    throw new FieldError(key, "too_long", `${key} must be at most ${opts.max} characters`);
  return s;
}

export function reqStr(body: Body, key: string, opts?: Parameters<typeof optStr>[2]): string {
  const v = optStr(body, key, opts);
  if (v === undefined) throw new FieldError(key, "required", `${key} is required`);
  if (v === null || v === "")  throw new FieldError(key, "required", `${key} cannot be empty`);
  return v;
}

// ── Numbers ─────────────────────────────────────────────────────────
export function optNum(body: Body, key: string, opts?: { int?: boolean; min?: number; max?: number }):
  number | null | undefined {
  const v = read(body, key);
  if (v === MISSING) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new FieldError(key, "not_a_number", `${key} must be a number`);
  if (opts?.int && !Number.isInteger(n))
    throw new FieldError(key, "not_an_integer", `${key} must be an integer`);
  if (opts?.min !== undefined && n < opts.min)
    throw new FieldError(key, "below_min", `${key} must be >= ${opts.min}`);
  if (opts?.max !== undefined && n > opts.max)
    throw new FieldError(key, "above_max", `${key} must be <= ${opts.max}`);
  return n;
}

// ── Dates ───────────────────────────────────────────────────────────
export function optDate(body: Body, key: string): Date | null | undefined {
  const v = read(body, key);
  if (v === MISSING) return undefined;
  if (v === null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new FieldError(key, "invalid_date", `${key} is not a valid date`);
  return d;
}

// ── Enums ───────────────────────────────────────────────────────────
export function optEnum<T extends string>(
  body: Body, key: string, allowed: readonly T[],
): T | null | undefined {
  const v = read(body, key);
  if (v === MISSING) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new FieldError(key, "invalid_enum", `${key} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

// ── Email ───────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function optEmail(body: Body, key: string): string | null | undefined {
  const s = optStr(body, key, { lowercase: true });
  if (s === undefined || s === null) return s;
  if (!EMAIL_RE.test(s)) throw new FieldError(key, "invalid_email", `${key} must be a valid email`);
  return s;
}
export function reqEmail(body: Body, key: string): string {
  const s = optEmail(body, key);
  if (s === undefined) throw new FieldError(key, "required", `${key} is required`);
  if (s === null)      throw new FieldError(key, "required", `${key} cannot be empty`);
  return s;
}

/**
 * Build a PATCH-safe data object. Copy keys that are defined (not
 * undefined); explicit null means "clear the column". Prisma treats
 * undefined as "don't touch" which is what we want for every missing key.
 */
export function buildPatch<T extends Record<string, unknown>>(values: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}
