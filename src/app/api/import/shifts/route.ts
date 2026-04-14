import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return runImport("shifts", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = asDate(r.shift_date);
      const email = asStr(r.driver_email)?.toLowerCase() ?? null;
      const carId = asStr(r.car_id);
      const startTime = asStr(r.start_time);
      const endTime = asStr(r.end_time);
      if (!date || !email || !carId || !startTime || !endTime) {
        report.errors.push({
          row: i + 2,
          message: "Missing shift_date, driver_email, car_id, start_time, or end_time",
        });
        continue;
      }
      try {
        const driver = await prisma.driver.findUnique({ where: { email } });
        const vehicle =
          (await prisma.vehicle.findUnique({ where: { carId } })) ||
          (await prisma.vehicle.findUnique({ where: { plateNumber: carId } }));
        if (!driver) { report.errors.push({ row: i + 2, email_or_id: email, message: "Unknown driver_email" }); continue; }
        if (!vehicle) { report.errors.push({ row: i + 2, email_or_id: carId, message: "Unknown car_id" }); continue; }
        await prisma.shift.create({
          data: {
            driverId: driver.id,
            vehicleId: vehicle.id,
            shiftDate: date,
            startTime,
            endTime,
            hoursOnline: asFloat(r.hours_online),
            zone: asStr(r.zone),
            platformPrimary: asStr(r.platform_primary),
            status: (asStr(r.status) || "completed"),
          },
        });
        report.inserted++;
      } catch (e) {
        report.errors.push({
          row: i + 2,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
}
