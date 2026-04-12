/**
 * MapsService — Google Maps Platform Integration
 *
 * COST & RATE LIMIT GUIDE (2024 pricing):
 * ─────────────────────────────────────────────────────────────────
 * Maps JavaScript API:   $7 per 1,000 loads (first $200/month free)
 * Geocoding API:         $5 per 1,000 requests
 * Directions API:        $5 per 1,000 requests
 * Routes API:            $10 per 1,000 requests
 * Distance Matrix API:   $5 per 1,000 elements
 *
 * Free tier: $200/month credit (~28,000 map loads free)
 *
 * COST REDUCTION STRATEGIES:
 * 1. Cache geocoding results in Redis (addresses don't change)
 * 2. Use encoded polylines instead of coordinate arrays
 * 3. Use Static Maps API for non-interactive views ($2/1000)
 * 4. Rate limit geocoding on your backend
 * 5. Consider OpenStreetMap / Mapbox as cheaper alternatives
 *
 * Rate Limits:
 * - Geocoding: 50 req/s (soft), 50,000 req/day
 * - Directions: 50 req/s, 100,000 req/day
 * - Maps JS: no per-request limit, billed per load
 *
 * ALTERNATIVES (cheaper for fleet use):
 * - Mapbox: $5 per 50,000 requests (cheaper at scale)
 * - HERE Maps: 250,000 free requests/month
 * - OpenRouteService: fully free (open source)
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import axios from 'axios';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeocodingResult {
  formattedAddress: string;
  lat: number;
  lng: number;
  placeId: string;
}

export interface DirectionsResult {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationMin: number;
  polyline: string;  // Encoded polyline
  steps: Array<{
    instruction: string;
    distanceMeters: number;
    durationSeconds: number;
  }>;
}

export interface EtaResult {
  durationMin: number;
  distanceKm: number;
  trafficDelayMin: number;
}

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private readonly apiKey: string;

  // Cache TTLs
  private readonly GEOCODE_TTL = 60 * 60 * 24 * 7 * 1000; // 7 days (addresses rarely change)
  private readonly DIRECTIONS_TTL = 60 * 5 * 1000;          // 5 minutes

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.apiKey = this.config.get<string>('googleMaps.apiKey');
  }

  // ─── Geocoding ────────────────────────────────────────────────────────────

  /**
   * Convert address string to coordinates.
   * Results cached for 7 days (addresses don't change).
   */
  async geocodeAddress(address: string): Promise<GeocodingResult | null> {
    const cacheKey = `geocode:${address.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = await this.cache.get<GeocodingResult>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(
        this.config.get<string>('googleMaps.geocodingUrl'),
        { params: { address, key: this.apiKey } },
      );

      const result = response.data.results?.[0];
      if (!result) return null;

      const normalized: GeocodingResult = {
        formattedAddress: result.formatted_address,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        placeId: result.place_id,
      };

      await this.cache.set(cacheKey, normalized, this.GEOCODE_TTL);
      return normalized;
    } catch (error: any) {
      this.logger.error(`Geocoding failed for "${address}": ${error.message}`);
      return null;
    }
  }

  /**
   * Reverse geocode: coordinates → address.
   */
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const cacheKey = `rgeocode:${lat.toFixed(4)}_${lng.toFixed(4)}`;
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(
        this.config.get<string>('googleMaps.geocodingUrl'),
        { params: { latlng: `${lat},${lng}`, key: this.apiKey } },
      );

      const address = response.data.results?.[0]?.formatted_address ?? null;
      if (address) await this.cache.set(cacheKey, address, this.GEOCODE_TTL);
      return address;
    } catch (error: any) {
      this.logger.error(`Reverse geocoding failed for ${lat},${lng}: ${error.message}`);
      return null;
    }
  }

  // ─── Directions / Route Calculation ──────────────────────────────────────

  /**
   * Get optimized route between two points.
   * Cached for 5 minutes (traffic changes).
   */
  async getDirections(
    origin: Coordinates,
    destination: Coordinates,
    departureTime: 'now' | Date = 'now',
  ): Promise<DirectionsResult | null> {
    const cacheKey = `directions:${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}:${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
    const cached = await this.cache.get<DirectionsResult>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(
        this.config.get<string>('googleMaps.directionsUrl'),
        {
          params: {
            origin: `${origin.lat},${origin.lng}`,
            destination: `${destination.lat},${destination.lng}`,
            departure_time: departureTime === 'now' ? 'now' : Math.floor(departureTime.getTime() / 1000),
            traffic_model: 'best_guess',
            key: this.apiKey,
          },
        },
      );

      const route = response.data.routes?.[0];
      if (!route) return null;

      const leg = route.legs[0];
      const result: DirectionsResult = {
        distanceMeters: leg.distance.value,
        distanceKm: leg.distance.value / 1000,
        durationSeconds: leg.duration_in_traffic?.value ?? leg.duration.value,
        durationMin: Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
        polyline: route.overview_polyline.points,
        steps: leg.steps.map((step: any) => ({
          instruction: step.html_instructions.replace(/<[^>]+>/g, ''),
          distanceMeters: step.distance.value,
          durationSeconds: step.duration.value,
        })),
      };

      await this.cache.set(cacheKey, result, this.DIRECTIONS_TTL);
      return result;
    } catch (error: any) {
      this.logger.error(`Directions API failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate ETA from driver's current location to pickup point.
   * Used for "driver is X minutes away" display.
   */
  async getEta(driverLocation: Coordinates, destination: Coordinates): Promise<EtaResult | null> {
    const directions = await this.getDirections(driverLocation, destination);
    if (!directions) return null;

    // Calculate traffic delay vs. no-traffic estimate
    const trafficDelay = Math.max(
      0,
      directions.durationMin - Math.ceil(directions.distanceKm / 0.5),
    );

    return {
      durationMin: directions.durationMin,
      distanceKm: directions.distanceKm,
      trafficDelayMin: trafficDelay,
    };
  }

  /**
   * Find the nearest available driver to a pickup point.
   * Returns the driverIds sorted by ETA ascending.
   */
  async findNearestDrivers(
    pickup: Coordinates,
    driverLocations: Array<{ driverId: string; lat: number; lng: number }>,
    topN = 3,
  ): Promise<Array<{ driverId: string; distanceKm: number; etaMin: number }>> {
    // First filter by Haversine distance (fast, no API call)
    const withDistance = driverLocations
      .map((d) => ({
        driverId: d.driverId,
        distanceKm: this.haversineDistance({ lat: d.lat, lng: d.lng }, pickup),
        lat: d.lat,
        lng: d.lng,
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, topN * 3); // Consider 3x candidates before real API calls

    // Get real ETAs for top candidates
    const results = await Promise.all(
      withDistance.slice(0, topN).map(async (d) => {
        const eta = await this.getEta({ lat: d.lat, lng: d.lng }, pickup);
        return {
          driverId: d.driverId,
          distanceKm: d.distanceKm,
          etaMin: eta?.durationMin ?? Math.ceil(d.distanceKm * 2),
        };
      }),
    );

    return results.sort((a, b) => a.etaMin - b.etaMin);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  /**
   * Haversine formula: straight-line distance between two GPS coordinates.
   * Extremely fast (no API call). Use for initial filtering.
   */
  haversineDistance(a: Coordinates, b: Coordinates): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(b.lat - a.lat);
    const dLng = this.toRad(b.lng - a.lng);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const chord =
      sinDLat * sinDLat +
      Math.cos(this.toRad(a.lat)) * Math.cos(this.toRad(b.lat)) * sinDLng * sinDLng;
    return R * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
