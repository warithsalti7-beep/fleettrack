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
  const vehicleId = searchParams.get("vehicleId");

  const logs = await prisma.fuelLog.findMany({
    where: vehicleId ? { vehicleId } : undefined,
    orderBy: { filledAt: "desc" },
    take: 100,
    include: {
      vehicle: { select: { plateNumber: true, make: true, model: true, fuelType: true } },
    },
  });

  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
  const liters = parseFloat(String(body.liters ?? ""));
  const pricePerLiter = parseFloat(String(body.pricePerLiter ?? ""));
  const mileageAtFill = parseInt(String(body.mileageAtFill ?? ""), 10);

  if (!vehicleId || !Number.isFinite(liters) || !Number.isFinite(pricePerLiter) || !Number.isFinite(mileageAtFill)) {
    return NextResponse.json(
      { error: "validation_failed", detail: "vehicleId, liters, pricePerLiter, mileageAtFill are required" },
      { status: 400 },
    );
  }

  const totalCost = liters * pricePerLiter;
  const log = await prisma.fuelLog.create({
    data: {
      vehicleId,
      liters,
      pricePerLiter,
      totalCost,
      mileageAtFill,
      station: typeof body.station === "string" ? body.station : null,
      filledAt: body.filledAt ? new Date(String(body.filledAt)) : new Date(),
    },
    include: { vehicle: { select: { plateNumber: true } } },
  });

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      fuelLevel: Math.min(100, parseFloat(String(body.fuelLevelAfter ?? "100"))),
      mileage: mileageAtFill,
    },
  });

  await writeAudit({
    action: "fuel.create",
    target: `vehicle:${vehicleId}`,
    meta: { liters, totalCost },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });

  return NextResponse.json(log, { status: 201 });
}
