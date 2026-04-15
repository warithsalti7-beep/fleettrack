import { NextResponse } from "next/server";
import {
  ALERT_THRESHOLDS,
  PEAK_HOURS,
  REV_PER_HOUR_CAP_NOK,
  SCORE_WEIGHTS_V2,
  TRIPS_PER_HOUR_CAP,
} from "@/lib/kpis";

/**
 * GET /api/kpis/config
 *
 * The single canonical bag of formula constants the client should
 * read at startup. Replaces several scattered hardcoded numbers in
 * dashboard.html so weights and thresholds cannot drift between the
 * server's calculations and the UI's labels.
 */
export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 60;

export async function GET() {
  return NextResponse.json({
    scoreWeightsV2: SCORE_WEIGHTS_V2,
    revPerHourCapNok: REV_PER_HOUR_CAP_NOK,
    tripsPerHourCap: TRIPS_PER_HOUR_CAP,
    peakHours: PEAK_HOURS,
    alertThresholds: ALERT_THRESHOLDS,
    rulesVersion: "kpis-2026-04-15",
  });
}
