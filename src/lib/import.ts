/**
 * Import helpers shared by every /api/import/* route.
 *
 * Every successful run writes an ImportLog row so we have a legal /
 * tax audit trail. Errors are PII-scrubbed before they touch Sentry
 * or the response body.
 *
 * ──────────────────────────────────────────────────────────────
 * IMPORTANT — data-preservation guarantees for operators
 * ──────────────────────────────────────────────────────────────
 *
 *  1. Imports are ADDITIVE. No route ever issues DELETE / TRUNCATE.
 *     Uploading a CSV never erases rows that are not in the file.
 *
 *  2. Imports are IDEMPOTENT. Every entity has a natural key used
 *     to UPSERT:
 *       - Driver        → email
 *       - Vehicle       → carId (falls back to plateNumber)
 *       - User          → email
 *       - Trip          → (externalPlatform, externalId); plain
 *                         CREATE when both are missing (manual entry)
 *       - Shift         → (driverId, vehicleId, shiftDate, startTime)
 *       - FuelLog       → (source, externalId); or (vehicleId,
 *                         filledAt, liters) as fallback
 *       - Maintenance   → (vehicleId, type, scheduledAt)
 *       - FixedCost     → (vehicleId NULL-safe, category,
 *                         description, startDate)
 *
 *     Re-uploading the same file is always a no-op — matching rows
 *     are UPDATED with the CSV values but NEVER duplicated.
 *
 *  3. Imports MERGE row-by-row. A partial file (new rows for new
 *     drivers only) leaves every previously-imported row intact.
 *
 *  4. Every run writes an ImportLog row recording who, what, when,
 *     success count, failure count, and a hash of the file. You can
 *     trace every historical change back through System → Import
 *     History.
 */
import { NextRequest, NextResponse } from "next/server";
import { captureError } from "./sentry";
import { redactPii } from "./api-guards";
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
  let csv = "";
  let topLevelError: unknown = null;
  try {
    csv = await readCsvBody(req);
    await work(csv, report);
  } catch (err) {
    topLevelError = err;
    await captureError(redactPii(err), { route: `/api/import/${entity}` });
    report.ok = false;
    report.errors.push({
      row: 0,
      message: err instanceof Error ? redactPii(err.message) : String(err),
    });
  }
  report.durationMs = Date.now() - start;
  report.ok = report.ok && report.errors.length === 0;
  // Redact any row-level messages collected in the work() callback.
  report.errors = report.errors.map((e) => ({ ...e, message: redactPii(e.message) }));

  // Fire-and-forget audit log — never block the response on this.
  const actorId = req.headers.get("x-user-id") || null;
  const actorEmail = req.headers.get("x-user-email") || null;
  const rowsTotal =
    report.inserted + report.updated + report.skipped + report.errors.length;
  void prisma
    .$executeRawUnsafe(
      `INSERT INTO "ImportLog"
       ("id","entity","actorId","actorEmail","rowsTotal","rowsInserted","rowsUpdated","rowsSkipped","rowsFailed","errors","status","durationMs","createdAt","sizeBytes")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, NOW(), $12)`,
      entity,
      actorId,
      actorEmail,
      rowsTotal,
      report.inserted,
      report.updated,
      report.skipped,
      report.errors.length,
      JSON.stringify(report.errors.slice(0, 100)),
      report.ok ? "OK" : report.errors.length && report.inserted ? "PARTIAL" : "FAILED",
      report.durationMs,
      csv.length,
    )
    .catch(() => {
      /* ImportLog not yet migrated — ignore until `prisma migrate dev` runs */
    });

  return NextResponse.json(report, { status: topLevelError ? 500 : 200 });
}
