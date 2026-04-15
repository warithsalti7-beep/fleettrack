import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/shifts/stop
 *
 * Closes the caller's open shift. If a `shiftId` is in the body it
 * targets that exact shift (admin override); otherwise it picks the
 * most-recent OPEN shift for the driver.
 *
 * Sets clockOutAt=now(), endTime=HH:MM, status='CLOSED' and computes
 * hoursOnline as a decimal.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const headerDriverId = req.headers.get("x-user-id") || null;
  const body = await req.json().catch(() => ({}));
  const driverId: string | null = body.driverId || headerDriverId;
  const shiftId: string | null = body.shiftId || null;

  if (!shiftId && !driverId) {
    return NextResponse.json(
      { error: "shiftId or driverId required" },
      { status: 400 },
    );
  }

  const shift = shiftId
    ? await prisma.shift.findUnique({ where: { id: shiftId } }).catch(() => null)
    : await prisma.shift
        .findFirst({
          where: { driverId: driverId!, status: "OPEN" },
          orderBy: { clockInAt: "desc" },
        })
        .catch(() => null);

  if (!shift) {
    return NextResponse.json({ error: "No open shift to close" }, { status: 404 });
  }
  if (shift.status !== "OPEN") {
    return NextResponse.json(
      { error: "Shift already closed", shift },
      { status: 409 },
    );
  }

  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const start = shift.clockInAt ?? shift.shiftDate;
  const hoursOnline = Math.max(
    0,
    +(((now.getTime() - new Date(start).getTime()) / 3600_000).toFixed(2)),
  );

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      clockOutAt: now,
      endTime: `${hh}:${mm}`,
      status: "CLOSED",
      hoursOnline,
    } as never,
  });
  return NextResponse.json({ ok: true, shift: updated });
}
