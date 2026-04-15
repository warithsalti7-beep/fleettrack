/**
 * Import helpers shared by every /api/import/* route.
 */
import { NextRequest, NextResponse } from "next/server";
import { captureError } from "./sentry";
import { prisma } from "./prisma";

export type ImportReport = {
  ok: boolean;
  entity: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: { row: number; email_or_id?: string; message: string }[];
  durationMs: number;
};

export function jsonError(status: number, msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/** Minimal admin auth — requires header X-Admin-Token matching SEED_TOKEN env. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const token =
    req.headers.get("x-admin-token") || req.nextUrl.searchParams.get("token");
  const expected = process.env.SEED_TOKEN;
  if (!expected) return jsonError(500, "SEED_TOKEN not configured on server");
  if (token !== expected) return jsonError(401, "unauthorized");
  return null;
}

export async function readCsvBody(req: NextRequest): Promise<string> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("text/csv") || ct.includes("text/plain")) {
    return await req.text();
  }
  // Support JSON body { csv: "..." } as a fallback
  try {
    const j = await req.json();
    if (typeof j?.csv === "string") return j.csv;
  } catch {
    /* ignore */
  }
  throw new Error(
    "Expected text/csv body or JSON { csv: '...' }. Got: " + ct,
  );
}

export async function runImport(
  entity: string,
  req: NextRequest,
  work: (csv: string, report: ImportReport) => Promise<void>,
): Promise<NextResponse> {
  const gate = requireAdmin(req);
  if (gate) return gate;
  const start = Date.now();
  const report: ImportReport = {
    ok: true,
    entity,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
  };
  try {
    const csv = await readCsvBody(req);
    await work(csv, report);
    report.durationMs = Date.now() - start;
    report.ok = report.errors.length === 0;
    // Fire-and-forget audit row
    await writeAudit({
      action: `import.${entity}`,
      target: entity,
      ok: report.ok,
      actorEmail: req.headers.get("x-user-email") || null,
      actorId: req.headers.get("x-user-id") || null,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
      meta: {
        inserted: report.inserted,
        updated: report.updated,
        skipped: report.skipped,
        errorCount: report.errors.length,
        durationMs: report.durationMs,
      },
    });
    return NextResponse.json(report);
  } catch (err) {
    await captureError(err, { route: `/api/import/${entity}` });
    report.durationMs = Date.now() - start;
    report.ok = false;
    report.errors.push({ row: 0, message: err instanceof Error ? err.message : String(err) });
    await writeAudit({
      action: `import.${entity}`,
      target: entity,
      ok: false,
      actorEmail: req.headers.get("x-user-email") || null,
      actorId: req.headers.get("x-user-id") || null,
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json(report, { status: 500 });
  }
}

/**
 * Append an AuditLog row. Silent — never throws back into the caller.
 * AuditLog is best-effort; if the table doesn't exist yet (pre-migration)
 * we swallow the error.
 */
export async function writeAudit(entry: {
  action: string;
  target?: string | null;
  ok?: boolean;
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const client = prisma as unknown as {
      auditLog?: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
    };
    if (!client.auditLog) return;
    await client.auditLog.create({
      data: {
        action: entry.action,
        target: entry.target ?? null,
        ok: entry.ok !== false,
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        ip: entry.ip ?? null,
        meta: (entry.meta ?? null) as unknown as object,
      },
    });
  } catch {
    /* best-effort */
  }
}
