import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  return NextResponse.json(vehicle);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();

  const vehicle = await prisma.vehicle.update({
    where: { id },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.fuelLevel !== undefined && { fuelLevel: parseFloat(body.fuelLevel) }),
      ...(body.mileage !== undefined && { mileage: parseInt(body.mileage) }),
      ...(body.latitude !== undefined && { latitude: parseFloat(body.latitude) }),
      ...(body.longitude !== undefined && { longitude: parseFloat(body.longitude) }),
      ...(body.nextService && { nextService: new Date(body.nextService) }),
    },
  });

  return NextResponse.json(vehicle);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.vehicle.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
