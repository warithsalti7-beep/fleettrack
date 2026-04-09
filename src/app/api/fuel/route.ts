import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
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
  const body = await request.json();

  const liters = parseFloat(body.liters);
  const pricePerLiter = parseFloat(body.pricePerLiter);
  const totalCost = liters * pricePerLiter;

  const log = await prisma.fuelLog.create({
    data: {
      vehicleId: body.vehicleId,
      liters,
      pricePerLiter,
      totalCost,
      mileageAtFill: parseInt(body.mileageAtFill),
      station: body.station,
      filledAt: body.filledAt ? new Date(body.filledAt) : new Date(),
    },
    include: {
      vehicle: { select: { plateNumber: true } },
    },
  });

  // Update vehicle fuel level
  await prisma.vehicle.update({
    where: { id: body.vehicleId },
    data: {
      fuelLevel: Math.min(100, parseFloat(body.fuelLevelAfter ?? "100")),
      mileage: parseInt(body.mileageAtFill),
    },
  });

  return NextResponse.json(log, { status: 201 });
}
