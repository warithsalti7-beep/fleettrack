import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: { driver: true, vehicle: true },
  });
  if (!trip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (gate.session.role === "driver" && trip.driver.email !== gate.session.email) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(trip);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const status = typeof body.status === "string" ? body.status : undefined;
  const updatedTrip = await prisma.trip.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(body.fare !== undefined && { fare: parseFloat(String(body.fare)) }),
      ...(body.distance !== undefined && { distance: parseFloat(String(body.distance)) }),
      ...(body.duration !== undefined && { duration: parseInt(String(body.duration), 10) }),
      ...(body.rating !== undefined && { rating: parseFloat(String(body.rating)) }),
      ...(status === "IN_PROGRESS" && { startedAt: new Date() }),
      ...(status === "COMPLETED" && { completedAt: new Date() }),
      ...(status === "CANCELLED" && { completedAt: new Date() }),
    },
  });

  if (status === "COMPLETED" || status === "CANCELLED") {
    await Promise.all([
      prisma.driver.update({
        where: { id: trip.driverId },
        data: {
          status: "AVAILABLE",
          totalTrips: { increment: status === "COMPLETED" ? 1 : 0 },
        },
      }),
      prisma.vehicle.update({ where: { id: trip.vehicleId }, data: { status: "AVAILABLE" } }),
    ]);
  }

  await writeAudit({
    action: "trip.update",
    target: `trip:${id}`,
    meta: { status, fields: Object.keys(body) },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return NextResponse.json(updatedTrip);
}
