import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr } from "@/lib/csv";
import { runImport } from "@/lib/import";
import { hashPassword, passwordStrengthError } from "@/lib/passwords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Imports login accounts (User table) from a CSV.
 *
 * Expected columns: email, name, role, password (plain; hashed on insert).
 * - role defaults to "employee" when blank; must be admin | employee | driver.
 * - password is required for new rows. For existing rows, password is only
 *   updated if a non-empty value is supplied.
 * - permissions column (comma-separated list) is accepted but ignored for
 *   now; permission overrides still live in the client-side access UI.
 */
export async function POST(req: NextRequest) {
  return runImport("users", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = asStr(r.email)?.toLowerCase();
      const name = asStr(r.name);
      const roleRaw = asStr(r.role) || "employee";
      const role = roleRaw.toLowerCase();
      const password = asStr(r.password) || "";

      if (!email || !name) {
        report.errors.push({
          row: i + 2,
          email_or_id: email ?? undefined,
          message: "Missing required field (name, email)",
        });
        continue;
      }
      if (!["admin", "employee", "driver"].includes(role)) {
        report.errors.push({
          row: i + 2,
          email_or_id: email,
          message: `Invalid role "${roleRaw}". Allowed: admin | employee | driver`,
        });
        continue;
      }

      try {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          // Only hash + swap the password when the CSV supplies a fresh one.
          let passwordHash: string | undefined;
          if (password) {
            const pwErr = passwordStrengthError(password);
            if (pwErr) {
              report.errors.push({ row: i + 2, email_or_id: email, message: pwErr });
              continue;
            }
            passwordHash = await hashPassword(password);
          }
          await prisma.user.update({
            where: { email },
            data: { name, role, ...(passwordHash ? { passwordHash } : {}) },
          });
          report.updated++;
        } else {
          if (!password) {
            report.errors.push({
              row: i + 2,
              email_or_id: email,
              message: "New user rows require a password column",
            });
            continue;
          }
          const pwErr = passwordStrengthError(password);
          if (pwErr) {
            report.errors.push({ row: i + 2, email_or_id: email, message: pwErr });
            continue;
          }
          const passwordHash = await hashPassword(password);
          await prisma.user.create({ data: { email, name, role, passwordHash } });
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
