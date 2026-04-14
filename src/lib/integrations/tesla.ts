/**
 * Tesla Fleet API adapter — OAuth 2.0 PKCE + odometer/location/charge sync.
 *
 * STATUS: Scaffold. OAuth callback + sync loop not yet wired.
 * See docs/INTEGRATIONS.md section 1 for the full checklist.
 *
 * To finish the implementation:
 *   1. Add OAuthToken model (userId, provider, accessToken, refreshToken, expiresAt) to schema
 *   2. Implement authUrl() using PKCE code challenge (S256)
 *   3. Implement handleCallback() - exchange code for tokens, store per-driver or per-vehicle
 *   4. Implement sync() - GET /api/1/vehicles, then /vehicle_data, upsert to Vehicle table
 */
import { envSoft } from "../env";
import type { FleetIntegration, SyncReport, IntegrationStatus } from "./types";

const TESLA_AUTH = "https://auth.tesla.com/oauth2/v3/authorize";
// const TESLA_API = "https://fleet-api.prd.na.vn.cloud.tesla.com";

export const tesla: FleetIntegration = {
  id: "tesla",
  name: "Tesla Fleet API",

  isConfigured() {
    return !!envSoft("TESLA_CLIENT_ID") && !!envSoft("TESLA_CLIENT_SECRET");
  },

  authUrl(state: string): string {
    const clientId = envSoft("TESLA_CLIENT_ID") || "";
    const redirect = envSoft("TESLA_REDIRECT_URI") || "";
    const scopes = [
      "openid",
      "offline_access",
      "vehicle_device_data",
      "vehicle_location",
      "vehicle_charging_cmds",
    ].join(" ");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: scopes,
      state,
    });
    return `${TESLA_AUTH}?${params.toString()}`;
  },

  async handleCallback(): Promise<{ ok: boolean; error?: string }> {
    // TODO: exchange code for tokens, persist OAuthToken row.
    return { ok: false, error: "Tesla handleCallback not yet implemented" };
  },

  async sync(sinceDays: number): Promise<SyncReport> {
    const now = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: "tesla",
        startedAt: now,
        finishedAt: now,
        ok: false,
        inserted: 0,
        updated: 0,
        skipped: 0,
        error: "TESLA_CLIENT_ID / TESLA_CLIENT_SECRET not set in env",
      };
    }
    // TODO: iterate vehicles, fetch /vehicle_data, upsert mileage/battery/location
    return {
      provider: "tesla",
      startedAt: now,
      finishedAt: new Date().toISOString(),
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      error: "Tesla sync not yet implemented — scaffold only",
      details: { sinceDays },
    };
  },

  async status(): Promise<IntegrationStatus> {
    return this.isConfigured() ? "disconnected" : "not_configured";
  },
};
