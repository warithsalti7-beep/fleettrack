import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return runImport("drivers", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = asStr(r.email)?.toLowerCase();
      const name = asStr(r.name);
      const licenseNumber = asStr(r.license_number);
      const licenseExpiry = asDate(r.license_expiry);
      const phone = asStr(r.phone) || "";
      if (!email || !name || !licenseNumber || !licenseExpiry) {
        report.errors.push({
          row: i + 2,
          email_or_id: email ?? undefined,
          message: "Missing required field (name, email, license_number, license_expiry)",
        });
        continue;
      }
      const data = {
        name,
        email,
        phone,
        licenseNumber,
        licenseExpiry,
        status: asStr(r.status)?.toUpperCase() || "AVAILABLE",
        address: asStr(r.address) || null,
      };
      try {
        const existing = await prisma.driver.findUnique({ where: { email } });
        if (existing) {
          await prisma.driver.update({ where: { email }, data });
          report.updated++;
        } else {
          await prisma.driver.create({ data });
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
