/**
 * Uber Fleet/Partner API adapter — PARTNER-GATED.
 *
 * Access requires approval through Uber Fleet/supplier team. Until approved,
 * workflow is CSV export from driver app → /api/import/bulk TRIP rows.
 *
 * STATUS: Scaffold. See docs/INTEGRATIONS.md section 3.
 */
import { envSoft } from "../env";
import type { FleetIntegration, SyncReport, IntegrationStatus } from "./types";

export const uber: FleetIntegration = {
  id: "uber",
  name: "Uber Fleet (partner API)",

  isConfigured() {
    return !!envSoft("UBER_CLIENT_ID") && !!envSoft("UBER_CLIENT_SECRET") && !!envSoft("UBER_FLEET_ID");
  },

  async sync(sinceDays: number): Promise<SyncReport> {
    const now = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: "uber", startedAt: now, finishedAt: now,
        ok: false, inserted: 0, updated: 0, skipped: 0,
        error:
          "Uber partner API credentials not configured. Apply at developer.uber.com, " +
          "then set UBER_CLIENT_ID / UBER_CLIENT_SECRET / UBER_FLEET_ID. Meanwhile, " +
          "download weekly earnings CSV from each driver's app and upload via /api/import/bulk.",
      };
    }
    return {
      provider: "uber", startedAt: now, finishedAt: new Date().toISOString(),
      ok: false, inserted: 0, updated: 0, skipped: 0,
      error: "Uber sync not yet implemented — scaffold only",
      details: { sinceDays },
    };
  },

  async status(): Promise<IntegrationStatus> {
    return this.isConfigured() ? "disconnected" : "not_configured";
  },
};
