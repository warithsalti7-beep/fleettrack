/**
 * RecommendationsService unit tests.
 *
 * Prisma is mocked so no database is required.
 * All analysis is pure in-memory computation — the DB mock just supplies the
 * trip fixtures that the service would normally query.
 */

import { RecommendationsService } from '../recommendations.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrip(overrides: Record<string, any> = {}) {
  return {
    id: 'trip-1',
    vehicleId: 'v-1',
    driverId: 'd-1',
    status: 'COMPLETED',
    distanceKm: 10,
    durationMin: 15,  // 40 km/h
    completedAt: new Date(),
    driver: { id: 'd-1', name: 'Alice' },
    vehicle: { id: 'v-1', plateNumber: 'EV-001', make: 'Tesla', model: 'Model 3' },
    ...overrides,
  };
}

function makeService(tripFixtures: any[]) {
  const mockPrisma = {
    trip: {
      findMany: jest.fn().mockResolvedValue(tripFixtures),
    },
  };
  const service = new RecommendationsService(mockPrisma as any);
  return service;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecommendationsService', () => {

  describe('getRecommendations — empty fleet', () => {
    it('returns empty array when no trips', async () => {
      const service = makeService([]);
      const recs = await service.getRecommendations();
      expect(recs).toEqual([]);
    });
  });

  describe('DRIVER_LOW_COMPLETION_RATE', () => {
    it('flags a driver with < 80% completion rate (min 5 trips)', async () => {
      // 4 completed, 4 cancelled = 50% completion over 8 trips
      const trips = [
        ...Array.from({ length: 4 }, (_, i) =>
          makeTrip({ id: `t-c${i}`, status: 'COMPLETED', driverId: 'd-1', driver: { id: 'd-1', name: 'Bob' } }),
        ),
        ...Array.from({ length: 4 }, (_, i) =>
          makeTrip({ id: `t-x${i}`, status: 'CANCELLED', driverId: 'd-1', driver: { id: 'd-1', name: 'Bob' } }),
        ),
      ];
      const service = makeService(trips);
      const recs = await service.getRecommendations();
      const rec = recs.find((r) => r.type === 'DRIVER_LOW_COMPLETION_RATE');
      expect(rec).toBeDefined();
      expect(rec!.entity.label).toBe('Bob');
      expect(rec!.metrics.completionRatePct).toBe(50);
    });

    it('does NOT flag a driver with < 5 trips', async () => {
      const trips = [
        makeTrip({ id: 't-c1', status: 'COMPLETED', driverId: 'd-1', driver: { id: 'd-1', name: 'Carol' } }),
        makeTrip({ id: 't-x1', status: 'CANCELLED', driverId: 'd-1', driver: { id: 'd-1', name: 'Carol' } }),
      ];
      const service = makeService(trips);
      const recs = await service.getRecommendations();
      expect(recs.find((r) => r.type === 'DRIVER_LOW_COMPLETION_RATE')).toBeUndefined();
    });

    it('does NOT flag a driver with ≥ 80% completion', async () => {
      const trips = Array.from({ length: 10 }, (_, i) =>
        makeTrip({ id: `t${i}`, status: 'COMPLETED', driverId: 'd-1', driver: { id: 'd-1', name: 'Eve' } }),
      );
      const service = makeService(trips);
      const recs = await service.getRecommendations();
      expect(recs.find((r) => r.type === 'DRIVER_LOW_COMPLETION_RATE')).toBeUndefined();
    });
  });

  describe('DRIVER_BELOW_FLEET_SPEED', () => {
    it('flags a driver whose avg speed is < 80% of fleet average', async () => {
      // Fast drivers: d-2 and d-3 at 60 km/h (10 km / 10 min)
      // Slow driver:  d-1 at 10 km/h (5 km / 30 min)
      // Fleet avg ≈ (10+10+60+60+60)/5 = ??? — actually computed per-driver then averaged differently
      // Let's use many fast-driver trips vs one slow driver

      const fastTrips = Array.from({ length: 5 }, (_, i) =>
        makeTrip({
          id: `f${i}`, driverId: 'd-2', distanceKm: 20, durationMin: 20,
          driver: { id: 'd-2', name: 'Fast' },
        }),
      );
      const slowTrips = Array.from({ length: 5 }, (_, i) =>
        makeTrip({
          id: `s${i}`, driverId: 'd-1', distanceKm: 5, durationMin: 60,
          driver: { id: 'd-1', name: 'Slow' },
        }),
      );
      const service = makeService([...fastTrips, ...slowTrips]);
      const recs = await service.getRecommendations();
      const rec = recs.find((r) => r.type === 'DRIVER_BELOW_FLEET_SPEED');
      expect(rec).toBeDefined();
      expect(rec!.entity.label).toBe('Slow');
    });

    it('does NOT flag drivers when all speeds are within 80% of average', async () => {
      // Both drivers at similar speeds (30 vs 40 km/h — within 80% of each other)
      const trips = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeTrip({ id: `a${i}`, driverId: 'd-1', distanceKm: 30, durationMin: 60, driver: { id: 'd-1', name: 'A' } }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeTrip({ id: `b${i}`, driverId: 'd-2', distanceKm: 40, durationMin: 60, driver: { id: 'd-2', name: 'B' } }),
        ),
      ];
      const service = makeService(trips);
      const recs = await service.getRecommendations();
      expect(recs.find((r) => r.type === 'DRIVER_BELOW_FLEET_SPEED')).toBeUndefined();
    });
  });

  describe('DRIVER_HIGH_IDLE_RATIO', () => {
    it('flags a driver with > 1.3× fleet avg min/km', async () => {
      // High-idle driver: 60 min / 5 km = 12 min/km
      // Normal drivers:   15 min / 20 km = 0.75 min/km
      const highIdleTrips = Array.from({ length: 3 }, (_, i) =>
        makeTrip({
          id: `h${i}`, driverId: 'd-1', distanceKm: 5, durationMin: 60,
          driver: { id: 'd-1', name: 'High Idle' },
        }),
      );
      const normalTrips = Array.from({ length: 5 }, (_, i) =>
        makeTrip({
          id: `n${i}`, driverId: 'd-2', distanceKm: 20, durationMin: 15,
          driver: { id: 'd-2', name: 'Normal' },
        }),
      );
      const service = makeService([...highIdleTrips, ...normalTrips]);
      const recs = await service.getRecommendations();
      const rec = recs.find((r) => r.type === 'DRIVER_HIGH_IDLE_RATIO');
      expect(rec).toBeDefined();
      expect(rec!.entity.label).toBe('High Idle');
    });

    it('does NOT flag drivers with fewer than 3 trips', async () => {
      const trips = [
        makeTrip({ id: 't1', driverId: 'd-1', distanceKm: 1, durationMin: 60, driver: { id: 'd-1', name: 'Few' } }),
        makeTrip({ id: 't2', driverId: 'd-1', distanceKm: 1, durationMin: 60, driver: { id: 'd-1', name: 'Few' } }),
      ];
      const service = makeService(trips);
      const recs = await service.getRecommendations();
      expect(recs.find((r) => r.type === 'DRIVER_HIGH_IDLE_RATIO')).toBeUndefined();
    });
  });

  describe('VEHICLE_EFFICIENCY_DECLINE', () => {
    it('flags a vehicle with > 20% speed decline week over week', async () => {
      const now = Date.now();
      const sevenDaysAgo = new Date(now - 7 * 24 * 3_600_000);
      const tenDaysAgo   = new Date(now - 10 * 24 * 3_600_000);

      // Last 7 days: 20 km/h
      const recentTrips = Array.from({ length: 4 }, (_, i) =>
        makeTrip({
          id: `r${i}`, vehicleId: 'v-1', driverId: 'd-1', distanceKm: 10, durationMin: 30,
          completedAt: new Date(now - i * 24 * 3_600_000), // within last 7d
          driver: { id: 'd-1', name: 'Driver' },
          vehicle: { id: 'v-1', plateNumber: 'VH-001', make: 'NIO', model: 'ET7' },
        }),
      );

      // Prior 7 days: 60 km/h (3× faster)
      const priorTrips = Array.from({ length: 4 }, (_, i) =>
        makeTrip({
          id: `p${i}`, vehicleId: 'v-1', driverId: 'd-1', distanceKm: 30, durationMin: 30,
          completedAt: new Date(now - 8 * 24 * 3_600_000 - i * 24 * 3_600_000), // 8–11d ago
          driver: { id: 'd-1', name: 'Driver' },
          vehicle: { id: 'v-1', plateNumber: 'VH-001', make: 'NIO', model: 'ET7' },
        }),
      );

      const service = makeService([...recentTrips, ...priorTrips]);
      const recs = await service.getRecommendations();
      const rec = recs.find((r) => r.type === 'VEHICLE_EFFICIENCY_DECLINE');
      expect(rec).toBeDefined();
      expect(rec!.entity.type).toBe('vehicle');
      expect(rec!.metrics.declinePct).toBeGreaterThan(0);
    });

    it('does NOT flag a vehicle with < 3 trips in either window', async () => {
      const now = Date.now();
      const trips = [
        makeTrip({ id: 'r1', vehicleId: 'v-1', distanceKm: 10, durationMin: 60,
          completedAt: new Date(now - 1 * 24 * 3_600_000),
          vehicle: { id: 'v-1', plateNumber: 'P', make: 'M', model: 'X' },
        }),
      ];
      const service = makeService(trips);
      const recs = await service.getRecommendations();
      expect(recs.find((r) => r.type === 'VEHICLE_EFFICIENCY_DECLINE')).toBeUndefined();
    });
  });

  describe('result structure', () => {
    it('returns deterministic ids in format TYPE:entityId', async () => {
      const trips = Array.from({ length: 4 }, (_, i) =>
        makeTrip({ id: `t-c${i}`, status: 'CANCELLED', driverId: 'd-1', driver: { id: 'd-1', name: 'Bob' } }),
      ).concat(
        Array.from({ length: 2 }, (_, i) =>
          makeTrip({ id: `t-d${i}`, status: 'COMPLETED', driverId: 'd-1', driver: { id: 'd-1', name: 'Bob' } }),
        ),
      );
      const service = makeService(trips);
      const recs = await service.getRecommendations();
      const rec = recs.find((r) => r.type === 'DRIVER_LOW_COMPLETION_RATE');
      expect(rec?.id).toMatch(/^DRIVER_LOW_COMPLETION_RATE:/);
    });

    it('sorts warning before info', async () => {
      // Generate both a warning-level and info-level scenario
      const slowTrips = Array.from({ length: 5 }, (_, i) =>
        makeTrip({ id: `s${i}`, driverId: 'd-1', distanceKm: 3, durationMin: 60, driver: { id: 'd-1', name: 'Slow' } }),
      );
      const fastTrips = Array.from({ length: 5 }, (_, i) =>
        makeTrip({ id: `f${i}`, driverId: 'd-2', distanceKm: 40, durationMin: 20, driver: { id: 'd-2', name: 'Fast' } }),
      );
      const service = makeService([...slowTrips, ...fastTrips]);
      const recs = await service.getRecommendations();

      // All warnings should come before all infos
      let seenInfo = false;
      for (const r of recs) {
        if (r.severity === 'info') seenInfo = true;
        if (seenInfo) expect(r.severity).not.toBe('warning');
      }
    });
  });
});
