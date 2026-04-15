import { NextRequest } from "next/server";
import { parseCsv, asStr, asInt, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";
import {
  ParsedRow,
  stageRaw,
  normalizeIntoTrip,
} from "@/lib/trip-import";

/**
 * POST /api/import/trips/taxi — Norwegian taxi/dispatch CSV.
 *
 * Norgestaxi / 07000 / 02300 dispatch dumps and taxameter exports
 * vary widely between meter brands (Frogne, Halda, Cygnus). The
 * shape we expect — but tolerate variations of — is:
 *   "Receipt #" / "kvittering" / "trip_id"
 *   "Driver" / "Sjåfør"
 *   "Plate" / "Bilnummer"
 *   "From" / "Pickup"  /  "To" / "Drop-off"
 *   "Start" / "End"
 *   "Fare" / "Beløp" / "Sum"
 *   "Tip" / "Tolls" / "Distance" / "Duration"
 *   "Payment" / "Betaling"
 *
 * Anything weird stays in TaxiRawTrip.rawPayload for inspection.
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
  return runImport("trips_taxi", req, async (csv, report) => {
    const rows = parseCsv(csv);
    const importBatchId = `taxi-${Date.now()}`;
    const fileName = req.headers.get("x-file-name") || null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const parsed: ParsedRow = {
        rowNumber: i + 2,
        raw: r,
        sourceTripId:
          get(r, "receipt_id", "Receipt #", "trip_id", "kvittering", "Kvittering"),
        driverName: get(r, "driver", "Driver", "Sjåfør", "sjafor", "Sjafor"),
        vehiclePlate: get(r, "plate", "Plate", "Bilnummer", "regnr"),
        tripStartAt: asDate(get(r, "start", "Start", "trip_start", "Startet")),
        tripEndAt: asDate(get(r, "end", "End", "trip_end", "Avsluttet")),
        grossFare: asFloat(get(r, "fare", "Fare", "Beløp", "belop", "Sum", "amount_nok")),
        tips: asFloat(get(r, "tip", "Tip", "Driks")),
        tolls: asFloat(get(r, "tolls", "Tolls", "Bompenger")),
        distanceKm: asFloat(get(r, "distance", "Distance", "km", "Kilometer")),
        durationMin: asInt(get(r, "duration_min", "Duration", "Minutter")),
        pickupAddress: asStr(get(r, "from", "From", "Pickup", "Hentested", "fra")),
        dropoffAddress: asStr(get(r, "to", "To", "Drop-off", "Levering", "til")),
        paymentType: asStr(get(r, "payment", "Payment", "Betaling")),
        currency: "NOK",
      };
      if (parsed.grossFare !== null && parsed.grossFare < 0) {
        report.errors.push({
          row: parsed.rowNumber,
          message: `Negative fare ${parsed.grossFare} — skipped`,
        });
        continue;
      }
      const stage = await stageRaw("TAXI", importBatchId, fileName, parsed);
      if (stage.error) { report.errors.push({ row: parsed.rowNumber, message: stage.error }); continue; }
      if (stage.isDuplicateRaw) { report.skipped++; continue; }
      if (!stage.rawId) { report.errors.push({ row: parsed.rowNumber, message: "raw stage failed" }); continue; }
      await normalizeIntoTrip("TAXI", stage.rawId, parsed, report);
    }
  });
}
