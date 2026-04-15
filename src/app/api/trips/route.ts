/**
 * GET  /api/trips — list; drivers see only their own; supports status,
 *                   driverId, vehicleId filters and a bounded limit.
 * POST /api/trips — create (staff only); validates full payload.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";
import {
  notFound,
  readJson,
  serverError,
  validationFailed,
} from "@/lib/http";
import { FieldError, optEnum, optNum, optStr, reqStr } from "@/lib/validation";

export const runtime = "nodejs";

const TRIP_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const PAYMENT_METHODS = ["CASH", "CARD", "MOBILE"] as const;

export async function GET(request: NextRequest) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const driverIdParam = searchParams.get("driverId");
  const vehicleId = searchParams.get("vehicleId");
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));

  let driverFilter: string | undefined = driverIdParam ?? undefined;
  if (gate.session.role === "driver") {
    const me = await prisma.driver.findUnique({ where: { email: gate.session.email }, select: { id: true } });
    if (!me) return NextResponse.json([]);
    driverFilter = me.id;
  }

  const trips = await prisma.trip.findMany({
    where: {
      ...(status && { status }),
      ...(driverFilter && { driverId: driverFilter }),
      ...(vehicleId && { vehicleId }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      driver: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, plateNumber: true, make: true, model: true } },
    },
  });

  return NextResponse.json(trips);
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  type CreateData = {
    driverId: string; vehicleId: string;
    pickupAddress: string; dropoffAddress: string;
    pickupLat: number | null; pickupLng: number | null;
    dropoffLat: number | null; dropoffLng: number | null;
    paymentMethod: string; status: string;
    notes: string | null;
  };

  let data: CreateData;
  try {
    data = {
      driverId:       reqStr(body, "driverId", { min: 1, max: 50 }),
      vehicleId:      reqStr(body, "vehicleId", { min: 1, max: 50 }),
      pickupAddress:  reqStr(body, "pickupAddress", { min: 1, max: 500 }),
      dropoffAddress: reqStr(body, "dropoffAddress", { min: 1, max: 500 }),
      pickupLat:      optNum(body, "pickupLat",  { min: -90,  max: 90 })  ?? null,
      pickupLng:      optNum(body, "pickupLng",  { min: -180, max: 180 }) ?? null,
      dropoffLat:     optNum(body, "dropoffLat", { min: -90,  max: 90 })  ?? null,
      dropoffLng:     optNum(body, "dropoffLng", { min: -180, max: 180 }) ?? null,
      paymentMethod:  optEnum(body, "paymentMethod", PAYMENT_METHODS) ?? "CASH",
      status:         optEnum(body, "status", TRIP_STATUSES) ?? "PENDING",
      notes:          optStr(body, "notes", { max: 2000 }) ?? null,
    };
  } catch (err) {
    if (err instanceof FieldError) return validationFailed({ [err.field]: err.message });
    throw err;
  }

  // Referential sanity: make sure the driver + vehicle exist before
  // we create the trip; Prisma would 500 on FK failure otherwise.
  const [driver, vehicle] = await Promise.all([
    prisma.driver.findUnique({ where: { id: data.driverId }, select: { id: true } }),
    prisma.vehicle.findUnique({ where: { id: data.vehicleId }, select: { id: true } }),
  ]);
  if (!driver) return notFound("Driver not found");
  if (!vehicle) return notFound("Vehicle not found");

  try {
    const trip = await prisma.trip.create({
      data,
      include: {
        driver: { select: { name: true } },
        vehicle: { select: { plateNumber: true } },
      },
    });

    await Promise.all([
      prisma.driver.update({ where: { id: data.driverId }, data: { status: "ON_TRIP" } }),
      prisma.vehicle.update({ where: { id: data.vehicleId }, data: { status: "ON_TRIP" } }),
    ]);

    await writeAudit({
      action: "trip.create",
      target: `trip:${trip.id}`,
      meta: { driverId: data.driverId, vehicleId: data.vehicleId },
      actor: { userId: gate.session.userId, email: gate.session.email },
      ip: clientIp(request),
    });
    return NextResponse.json(trip, { status: 201 });
  } catch (err) {
    return serverError(err instanceof Error ? err.message : undefined);
  }
}
