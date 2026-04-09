import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      driver: true,
      vehicle: true,
    },
  });

  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  return NextResponse.json(trip);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const trip = await prisma.trip.findUnique({ where: { id } });

  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const updatedTrip = await prisma.trip.update({
    where: { id },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.fare !== undefined && { fare: parseFloat(body.fare) }),
      ...(body.distance !== undefined && { distance: parseFloat(body.distance) }),
      ...(body.duration !== undefined && { duration: parseInt(body.duration) }),
      ...(body.rating !== undefined && { rating: parseFloat(body.rating) }),
      ...(body.status === "IN_PROGRESS" && { startedAt: new Date() }),
      ...(body.status === "COMPLETED" && { completedAt: new Date() }),
      ...(body.status === "CANCELLED" && { completedAt: new Date() }),
    },
  });

  // Update driver/vehicle status when trip completes or cancels
  if (body.status === "COMPLETED" || body.status === "CANCELLED") {
    await Promise.all([
      prisma.driver.update({
        where: { id: trip.driverId },
        data: {
          status: "AVAILABLE",
          totalTrips: { increment: body.status === "COMPLETED" ? 1 : 0 },
        },
      }),
      prisma.vehicle.update({
        where: { id: trip.vehicleId },
        data: { status: "AVAILABLE" },
      }),
    ]);
  }

  return NextResponse.json(updatedTrip);
}
