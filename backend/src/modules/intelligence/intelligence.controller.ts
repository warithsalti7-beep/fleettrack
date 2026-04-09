import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IntelligenceService } from './intelligence.service';
import { TripInsightsQueryDto } from './dto/query-intelligence.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller({ path: 'intelligence', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntelligenceController {
  constructor(private readonly intelligence: IntelligenceService) {}

  /**
   * GET /api/v1/intelligence/vehicles/health
   *
   * Returns a health score (0–100) and letter grade per active vehicle.
   * Score is composed of 5 weighted components:
   *   • energy      (0–40 pts) — battery SoC or fuel level
   *   • freshness   (0–20 pts) — telematics data recency
   *   • utilization (0–20 pts) — completed trips in last 7 days
   *   • diagnostics (0–10 pts) — active OBD fault codes (penalty)
   *   • maintenance (0–10 pts) — overdue service records (penalty)
   *
   * Results are cached in Redis for 5 minutes and pre-warmed every 5 minutes
   * by the IntelligenceScheduler.
   *
   * Example response:
   * [
   *   {
   *     "vehicleId": "clx1...",
   *     "score": 82,
   *     "grade": "B",
   *     "components": { "energy": 36, "freshness": 20, "utilization": 15, "diagnostics": 10, "maintenance": 1 },
   *     "flags": ["Very high utilization (> 15 trips / 7 days)"]
   *   }
   * ]
   */
  @Get('vehicles/health')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getHealthScores() {
    return this.intelligence.getHealthScores();
  }

  /**
   * GET /api/v1/intelligence/charging/recommendations
   *
   * Returns EV/Hybrid vehicles that need charging, sorted by urgency:
   *   • critical — battery ≤ 10%  → charge immediately
   *   • high     — battery ≤ 20%  → charge within 1 hour
   *   • medium   — battery ≤ 40%  → charge within 4 hours
   *   • low      — battery ≤ 60%  → opportunistic charge
   *
   * Non-charging vehicles are sorted before vehicles already charging.
   * Within each urgency tier, lowest battery level appears first.
   *
   * Example response:
   * {
   *   "recommendations": [
   *     {
   *       "vehicleId": "clx2...",
   *       "plateNumber": "EV-001",
   *       "make": "Tesla", "model": "Model 3",
   *       "batteryLevel": 8,
   *       "batteryRangeKm": 34,
   *       "urgency": "critical",
   *       "reason": "Battery at 8% — risk of vehicle shutdown. 2 trip(s) scheduled in the next 4 hours.",
   *       "suggestedAction": "Charge immediately",
   *       "isCurrentlyCharging": false,
   *       "upcomingTrips": 2
   *     }
   *   ],
   *   "meta": { "total": 5, "critical": 1, "high": 2, "medium": 1, "low": 1 }
   * }
   */
  @Get('charging/recommendations')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getChargingRecommendations() {
    return this.intelligence.getChargingRecommendations();
  }

  /**
   * GET /api/v1/intelligence/alerts
   *
   * Rule-based alert engine. Evaluates every active vehicle against 5 rules:
   *   • LOW_BATTERY         — EV battery ≤ 20%
   *   • VEHICLE_INACTIVE    — no GPS update for ≥ 6 hours
   *   • TELEMETRY_GAP       — telematics-enabled vehicle, no log for ≥ 30 min
   *   • OBD_FAULT           — active OBD-II diagnostic codes in latest log
   *   • MAINTENANCE_OVERDUE — past-due maintenance records
   *
   * Alert IDs are deterministic (`{TYPE}:{vehicleId}`) — safe to use as
   * React keys or for deduplication in notification systems.
   *
   * Example response:
   * {
   *   "alerts": [
   *     {
   *       "id": "LOW_BATTERY:clx2...",
   *       "type": "LOW_BATTERY",
   *       "severity": "critical",
   *       "vehicleId": "clx2...",
   *       "plateNumber": "EV-001",
   *       "message": "Battery at 8%",
   *       "detail": "Vehicle has critically low battery (8%). Range: 34 km.",
   *       "detectedAt": "2026-04-09T14:22:00.000Z",
   *       "metadata": { "batteryLevel": 8 }
   *     }
   *   ],
   *   "meta": { "total": 3, "critical": 1, "warning": 2, "info": 0 }
   * }
   */
  @Get('alerts')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getAlerts() {
    return this.intelligence.getAlerts();
  }

  /**
   * GET /api/v1/intelligence/trips/insights?from=&to=
   *
   * Analyses completed trips to surface efficiency metrics:
   *   • Fleet-wide avg speed, fare/km, and duration
   *   • Flagged inefficient trips with specific reasons:
   *       - Speed below 50% of fleet average
   *       - Excessive duration per km (> 15 min/km ≈ walking pace)
   *   • Per-vehicle summary sorted by avg speed (best performers first)
   *
   * Defaults to the last 30 days if no date range is supplied.
   * Results are cached in Redis for 10 minutes.
   *
   * Example response:
   * {
   *   "totalTripsAnalyzed": 142,
   *   "fleetAvgSpeedKmh": 34.7,
   *   "fleetAvgFarePerKm": 2.15,
   *   "fleetAvgDurationMin": 28.4,
   *   "inefficientTrips": [
   *     {
   *       "tripId": "clx9...",
   *       "vehicleId": "clx1...",
   *       "driverId": "cly2...",
   *       "distanceKm": 3.2,
   *       "durationMin": 82,
   *       "avgSpeedKmh": 2.3,
   *       "farePerKm": 4.84,
   *       "flags": ["2.3 km/h is below 50% of fleet average (34.7 km/h)", "25.6 min/km — excessive time per distance"]
   *     }
   *   ],
   *   "vehicleSummaries": [...],
   *   "queryRange": { "from": "2026-03-10T00:00:00.000Z", "to": "2026-04-09T00:00:00.000Z" }
   * }
   */
  @Get('trips/insights')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getTripInsights(@Query() query: TripInsightsQueryDto) {
    return this.intelligence.getTripInsights(query.from, query.to);
  }
}
