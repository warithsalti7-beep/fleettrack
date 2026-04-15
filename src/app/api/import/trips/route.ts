import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asInt, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findDriverId(email: string | null) {
  if (!email) return null;
  const d = await prisma.driver.findUnique({ where: { email } });
  return d?.id ?? null;
}
async function findVehicleId(carId: string | null) {
  if (!carId) return null;
  const v =
    (await prisma.vehicle.findUnique({ where: { carId } })) ||
    (await prisma.vehicle.findUnique({ where: { plateNumber: carId } }));
  return v?.id ?? null;
}

export async function POST(req: NextRequest) {
  return runImport("trips", req, async (csv, report) => {
    const rows = parseCsv(csv);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = asDate(r.trip_date);
      const time = asStr(r.trip_time) || "00:00";
      const email = asStr(r.driver_email)?.toLowerCase() ?? null;
      const carId = asStr(r.car_id);
      if (!date || !email || !carId) {
        report.errors.push({
          row: i + 2,
          message: "Missing trip_date, driver_email, or car_id",
        });
        continue;
      }
      const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
      const startedAt = new Date(date);
      if (Number.isFinite(hh) && Number.isFinite(mm)) startedAt.setUTCHours(hh, mm);

      try {
        const [driverId, vehicleId] = await Promise.all([
          findDriverId(email),
          findVehicleId(carId),
        ]);
        if (!driverId) {
          report.errors.push({ row: i + 2, email_or_id: email, message: "Unknown driver_email — import drivers first" });
          continue;
        }
        if (!vehicleId) {
          report.errors.push({ row: i + 2, email_or_id: carId, message: "Unknown car_id — import vehicles first" });
          continue;
        }
        const duration = asInt(r.duration_min);
        const completedAt = duration
          ? new Date(startedAt.getTime() + duration * 60_000)
          : null;

        // Idempotency: when the CSV carries an external platform id we
        // upsert instead of blindly creating. Re-uploading the same
        // Bolt / Uber export is then a no-op. Rows without an external
        // id fall back to plain create (same as before).
        const externalPlatform = asStr(r.platform)?.toUpperCase() || null;
        const externalId =
          asStr(r.external_id) || asStr(r.platform_trip_id) || null;
        const data = {
          driverId,
          vehicleId,
          externalPlatform,
          externalId,
          pickupAddress: asStr(r.pickup_address) || "",
          dropoffAddress: asStr(r.dropoff_address) || "",
          distance: asFloat(r.distance_km),
          duration,
          fare: asFloat(r.fare_nok),
          paymentMethod: (asStr(r.payment_method) || "CARD").toUpperCase(),
          rating: asFloat(r.rating),
          status: (asStr(r.status) || "COMPLETED").toUpperCase(),
          cancelReason: asStr(r.cancel_reason) || null,
          startedAt,
          completedAt,
        };
        if (externalPlatform && externalId) {
          const existing = await prisma.trip.findUnique({
            where: { externalPlatform_externalId: { externalPlatform, externalId } },
          }).catch(() => null);
          if (existing) {
            await prisma.trip.update({ where: { id: existing.id }, data });
            report.updated++;
          } else {
            await prisma.trip.create({ data });
            report.inserted++;
          }
        } else {
          await prisma.trip.create({ data });
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
