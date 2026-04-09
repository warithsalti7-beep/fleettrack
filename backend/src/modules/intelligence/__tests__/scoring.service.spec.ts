import {
  ScoringService,
  HealthScoreInput,
  ChargingInput,
  PredictiveChargingInput,
  TripEfficiencyInput,
  AlertInput,
} from '../scoring.service';
import { THRESHOLDS, DEFAULT_CONFIG, FleetConfig } from '../intelligence.constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHealthInput(overrides: Partial<HealthScoreInput> = {}): HealthScoreInput {
  return {
    vehicleId: 'v-1',
    batteryLevel: 80,
    fuelLevel: null,
    fuelType: 'ELECTRIC',
    telematicsEnabled: true,
    lastLogAt: new Date(Date.now() - 5 * 60_000), // 5 minutes ago
    recentTripCount: 5,
    obdCodes: [],
    hasOverdueMaintenance: false,
    overduePriority: null,
    ...overrides,
  };
}

function makeChargingInput(overrides: Partial<ChargingInput> = {}): ChargingInput {
  return {
    vehicleId: 'v-1',
    plateNumber: 'EV-001',
    make: 'Tesla',
    model: 'Model 3',
    batteryLevel: 15,
    batteryRange: 60,
    isCharging: false,
    status: 'AVAILABLE',
    upcomingTripCount: 0,
    ...overrides,
  };
}

function makePredictiveInput(overrides: Partial<PredictiveChargingInput> = {}): PredictiveChargingInput {
  return {
    vehicleId: 'v-1',
    plateNumber: 'EV-001',
    make: 'Tesla',
    model: 'Model 3',
    batteryLevel: 15,
    batteryRange: 60,
    isCharging: false,
    status: 'AVAILABLE',
    upcomingTripCount: 0,
    batteryHistory: [],
    ...overrides,
  };
}

function makeAlertInput(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    vehicleId: 'v-1',
    plateNumber: 'EV-001',
    make: 'Tesla',
    model: 'Model 3',
    fuelType: 'ELECTRIC',
    batteryLevel: 80,
    status: 'AVAILABLE',
    telematicsEnabled: true,
    lastLocationAt: new Date(),
    lastLogAt: new Date(),
    latestObdCodes: [],
    hasOverdueMaintenance: false,
    overduePriority: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(() => {
    service = new ScoringService();
  });

  // ─── Health scoring ────────────────────────────────────────────────────────

  describe('computeHealthScore', () => {
    it('scores an ideal EV correctly (80% battery, fresh telemetry, 5 recent trips)', () => {
      // energy: (80/100)*40=32  freshness: 20  utilization: 20  diagnostics: 10  maintenance: 10
      const result = service.computeHealthScore(makeHealthInput());
      expect(result.score).toBe(92);
      expect(result.grade).toBe('A');
      expect(result.flags).toHaveLength(0);
      expect(result.components).toEqual({
        energy: 32,
        freshness: 20,
        utilization: 20,
        diagnostics: 10,
        maintenance: 10,
      });
    });

    it('gives full energy score for 100% battery', () => {
      const r = service.computeHealthScore(makeHealthInput({ batteryLevel: 100 }));
      expect(r.components.energy).toBe(40);
    });

    it('gives 0 energy score and flags for 0% battery', () => {
      const r = service.computeHealthScore(makeHealthInput({ batteryLevel: 0 }));
      expect(r.components.energy).toBe(0);
      expect(r.flags.some((f) => f.includes('Critical energy level'))).toBe(true);
    });

    it('gives 0 freshness and flag when telematics enabled but no log', () => {
      const r = service.computeHealthScore(makeHealthInput({ lastLogAt: null }));
      expect(r.components.freshness).toBe(0);
      expect(r.flags.some((f) => f.includes('No telematics data'))).toBe(true);
    });

    it('gives full freshness score when telematics is disabled', () => {
      const r = service.computeHealthScore(
        makeHealthInput({ telematicsEnabled: false, lastLogAt: null }),
      );
      expect(r.components.freshness).toBe(20);
    });

    it('gives 15 freshness for a 15-minute-old log', () => {
      const r = service.computeHealthScore(
        makeHealthInput({ lastLogAt: new Date(Date.now() - 15 * 60_000) }),
      );
      expect(r.components.freshness).toBe(15);
    });

    it('gives 0 freshness for a 7-hour-old log', () => {
      const r = service.computeHealthScore(
        makeHealthInput({ lastLogAt: new Date(Date.now() - 7 * 3_600_000) }),
      );
      expect(r.components.freshness).toBe(0);
    });

    it('deducts OBD fault penalty per code', () => {
      const r = service.computeHealthScore(makeHealthInput({ obdCodes: ['P0301', 'P0302'] }));
      // 2 faults × 5 penalty = 10 deducted from 10 → 0
      expect(r.components.diagnostics).toBe(0);
      expect(r.flags.some((f) => f.includes('OBD fault'))).toBe(true);
    });

    it('caps OBD penalty at THRESHOLDS.health.maxObdPenalty', () => {
      // 5 faults × 5 = 25, but max penalty is 10
      const r = service.computeHealthScore(
        makeHealthInput({ obdCodes: ['P0301', 'P0302', 'P0303', 'P0304', 'P0305'] }),
      );
      expect(r.components.diagnostics).toBeGreaterThanOrEqual(0);
    });

    it('deducts maintenance penalty for high-priority overdue', () => {
      const r = service.computeHealthScore(
        makeHealthInput({ hasOverdueMaintenance: true, overduePriority: 'URGENT' }),
      );
      expect(r.components.maintenance).toBe(0);
      expect(r.flags.some((f) => f.includes('Maintenance overdue'))).toBe(true);
    });

    it('deducts partial maintenance penalty for low-priority overdue', () => {
      const r = service.computeHealthScore(
        makeHealthInput({ hasOverdueMaintenance: true, overduePriority: 'LOW' }),
      );
      expect(r.components.maintenance).toBe(5);
    });

    it('uses fuelLevel for ICE vehicles', () => {
      const r = service.computeHealthScore(
        makeHealthInput({ fuelType: 'PETROL', batteryLevel: null, fuelLevel: 50 }),
      );
      expect(r.components.energy).toBe(Math.round((50 / 100) * 40));
    });

    it('gives neutral energy score for ICE vehicle with unknown fuel', () => {
      const r = service.computeHealthScore(
        makeHealthInput({ fuelType: 'PETROL', batteryLevel: null, fuelLevel: null }),
      );
      expect(r.components.energy).toBe(20);
    });

    it('assigns grade A for score ≥ 90', () => {
      expect(service.toGrade(95)).toBe('A');
      expect(service.toGrade(90)).toBe('A');
    });

    it('assigns grade B for score 75–89', () => {
      expect(service.toGrade(80)).toBe('B');
    });

    it('assigns grade F for score < 40', () => {
      expect(service.toGrade(35)).toBe('F');
      expect(service.toGrade(0)).toBe('F');
    });

    it('score is clamped to 0 minimum', () => {
      const r = service.computeHealthScore(
        makeHealthInput({
          batteryLevel: 0,
          lastLogAt: null,
          obdCodes: ['P1', 'P2', 'P3'],
          hasOverdueMaintenance: true,
          overduePriority: 'CRITICAL',
          recentTripCount: 0,
        }),
      );
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    });
  });

  // ─── Charging recommendations ──────────────────────────────────────────────

  describe('computeChargingRecommendation', () => {
    it('returns critical urgency for battery ≤ 10%', () => {
      const r = service.computeChargingRecommendation(makeChargingInput({ batteryLevel: 8 }));
      expect(r).not.toBeNull();
      expect(r!.urgency).toBe('critical');
      expect(r!.suggestedAction).toMatch(/immediately/i);
    });

    it('returns high urgency for battery between 11–20%', () => {
      const r = service.computeChargingRecommendation(makeChargingInput({ batteryLevel: 18 }));
      expect(r!.urgency).toBe('high');
      expect(r!.suggestedAction).toMatch(/1 hour/i);
    });

    it('returns medium urgency for battery between 21–40%', () => {
      const r = service.computeChargingRecommendation(makeChargingInput({ batteryLevel: 35 }));
      expect(r!.urgency).toBe('medium');
      expect(r!.suggestedAction).toMatch(/4 hours/i);
    });

    it('returns low urgency for battery between 41–60%', () => {
      const r = service.computeChargingRecommendation(makeChargingInput({ batteryLevel: 55 }));
      expect(r!.urgency).toBe('low');
    });

    it('returns null for battery > 60%', () => {
      const r = service.computeChargingRecommendation(makeChargingInput({ batteryLevel: 75 }));
      expect(r).toBeNull();
    });

    it('returns null when batteryLevel is null', () => {
      const r = service.computeChargingRecommendation(makeChargingInput({ batteryLevel: null }));
      expect(r).toBeNull();
    });

    it('mentions upcoming trips in the reason', () => {
      const r = service.computeChargingRecommendation(
        makeChargingInput({ batteryLevel: 15, upcomingTripCount: 3 }),
      );
      expect(r!.reason).toMatch(/3 trip/);
    });

    it('notes currently-charging vehicles in reason', () => {
      const r = service.computeChargingRecommendation(
        makeChargingInput({ batteryLevel: 15, isCharging: true }),
      );
      expect(r!.reason).toMatch(/currently charging/i);
    });
  });

  describe('sortRecommendations', () => {
    function makeRec(batteryLevel: number, isCurrentlyCharging: boolean) {
      return {
        vehicleId: 'v-1', plateNumber: 'EV-001', make: 'Tesla', model: 'Model 3',
        batteryLevel, batteryRangeKm: null, urgency: 'high' as const,
        reason: '', suggestedAction: '', isCurrentlyCharging, upcomingTrips: 0,
      };
    }

    it('puts non-charging vehicles before charging ones', () => {
      const recs = [makeRec(15, true), makeRec(15, false)];
      const sorted = service.sortRecommendations(recs);
      expect(sorted[0].isCurrentlyCharging).toBe(false);
    });

    it('sorts by battery level ascending within same charging state', () => {
      const sorted = service.sortRecommendations([makeRec(15, false), makeRec(5, false)]);
      expect(sorted[0].batteryLevel).toBe(5);
    });
  });

  // ─── Trip efficiency ───────────────────────────────────────────────────────

  describe('computeTripEfficiency', () => {
    it('returns empty result for empty input', () => {
      const r = service.computeTripEfficiency([]);
      expect(r.totalTripsAnalyzed).toBe(0);
      expect(r.inefficientTrips).toHaveLength(0);
    });

    it('filters out trips below minimum distance', () => {
      const trip: TripEfficiencyInput = {
        id: 't1', vehicleId: 'v1', driverId: 'd1',
        distanceKm: 0.1,    // below 0.5 km threshold
        durationMin: 5,
        fare: 5,
      };
      const r = service.computeTripEfficiency([trip]);
      expect(r.totalTripsAnalyzed).toBe(0);
    });

    it('flags a trip with very low speed', () => {
      const slowTrip: TripEfficiencyInput = {
        id: 't1', vehicleId: 'v1', driverId: 'd1',
        distanceKm: 2,
        durationMin: 200,   // 0.6 km/h — well below any fleet avg
        fare: 10,
      };
      const normalTrip: TripEfficiencyInput = {
        id: 't2', vehicleId: 'v2', driverId: 'd2',
        distanceKm: 20,
        durationMin: 30,    // 40 km/h
        fare: 30,
      };
      const r = service.computeTripEfficiency([slowTrip, normalTrip]);
      const flagged = r.inefficientTrips.find((t) => t.tripId === 't1');
      expect(flagged).toBeDefined();
      expect(flagged!.flags.some((f) => f.includes('below 50%'))).toBe(true);
    });

    it('flags a trip with excessive duration per km', () => {
      const trip: TripEfficiencyInput = {
        id: 't1', vehicleId: 'v1', driverId: 'd1',
        distanceKm: 1,
        durationMin: 60,    // 60 min/km — far above 15 min/km threshold
        fare: 8,
      };
      const r = service.computeTripEfficiency([trip]);
      const flagged = r.inefficientTrips[0];
      expect(flagged.flags.some((f) => f.includes('excessive time'))).toBe(true);
    });

    it('computes correct fleet average speed', () => {
      const trips: TripEfficiencyInput[] = [
        { id: 't1', vehicleId: 'v1', driverId: 'd1', distanceKm: 30, durationMin: 30, fare: 30 }, // 60 km/h
        { id: 't2', vehicleId: 'v2', driverId: 'd2', distanceKm: 20, durationMin: 30, fare: 20 }, // 40 km/h
      ];
      const r = service.computeTripEfficiency(trips);
      expect(r.fleetAvgSpeedKmh).toBeCloseTo(50, 1); // (60+40)/2 = 50
    });

    it('groups vehicle summaries correctly', () => {
      const trips: TripEfficiencyInput[] = [
        { id: 't1', vehicleId: 'v1', driverId: 'd1', distanceKm: 10, durationMin: 10, fare: 10 }, // 60 km/h
        { id: 't2', vehicleId: 'v1', driverId: 'd1', distanceKm: 20, durationMin: 20, fare: 20 }, // 60 km/h
        { id: 't3', vehicleId: 'v2', driverId: 'd2', distanceKm: 10, durationMin: 20, fare: 15 }, // 30 km/h
      ];
      const r = service.computeTripEfficiency(trips);
      expect(r.vehicleSummaries).toHaveLength(2);
      const v1 = r.vehicleSummaries.find((s) => s.vehicleId === 'v1');
      expect(v1!.tripCount).toBe(2);
      expect(v1!.avgSpeedKmh).toBeCloseTo(60, 1);
    });
  });

  // ─── Alert engine ──────────────────────────────────────────────────────────

  describe('evaluateAlerts', () => {
    it('returns no alerts for a healthy vehicle', () => {
      const alerts = service.evaluateAlerts(makeAlertInput());
      expect(alerts).toHaveLength(0);
    });

    it('raises LOW_BATTERY critical alert for battery ≤ 10%', () => {
      const alerts = service.evaluateAlerts(makeAlertInput({ batteryLevel: 8 }));
      const alert = alerts.find((a) => a.type === 'LOW_BATTERY');
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe('critical');
    });

    it('raises LOW_BATTERY warning alert for battery between 11–20%', () => {
      const alerts = service.evaluateAlerts(makeAlertInput({ batteryLevel: 18 }));
      const alert = alerts.find((a) => a.type === 'LOW_BATTERY');
      expect(alert!.severity).toBe('warning');
    });

    it('does NOT raise LOW_BATTERY for ICE vehicles', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ fuelType: 'PETROL', batteryLevel: 5 }),
      );
      expect(alerts.find((a) => a.type === 'LOW_BATTERY')).toBeUndefined();
    });

    it('raises VEHICLE_INACTIVE when last location is > 6 hours ago', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ lastLocationAt: new Date(Date.now() - 7 * 3_600_000) }),
      );
      expect(alerts.find((a) => a.type === 'VEHICLE_INACTIVE')).toBeDefined();
    });

    it('does NOT raise VEHICLE_INACTIVE for vehicles with recent GPS', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ lastLocationAt: new Date(Date.now() - 1 * 3_600_000) }),
      );
      expect(alerts.find((a) => a.type === 'VEHICLE_INACTIVE')).toBeUndefined();
    });

    it('raises TELEMETRY_GAP when enabled vehicle has no log for > 30 min', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ lastLogAt: new Date(Date.now() - 60 * 60_000) }),
      );
      expect(alerts.find((a) => a.type === 'TELEMETRY_GAP')).toBeDefined();
    });

    it('does NOT raise TELEMETRY_GAP when telematics is disabled', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ telematicsEnabled: false, lastLogAt: null }),
      );
      expect(alerts.find((a) => a.type === 'TELEMETRY_GAP')).toBeUndefined();
    });

    it('raises OBD_FAULT when fault codes are present', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ latestObdCodes: ['P0301'] }),
      );
      const alert = alerts.find((a) => a.type === 'OBD_FAULT');
      expect(alert).toBeDefined();
      expect(alert!.metadata.codes).toEqual(['P0301']);
    });

    it('raises critical OBD_FAULT for 3+ fault codes', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ latestObdCodes: ['P0301', 'P0302', 'P0303'] }),
      );
      expect(alerts.find((a) => a.type === 'OBD_FAULT')!.severity).toBe('critical');
    });

    it('raises MAINTENANCE_OVERDUE when maintenance is past due', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ hasOverdueMaintenance: true, overduePriority: 'HIGH' }),
      );
      expect(alerts.find((a) => a.type === 'MAINTENANCE_OVERDUE')).toBeDefined();
    });

    it('raises critical MAINTENANCE_OVERDUE for URGENT/CRITICAL priority', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({ hasOverdueMaintenance: true, overduePriority: 'URGENT' }),
      );
      expect(alerts.find((a) => a.type === 'MAINTENANCE_OVERDUE')!.severity).toBe('critical');
    });

    it('generates deterministic alert IDs', () => {
      const a1 = service.evaluateAlerts(makeAlertInput({ batteryLevel: 5 }));
      const a2 = service.evaluateAlerts(makeAlertInput({ batteryLevel: 5 }));
      expect(a1[0].id).toBe(a2[0].id);
      expect(a1[0].id).toBe('LOW_BATTERY:v-1');
    });

    it('can raise multiple alerts for the same vehicle', () => {
      const alerts = service.evaluateAlerts(
        makeAlertInput({
          batteryLevel: 5,
          lastLocationAt: new Date(Date.now() - 8 * 3_600_000),
          latestObdCodes: ['P0301'],
          hasOverdueMaintenance: true,
          overduePriority: 'HIGH',
        }),
      );
      expect(alerts.length).toBeGreaterThanOrEqual(3);
    });

    it('includes severityScore (0–100) on every alert', () => {
      const alerts = service.evaluateAlerts(makeAlertInput({ batteryLevel: 5 }));
      for (const alert of alerts) {
        expect(alert.severityScore).toBeGreaterThanOrEqual(0);
        expect(alert.severityScore).toBeLessThanOrEqual(100);
      }
    });

    it('includes priority derived from severityScore', () => {
      const alerts = service.evaluateAlerts(makeAlertInput({ batteryLevel: 5 }));
      const batteryAlert = alerts.find((a) => a.type === 'LOW_BATTERY')!;
      // Critical battery (5%) → score ≥ 90 → priority = 'critical'
      expect(batteryAlert.severityScore).toBeGreaterThanOrEqual(90);
      expect(batteryAlert.priority).toBe('critical');
    });

    it('maps severityScore 50–74 to high priority', () => {
      // HIGH maintenance → score 65 → priority 'high'
      const alerts = service.evaluateAlerts(
        makeAlertInput({ hasOverdueMaintenance: true, overduePriority: 'HIGH' }),
      );
      const maint = alerts.find((a) => a.type === 'MAINTENANCE_OVERDUE')!;
      expect(maint.severityScore).toBe(65);
      expect(maint.priority).toBe('high');
    });

    it('maps severityScore 30–49 to medium priority', () => {
      // LOW maintenance → score 35 → priority 'medium'
      const alerts = service.evaluateAlerts(
        makeAlertInput({ hasOverdueMaintenance: true, overduePriority: 'LOW' }),
      );
      const maint = alerts.find((a) => a.type === 'MAINTENANCE_OVERDUE')!;
      expect(maint.severityScore).toBe(35);
      expect(maint.priority).toBe('medium');
    });
  });

  // ─── Predictive charging ──────────────────────────────────────────────────

  describe('computePredictiveCharging', () => {
    it('returns null for battery > low threshold', () => {
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryLevel: 75 }));
      expect(r).toBeNull();
    });

    it('uses 15%/h estimated drain rate when no history provided', () => {
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryLevel: 15 }));
      expect(r).not.toBeNull();
      expect(r!.predictionBasis).toBe('estimated');
      expect(r!.drainRatePerHour).toBe(15);
    });

    it('computes timeToDepletionMin correctly from estimated drain rate', () => {
      // battery=15%, critical=10%, drain=15%/h → (15-10)/15 * 60 = 20 min
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryLevel: 15 }));
      expect(r!.timeToDepletionMin).toBe(20);
    });

    it('escalates urgency to critical when timeToDepletion < 30 min', () => {
      // battery=15%, drain=15%/h → 20 min to depletion → escalates to critical
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryLevel: 15 }));
      expect(r!.urgency).toBe('critical');
    });

    it('computes drain rate from telemetry history', () => {
      const now = Date.now();
      const batteryHistory = [
        { timestamp: new Date(now - 2 * 3_600_000), batteryLevel: 40 }, // 2h ago: 40%
        { timestamp: new Date(now),                  batteryLevel: 20 }, // now:    20%
        // drain = 20%/2h = 10%/h
      ];
      const r = service.computePredictiveCharging(
        makePredictiveInput({ batteryLevel: 20, batteryHistory }),
      );
      expect(r!.predictionBasis).toBe('telemetry');
      expect(r!.drainRatePerHour).toBeCloseTo(10, 1);
    });

    it('falls back to estimated rate when history shows no drain (charging)', () => {
      const now = Date.now();
      const batteryHistory = [
        { timestamp: new Date(now - 3_600_000), batteryLevel: 10 },
        { timestamp: new Date(now),             batteryLevel: 50 }, // battery went up
      ];
      const r = service.computePredictiveCharging(
        makePredictiveInput({ batteryLevel: 15, isCharging: true, batteryHistory }),
      );
      // batteryDrop is negative → no telemetry rate → isCharging → drainRate null
      expect(r!.drainRatePerHour).toBeNull();
      expect(r!.predictionBasis).toBe('estimated');
    });

    it('includes recommendedChargeBy timestamp when above medium threshold', () => {
      // battery=50% (below low=60, above medium=40), drain=15%/h
      // minutesToMedium = (50-40)/15*60 = 40 min → recommendedChargeBy = now + 40 min
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryLevel: 50 }));
      expect(r).not.toBeNull();
      expect(r!.recommendedChargeBy).not.toBeNull();
      const recommended = new Date(r!.recommendedChargeBy!).getTime();
      expect(recommended).toBeGreaterThan(Date.now());
    });

    it('sets recommendedChargeBy to now when already below medium threshold', () => {
      // battery=15% < medium=40% → recommend immediately
      const before = Date.now();
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryLevel: 15 }));
      const recommended = new Date(r!.recommendedChargeBy!).getTime();
      expect(recommended).toBeGreaterThanOrEqual(before - 100); // within ~100ms
      expect(recommended).toBeLessThanOrEqual(Date.now() + 100);
    });

    it('ignores history with < 2 valid readings', () => {
      const batteryHistory = [{ timestamp: new Date(), batteryLevel: 20 }];
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryHistory }));
      expect(r!.predictionBasis).toBe('estimated');
    });

    it('ignores history with null battery levels', () => {
      const now = Date.now();
      const batteryHistory = [
        { timestamp: new Date(now - 3_600_000), batteryLevel: null },
        { timestamp: new Date(now),             batteryLevel: null },
      ];
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryHistory }));
      expect(r!.predictionBasis).toBe('estimated');
    });

    it('inherits all base ChargingRecommendation fields', () => {
      const r = service.computePredictiveCharging(makePredictiveInput({ batteryLevel: 15, upcomingTripCount: 2 }));
      expect(r!.vehicleId).toBe('v-1');
      expect(r!.plateNumber).toBe('EV-001');
      expect(r!.upcomingTrips).toBe(2);
    });
  });

  // ─── Custom FleetConfig ───────────────────────────────────────────────────

  describe('custom FleetConfig', () => {
    it('respects custom battery thresholds for health scoring', () => {
      const customConfig: FleetConfig = {
        ...DEFAULT_CONFIG,
        battery: { critical: 20, high: 30, medium: 50, low: 70 },
      };
      const r = service.computeHealthScore(
        makeHealthInput({ batteryLevel: 25 }), // 25% is above default critical (10) but below custom critical (20)
        customConfig,
      );
      expect(r.flags.some((f) => f.includes('Low energy level'))).toBe(true);
    });

    it('respects custom health weights summing to 100', () => {
      const customConfig: FleetConfig = {
        ...DEFAULT_CONFIG,
        health: {
          ...DEFAULT_CONFIG.health,
          weights: { energy: 50, freshness: 20, utilization: 10, diagnostics: 10, maintenance: 10 },
        },
      };
      const r = service.computeHealthScore(makeHealthInput({ batteryLevel: 100 }), customConfig);
      expect(r.components.energy).toBe(50);
    });

    it('respects custom inactivity threshold for alerts', () => {
      const customConfig: FleetConfig = {
        ...DEFAULT_CONFIG,
        inactivity: { vehicleHours: 2, telemetryMinutes: 10 },
      };
      // 3h old location → above custom 2h threshold → alert raised
      const alerts = service.evaluateAlerts(
        makeAlertInput({ lastLocationAt: new Date(Date.now() - 3 * 3_600_000) }),
        customConfig,
      );
      expect(alerts.find((a) => a.type === 'VEHICLE_INACTIVE')).toBeDefined();
    });

    it('no VEHICLE_INACTIVE alert with default config for same 3h gap', () => {
      // Default threshold is 6h → 3h should NOT trigger
      const alerts = service.evaluateAlerts(
        makeAlertInput({ lastLocationAt: new Date(Date.now() - 3 * 3_600_000) }),
      );
      expect(alerts.find((a) => a.type === 'VEHICLE_INACTIVE')).toBeUndefined();
    });

    it('respects custom charging low threshold', () => {
      const customConfig: FleetConfig = {
        ...DEFAULT_CONFIG,
        battery: { critical: 10, high: 20, medium: 40, low: 80 }, // wider low threshold
      };
      // 70% battery — normally no recommendation, but above custom low=80? → still no (above)
      // Actually with low=80, battery=70 < 80 → should trigger
      const r = service.computeChargingRecommendation(
        makeChargingInput({ batteryLevel: 70 }), customConfig,
      );
      expect(r).not.toBeNull();
      expect(r!.urgency).toBe('low');
    });
  });
});
