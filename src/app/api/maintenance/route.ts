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
  const vehicleId = searchParams.get("vehicleId");

  const records = await prisma.maintenance.findMany({
    where: {
      ...(status && { status }),
      ...(vehicleId && { vehicleId }),
    },
    orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
    include: { vehicle: { select: { plateNumber: true, make: true, model: true } } },
  });

  return NextResponse.json(records);
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
  const type = typeof body.type === "string" ? body.type : "";
  const description = typeof body.description === "string" ? body.description : "";
  const scheduledAt = body.scheduledAt ? new Date(String(body.scheduledAt)) : null;

  if (!vehicleId || !type || !description || !scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { error: "validation_failed", detail: "vehicleId, type, description, scheduledAt are required" },
      { status: 400 },
    );
  }

  const record = await prisma.maintenance.create({
    data: {
      vehicleId,
      type,
      description,
      priority: typeof body.priority === "string" ? body.priority : "NORMAL",
      status: "SCHEDULED",
      scheduledAt,
      cost: body.cost !== undefined ? parseFloat(String(body.cost)) : null,
      technicianName: typeof body.technicianName === "string" ? body.technicianName : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
    include: { vehicle: { select: { plateNumber: true } } },
  });

  await writeAudit({
    action: "maintenance.create",
    target: `vehicle:${vehicleId}`,
    meta: { type, priority: record.priority },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });

  return NextResponse.json(record, { status: 201 });
}
