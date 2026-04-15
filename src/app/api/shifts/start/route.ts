import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/shifts/start
 *
 * Body: { driverId?: string, vehicleId?: string }
 *   - driverId is optional in dev — falls back to the x-user-id header
 *     written by middleware. In production it MUST come from the
 *     authenticated session.
 *   - vehicleId is optional but recommended.
 *
 * Behaviour (per spec §6 'driver shift start/stop'):
 *   - Refuses to open a second shift while one is still open
 *     (status='OPEN'). Returns 409 with the existing shift so the UI
 *     can show "you're already on shift, started at HH:MM".
 *   - Sets source='APP', clockInAt=now(), status='OPEN', endTime='—'.
 *   - Computes shiftDate as the local-time-of-day of clockInAt to keep
 *     daily KPI rollups stable.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const headerDriverId = req.headers.get("x-user-id") || null;
  const body = await req.json().catch(() => ({}));
  const driverId: string | null = body.driverId || headerDriverId;
  const vehicleId: string | null = body.vehicleId || null;

  if (!driverId) {
    return NextResponse.json(
      { error: "driverId required (no session and none in body)" },
      { status: 400 },
    );
  }

  // Check for an open shift first — the spec is explicit that we
  // should not allow a second open shift. We index on
  // (driverId, status) for this exact lookup.
  const open = await prisma.shift
    .findFirst({
      where: { driverId, status: "OPEN" },
      orderBy: { clockInAt: "desc" },
    })
    .catch(() => null);
  if (open) {
    return NextResponse.json(
      {
        error: "Shift already open",
        code: "SHIFT_OPEN",
        shift: open,
      },
      { status: 409 },
    );
  }

  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  // Vehicle is optional, but the model field is required on the
  // existing schema. Use the driver's last-known vehicle when none
  // was passed, so we never end up with a NULL vehicleId.
  let resolvedVehicleId: string | null = vehicleId;
  if (!resolvedVehicleId) {
    const last = await prisma.shift
      .findFirst({ where: { driverId }, orderBy: { createdAt: "desc" } })
      .catch(() => null);
    resolvedVehicleId = last?.vehicleId ?? null;
  }
  if (!resolvedVehicleId) {
    return NextResponse.json(
      {
        error: "vehicleId required and no previous vehicle on file",
        code: "VEHICLE_REQUIRED",
      },
      { status: 400 },
    );
  }

  const shift = await prisma.shift.create({
    data: {
      driverId,
      vehicleId: resolvedVehicleId,
      shiftDate: new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      startTime: `${hh}:${mm}`,
      endTime: "--:--",
      clockInAt: now,
      status: "OPEN",
      source: "APP",
    } as never,
  });
  return NextResponse.json({ ok: true, shift });
}
