import {
  Controller, Get, Put, Delete, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { IntelligenceService } from './intelligence.service';
import { FleetConfigService } from './fleet-config.service';
import { TripInsightsQueryDto } from './dto/query-intelligence.dto';
import { UpdateFleetConfigDto } from './dto/fleet-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller({ path: 'intelligence', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntelligenceController {
  constructor(
    private readonly intelligence: IntelligenceService,
    private readonly configSvc: FleetConfigService,
  ) {}

  // ── Existing endpoints (unchanged signatures) ─────────────────────────────

  /**
   * GET /api/v1/intelligence/vehicles/health
   * Health score (0–100) + grade (A–F) per vehicle.
   * Scores use weights from fleet config (configurable via PUT /intelligence/config).
   */
  @Get('vehicles/health')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getHealthScores() {
    return this.intelligence.getHealthScores();
  }

  /**
   * GET /api/v1/intelligence/charging/recommendations
   * Predictive charging queue for EV/Hybrid vehicles.
   *
   * Now includes:
   *   • timeToDepletionMin  — estimated minutes until critical threshold
   *   • recommendedChargeBy — ISO timestamp by which charging should start
   *   • drainRatePerHour    — % battery per hour from telematics history
   *   • predictionBasis     — 'telemetry' | 'estimated'
   *
   * Example response item:
   * {
   *   "vehicleId": "...",
   *   "plateNumber": "EV-003",
   *   "batteryLevel": 28,
   *   "batteryRangeKm": 112,
   *   "urgency": "medium",
   *   "timeToDepletionMin": 72,
   *   "recommendedChargeBy": "2026-04-09T16:45:00.000Z",
   *   "drainRatePerHour": 18.5,
   *   "predictionBasis": "telemetry",
   *   "reason": "Battery at 28% — limited range available.",
   *   "suggestedAction": "Charge within 4 hours"
   * }
   */
  @Get('charging/recommendations')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getChargingRecommendations() {
    return this.intelligence.getChargingRecommendations();
  }

  /**
   * GET /api/v1/intelligence/alerts
   * Rule-based fleet alert engine, now with severityScore (0–100) and priority.
   *
   * Alerts are sorted by severityScore descending (most impactful first).
   * Each alert includes:
   *   • severityScore — numeric 0–100; determines badge colour
   *   • priority      — critical / high / medium / low
   *
   * Example response item:
   * {
   *   "id": "LOW_BATTERY:v-abc",
   *   "type": "LOW_BATTERY",
   *   "severity": "critical",
   *   "severityScore": 98,
   *   "priority": "critical",
   *   "plateNumber": "EV-001",
   *   "message": "Battery at 2%",
   *   "detail": "Vehicle has critically low battery (2%).",
   *   "detectedAt": "2026-04-09T14:22:00.000Z"
   * }
   */
  @Get('alerts')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getAlerts() {
    return this.intelligence.getAlerts();
  }

  /**
   * GET /api/v1/intelligence/trips/insights?from=&to=
   * Fleet trip efficiency analysis against current config thresholds.
   */
  @Get('trips/insights')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getTripInsights(@Query() query: TripInsightsQueryDto) {
    return this.intelligence.getTripInsights(query.from, query.to);
  }

  // ── New endpoints ─────────────────────────────────────────────────────────

  /**
   * GET /api/v1/intelligence/recommendations
   * Actionable operational recommendations for drivers and vehicles.
   *
   * Types:
   *   • DRIVER_HIGH_IDLE_RATIO       — min/km > 1.3× fleet avg
   *   • DRIVER_BELOW_FLEET_SPEED     — avg speed < 80% of fleet avg
   *   • DRIVER_LOW_COMPLETION_RATE   — < 80% trips completed
   *   • VEHICLE_EFFICIENCY_DECLINE   — last-7d speed < 80% of prior-7d
   *
   * Each recommendation includes:
   *   • entity: { type, id, label }
   *   • insight: human-readable finding
   *   • suggestedAction: concrete next step
   *   • metrics: supporting numbers (percentages, counts, speeds)
   *
   * Example response item:
   * {
   *   "id": "DRIVER_HIGH_IDLE_RATIO:d-xyz",
   *   "type": "DRIVER_HIGH_IDLE_RATIO",
   *   "entity": { "type": "driver", "id": "d-xyz", "label": "John Doe" },
   *   "insight": "John Doe spends 42% more time per km than the fleet average, indicating high idle or stop time.",
   *   "suggestedAction": "Review route choices, stop frequency, and idling habits. Consider driver coaching session.",
   *   "severity": "info",
   *   "metrics": { "avgMinPerKm": 4.8, "fleetAvgMinPerKm": 3.4, "pctAboveFleetAvg": 42, "tripsAnalyzed": 18 }
   * }
   */
  @Get('recommendations')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getRecommendations() {
    return this.intelligence.getRecommendations();
  }

  /**
   * GET /api/v1/intelligence/config
   * Returns the active fleet configuration.
   * Falls back to system defaults if no custom config has been saved.
   *
   * Example response:
   * {
   *   "health": { "weights": { "energy": 40, "freshness": 20, "utilization": 20, "diagnostics": 10, "maintenance": 10 }, "obdFaultPenalty": 5, "maxObdPenalty": 10 },
   *   "battery": { "critical": 10, "high": 20, "medium": 40, "low": 60 },
   *   "inactivity": { "vehicleHours": 6, "telemetryMinutes": 30 },
   *   "tripEfficiency": { "minDistanceKm": 0.5, "slowSpeedFactor": 0.5, "excessiveDurationPerKm": 15 }
   * }
   */
  @Get('config')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getConfig() {
    return this.configSvc.getConfig();
  }

  /**
   * PUT /api/v1/intelligence/config
   * Persist custom fleet intelligence thresholds.
   * Partial updates are merged with current config (any omitted section keeps its value).
   * Changes take effect immediately — the config cache is invalidated on save.
   *
   * Weight validation: energy + freshness + utilization + diagnostics + maintenance
   * should equal 100 for scores to be on a 0–100 scale. A warning is logged if not.
   *
   * Example request body (partial update — only battery section):
   * { "battery": { "critical": 15, "high": 25, "medium": 50, "low": 70 } }
   */
  @Put('config')
  @Roles('SUPER_ADMIN')
  async updateConfig(@Body() dto: UpdateFleetConfigDto, @Request() req: any) {
    const updatedBy = req.user?.id;
    const config = await this.configSvc.updateConfig(dto, updatedBy);
    // Bust all intelligence caches so next request uses new thresholds
    await this.intelligence.invalidateAll();
    return { config, message: 'Fleet configuration updated. All intelligence caches cleared.' };
  }

  /**
   * DELETE /api/v1/intelligence/config
   * Resets the fleet configuration to system defaults.
   */
  @Delete('config')
  @Roles('SUPER_ADMIN')
  async resetConfig(@Request() req: any) {
    const updatedBy = req.user?.id;
    const config = await this.configSvc.resetToDefaults(updatedBy);
    await this.intelligence.invalidateAll();
    return { config, message: 'Fleet configuration reset to system defaults.' };
  }
}
