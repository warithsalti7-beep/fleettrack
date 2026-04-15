/**
 * POST /api/auth/bootstrap — idempotent creation of the three default
 * login accounts (admin / employee / driver). SEED_TOKEN-gated; safe to
 * call against an existing database because it upserts by email.
 *
 * Headers: X-Admin-Token: $SEED_TOKEN (or ?token=... in URL).
 * Body:    optional { admin: {email,password,name}, employee: {...}, driver: {...} }
 *          Any missing block falls back to built-in defaults that are
 *          ONLY safe for initial bootstrap — change them immediately.
 *
 * Deliberately does NOT seed any fleet data. Use CSV imports for that.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordStrengthError } from "@/lib/passwords";
import { writeAudit } from "@/lib/audit-log";
import { clientIp } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Seed = { email: string; password: string; name: string; role: "admin" | "employee" | "driver" };

const DEFAULT_SEEDS: Seed[] = [
  { role: "admin",    email: "admin@fleettrack.no",    password: "Admin2024!",    name: "Fleet Admin" },
  { role: "employee", email: "employee@fleettrack.no", password: "Employee2024!", name: "Dispatch Officer" },
  { role: "driver",   email: "driver@fleettrack.no",   password: "Driver2024!",   name: "Demo Driver" },
];

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  let overrides: Partial<Record<Seed["role"], Partial<Seed>>> = {};
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object") overrides = body;
  } catch {
    /* no body — use defaults */
  }

  const results: Array<{ email: string; role: string; action: "created" | "updated" }> = [];

  for (const base of DEFAULT_SEEDS) {
    const o = overrides[base.role] || {};
    const seed: Seed = {
      role: base.role,
      email: (o.email || base.email).trim().toLowerCase(),
      password: o.password || base.password,
      name: o.name || base.name,
    };

    const pwErr = passwordStrengthError(seed.password);
    if (pwErr) {
      return NextResponse.json({ error: `invalid_password_${seed.role}`, detail: pwErr }, { status: 400 });
    }

    const passwordHash = await hashPassword(seed.password);
    const existing = await prisma.user.findUnique({ where: { email: seed.email } });

    if (existing) {
      await prisma.user.update({
        where: { email: seed.email },
        data: { passwordHash, name: seed.name, role: seed.role },
      });
      results.push({ email: seed.email, role: seed.role, action: "updated" });
    } else {
      await prisma.user.create({
        data: {
          email: seed.email,
          passwordHash,
          name: seed.name,
          role: seed.role,
        },
      });
      results.push({ email: seed.email, role: seed.role, action: "created" });
    }
  }

  await writeAudit({
    action: "auth.bootstrap",
    meta: { count: results.length, actions: results.map((r) => r.action) },
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true, users: results });
}
