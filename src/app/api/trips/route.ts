import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const driverId = searchParams.get("driverId");
  const vehicleId = searchParams.get("vehicleId");
  const limit = parseInt(searchParams.get("limit") ?? "50");

  const trips = await prisma.trip.findMany({
    where: {
      ...(status && { status }),
      ...(driverId && { driverId }),
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
  const body = await request.json();

  const trip = await prisma.trip.create({
    data: {
      driverId: body.driverId,
      vehicleId: body.vehicleId,
      pickupAddress: body.pickupAddress,
      dropoffAddress: body.dropoffAddress,
      pickupLat: body.pickupLat ? parseFloat(body.pickupLat) : null,
      pickupLng: body.pickupLng ? parseFloat(body.pickupLng) : null,
      dropoffLat: body.dropoffLat ? parseFloat(body.dropoffLat) : null,
      dropoffLng: body.dropoffLng ? parseFloat(body.dropoffLng) : null,
      paymentMethod: body.paymentMethod ?? "CASH",
      status: "PENDING",
      notes: body.notes,
    },
    include: {
      driver: { select: { name: true } },
      vehicle: { select: { plateNumber: true } },
    },
  });

  // Update driver and vehicle status
  await Promise.all([
    prisma.driver.update({ where: { id: body.driverId }, data: { status: "ON_TRIP" } }),
    prisma.vehicle.update({ where: { id: body.vehicleId }, data: { status: "ON_TRIP" } }),
  ]);

  return NextResponse.json(trip, { status: 201 });
}
