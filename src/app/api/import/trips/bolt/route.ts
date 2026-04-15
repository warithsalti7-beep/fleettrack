import { NextRequest } from "next/server";
import { parseCsv, asStr, asInt, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";
import {
  ParsedRow,
  stageRaw,
  normalizeIntoTrip,
} from "@/lib/trip-import";

/**
 * POST /api/import/trips/bolt — Bolt driver-trip CSV.
 *
 * Bolt's "Order History" export commonly carries:
 *   "Order ID" / "order_id"
 *   "Driver name" / "Driver email"
 *   "Vehicle plate"
 *   "Started at" / "Finished at"
 *   "Gross price" / "Net price" / "Bolt commission"
 *   "Tips", "Tolls", "Distance, km", "Duration, min"
 *   "Cancellation fee" — sometimes present on cancelled orders
 *
 * Same robust column lookup as the Uber importer; raw row preserved
 * either way.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const get = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return null;
};

export async function POST(req: NextRequest) {
  return runImport("trips_bolt", req, async (csv, report) => {
    const rows = parseCsv(csv);
    const importBatchId = `bolt-${Date.now()}`;
    const fileName = req.headers.get("x-file-name") || null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const parsed: ParsedRow = {
        rowNumber: i + 2,
        raw: r,
        sourceTripId:
          get(r, "order_id", "Order ID", "order_reference"),
        driverEmail: get(r, "driver_email", "Driver email", "Email")?.toLowerCase() ?? null,
        driverName: get(r, "driver_name", "Driver name", "Driver"),
        externalDriverCode: get(r, "driver_id", "Driver ID", "partner_driver_id"),
        vehiclePlate: get(r, "vehicle_plate", "Vehicle plate", "Plate"),
        tripStartAt: asDate(
          get(r, "started_at", "Started at", "Pickup time"),
        ),
        tripEndAt: asDate(
          get(r, "finished_at", "Finished at", "Drop-off time"),
        ),
        grossFare: asFloat(
          get(r, "gross_price", "Gross price", "Total"),
        ),
        platformFee: asFloat(
          get(r, "bolt_commission", "Bolt commission", "Platform fee", "commission"),
        ),
        driverEarnings: asFloat(
          get(r, "net_price", "Net price", "Driver earnings"),
        ),
        tips: asFloat(get(r, "tips", "Tips", "tip")),
        tolls: asFloat(get(r, "tolls", "Tolls", "toll")),
        distanceKm: asFloat(
          get(r, "distance_km", "Distance, km", "Distance (km)", "Ride distance"),
        ),
        durationMin: asInt(
          get(r, "duration_min", "Duration, min", "Duration (min)", "Trip time"),
        ),
        pickupAddress: asStr(get(r, "pickup_address", "Pickup address", "From")),
        dropoffAddress: asStr(get(r, "dropoff_address", "Drop-off address", "To")),
        cancellationFee: asFloat(get(r, "cancellation_fee", "Cancellation fee")),
        currency: asStr(get(r, "currency", "Currency")) ?? "NOK",
      };
      if (parsed.grossFare !== null && parsed.grossFare < 0) {
        report.errors.push({
          row: parsed.rowNumber,
          message: `Negative fare ${parsed.grossFare} — skipped`,
        });
        continue;
      }
      const stage = await stageRaw("BOLT", importBatchId, fileName, parsed);
      if (stage.error) { report.errors.push({ row: parsed.rowNumber, message: stage.error }); continue; }
      if (stage.isDuplicateRaw) { report.skipped++; continue; }
      if (!stage.rawId) { report.errors.push({ row: parsed.rowNumber, message: "raw stage failed" }); continue; }
      await normalizeIntoTrip("BOLT", stage.rawId, parsed, report);
    }
  });
}
