/**
 * GET  /api/drivers   — list, status filter, drivers see only themselves
 * POST /api/drivers   — create (staff only); full input validation
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
import {
  FieldError,
  optEnum,
  optStr,
  reqEmail,
  reqStr,
  optDate,
} from "@/lib/validation";

export const runtime = "nodejs";

const DRIVER_STATUSES = ["AVAILABLE", "ON_TRIP", "OFF_DUTY", "MAINTENANCE"] as const;

export async function GET(request: NextRequest) {
  const gate = await requireSession(request);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const where =
    gate.session.role === "driver"
      ? { email: gate.session.email }
      : status
        ? { status }
        : undefined;

  const drivers = await prisma.driver.findMany({
    where,
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

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  type CreateData = {
    name: string;
    email: string;
    phone: string;
    licenseNumber: string;
    licenseExpiry: Date;
    status: string;
    address: string | null;
    photoUrl: string | null;
  };

  let data: CreateData;
  try {
    const licenseExpiry = optDate(body, "licenseExpiry");
    if (!licenseExpiry) throw new FieldError("licenseExpiry", "required", "licenseExpiry is required");
    data = {
      name:          reqStr(body, "name", { min: 1, max: 200 }),
      email:         reqEmail(body, "email"),
      phone:         optStr(body, "phone", { max: 40 }) ?? "",
      licenseNumber: reqStr(body, "licenseNumber", { min: 1, max: 50 }),
      licenseExpiry,
      status:        optEnum(body, "status", DRIVER_STATUSES) ?? "AVAILABLE",
      address:       optStr(body, "address", { max: 500 }) ?? null,
      photoUrl:      optStr(body, "photoUrl", { max: 500 }) ?? null,
    };
  } catch (err) {
    if (err instanceof FieldError) return validationFailed({ [err.field]: err.message });
    throw err;
  }

  try {
    const driver = await prisma.driver.create({ data });
    await writeAudit({
      action: "driver.create",
      target: `driver:${driver.id}`,
      meta: { email: driver.email },
      actor: { userId: gate.session.userId, email: gate.session.email },
      ip: clientIp(request),
    });
    return NextResponse.json(driver, { status: 201 });
  } catch (err) {
    const dup = isPrismaUniqueViolation(err);
    if (dup) return conflict(`Another driver already uses that ${dup}`);
    return serverError(err instanceof Error ? err.message : undefined);
  }
}
