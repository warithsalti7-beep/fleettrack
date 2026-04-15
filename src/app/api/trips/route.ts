import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const driverIdParam = searchParams.get("driverId");
  const vehicleId = searchParams.get("vehicleId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  // Drivers may only see their own trips regardless of filter params.
  let driverFilter: string | undefined = driverIdParam ?? undefined;
  if (gate.session.role === "driver") {
    const me = await prisma.driver.findUnique({ where: { email: gate.session.email }, select: { id: true } });
    if (!me) return NextResponse.json([]);
    driverFilter = me.id;
  }

  const trips = await prisma.trip.findMany({
    where: {
      ...(status && { status }),
      ...(driverFilter && { driverId: driverFilter }),
      ...(vehicleId && { vehicleId }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      driver: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, plateNumber: true, make: true, model: true } },
    },
  });

  return NextResponse.json(trips);
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const driverId = typeof body.driverId === "string" ? body.driverId : "";
  const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
  const pickupAddress = typeof body.pickupAddress === "string" ? body.pickupAddress : "";
  const dropoffAddress = typeof body.dropoffAddress === "string" ? body.dropoffAddress : "";

  if (!driverId || !vehicleId || !pickupAddress || !dropoffAddress) {
    return NextResponse.json(
      { error: "validation_failed", detail: "driverId, vehicleId, pickupAddress and dropoffAddress are required" },
      { status: 400 },
    );
  }

  const trip = await prisma.trip.create({
    data: {
      driverId,
      vehicleId,
      pickupAddress,
      dropoffAddress,
      pickupLat: body.pickupLat ? parseFloat(String(body.pickupLat)) : null,
      pickupLng: body.pickupLng ? parseFloat(String(body.pickupLng)) : null,
      dropoffLat: body.dropoffLat ? parseFloat(String(body.dropoffLat)) : null,
      dropoffLng: body.dropoffLng ? parseFloat(String(body.dropoffLng)) : null,
      paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod : "CASH",
      status: "PENDING",
      notes: typeof body.notes === "string" ? body.notes : null,
    },
    include: {
      driver: { select: { name: true } },
      vehicle: { select: { plateNumber: true } },
    },
  });

  await Promise.all([
    prisma.driver.update({ where: { id: driverId }, data: { status: "ON_TRIP" } }),
    prisma.vehicle.update({ where: { id: vehicleId }, data: { status: "ON_TRIP" } }),
  ]);

  await writeAudit({
    action: "trip.create",
    target: `trip:${trip.id}`,
    meta: { driverId, vehicleId },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });

  return NextResponse.json(trip, { status: 201 });
}
