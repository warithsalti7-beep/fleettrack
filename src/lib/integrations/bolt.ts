/**
 * Bolt Business / Drive adapter — PARTNER-GATED.
 *
 * Access via partnership agreement (contact fleets@bolt.eu). Until then,
 * workflow is Operator Console CSV → /api/import/bulk TRIP rows.
 *
 * STATUS: Scaffold. See docs/INTEGRATIONS.md section 4.
 */
import { envSoft } from "../env";
import type { FleetIntegration, SyncReport, IntegrationStatus } from "./types";

export const bolt: FleetIntegration = {
  id: "bolt",
  name: "Bolt Business (partner API)",

  isConfigured() {
    return !!envSoft("BOLT_API_KEY") && !!envSoft("BOLT_FLEET_ID");
  },

  async sync(sinceDays: number): Promise<SyncReport> {
    const now = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: "bolt", startedAt: now, finishedAt: now,
        ok: false, inserted: 0, updated: 0, skipped: 0,
        error:
          "Bolt partner API credentials not configured. Contact fleets@bolt.eu, " +
          "then set BOLT_API_KEY / BOLT_FLEET_ID / BOLT_WEBHOOK_SECRET. Meanwhile, " +
          "download Bolt Operator Console CSV and upload via /api/import/bulk.",
      };
    }
    return {
      provider: "bolt", startedAt: now, finishedAt: new Date().toISOString(),
      ok: false, inserted: 0, updated: 0, skipped: 0,
      error: "Bolt sync not yet implemented — scaffold only",
      details: { sinceDays },
    };
  },

  async status(): Promise<IntegrationStatus> {
    return this.isConfigured() ? "disconnected" : "not_configured";
  },
};
