import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      trips: { orderBy: { createdAt: "desc" }, take: 20, include: { driver: { select: { name: true } } } },
      maintenance: { orderBy: { scheduledAt: "desc" }, take: 10 },
      fuelLogs: { orderBy: { filledAt: "desc" }, take: 10 },
      drivers: { include: { driver: true } },
    },
  });
  if (!vehicle) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Drivers may only fetch vehicles they're assigned to.
  if (gate.session.role === "driver") {
    const allowed = vehicle.drivers.some((dv) => dv.driver.email === gate.session.email);
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json(vehicle);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const data: Record<string, unknown> = {};
  if (typeof body.status === "string") data.status = body.status;
  if (body.fuelLevel !== undefined) data.fuelLevel = parseFloat(String(body.fuelLevel));
  if (body.mileage !== undefined) data.mileage = parseInt(String(body.mileage), 10);
  if (body.latitude !== undefined) data.latitude = parseFloat(String(body.latitude));
  if (body.longitude !== undefined) data.longitude = parseFloat(String(body.longitude));
  if (body.nextService) data.nextService = new Date(String(body.nextService));

  const vehicle = await prisma.vehicle.update({ where: { id }, data });
  await writeAudit({
    action: "vehicle.update",
    target: `vehicle:${id}`,
    meta: body,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return NextResponse.json(vehicle);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  await prisma.vehicle.delete({ where: { id } });
  await writeAudit({
    action: "vehicle.delete",
    target: `vehicle:${id}`,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return new NextResponse(null, { status: 204 });
}
