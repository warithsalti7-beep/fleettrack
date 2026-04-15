/**
 * GET    /api/drivers/:id — read with trips + vehicles (drivers limited to own)
 * PATCH  /api/drivers/:id — partial update; all editable columns supported
 * DELETE /api/drivers/:id — admin only
 *
 * Accepted PATCH fields: name, email, phone, licenseNumber, licenseExpiry,
 * status, rating, totalTrips, address, photoUrl.
 * Unique-constraint violations (email, licenseNumber) return 409.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";
import {
  badRequest,
  conflict,
  forbidden,
  isPrismaUniqueViolation,
  notFound,
  readJson,
  serverError,
  validationFailed,
} from "@/lib/http";
import {
  FieldError,
  buildPatch,
  optDate,
  optEmail,
  optEnum,
  optNum,
  optStr,
} from "@/lib/validation";

export const runtime = "nodejs";

const DRIVER_STATUSES = ["AVAILABLE", "ON_TRIP", "OFF_DUTY", "MAINTENANCE"] as const;

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
  if (!driver) return notFound("Driver not found");
  if (gate.session.role === "driver" && driver.email !== gate.session.email) {
    return forbidden("Drivers may only read their own record");
  }
  return NextResponse.json(driver);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  let data: Record<string, unknown>;
  try {
    data = buildPatch({
      name:          optStr(body, "name", { min: 1, max: 200 }),
      email:         optEmail(body, "email"),
      phone:         optStr(body, "phone", { max: 40 }),
      licenseNumber: optStr(body, "licenseNumber", { min: 1, max: 50 }),
      licenseExpiry: optDate(body, "licenseExpiry"),
      status:        optEnum(body, "status", DRIVER_STATUSES),
      rating:        optNum(body, "rating", { min: 0, max: 5 }),
      totalTrips:    optNum(body, "totalTrips", { int: true, min: 0 }),
      address:       optStr(body, "address", { max: 500 }),
      photoUrl:      optStr(body, "photoUrl", { max: 500 }),
    });
  } catch (err) {
    if (err instanceof FieldError) return validationFailed({ [err.field]: err.message });
    throw err;
  }

  if (Object.keys(data).length === 0) return badRequest("No editable fields supplied");

  try {
    const driver = await prisma.driver.update({ where: { id }, data });
    await writeAudit({
      action: "driver.update",
      target: `driver:${id}`,
      meta: { fields: Object.keys(data) },
      actor: { userId: gate.session.userId, email: gate.session.email },
      ip: clientIp(request),
    });
    return NextResponse.json(driver);
  } catch (err) {
    const dup = isPrismaUniqueViolation(err);
    if (dup) return conflict(`Another driver already uses that ${dup}`);
    if ((err as { code?: string }).code === "P2025") return notFound("Driver not found");
    return serverError(err instanceof Error ? err.message : undefined);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  try {
    await prisma.driver.delete({ where: { id } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return notFound("Driver not found");
    throw err;
  }
  await writeAudit({
    action: "driver.delete",
    target: `driver:${id}`,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return new NextResponse(null, { status: 204 });
}
