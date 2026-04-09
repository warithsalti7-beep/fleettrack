import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const vehicleId = searchParams.get("vehicleId");

  const records = await prisma.maintenance.findMany({
    where: {
      ...(status && { status }),
      ...(vehicleId && { vehicleId }),
    },
    orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
    include: {
      vehicle: { select: { plateNumber: true, make: true, model: true } },
    },
  });

  return NextResponse.json(records);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const record = await prisma.maintenance.create({
    data: {
      vehicleId: body.vehicleId,
      type: body.type,
      description: body.description,
      priority: body.priority ?? "NORMAL",
      status: "SCHEDULED",
      scheduledAt: new Date(body.scheduledAt),
      cost: body.cost ? parseFloat(body.cost) : null,
      technicianName: body.technicianName,
      notes: body.notes,
    },
    include: {
      vehicle: { select: { plateNumber: true } },
    },
  });

  return NextResponse.json(record, { status: 201 });
}
