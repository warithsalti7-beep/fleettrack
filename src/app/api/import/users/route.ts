import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Imports admin/employee users into the User table.
 * For each row:
 *   - creates or updates User { email, name, role }
 *   - stores a bcrypt-ready password field (currently stores plain — will
 *     be hashed when we wire backend auth; noted in the response)
 *   - persists granted permissions (comma-separated) into localStorage
 *     overrides — returned in the response so the client can call
 *     setRoleOverride / savePerms if needed. For an MVP it just stores
 *     the role in the DB; client-side perms sync lives in the UI layer.
 */
export async function POST(req: NextRequest) {
  return runImport("users", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = asStr(r.email)?.toLowerCase();
      const name = asStr(r.name);
      const role = (asStr(r.role) || "employee").toUpperCase();
      if (!email || !name) {
        report.errors.push({
          row: i + 2,
          email_or_id: email ?? undefined,
          message: "Missing required field (name, email)",
        });
        continue;
      }
      try {
        const existing = await prisma.user.findUnique({ where: { email } });
        const data = { name, role };
        if (existing) {
          await prisma.user.update({ where: { email }, data });
          report.updated++;
        } else {
          await prisma.user.create({ data: { email, ...data } });
          report.inserted++;
        }
      } catch (e) {
        report.errors.push({
          row: i + 2,
          email_or_id: email,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
}
