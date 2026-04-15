import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const driver = await prisma.driver.findUnique({
    where: { id },
    include: {
      trips: { orderBy: { createdAt: "desc" }, take: 20 },
      vehicles: { include: { vehicle: true } },
    },
  });
  if (!driver) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Drivers can only read their own record.
  if (gate.session.role === "driver" && driver.email !== gate.session.email) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(driver);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const driver = await prisma.driver.update({
    where: { id },
    data: {
      ...(typeof body.status === "string" && { status: body.status }),
      ...(body.rating !== undefined && { rating: parseFloat(String(body.rating)) }),
      ...(body.totalTrips !== undefined && { totalTrips: parseInt(String(body.totalTrips), 10) }),
    },
  });
  await writeAudit({
    action: "driver.update",
    target: `driver:${id}`,
    meta: body,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return NextResponse.json(driver);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  await prisma.driver.delete({ where: { id } });
  await writeAudit({
    action: "driver.delete",
    target: `driver:${id}`,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return new NextResponse(null, { status: 204 });
}
