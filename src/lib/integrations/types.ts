/**
 * Shared types for provider integrations.
 *
 * Each provider adapter in this folder implements `FleetIntegration<T>`
 * — a common shape so the admin UI and cron runner don't need to know
 * which provider they're calling.
 */

export type ProviderId = "tesla" | "smartcar" | "uber" | "bolt" | "google-maps";

export type IntegrationStatus = "connected" | "disconnected" | "error" | "not_configured";

export type SyncReport = {
  provider: ProviderId;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
  details?: Record<string, unknown>;
};

export interface FleetIntegration {
  id: ProviderId;
  name: string;
  /** True if env vars + credentials are present. */
  isConfigured(): boolean;
  /** Start OAuth flow, returns URL to redirect user to. */
  authUrl?(state: string): string;
  /** Exchange OAuth code for tokens, persist server-side. */
  handleCallback?(code: string, state: string): Promise<{ ok: boolean; error?: string }>;
  /** Pull last `sinceDays` of data and upsert into DB. */
  sync(sinceDays: number): Promise<SyncReport>;
  /** Lightweight health check — used by the admin UI status badge. */
  status(): Promise<IntegrationStatus>;
}
