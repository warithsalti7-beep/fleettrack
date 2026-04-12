import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
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
  const body = await request.json();

  const vehicle = await prisma.vehicle.create({
    data: {
      plateNumber: body.plateNumber,
      make: body.make,
      model: body.model,
      year: parseInt(body.year),
      color: body.color,
      status: body.status ?? "AVAILABLE",
      fuelType: body.fuelType ?? "PETROL",
      fuelLevel: parseFloat(body.fuelLevel ?? 100),
      mileage: parseInt(body.mileage ?? 0),
      lastService: body.lastService ? new Date(body.lastService) : null,
      nextService: body.nextService ? new Date(body.nextService) : null,
    },
  });

  return NextResponse.json(vehicle, { status: 201 });
}
