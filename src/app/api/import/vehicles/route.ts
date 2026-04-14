import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asInt, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return runImport("vehicles", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const carId = asStr(r.car_id);
      const plateNumber = asStr(r.plate_number) || carId;
      const make = asStr(r.make) || "";
      const model = asStr(r.model);
      const year = asInt(r.year);
      const color = asStr(r.color) || "";
      if (!plateNumber || !model || year === null) {
        report.errors.push({
          row: i + 2,
          email_or_id: carId ?? plateNumber ?? undefined,
          message: "Missing required field (car_id or plate_number, model, year)",
        });
        continue;
      }
      const data = {
        carId,
        plateNumber,
        make,
        model,
        year,
        color,
        fuelType: (asStr(r.fuel_type) || "PETROL").toUpperCase(),
        status: (asStr(r.status) || "AVAILABLE").toUpperCase(),
        mileage: asInt(r.current_mileage_km) ?? 0,
        purchaseDate: asDate(r.purchase_date),
        purchasePriceNok: asInt(r.purchase_price_nok),
        leaseMonthlyNok: asInt(r.lease_monthly_nok),
        insuranceMonthlyNok: asInt(r.insurance_monthly_nok),
      };
      try {
        const existing = carId
          ? await prisma.vehicle.findUnique({ where: { carId } })
          : await prisma.vehicle.findUnique({ where: { plateNumber } });
        if (existing) {
          await prisma.vehicle.update({ where: { id: existing.id }, data });
          report.updated++;
        } else {
          await prisma.vehicle.create({ data });
          report.inserted++;
        }
      } catch (e) {
        report.errors.push({
          row: i + 2,
          email_or_id: carId ?? plateNumber ?? undefined,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
}
