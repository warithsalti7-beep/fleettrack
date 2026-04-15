/**
 * Small response helpers so every API route returns the same error shape:
 *   { error: "<code>", detail?: "<human>", fields?: { <field>: "<reason>" } }
 *
 * Codes are stable for the client to switch on; detail is localisable;
 * fields surfaces per-field validation errors so form UIs can highlight
 * the exact input.
 */
import { NextResponse } from "next/server";

export type ApiError = {
  error: string;
  detail?: string;
  fields?: Record<string, string>;
};

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function badRequest(detail?: string, fields?: Record<string, string>): NextResponse {
  const body: ApiError = { error: "bad_request" };
  if (detail) body.detail = detail;
  if (fields) body.fields = fields;
  return NextResponse.json(body, { status: 400 });
}

export function validationFailed(fields: Record<string, string>): NextResponse {
  return NextResponse.json<ApiError>({ error: "validation_failed", fields }, { status: 400 });
}

export function notFound(detail = "Resource not found"): NextResponse {
  return NextResponse.json<ApiError>({ error: "not_found", detail }, { status: 404 });
}

export function forbidden(detail = "Permission denied"): NextResponse {
  return NextResponse.json<ApiError>({ error: "forbidden", detail }, { status: 403 });
}

export function conflict(detail: string): NextResponse {
  return NextResponse.json<ApiError>({ error: "conflict", detail }, { status: 409 });
}

export function serverError(detail?: string): NextResponse {
  return NextResponse.json<ApiError>({ error: "server_error", detail }, { status: 500 });
}

/** Parses `request.json()` into Record<string,unknown> or returns a 400. */
export async function readJson(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  try {
    const b = await req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      return { ok: false, response: badRequest("Expected a JSON object body") };
    }
    return { ok: true, body: b as Record<string, unknown> };
  } catch {
    return { ok: false, response: badRequest("Invalid JSON body") };
  }
}

/**
 * Wrap a Prisma call; detect unique-constraint failures (P2002) and
 * translate them to a 409 conflict with the offending field in the message.
 */
export function isPrismaUniqueViolation(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; meta?: { target?: string[] | string } };
  if (e.code !== "P2002") return null;
  const t = e.meta?.target;
  if (Array.isArray(t)) return t.join(", ");
  if (typeof t === "string") return t;
  return "unique field";
}
