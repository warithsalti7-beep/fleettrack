/**
 * GET    /api/trips/:id — read with driver + vehicle (drivers limited to own)
 * PATCH  /api/trips/:id — partial update (all editable columns)
 * DELETE /api/trips/:id — admin only; rare, guarded
 *
 * Side effects: when PATCH transitions status to COMPLETED or CANCELLED,
 * we auto-release the driver + vehicle to AVAILABLE and bump the driver's
 * totalTrips on COMPLETED.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";
import {
  badRequest,
  forbidden,
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

const TRIP_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const PAYMENT_METHODS = ["CASH", "CARD", "MOBILE"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: { driver: true, vehicle: true },
  });
  if (!trip) return notFound("Trip not found");

  if (gate.session.role === "driver" && trip.driver.email !== gate.session.email) {
    return forbidden("Drivers may only read their own trips");
  }
  return NextResponse.json(trip);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const current = await prisma.trip.findUnique({ where: { id } });
  if (!current) return notFound("Trip not found");

  let data: Record<string, unknown>;
  let targetStatus: string | null | undefined;
  try {
    targetStatus = optEnum(body, "status", TRIP_STATUSES);
    data = buildPatch({
      status:         targetStatus,
      pickupAddress:  optStr(body, "pickupAddress", { max: 500 }),
      dropoffAddress: optStr(body, "dropoffAddress", { max: 500 }),
      pickupLat:      optNum(body, "pickupLat",  { min: -90,  max: 90 }),
      pickupLng:      optNum(body, "pickupLng",  { min: -180, max: 180 }),
      dropoffLat:     optNum(body, "dropoffLat", { min: -90,  max: 90 }),
      dropoffLng:     optNum(body, "dropoffLng", { min: -180, max: 180 }),
      distance:       optNum(body, "distance", { min: 0 }),
      duration:       optNum(body, "duration", { int: true, min: 0 }),
      fare:           optNum(body, "fare", { min: 0 }),
      rating:         optNum(body, "rating", { min: 0, max: 5 }),
      paymentMethod:  optEnum(body, "paymentMethod", PAYMENT_METHODS),
      notes:          optStr(body, "notes", { max: 2000 }),
    });
    // Lifecycle timestamps — set automatically when transitioning status.
    const now = new Date();
    if (targetStatus === "IN_PROGRESS" && !current.startedAt) data.startedAt = now;
    if ((targetStatus === "COMPLETED" || targetStatus === "CANCELLED") && !current.completedAt) data.completedAt = now;
  } catch (err) {
    if (err instanceof FieldError) return validationFailed({ [err.field]: err.message });
    throw err;
  }

  if (Object.keys(data).length === 0) return badRequest("No editable fields supplied");

  try {
    const updated = await prisma.trip.update({ where: { id }, data });

    // Side effects on terminal transitions.
    if (targetStatus === "COMPLETED" || targetStatus === "CANCELLED") {
      await Promise.all([
        prisma.driver.update({
          where: { id: current.driverId },
          data: {
            status: "AVAILABLE",
            totalTrips: targetStatus === "COMPLETED" ? { increment: 1 } : undefined,
          },
        }),
        prisma.vehicle.update({ where: { id: current.vehicleId }, data: { status: "AVAILABLE" } }),
      ]);
    }

    await writeAudit({
      action: "trip.update",
      target: `trip:${id}`,
      meta: { fields: Object.keys(data), status: targetStatus ?? null },
      actor: { userId: gate.session.userId, email: gate.session.email },
      ip: clientIp(request),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return notFound("Trip not found");
    return serverError(err instanceof Error ? err.message : undefined);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  try {
    await prisma.trip.delete({ where: { id } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return notFound("Trip not found");
    throw err;
  }
  await writeAudit({
    action: "trip.delete",
    target: `trip:${id}`,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return new NextResponse(null, { status: 204 });
}
