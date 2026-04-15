/**
 * GET /api/users           — list all users (admin only). Passwords are
 *                            never returned; the hash is filtered out.
 * POST /api/users          — create a new user with a hashed password.
 *
 * Note: this is the server-backed replacement for the old
 * localStorage `addCustomUser` / `getAllUsers` helpers in auth.js.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-guard";
import { hashPassword, passwordStrengthError } from "@/lib/passwords";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");

  const users = await prisma.user.findMany({
    where: role ? { role } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      permissions: true,
      driverId: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      // passwordHash deliberately excluded
    },
  });

  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = typeof body.role === "string" ? body.role : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "validation_failed", detail: "valid email required" }, { status: 400 });
  }
  if (!["admin", "employee", "driver"].includes(role)) {
    return NextResponse.json({ error: "validation_failed", detail: "role must be admin | employee | driver" }, { status: 400 });
  }
  const pwErr = passwordStrengthError(password);
  if (pwErr) return NextResponse.json({ error: "validation_failed", detail: pwErr }, { status: 400 });

  let permissions: string[] | null = null;
  if (body.permissions !== undefined && body.permissions !== null) {
    if (Array.isArray(body.permissions) && body.permissions.every((p) => typeof p === "string")) {
      permissions = body.permissions as string[];
    } else {
      return NextResponse.json(
        { error: "validation_failed", detail: "permissions must be an array of strings" },
        { status: 400 },
      );
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "conflict", detail: "email already in use" }, { status: 409 });

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      passwordHash: await hashPassword(password),
      ...(permissions ? { permissions } : {}),
    },
    select: { id: true, email: true, name: true, role: true, permissions: true, createdAt: true },
  });

  await writeAudit({
    action: "user.create",
    target: `user:${user.id}`,
    meta: { role },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });

  return NextResponse.json(user, { status: 201 });
}
