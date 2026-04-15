import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET   /api/diagnostics/issues?status=OPEN
 * PATCH /api/diagnostics/issues   { id, status: RESOLVED|DISMISSED }
 *
 * The Errors & Sync page calls GET on load to populate its table and
 * PATCH when the dispatcher resolves or dismisses a row.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "OPEN").toUpperCase();
  const rows = await (prisma as never as {
    dataIssue: { findMany: (a: unknown) => Promise<unknown[]> };
  })
    .dataIssue.findMany({
      where: { status },
      orderBy: { openedAt: "desc" },
      take: 200,
    })
    .catch(() => []);
  return NextResponse.json({ rows });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.id || !body.status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }
  if (!["OPEN", "RESOLVED", "DISMISSED"].includes(body.status)) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  const data = {
    status: body.status,
    resolvedAt: body.status === "OPEN" ? null : new Date(),
    resolvedBy: req.headers.get("x-user-id") || null,
  };
  try {
    await (prisma as never as { dataIssue: { update: (a: unknown) => Promise<unknown> } })
      .dataIssue.update({ where: { id: body.id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
