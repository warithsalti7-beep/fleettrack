import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CATEGORIES = new Set([
  "LEASE", "INSURANCE", "FINANCING", "PARKING", "WASH", "LOYVE",
  "TAXIMETER", "REGISTRATION", "DEPRECIATION", "OFFICE", "SOFTWARE",
  "SALARY", "EMPLOYER_NI", "ACCOUNTING", "OTHER",
]);
const VALID_FREQ = new Set(["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"]);

export async function POST(req: NextRequest) {
  return runImport("fixed_costs", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const category = (asStr(r.category) || "OTHER").toUpperCase();
      const description = asStr(r.description);
      const amount = asFloat(r.amount_nok);
      const startDate = asDate(r.start_date);
      const endDate = asDate(r.end_date);
      const frequency = (asStr(r.frequency) || "MONTHLY").toUpperCase();
      const carId = asStr(r.car_id);

      if (!description || amount === null || !startDate) {
        report.errors.push({
          row: i + 2,
          message: "Missing description, amount_nok, or start_date",
        });
        continue;
      }
      if (!VALID_CATEGORIES.has(category)) {
        report.errors.push({
          row: i + 2,
          message: `Unknown category '${category}' — must be one of ${[...VALID_CATEGORIES].join(", ")}`,
        });
        continue;
      }
      if (!VALID_FREQ.has(frequency)) {
        report.errors.push({
          row: i + 2,
          message: `Unknown frequency '${frequency}' — must be ONCE/MONTHLY/QUARTERLY/YEARLY`,
        });
        continue;
      }

      let vehicleId: string | null = null;
      if (carId) {
        const v =
          (await prisma.vehicle.findUnique({ where: { carId } })) ||
          (await prisma.vehicle.findUnique({ where: { plateNumber: carId } }));
        if (!v) {
          report.errors.push({
            row: i + 2,
            email_or_id: carId,
            message: "Unknown car_id (leave blank for fleet-wide cost)",
          });
          continue;
        }
        vehicleId = v.id;
      }

      try {
        const data = {
          vehicleId,
          category,
          description,
          amountNok: amount,
          frequency,
          startDate,
          endDate,
          vendor: asStr(r.vendor),
          notes: asStr(r.notes),
        };
        // Natural key: the same recurring cost should map to the same
        // row each time — (vehicleId, category, description, startDate).
        // A vehicleId NULL-safe match is required because fleet-wide
        // rows (vehicleId = null) must still dedupe.
        const existing = await prisma.fixedCost.findFirst({
          where: { vehicleId, category, description, startDate },
        });
        if (existing) {
          await prisma.fixedCost.update({ where: { id: existing.id }, data });
          report.updated++;
        } else {
          await prisma.fixedCost.create({ data });
          report.inserted++;
        }
      } catch (e) {
        report.errors.push({
          row: i + 2,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
}
