/**
 * FleetConfigService — loads, persists, and caches the per-fleet configuration.
 *
 * Storage:  PostgreSQL fleet_settings table (singleton row, id = "singleton")
 * Cache:    Redis, TTL 10 minutes
 * Fallback: DEFAULT_CONFIG when no row exists
 *
 * All other intelligence services call getConfig() to receive the resolved
 * FleetConfig — they never import DEFAULT_CONFIG or THRESHOLDS directly.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { FleetConfig, DEFAULT_CONFIG, THRESHOLDS, CACHE_KEYS } from './intelligence.constants';

const SETTINGS_ID = 'singleton';

@Injectable()
export class FleetConfigService {
  private readonly logger = new Logger(FleetConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** Returns the active fleet config (DB → cache → DEFAULT_CONFIG fallback). */
  async getConfig(): Promise<FleetConfig> {
    const cached = await this.cache.get<FleetConfig>(CACHE_KEYS.fleetConfig());
    if (cached) return cached;

    return this.loadFromDb();
  }

  async loadFromDb(): Promise<FleetConfig> {
    const row = await this.prisma.fleetSettings.findUnique({
      where: { id: SETTINGS_ID },
    });

    const config: FleetConfig = row ? (row.config as FleetConfig) : DEFAULT_CONFIG;
    await this.cache.set(CACHE_KEYS.fleetConfig(), config, THRESHOLDS.cache.fleetConfig);
    return config;
  }

  /** Merges partial updates into the current config and persists. */
  async updateConfig(partial: Partial<FleetConfig>, updatedBy?: string): Promise<FleetConfig> {
    const current = await this.getConfig();

    const merged: FleetConfig = {
      health: { ...current.health, ...(partial.health ?? {}), weights: { ...current.health.weights, ...(partial.health?.weights ?? {}) } },
      battery: { ...current.battery, ...(partial.battery ?? {}) },
      inactivity: { ...current.inactivity, ...(partial.inactivity ?? {}) },
      tripEfficiency: { ...current.tripEfficiency, ...(partial.tripEfficiency ?? {}) },
    };

    this.validateWeightsSum(merged);

    await this.prisma.fleetSettings.upsert({
      where:  { id: SETTINGS_ID },
      update: { config: merged as any, updatedBy },
      create: { id: SETTINGS_ID, config: merged as any, updatedBy },
    });

    // Bust cache
    await this.cache.del(CACHE_KEYS.fleetConfig());

    this.logger.log(`Fleet config updated by ${updatedBy ?? 'system'}`);
    return merged;
  }

  /** Reset to system defaults. */
  async resetToDefaults(updatedBy?: string): Promise<FleetConfig> {
    await this.prisma.fleetSettings.upsert({
      where:  { id: SETTINGS_ID },
      update: { config: DEFAULT_CONFIG as any, updatedBy },
      create: { id: SETTINGS_ID, config: DEFAULT_CONFIG as any, updatedBy },
    });
    await this.cache.del(CACHE_KEYS.fleetConfig());
    this.logger.log(`Fleet config reset to defaults by ${updatedBy ?? 'system'}`);
    return DEFAULT_CONFIG;
  }

  /**
   * Guard: health weight components should sum to 100.
   * Logs a warning but does NOT throw — wrong weights produce a valid (if odd)
   * score rather than a 500 error in production.
   */
  private validateWeightsSum(config: FleetConfig): void {
    const { energy, freshness, utilization, diagnostics, maintenance } = config.health.weights;
    const sum = energy + freshness + utilization + diagnostics + maintenance;
    if (sum !== 100) {
      this.logger.warn(
        `Health score weights sum to ${sum} instead of 100. Scores will not be on a 0–100 scale.`,
      );
    }
  }
}
