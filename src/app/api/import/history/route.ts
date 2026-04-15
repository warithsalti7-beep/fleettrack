import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/import/history
 *
 * Returns the last 100 ImportLog rows so operators can see what was
 * uploaded, by whom, how many rows succeeded, and whether there were
 * errors. Powers the Dashboard → System → Import History page.
 *
 * Uses `$queryRawUnsafe` with a safe literal SQL statement because the
 * Prisma client might not yet have `importLog` generated on this
 * deploy. Falls back to empty array if the table hasn't been migrated.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  entity: string;
  actorEmail: string | null;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;
  status: string;
  durationMs: number | null;
  createdAt: Date;
};

export async function GET(_req: NextRequest) {
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT "id","entity","actorEmail","rowsTotal","rowsInserted",
              "rowsUpdated","rowsSkipped","rowsFailed","status",
              "durationMs","createdAt"
       FROM "ImportLog"
       ORDER BY "createdAt" DESC
       LIMIT 100`,
    );
    return NextResponse.json({ rows });
  } catch {
    // Table not yet migrated — return empty array so the UI can render
    // an empty state instead of a 500.
    return NextResponse.json({ rows: [] });
  }
}
