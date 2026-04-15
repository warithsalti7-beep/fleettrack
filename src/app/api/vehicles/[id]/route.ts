/**
 * GET    /api/vehicles/:id — read with trips + maintenance + fuel + drivers
 * PATCH  /api/vehicles/:id — partial update, all editable columns supported
 * DELETE /api/vehicles/:id — admin only
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
  optEnum,
  optNum,
  optStr,
} from "@/lib/validation";

export const runtime = "nodejs";

const VEHICLE_STATUSES = ["AVAILABLE", "ON_TRIP", "MAINTENANCE", "OUT_OF_SERVICE"] as const;
const FUEL_TYPES = ["PETROL", "DIESEL", "ELECTRIC", "HYBRID"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;
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
  if (!vehicle) return notFound("Vehicle not found");

  if (gate.session.role === "driver") {
    const allowed = vehicle.drivers.some((dv) => dv.driver.email === gate.session.email);
    if (!allowed) return forbidden("Drivers may only read vehicles they are assigned to");
  }
  return NextResponse.json(vehicle);
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
      carId:               optStr(body, "carId", { max: 30 }),
      plateNumber:         optStr(body, "plateNumber", { min: 1, max: 30 }),
      make:                optStr(body, "make", { max: 50 }),
      model:               optStr(body, "model", { max: 50 }),
      year:                optNum(body, "year", { int: true, min: 1980, max: 2100 }),
      color:               optStr(body, "color", { max: 40 }),
      status:              optEnum(body, "status", VEHICLE_STATUSES),
      fuelType:            optEnum(body, "fuelType", FUEL_TYPES),
      fuelLevel:           optNum(body, "fuelLevel", { min: 0, max: 100 }),
      mileage:             optNum(body, "mileage", { int: true, min: 0 }),
      purchaseDate:        optDate(body, "purchaseDate"),
      purchasePriceNok:    optNum(body, "purchasePriceNok", { int: true, min: 0 }),
      leaseMonthlyNok:     optNum(body, "leaseMonthlyNok", { int: true, min: 0 }),
      insuranceMonthlyNok: optNum(body, "insuranceMonthlyNok", { int: true, min: 0 }),
      lastService:         optDate(body, "lastService"),
      nextService:         optDate(body, "nextService"),
      latitude:            optNum(body, "latitude",  { min: -90,  max: 90 }),
      longitude:           optNum(body, "longitude", { min: -180, max: 180 }),
    });
  } catch (err) {
    if (err instanceof FieldError) return validationFailed({ [err.field]: err.message });
    throw err;
  }

  if (Object.keys(data).length === 0) return badRequest("No editable fields supplied");

  try {
    const vehicle = await prisma.vehicle.update({ where: { id }, data });
    await writeAudit({
      action: "vehicle.update",
      target: `vehicle:${id}`,
      meta: { fields: Object.keys(data) },
      actor: { userId: gate.session.userId, email: gate.session.email },
      ip: clientIp(request),
    });
    return NextResponse.json(vehicle);
  } catch (err) {
    const dup = isPrismaUniqueViolation(err);
    if (dup) return conflict(`Another vehicle already uses that ${dup}`);
    if ((err as { code?: string }).code === "P2025") return notFound("Vehicle not found");
    return serverError(err instanceof Error ? err.message : undefined);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  try {
    await prisma.vehicle.delete({ where: { id } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return notFound("Vehicle not found");
    throw err;
  }
  await writeAudit({
    action: "vehicle.delete",
    target: `vehicle:${id}`,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return new NextResponse(null, { status: 204 });
}
