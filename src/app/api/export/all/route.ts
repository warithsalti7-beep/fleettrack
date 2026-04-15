/**
 * GET /api/export/all — full database snapshot as a single CSV-concatenated
 * download (streamed text).
 *
 * Admins only. Drops every table as CSV, separated by sentinel lines
 * (### TABLE: <name> ###). Load it back later with a restore tool or
 * split on those sentinels.
 *
 * This is the "save-my-work" button. Run it before a big migration, store
 * it off-platform (Dropbox, Drive), and you can reconstruct the DB.
 *
 * For actual production backups, use Neon's built-in point-in-time recovery
 * (Launch tier+). See docs/BACKUPS.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-table row cap — prevents a lambda OOM on huge fleets. 50k rows of
// mid-sized data is ~15 MB of CSV which fits comfortably in lambda memory.
// Callers should set up Neon PITR for real backups; this endpoint is for
// "quick operator dump".
const ROW_CAP = 50000;
const SENTINEL = "### TABLE:";

function toCsv(rows: unknown[]): string {
  if (!rows.length) return "";
  const first = rows[0] as Record<string, unknown>;
  const cols = Object.keys(first);
  const esc = (v: unknown) => {
    if (v == null) return "";
    let s = v instanceof Date ? v.toISOString() : String(v);
    // Escape sentinel collisions defensively — any row value that contains
    // "### TABLE:" would break split-on-sentinel restore. Quote + pad.
    if (s.includes(SENTINEL)) s = s.split(SENTINEL).join("#​#​# TABLE:"); // zero-width joiners
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    lines.push(cols.map((c) => esc(r[c])).join(","));
  }
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  // Require admin role — proxy already verified the session cookie, here we
  // check role specifically for this destructive-sensitive endpoint.
  const role = req.headers.get("x-user-role");
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  try {
    const [users, drivers, vehicles, trips, maintenance, fuelLogs, shifts, fixedCosts, auditLogs] = await Promise.all([
      prisma.user.findMany({ take: ROW_CAP }).catch(() => []),
      prisma.driver.findMany({ take: ROW_CAP }).catch(() => []),
      prisma.vehicle.findMany({ take: ROW_CAP }).catch(() => []),
      prisma.trip.findMany({ take: ROW_CAP, orderBy: { startedAt: "desc" } }).catch(() => []),
      prisma.maintenance.findMany({ take: ROW_CAP, orderBy: { scheduledAt: "desc" } }).catch(() => []),
      prisma.fuelLog.findMany({ take: ROW_CAP, orderBy: { filledAt: "desc" } }).catch(() => []),
      // Optional tables that may not exist pre-migration
      (prisma as unknown as { shift?: { findMany: (a: unknown) => Promise<unknown[]> } })
        .shift?.findMany({ take: ROW_CAP }).catch(() => []) ?? Promise.resolve([]),
      (prisma as unknown as { fixedCost?: { findMany: (a: unknown) => Promise<unknown[]> } })
        .fixedCost?.findMany({ take: ROW_CAP }).catch(() => []) ?? Promise.resolve([]),
      (prisma as unknown as { auditLog?: { findMany: (a: unknown) => Promise<unknown[]> } })
        .auditLog?.findMany({ take: 10000, orderBy: { createdAt: "desc" } }).catch(() => []) ?? Promise.resolve([]),
    ]);

    const truncated: string[] = [];
    [["users", users], ["drivers", drivers], ["vehicles", vehicles],
     ["trips", trips], ["maintenance", maintenance], ["fuel_logs", fuelLogs],
     ["shifts", shifts], ["fixed_costs", fixedCosts], ["audit_logs", auditLogs]]
      .forEach(([name, arr]) => {
        if (Array.isArray(arr) && arr.length >= (name === "audit_logs" ? 10000 : ROW_CAP)) {
          truncated.push(String(name));
        }
      });

    const blocks: { name: string; rows: unknown[] }[] = [
      { name: "users",        rows: users },
      { name: "drivers",      rows: drivers },
      { name: "vehicles",     rows: vehicles },
      { name: "trips",        rows: trips },
      { name: "maintenance",  rows: maintenance },
      { name: "fuel_logs",    rows: fuelLogs },
      { name: "shifts",       rows: shifts },
      { name: "fixed_costs",  rows: fixedCosts },
      { name: "audit_logs",   rows: auditLogs },
    ];

    const timestamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const body = blocks
      .map((b) => `### TABLE: ${b.name} (${b.rows.length} rows) ###\n${toCsv(b.rows)}`)
      .join("\n\n");

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fleettrack-backup-${timestamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Row-Counts": blocks.map((b) => `${b.name}:${b.rows.length}`).join(","),
        ...(truncated.length ? { "X-Truncated": truncated.join(",") } : {}),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backup failed" },
      { status: 500 },
    );
  }
}
