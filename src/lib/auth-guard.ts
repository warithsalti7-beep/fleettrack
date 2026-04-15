/**
 * Route-handler level authentication.
 *
 * Patterns:
 *   const gate = await requireSession(req);
 *   if (!gate.ok) return gate.response;
 *   const { session } = gate;
 *
 *   const gate = await requireSession(req, ["admin", "employee"]);
 *   if (!gate.ok) return gate.response;
 */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";

export type Role = SessionPayload["role"];

export async function readSession(req: NextRequest | Request): Promise<SessionPayload | null> {
  // NextRequest exposes .cookies.get; plain Request parses cookie header.
  const nreq = req as NextRequest;
  const token =
    nreq.cookies && typeof nreq.cookies.get === "function"
      ? nreq.cookies.get(SESSION_COOKIE)?.value
      : parseCookie((req.headers.get("cookie") || ""), SESSION_COOKIE);
  return verifySession(token);
}

function parseCookie(header: string, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v;
  }
  return undefined;
}

export type GateOk = { ok: true; session: SessionPayload };
export type GateFail = { ok: false; response: NextResponse };

export async function requireSession(
  req: NextRequest | Request,
  allowedRoles?: readonly Role[],
): Promise<GateOk | GateFail> {
  const session = await readSession(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(session.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, session };
}

/** Convenience: require admin. */
export function requireAdmin(req: NextRequest | Request) {
  return requireSession(req, ["admin"]);
}

/** Convenience: require admin OR employee (office staff, not driver). */
export function requireStaff(req: NextRequest | Request) {
  return requireSession(req, ["admin", "employee"]);
}
