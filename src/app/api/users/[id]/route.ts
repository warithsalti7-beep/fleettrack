/**
 * PATCH /api/users/:id   — update role/name/password (admin only).
 * DELETE /api/users/:id  — hard-delete user (admin only; can't delete self).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-guard";
import { hashPassword, passwordStrengthError } from "@/lib/passwords";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (typeof body.role === "string") {
    if (!["admin", "employee", "driver"].includes(body.role)) {
      return NextResponse.json({ error: "validation_failed", detail: "invalid role" }, { status: 400 });
    }
    data.role = body.role;
  }
  if (typeof body.password === "string" && body.password) {
    const err = passwordStrengthError(body.password);
    if (err) return NextResponse.json({ error: "validation_failed", detail: err }, { status: 400 });
    data.passwordHash = await hashPassword(body.password);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, updatedAt: true },
  });

  await writeAudit({
    action: "user.update",
    target: `user:${id}`,
    meta: { fields: Object.keys(data) },
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });

  return NextResponse.json(user);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  if (id === gate.session.userId) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 409 });
  }

  await prisma.user.delete({ where: { id } });
  await writeAudit({
    action: "user.delete",
    target: `user:${id}`,
    actor: { userId: gate.session.userId, email: gate.session.email },
    ip: clientIp(request),
  });
  return new NextResponse(null, { status: 204 });
}
