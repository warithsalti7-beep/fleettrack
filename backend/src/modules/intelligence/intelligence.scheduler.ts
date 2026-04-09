import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IntelligenceService } from './intelligence.service';

/**
 * Pre-warms the intelligence cache on a fixed schedule so that dashboard
 * requests are served from Redis rather than re-computing on every hit.
 *
 * Schedule:   every 5 minutes
 * Cold path:  GET /intelligence/* → IntelligenceService computes + caches
 * Warm path:  scheduler recomputes quietly in the background
 */
@Injectable()
export class IntelligenceScheduler {
  private readonly logger = new Logger(IntelligenceScheduler.name);

  constructor(private readonly intelligence: IntelligenceService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async recomputeIntelligence(): Promise<void> {
    this.logger.debug('Recomputing fleet intelligence cache…');
    const start = Date.now();

    try {
      // Invalidate first so computeHealthScores writes fresh values
      await this.intelligence.invalidateAll();

      // Run all computations in parallel; each will cache its result
      await Promise.all([
        this.intelligence.getHealthScores(),
        this.intelligence.getChargingRecommendations(),
        this.intelligence.getAlerts(),
        // Trip insights cover last 30 days — included in warm-up
        this.intelligence.getTripInsights(),
        // Operational recommendations (driver/vehicle efficiency analysis)
        this.intelligence.getRecommendations(),
      ]);

      this.logger.log(`Intelligence cache refreshed in ${Date.now() - start} ms`);
    } catch (err) {
      // Never let a scheduler crash the process
      this.logger.error('Failed to recompute intelligence cache', (err as Error).stack);
    }
  }
}
