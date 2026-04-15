/**
 * Shared helpers for /api/export/* routes.
 *
 * Goals:
 *  - Paginate via ?limit + ?offset so a 50 000-row export doesn't
 *    blow the serverless memory limit.
 *  - Emit a consistent filename and Cache-Control header.
 *  - Escape CSV cells correctly (quotes, commas, newlines).
 */
import { NextResponse } from "next/server";

export const MAX_EXPORT_LIMIT = 5000;
export const DEFAULT_EXPORT_LIMIT = 1000;

export function parseExportPage(url: URL): { limit: number; offset: number } {
  const limit = Math.min(
    MAX_EXPORT_LIMIT,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_EXPORT_LIMIT), 10) || DEFAULT_EXPORT_LIMIT),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  return { limit, offset };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export function rowsToCsv(rows: Array<Array<unknown>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export function csvResponse(filename: string, csv: string, totalCount?: number): NextResponse {
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "private, no-store",
  };
  if (totalCount !== undefined) headers["X-Total-Count"] = String(totalCount);
  return new NextResponse(csv, { headers });
}
