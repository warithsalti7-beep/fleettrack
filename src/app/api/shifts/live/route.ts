import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/shifts/live
 *
 * Admin: every driver currently on shift. Powers the new fleet-side
 * Live Shifts page. Returned shape is intentionally minimal so the
 * page can poll every 10-30 s without DB pressure.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const open = await prisma.shift
    .findMany({
      where: { status: "OPEN" },
      include: {
        driver: { select: { id: true, name: true, status: true } },
        vehicle: { select: { id: true, carId: true, plateNumber: true, make: true, model: true } },
      },
      orderBy: { clockInAt: "asc" },
    })
    .catch(() => []);

  const now = Date.now();
  const rows = open.map((s) => ({
    shiftId: s.id,
    driver: s.driver,
    vehicle: s.vehicle,
    clockInAt: s.clockInAt,
    minutesOnShift: s.clockInAt
      ? Math.round((now - new Date(s.clockInAt).getTime()) / 60_000)
      : null,
    source: (s as unknown as { source?: string }).source ?? "IMPORT",
    zone: s.zone,
    platformPrimary: s.platformPrimary,
  }));
  return NextResponse.json({ count: rows.length, rows });
}
