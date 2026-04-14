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

function toCsv(rows: unknown[]): string {
  if (!rows.length) return "";
  const first = rows[0] as Record<string, unknown>;
  const cols = Object.keys(first);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
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
      prisma.user.findMany().catch(() => []),
      prisma.driver.findMany().catch(() => []),
      prisma.vehicle.findMany().catch(() => []),
      prisma.trip.findMany().catch(() => []),
      prisma.maintenance.findMany().catch(() => []),
      prisma.fuelLog.findMany().catch(() => []),
      // Optional tables that may not exist pre-migration
      (prisma as unknown as { shift?: { findMany: () => Promise<unknown[]> } })
        .shift?.findMany().catch(() => []) ?? Promise.resolve([]),
      (prisma as unknown as { fixedCost?: { findMany: () => Promise<unknown[]> } })
        .fixedCost?.findMany().catch(() => []) ?? Promise.resolve([]),
      (prisma as unknown as { auditLog?: { findMany: (a: unknown) => Promise<unknown[]> } })
        .auditLog?.findMany({ take: 10000, orderBy: { createdAt: "desc" } }).catch(() => []) ?? Promise.resolve([]),
    ]);

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
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backup failed" },
      { status: 500 },
    );
  }
}
