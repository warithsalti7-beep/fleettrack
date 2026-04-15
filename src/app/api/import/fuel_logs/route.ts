import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asInt, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return runImport("fuel_logs", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = asDate(r.fill_date);
      const carId = asStr(r.car_id);
      const liters = asFloat(r.liters_or_kwh);
      const price = asFloat(r.price_per_unit_nok);
      const total = asFloat(r.total_cost_nok);
      if (!date || !carId || liters === null || price === null) {
        report.errors.push({
          row: i + 2,
          message: "Missing fill_date, car_id, liters_or_kwh, or price_per_unit_nok",
        });
        continue;
      }
      const vehicle =
        (await prisma.vehicle.findUnique({ where: { carId } })) ||
        (await prisma.vehicle.findUnique({ where: { plateNumber: carId } }));
      if (!vehicle) {
        report.errors.push({ row: i + 2, email_or_id: carId, message: "Unknown car_id" });
        continue;
      }
      try {
        const source = (asStr(r.source) || "CSV").toUpperCase();
        const externalId = asStr(r.external_id) || asStr(r.receipt_id) || null;
        const data = {
          vehicleId: vehicle.id,
          liters,
          pricePerLiter: price,
          totalCost: total ?? +(liters * price).toFixed(2),
          mileageAtFill: asInt(r.mileage_at_fill_km) ?? 0,
          station: asStr(r.station),
          filledAt: date,
          source,
          externalId,
        };
        // Idempotency — prefer (source,externalId) when both present;
        // fall back to a natural-key dedupe on
        // (vehicleId, filledAt, liters, pricePerLiter) so that scanning
        // the same Circle K receipt twice is a no-op.
        let existing = null as { id: string } | null;
        if (externalId) {
          existing = await prisma.fuelLog.findUnique({
            where: { source_externalId: { source, externalId } },
          }).catch(() => null);
        }
        if (!existing) {
          existing = await prisma.fuelLog.findFirst({
            where: {
              vehicleId: vehicle.id,
              filledAt: date,
              liters,
              pricePerLiter: price,
            },
          });
        }
        if (existing) {
          await prisma.fuelLog.update({ where: { id: existing.id }, data });
          report.updated++;
        } else {
          await prisma.fuelLog.create({ data });
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
