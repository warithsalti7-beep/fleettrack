/**
 * Smartcar adapter — unified OAuth for NIO, BMW, Ford, Hyundai, VW, etc.
 *
 * STATUS: Scaffold. See docs/INTEGRATIONS.md section 2.
 */
import { envSoft } from "../env";
import type { FleetIntegration, SyncReport, IntegrationStatus } from "./types";

const SMARTCAR_AUTH = "https://connect.smartcar.com/oauth/authorize";

export const smartcar: FleetIntegration = {
  id: "smartcar",
  name: "Smartcar (NIO, BMW, Ford, VW, 40+ brands)",

  isConfigured() {
    return !!envSoft("SMARTCAR_CLIENT_ID") && !!envSoft("SMARTCAR_CLIENT_SECRET");
  },

  authUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: envSoft("SMARTCAR_CLIENT_ID") || "",
      redirect_uri: envSoft("SMARTCAR_REDIRECT_URI") || "",
      scope: "read_vehicle_info read_location read_odometer read_battery read_charge",
      mode: "live",
      state,
    });
    return `${SMARTCAR_AUTH}?${params.toString()}`;
  },

  async handleCallback(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "Smartcar handleCallback not yet implemented" };
  },

  async sync(sinceDays: number): Promise<SyncReport> {
    const now = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: "smartcar", startedAt: now, finishedAt: now,
        ok: false, inserted: 0, updated: 0, skipped: 0,
        error: "SMARTCAR_CLIENT_ID / SMARTCAR_CLIENT_SECRET not set",
      };
    }
    return {
      provider: "smartcar", startedAt: now, finishedAt: new Date().toISOString(),
      ok: false, inserted: 0, updated: 0, skipped: 0,
      error: "Smartcar sync not yet implemented — scaffold only",
      details: { sinceDays },
    };
  },

  async status(): Promise<IntegrationStatus> {
    return this.isConfigured() ? "disconnected" : "not_configured";
  },
};
