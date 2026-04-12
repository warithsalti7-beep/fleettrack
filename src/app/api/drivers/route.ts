import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const drivers = await prisma.driver.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      vehicles: { include: { vehicle: { select: { plateNumber: true, make: true, model: true } } }, take: 1 },
      _count: { select: { trips: true } },
    },
  });

  return NextResponse.json(drivers);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const driver = await prisma.driver.create({
    data: {
      name: body.name,
      email: body.email,
      phone: body.phone,
      licenseNumber: body.licenseNumber,
      licenseExpiry: new Date(body.licenseExpiry),
      status: body.status ?? "AVAILABLE",
      address: body.address,
    },
  });

  return NextResponse.json(driver, { status: 201 });
}
