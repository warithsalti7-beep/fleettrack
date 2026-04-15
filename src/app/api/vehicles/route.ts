/**
 * GET  /api/vehicles — list; status filter
 * POST /api/vehicles — create (staff only)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireStaff } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";
import {
  conflict,
  isPrismaUniqueViolation,
  readJson,
  serverError,
  validationFailed,
} from "@/lib/http";
import { FieldError, optDate, optEnum, optNum, optStr, reqStr } from "@/lib/validation";

export const runtime = "nodejs";

const VEHICLE_STATUSES = ["AVAILABLE", "ON_TRIP", "MAINTENANCE", "OUT_OF_SERVICE"] as const;
const FUEL_TYPES = ["PETROL", "DIESEL", "ELECTRIC", "HYBRID"] as const;

export async function GET(request: NextRequest) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const vehicles = await prisma.vehicle.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      drivers: { include: { driver: { select: { id: true, name: true } } }, take: 1 },
      _count: { select: { trips: true } },
    },
  });

  return NextResponse.json(vehicles);
}

export async function POST(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  type CreateData = {
    plateNumber: string; make: string; model: string; year: number; color: string;
    status: string; fuelType: string; fuelLevel: number; mileage: number;
    carId: string | null; lastService: Date | null; nextService: Date | null;
    purchaseDate: Date | null; purchasePriceNok: number | null;
    leaseMonthlyNok: number | null; insuranceMonthlyNok: number | null;
  };

  let data: CreateData;
  try {
    const year = optNum(body, "year", { int: true, min: 1980, max: 2100 });
    if (year === undefined || year === null) {
      throw new FieldError("year", "required", "year is required");
    }
    data = {
      plateNumber:         reqStr(body, "plateNumber", { min: 1, max: 30 }),
      make:                reqStr(body, "make", { max: 50 }),
      model:               reqStr(body, "model", { max: 50 }),
      year,
      color:               optStr(body, "color", { max: 40 }) ?? "",
      status:              optEnum(body, "status", VEHICLE_STATUSES) ?? "AVAILABLE",
      fuelType:            optEnum(body, "fuelType", FUEL_TYPES) ?? "PETROL",
      fuelLevel:           optNum(body, "fuelLevel", { min: 0, max: 100 }) ?? 100,
      mileage:             optNum(body, "mileage", { int: true, min: 0 }) ?? 0,
      carId:               optStr(body, "carId", { max: 30 }) ?? null,
      lastService:         optDate(body, "lastService") ?? null,
      nextService:         optDate(body, "nextService") ?? null,
      purchaseDate:        optDate(body, "purchaseDate") ?? null,
      purchasePriceNok:    optNum(body, "purchasePriceNok", { int: true, min: 0 }) ?? null,
      leaseMonthlyNok:     optNum(body, "leaseMonthlyNok", { int: true, min: 0 }) ?? null,
      insuranceMonthlyNok: optNum(body, "insuranceMonthlyNok", { int: true, min: 0 }) ?? null,
    };
  } catch (err) {
    if (err instanceof FieldError) return validationFailed({ [err.field]: err.message });
    throw err;
  }

  try {
    const vehicle = await prisma.vehicle.create({ data });
    await writeAudit({
      action: "vehicle.create",
      target: `vehicle:${vehicle.id}`,
      meta: { plateNumber: vehicle.plateNumber },
      actor: { userId: gate.session.userId, email: gate.session.email },
      ip: clientIp(request),
    });
    return NextResponse.json(vehicle, { status: 201 });
  } catch (err) {
    const dup = isPrismaUniqueViolation(err);
    if (dup) return conflict(`Another vehicle already uses that ${dup}`);
    return serverError(err instanceof Error ? err.message : undefined);
  }
}
