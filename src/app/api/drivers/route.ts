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

  // Drivers see only themselves; staff see all.
  const baseWhere = gate.session.role === "driver"
    ? { email: gate.session.email }
    : (status ? { status } : undefined);

  const drivers = await prisma.driver.findMany({
    where: baseWhere,
    orderBy: { createdAt: "desc" },
    include: {
      vehicles: { include: { vehicle: { select: { plateNumber: true, make: true, model: true } } }, take: 1 },
      _count: { select: { trips: true } },
    },
  });

  return NextResponse.json(drivers);
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const licenseNumber = typeof body.licenseNumber === "string" ? body.licenseNumber.trim() : "";
  const licenseExpiry = body.licenseExpiry ? new Date(String(body.licenseExpiry)) : null;

  if (!name || !email || !licenseNumber || !licenseExpiry || Number.isNaN(licenseExpiry.getTime())) {
    return NextResponse.json(
      { error: "validation_failed", detail: "name, email, licenseNumber and a valid licenseExpiry are required" },
      { status: 400 },
    );
  }

  const driver = await prisma.driver.create({
    data: {
      name,
      email,
      phone: typeof body.phone === "string" ? body.phone : "",
      licenseNumber,
      licenseExpiry,
      status: typeof body.status === "string" ? body.status : "AVAILABLE",
      address: typeof body.address === "string" ? body.address : null,
    },
  });

  await writeAudit({
    action: "driver.create",
    target: `driver:${driver.id}`,
    meta: { email: driver.email },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });

  return NextResponse.json(driver, { status: 201 });
}
