/**
 * POST /api/ocr/extract
 *
 * Accepts: JSON { image: "data:image/jpeg;base64,..." [, hint?: string] }
 *      OR: multipart/form-data with field "photo"
 *
 * Calls Claude Vision (Sonnet 4.5) to OCR a daily driver sheet, fuel receipt,
 * shift log, etc. and returns suggested rows in weekly-operations.csv format.
 *
 * Output:
 *   {
 *     ok: true,
 *     summary: "Detected: 12 trips, 1 fuel refill, 1 shift block",
 *     rows: [
 *       { record_type: "TRIP", date: "...", driver_email: "...", ... },
 *       ...
 *     ],
 *     unmatched: [ "could not parse line: 3 — driver name 'X. Y.' not in roster" ],
 *     csv: "record_type,date,...\nTRIP,2025-09-01,..."
 *   }
 *
 * The admin UI then lets the user review rows before importing via /api/import/bulk.
 *
 * Auth: requires admin session (proxy enforces).
 */

import { NextRequest, NextResponse } from "next/server";
import { callClaudeVision, parseAiJson, AiError } from "@/lib/anthropic";
import { captureError } from "@/lib/sentry";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPPORTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const SYSTEM_PROMPT = `You are an OCR assistant for a Norwegian taxi fleet ops dashboard.

Your job: read the attached photo (a driver's daily sheet, fuel receipt, workshop invoice, shift log, or platform export screenshot) and extract every data point as rows that match this CSV schema:

  record_type | date | time | driver_email | car_id | shift_start | shift_end | hours_online | zone | platform | pickup_address | dropoff_address | distance_km | duration_min | fare_nok | payment_method | rating | status | liters_or_kwh | price_per_unit_nok | total_cost_nok | mileage_km | station | type | description | workshop | notes

record_type values: SHIFT | TRIP | FUEL | MAINTENANCE
Dates: YYYY-MM-DD. Times: HH:MM (24h). Currency: NOK.

Rules:
1. NEVER invent values. If a field isn't visible/legible, leave it null.
2. Match driver names to the roster provided (case-insensitive, partial OK). If unclear, set driver_email to null and explain in 'unmatched'.
3. Match car_ids to the fleet list provided. If a number on the receipt doesn't match a known car_id, treat it as plate_number and try to map.
4. For receipts: assume station name from header, fuel/charge cost from total. EV charging = liters_or_kwh in kWh.
5. Norwegian addresses are common — keep them as written (Storgata, Aker Brygge, etc.).
6. If the photo shows a weekly summary, generate one row PER trip if listed individually, or one summary SHIFT row if only totals shown.
7. Return ONLY valid JSON of shape:
   { "summary": "...", "rows": [ {...row1...}, {...row2...} ], "unmatched": ["..."] }
8. No markdown, no commentary outside JSON.`;

async function imageToBase64(req: NextRequest): Promise<{ data: string; mediaType: string } | null> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const img = body?.image;
    if (typeof img !== "string") return null;
    const m = img.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!m) return null;
    return { mediaType: m[1], data: m[2] };
  }

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("photo");
    if (!(file instanceof File)) return null;
    if (!SUPPORTED_MIME.includes(file.type)) return null;
    const buf = Buffer.from(await file.arrayBuffer());
    return { mediaType: file.type, data: buf.toString("base64") };
  }

  return null;
}

export async function POST(req: NextRequest) {
  // Require admin
  if (req.headers.get("x-user-role") !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  try {
    const img = await imageToBase64(req);
    if (!img) {
      return NextResponse.json(
        { error: "Send a JSON body { image: 'data:image/...;base64,...' } or multipart 'photo'." },
        { status: 400 },
      );
    }

    // Pull current roster + fleet so the model can match drivers/vehicles
    const [drivers, vehicles] = await Promise.all([
      prisma.driver.findMany({ select: { name: true, email: true } }).catch(() => []),
      prisma.vehicle.findMany({ select: { carId: true, plateNumber: true, make: true, model: true } }).catch(() => []),
    ]);

    const userBody = req.headers.get("x-ocr-hint") || ""; // optional context
    const rosterContext =
      `Known drivers (${drivers.length}):\n` +
      drivers.slice(0, 50).map((d) => `  - ${d.name} <${d.email}>`).join("\n") +
      `\n\nKnown vehicles (${vehicles.length}):\n` +
      vehicles.slice(0, 50).map((v) => `  - ${v.carId || v.plateNumber} (${v.make} ${v.model})`).join("\n");

    const raw = await callClaudeVision(
      [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
            {
              type: "text",
              text:
                "Extract all rows from this photo into the weekly-operations.csv schema.\n\n" +
                rosterContext +
                (userBody ? `\n\nUser hint: ${userBody}` : "") +
                "\n\nReturn JSON: { summary, rows[], unmatched[] }",
            },
          ],
        },
      ],
      { system: SYSTEM_PROMPT, maxTokens: 4096 },
    );

    let parsed: { summary: string; rows: Record<string, unknown>[]; unmatched?: string[] };
    try {
      parsed = parseAiJson(raw);
    } catch {
      return NextResponse.json(
        { error: "Vision model returned non-JSON output", raw: raw.slice(0, 500) },
        { status: 502 },
      );
    }

    // Generate downloadable CSV
    const allCols = [
      "record_type", "date", "time", "driver_email", "car_id",
      "shift_start", "shift_end", "hours_online", "zone", "platform",
      "pickup_address", "dropoff_address", "distance_km", "duration_min",
      "fare_nok", "payment_method", "rating", "status",
      "liters_or_kwh", "price_per_unit_nok", "total_cost_nok",
      "mileage_km", "station", "type", "description", "workshop", "notes",
    ];
    const escape = (v: unknown) => {
      if (v == null) return "";
      const s = String(v);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv =
      allCols.join(",") + "\n" +
      (parsed.rows || [])
        .map((r) => allCols.map((c) => escape(r[c])).join(","))
        .join("\n");

    return NextResponse.json({
      ok: true,
      summary: parsed.summary || "",
      rowCount: (parsed.rows || []).length,
      rows: parsed.rows || [],
      unmatched: parsed.unmatched || [],
      csv,
    });
  } catch (err) {
    await captureError(err, { route: "/api/ocr/extract" });
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "OCR failed" },
      { status: 500 },
    );
  }
}
