import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id },
    include: {
      trips: { orderBy: { createdAt: "desc" }, take: 20 },
      vehicles: { include: { vehicle: true } },
    },
  });

  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  return NextResponse.json(driver);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();

  const driver = await prisma.driver.update({
    where: { id },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.rating !== undefined && { rating: parseFloat(body.rating) }),
      ...(body.totalTrips !== undefined && { totalTrips: parseInt(body.totalTrips) }),
    },
  });

  return NextResponse.json(driver);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.driver.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
