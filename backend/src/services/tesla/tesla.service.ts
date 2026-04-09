/**
 * TeslaService — Integration with Tesla Fleet API v1
 *
 * IMPORTANT LIMITATIONS (read before deploying):
 * ─────────────────────────────────────────────
 * 1. Tesla Fleet API requires:
 *    - A Tesla Developer Account (developer.tesla.com)
 *    - Approved application with fleet_telemetry scope
 *    - Per-vehicle OAuth2 consent from the vehicle owner
 *    - HTTPS redirect URI (not localhost in production)
 *
 * 2. Rate limits (as of 2024):
 *    - Waking vehicle: ~1 req/min per vehicle
 *    - Data polling: ~1 req/min per vehicle
 *    - Exceeding = 429 rate limit errors
 *
 * 3. Sleeping vehicles:
 *    - Tesla vehicles sleep when idle to preserve battery
 *    - Waking costs ~30 seconds and drains battery
 *    - Use Fleet Telemetry (streaming) instead of polling for active fleets
 *
 * 4. Fleet Telemetry (recommended for production):
 *    - Tesla pushes data to your server via WebSocket (protobuf)
 *    - Requires a public server with TLS cert
 *    - Eliminates polling entirely
 *    - See: https://github.com/teslamotors/fleet-telemetry
 *
 * For 1-25 vehicles polling is workable.
 * For 25+ vehicles use Fleet Telemetry streaming.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import axios, { AxiosInstance } from 'axios';
import {
  TeslaVehicle, TeslaVehicleData, TeslaAuthToken,
  TeslaDriveState, TeslaChargeState,
} from './tesla.types';

export interface NormalizedTelemetry {
  vehicleId: string;        // Our DB vehicle ID
  vin: string;
  latitude: number;
  longitude: number;
  speedKmh: number;
  heading: number;
  batteryLevel: number;     // SoC %
  batteryRangeKm: number;
  isCharging: boolean;
  chargingPowerKw: number;
  odometer: number;         // km
  timestamp: Date;
}

@Injectable()
export class TeslaService {
  private readonly logger = new Logger(TeslaService.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.baseUrl = this.config.get<string>('tesla.baseUrl');
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30_000,
    });
  }

  // ─── OAuth2 Flow ──────────────────────────────────────────────────────────

  /**
   * Step 1: Generate the authorization URL to redirect vehicle owner.
   * The owner must approve access in the Tesla app.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.get('tesla.clientId'),
      redirect_uri: this.config.get('tesla.redirectUri'),
      response_type: 'code',
      scope: [
        'openid', 'email', 'offline_access',
        'vehicle_device_data',
        'vehicle_location',
        'vehicle_cmds',
        'vehicle_charging_cmds',
      ].join(' '),
      state,
      audience: this.config.get('tesla.audience'),
    });

    return `https://auth.tesla.com/oauth2/v3/authorize?${params.toString()}`;
  }

  /**
   * Step 2: Exchange auth code for access + refresh tokens.
   * Call this from your OAuth callback endpoint.
   */
  async exchangeCodeForTokens(code: string): Promise<TeslaAuthToken> {
    const response = await axios.post('https://auth.tesla.com/oauth2/v3/token', {
      grant_type: 'authorization_code',
      client_id: this.config.get('tesla.clientId'),
      client_secret: this.config.get('tesla.clientSecret'),
      code,
      redirect_uri: this.config.get('tesla.redirectUri'),
      audience: this.config.get('tesla.audience'),
    });

    return response.data;
  }

  /**
   * Refresh an expired access token using the refresh token.
   * Store both in your DB (encrypted) per vehicle/owner.
   */
  async refreshAccessToken(refreshToken: string): Promise<TeslaAuthToken> {
    const cacheKey = `tesla:token:${refreshToken.slice(-8)}`;
    const cached = await this.cache.get<TeslaAuthToken>(cacheKey);
    if (cached) return cached;

    const response = await axios.post('https://auth.tesla.com/oauth2/v3/token', {
      grant_type: 'refresh_token',
      client_id: this.config.get('tesla.clientId'),
      client_secret: this.config.get('tesla.clientSecret'),
      refresh_token: refreshToken,
    });

    const token: TeslaAuthToken = response.data;

    // Cache for slightly less than expires_in
    await this.cache.set(cacheKey, token, (token.expires_in - 60) * 1000);
    return token;
  }

  // ─── Vehicle Listing ──────────────────────────────────────────────────────

  /**
   * List all vehicles linked to the access token.
   */
  async listVehicles(accessToken: string): Promise<TeslaVehicle[]> {
    const response = await this.http.get('/api/1/vehicles', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data.response;
  }

  // ─── Vehicle State ────────────────────────────────────────────────────────

  /**
   * Get complete vehicle data snapshot.
   * WARNING: Vehicle must be ONLINE. If asleep, call wakeUp() first.
   */
  async getVehicleData(vin: string, accessToken: string): Promise<TeslaVehicleData> {
    const response = await this.http.get(
      `/api/1/vehicles/${vin}/vehicle_data?endpoints=drive_state%3Bcharge_state%3Bvehicle_state`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return response.data.response;
  }

  /**
   * Get only drive state (location + speed). Cheaper than full vehicle_data.
   */
  async getDriveState(vin: string, accessToken: string): Promise<TeslaDriveState> {
    const response = await this.http.get(`/api/1/vehicles/${vin}/data_request/drive_state`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data.response;
  }

  /**
   * Get only charge state (battery + charging). Cheaper than full vehicle_data.
   */
  async getChargeState(vin: string, accessToken: string): Promise<TeslaChargeState> {
    const response = await this.http.get(`/api/1/vehicles/${vin}/data_request/charge_state`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data.response;
  }

  /**
   * Wake a sleeping vehicle. IMPORTANT: costs battery and takes ~30s.
   * Only call when necessary; prefer Fleet Telemetry for active vehicles.
   */
  async wakeUp(vin: string, accessToken: string): Promise<void> {
    await this.http.post(`/api/1/vehicles/${vin}/wake_up`, {}, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Poll until online (max 60s)
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const vehicles = await this.listVehicles(accessToken);
      const vehicle = vehicles.find((v) => v.vin === vin);
      if (vehicle?.state === 'online') return;
    }

    throw new Error(`Vehicle ${vin} did not wake up within 60s`);
  }

  // ─── Normalized telemetry for our DB ─────────────────────────────────────

  /**
   * Fetch and normalize Tesla vehicle data into our standard format.
   * Converts Imperial to Metric (miles → km).
   */
  async getNormalizedTelemetry(
    ourVehicleId: string,
    vin: string,
    accessToken: string,
  ): Promise<NormalizedTelemetry | null> {
    try {
      const data = await this.getVehicleData(vin, accessToken);
      const { drive_state: drive, charge_state: charge } = data;

      const MILES_TO_KM = 1.60934;
      const speedMph = drive.speed ?? 0;
      const odometerMiles = data.vehicle_state.odometer;

      return {
        vehicleId: ourVehicleId,
        vin,
        latitude: drive.latitude,
        longitude: drive.longitude,
        speedKmh: speedMph * MILES_TO_KM,
        heading: drive.heading,
        batteryLevel: charge.battery_level,
        batteryRangeKm: charge.battery_range * MILES_TO_KM,
        isCharging: charge.charging_state === 'Charging',
        chargingPowerKw: charge.charger_power,
        odometer: Math.round(odometerMiles * MILES_TO_KM),
        timestamp: new Date(drive.timestamp),
      };
    } catch (error: any) {
      // Vehicle is asleep or offline
      if (error.response?.status === 408) {
        this.logger.warn(`Vehicle ${vin} is asleep — skipping this sync cycle`);
        return null;
      }
      // Rate limited
      if (error.response?.status === 429) {
        this.logger.warn(`Rate limited by Tesla API for VIN ${vin} — backing off`);
        return null;
      }
      this.logger.error(`Tesla API error for ${vin}: ${error.message}`);
      throw error;
    }
  }
}
