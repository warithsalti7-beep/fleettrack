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

  const vehicles = await prisma.vehicle.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      drivers: {
        include: { driver: { select: { id: true, name: true } } },
        take: 1,
      },
      _count: { select: { trips: true } },
    },
  });

  return NextResponse.json(vehicles);
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const plateNumber = typeof body.plateNumber === "string" ? body.plateNumber.trim() : "";
  const make = typeof body.make === "string" ? body.make : "";
  const model = typeof body.model === "string" ? body.model : "";
  const year = parseInt(String(body.year ?? ""), 10);
  const color = typeof body.color === "string" ? body.color : "";

  if (!plateNumber || !make || !model || !Number.isFinite(year)) {
    return NextResponse.json(
      { error: "validation_failed", detail: "plateNumber, make, model and a numeric year are required" },
      { status: 400 },
    );
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      plateNumber,
      make,
      model,
      year,
      color,
      status: typeof body.status === "string" ? body.status : "AVAILABLE",
      fuelType: typeof body.fuelType === "string" ? body.fuelType : "PETROL",
      fuelLevel: parseFloat(String(body.fuelLevel ?? 100)),
      mileage: parseInt(String(body.mileage ?? 0), 10),
      lastService: body.lastService ? new Date(String(body.lastService)) : null,
      nextService: body.nextService ? new Date(String(body.nextService)) : null,
    },
  });

  await writeAudit({
    action: "vehicle.create",
    target: `vehicle:${vehicle.id}`,
    meta: { plateNumber },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });

  return NextResponse.json(vehicle, { status: 201 });
}
