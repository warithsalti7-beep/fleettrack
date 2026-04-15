import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asFloat, asDate, asInt } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return runImport("maintenance", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = asDate(r.service_date);
      const carId = asStr(r.car_id);
      const type = asStr(r.type);
      const description = asStr(r.description);
      if (!date || !carId || !type || !description) {
        report.errors.push({
          row: i + 2,
          message: "Missing service_date, car_id, type, or description",
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
        const status = (asStr(r.status) || "COMPLETED").toUpperCase();
        const data = {
          vehicleId: vehicle.id,
          type: type.toUpperCase(),
          description,
          cost: asFloat(r.cost_nok),
          technicianName: asStr(r.workshop),
          status,
          scheduledAt: date,
          completedAt: status === "COMPLETED" ? date : null,
          notes: asInt(r.mileage_at_service_km)
            ? `Mileage at service: ${r.mileage_at_service_km} km`
            : null,
        };
        // Natural key: one maintenance record per
        // (vehicle, type, scheduledAt) avoids the "scheduled → done"
        // transition creating a second row.
        const existing = await prisma.maintenance.findFirst({
          where: { vehicleId: vehicle.id, type: type.toUpperCase(), scheduledAt: date },
        });
        if (existing) {
          await prisma.maintenance.update({ where: { id: existing.id }, data });
          report.updated++;
        } else {
          await prisma.maintenance.create({ data });
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
