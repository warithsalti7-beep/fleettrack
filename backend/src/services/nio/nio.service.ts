/**
 * NioService — Integration layer for NIO vehicles via Smartcar API
 *
 * REALITY CHECK — NIO API Access (2024):
 * ────────────────────────────────────────────────────────────────
 * NIO does NOT offer a public fleet API.
 *
 * Options for integrating NIO and other EVs (BYD, Rivian, etc.):
 *
 * OPTION A: Smartcar (RECOMMENDED)
 *   - Universal EV API supporting 40+ brands including NIO, Tesla, Ford, VW
 *   - Standardized endpoints: /location, /battery, /odometer, /charge
 *   - Free tier: 20 vehicles; Paid: custom pricing
 *   - Website: https://smartcar.com
 *   - Registration: https://dashboard.smartcar.com
 *
 * OPTION B: Samsara / Geotab (commercial hardware OBD dongle)
 *   - Works with ANY vehicle (ICE or EV)
 *   - Plug OBD-II device into vehicle port
 *   - Provides GPS, speed, engine data, fault codes
 *   - Best for fleets that own the vehicles
 *
 * OPTION C: AirtelIoT / Teltonika Hardware
 *   - GPS tracker installed in vehicle
 *   - Works offline, sends data to your own server
 *   - No per-vehicle API approval needed
 *   - Cost: ~$50 hardware + SIM card
 *
 * This service implements OPTION A (Smartcar) as it covers NIO in CN/EU.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import axios, { AxiosInstance } from 'axios';
import { NormalizedTelemetry } from '../tesla/tesla.service';

export interface SmartcarVehicle {
  id: string;        // Smartcar vehicle ID
  make: string;
  model: string;
  year: number;
}

export interface SmartcarBattery {
  percentRemaining: number;  // 0-1
  range: number;             // km
}

export interface SmartcarLocation {
  latitude: number;
  longitude: number;
  age: { elapsed: number; unit: 'seconds' };
}

export interface SmartcarOdometer {
  distance: number;  // km
}

export interface SmartcarCharge {
  isPluggedIn: boolean;
  state: 'CHARGING' | 'FULLY_CHARGED' | 'NOT_CHARGING';
}

@Injectable()
export class NioService {
  private readonly logger = new Logger(NioService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.http = axios.create({
      baseURL: this.config.get<string>('smartcar.baseUrl', 'https://api.smartcar.com/v2.0'),
      timeout: 15_000,
    });
  }

  // ─── OAuth2 Authorization ─────────────────────────────────────────────────

  /**
   * Generate Smartcar Connect URL for vehicle owner authorization.
   * Supports NIO, Tesla, Ford, VW, BMW, Hyundai, and 40+ more brands.
   */
  getAuthorizationUrl(state: string): string {
    const mode = this.config.get<string>('smartcar.mode', 'simulated');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.get('smartcar.clientId'),
      redirect_uri: this.config.get('smartcar.redirectUri'),
      scope: [
        'required:read_vehicle_info',
        'required:read_location',
        'required:read_battery',
        'required:read_charge',
        'required:read_odometer',
      ].join(' '),
      state,
      mode,  // 'simulated' for testing without real vehicle
    });

    return `https://connect.smartcar.com/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string) {
    const credentials = Buffer.from(
      `${this.config.get('smartcar.clientId')}:${this.config.get('smartcar.clientSecret')}`,
    ).toString('base64');

    const response = await axios.post(
      'https://auth.smartcar.com/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.get('smartcar.redirectUri'),
      }),
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    return response.data;
  }

  async refreshAccessToken(refreshToken: string) {
    const credentials = Buffer.from(
      `${this.config.get('smartcar.clientId')}:${this.config.get('smartcar.clientSecret')}`,
    ).toString('base64');

    const cacheKey = `smartcar:token:${refreshToken.slice(-8)}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const response = await axios.post(
      'https://auth.smartcar.com/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    const data = response.data;
    await this.cache.set(cacheKey, data, (data.expires_in - 60) * 1000);
    return data;
  }

  // ─── Vehicle Data ─────────────────────────────────────────────────────────

  async listVehicles(accessToken: string): Promise<SmartcarVehicle[]> {
    const response = await this.http.get('/vehicles', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data.vehicles;
  }

  async getBattery(vehicleId: string, accessToken: string): Promise<SmartcarBattery> {
    const response = await this.http.get(`/vehicles/${vehicleId}/battery`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }

  async getLocation(vehicleId: string, accessToken: string): Promise<SmartcarLocation> {
    const response = await this.http.get(`/vehicles/${vehicleId}/location`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }

  async getOdometer(vehicleId: string, accessToken: string): Promise<SmartcarOdometer> {
    const response = await this.http.get(`/vehicles/${vehicleId}/odometer`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }

  async getCharge(vehicleId: string, accessToken: string): Promise<SmartcarCharge> {
    const response = await this.http.get(`/vehicles/${vehicleId}/charge`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }

  // ─── Normalized telemetry ─────────────────────────────────────────────────

  /**
   * Fetch all required endpoints in parallel and normalize to our format.
   * Smartcar charges per API call per vehicle — batch wisely.
   */
  async getNormalizedTelemetry(
    ourVehicleId: string,
    smartcarVehicleId: string,
    accessToken: string,
  ): Promise<NormalizedTelemetry | null> {
    try {
      const [battery, location, odometer, charge] = await Promise.all([
        this.getBattery(smartcarVehicleId, accessToken),
        this.getLocation(smartcarVehicleId, accessToken),
        this.getOdometer(smartcarVehicleId, accessToken),
        this.getCharge(smartcarVehicleId, accessToken),
      ]);

      return {
        vehicleId: ourVehicleId,
        vin: smartcarVehicleId,  // Using Smartcar ID as VIN equivalent
        latitude: location.latitude,
        longitude: location.longitude,
        speedKmh: 0,             // Smartcar doesn't provide speed
        heading: 0,              // Smartcar doesn't provide heading
        batteryLevel: battery.percentRemaining * 100,
        batteryRangeKm: battery.range,
        isCharging: charge.state === 'CHARGING',
        chargingPowerKw: 0,      // Not available in basic Smartcar plan
        odometer: odometer.distance,
        timestamp: new Date(),
      };
    } catch (error: any) {
      if (error.response?.status === 429) {
        this.logger.warn(`Smartcar rate limit hit for vehicle ${smartcarVehicleId}`);
        return null;
      }
      this.logger.error(`Smartcar API error: ${error.message}`);
      throw error;
    }
  }
}
