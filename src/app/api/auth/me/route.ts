/**
 * GET /api/auth/me — returns the current session payload + fresh
 * permissions from the User record. Permissions are not cached in the
 * signed cookie so an admin-triggered permission change takes effect
 * on the next page load without requiring the user to sign out.
 *
 * 200 { user: { id, email, role, name, permissions } }
 * 401 (handled by proxy before this is reached; guarded here anyway)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLE_DEFAULT_PERMS: Record<string, string[]> = {
  admin: ["all"],
  employee: [],
  driver: [],
};

export async function GET(req: NextRequest) {
  const gate = await requireSession(req);
  if (!gate.ok) return gate.response;
  const s = gate.session;

  const user = await prisma.user
    .findUnique({
      where: { id: s.userId },
      select: { id: true, email: true, name: true, role: true, permissions: true },
    })
    .catch(() => null);

  if (!user) {
    // Session cookie points to a user that no longer exists — treat as
    // signed out so the client clears its mirror and redirects.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const permissions = Array.isArray(user.permissions)
    ? (user.permissions as string[])
    : (ROLE_DEFAULT_PERMS[user.role] ?? []);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name ?? null,
      permissions,
    },
  });
}
