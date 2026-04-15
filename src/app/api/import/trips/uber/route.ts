import { NextRequest } from "next/server";
import { parseCsv, asStr, asInt, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";
import {
  ParsedRow,
  stageRaw,
  normalizeIntoTrip,
} from "@/lib/trip-import";

/**
 * POST /api/import/trips/uber — Uber driver-trip CSV.
 *
 * Real Uber exports vary by region but consistently include:
 *   "Trip UUID" / "trip_uuid" / "Order ID"
 *   "Driver Name" / "Driver UUID" / "Driver Email"
 *   "License Plate" / "Vehicle Plate"
 *   "Trip Start" / "Begin Trip Time"
 *   "Trip End"
 *   "Fare" / "Gross Fare" / "Total Fare"
 *   "Service Fee"  ← Uber's commission
 *   "Tips" / "Tolls" / "Distance (km)" / "Duration (min)"
 *
 * We accept any of those header variants per spec §3 ('Support
 * slightly different CSV formats from same source'). Anything we
 * cannot parse is still preserved in UberRawTrip.rawPayload so the
 * operator can inspect and re-run after fixing the CSV.
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
  return runImport("trips_uber", req, async (csv, report) => {
    const rows = parseCsv(csv);
    const importBatchId = `uber-${Date.now()}`;
    const fileName = req.headers.get("x-file-name") || null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const parsed: ParsedRow = {
        rowNumber: i + 2, // +1 for 0-index, +1 for header row
        raw: r,
        sourceTripId:
          get(r, "trip_uuid", "Trip UUID", "trip_id", "Order ID", "order_id"),
        driverEmail: get(r, "driver_email", "Driver Email", "Email")?.toLowerCase() ?? null,
        driverName: get(r, "driver_name", "Driver Name", "Driver"),
        externalDriverCode: get(r, "driver_uuid", "Driver UUID", "Driver ID"),
        vehiclePlate: get(r, "license_plate", "License Plate", "Vehicle Plate", "plate"),
        tripStartAt: asDate(
          get(r, "trip_start", "Begin Trip Time", "Trip Start", "Started At"),
        ),
        tripEndAt: asDate(
          get(r, "trip_end", "Drop-off Time", "Trip End", "Completed At"),
        ),
        grossFare: asFloat(
          get(r, "gross_fare", "Total Fare", "Fare", "fare_local"),
        ),
        platformFee: asFloat(
          get(r, "service_fee", "Service Fee", "Uber Fee", "platform_fee"),
        ),
        driverEarnings: asFloat(
          get(r, "your_earnings", "Driver Earnings", "Net Earnings"),
        ),
        tips: asFloat(get(r, "tip", "Tips", "tip_amount")),
        tolls: asFloat(get(r, "toll", "Tolls", "toll_amount")),
        distanceKm: asFloat(get(r, "distance_km", "Distance (km)", "Distance")),
        durationMin: asInt(get(r, "duration_min", "Duration (min)", "Trip Time (min)")),
        pickupAddress: asStr(get(r, "pickup_address", "Pickup Address", "Begin Address")),
        dropoffAddress: asStr(get(r, "dropoff_address", "Drop-off Address", "End Address")),
        currency: asStr(get(r, "currency", "Currency Code")) ?? "NOK",
      };
      // Sanity guard from spec §9 (negative or impossible fares).
      if (parsed.grossFare !== null && parsed.grossFare < 0) {
        report.errors.push({
          row: parsed.rowNumber,
          message: `Negative fare ${parsed.grossFare} — skipped`,
        });
        continue;
      }

      const stage = await stageRaw("UBER", importBatchId, fileName, parsed);
      if (stage.error) {
        report.errors.push({ row: parsed.rowNumber, message: stage.error });
        continue;
      }
      if (stage.isDuplicateRaw) {
        report.skipped++;
        continue;
      }
      if (!stage.rawId) {
        report.errors.push({ row: parsed.rowNumber, message: "raw stage failed" });
        continue;
      }
      await normalizeIntoTrip("UBER", stage.rawId, parsed, report);
    }
  });
}
