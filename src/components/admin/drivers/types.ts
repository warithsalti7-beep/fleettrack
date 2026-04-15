/**
 * Shared types for the /admin/drivers migration. Kept separate so
 * both the server page and client components import from one place —
 * avoids drift when the API shape evolves.
 */

/** Shape of a row returned by /api/drivers (with our includes). */
export type DriverRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string;
  status: string;
  rating: number;
  totalTrips: number;
  joinedAt: string;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  vehicles: Array<{ vehicle: { plateNumber: string; make: string; model: string } }>;
  _count: { trips: number };
};

/** Shape returned by /api/stats/per-driver. */
export type DriverPerfRow = {
  driverId: string;
  name: string;
  email: string;
  trips: number;
  completedTrips: number;
  cancelledTrips: number;
  revenueNok: number;
  distanceKm: number;
  onlineHours: number;
  revenuePerHour: number;
  tripsPerHour: number;
  acceptanceRate: number;
  cancellationRate: number;
  avgFare: number;
  avgRating: number;
  score: number;
};

/** Row shape the table renders — a merge of the above two. */
export type DriverView = {
  id: string;
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string;
  status: string;
  rating: number;
  totalTrips: number;
  joinedAt: string;
  address: string | null;
  plate: string | null;
  vehicle: string | null;
  // Live 7-day performance (may be zero for brand-new drivers).
  revenueNok: number;
  revenuePerHour: number;
  tripsPerHour: number;
  acceptanceRate: number;
  score: number;
  onlineHours: number;
};

export function mergeDriverViews(
  drivers: DriverRow[],
  perf: DriverPerfRow[],
): DriverView[] {
  const perfIndex = new Map<string, DriverPerfRow>();
  for (const p of perf) perfIndex.set(p.driverId, p);
  return drivers.map((d) => {
    const p = perfIndex.get(d.id);
    const firstVeh = d.vehicles[0]?.vehicle;
    return {
      id: d.id,
      name: d.name,
      email: d.email,
      phone: d.phone,
      licenseNumber: d.licenseNumber,
      licenseExpiry: d.licenseExpiry,
      status: d.status,
      rating: d.rating,
      totalTrips: d.totalTrips,
      joinedAt: d.joinedAt,
      address: d.address,
      plate: firstVeh?.plateNumber ?? null,
      vehicle: firstVeh ? [firstVeh.make, firstVeh.model].filter(Boolean).join(" ") : null,
      revenueNok: p?.revenueNok ?? 0,
      revenuePerHour: p?.revenuePerHour ?? 0,
      tripsPerHour: p?.tripsPerHour ?? 0,
      acceptanceRate: p?.acceptanceRate ?? 0,
      score: p?.score ?? 0,
      onlineHours: p?.onlineHours ?? 0,
    };
  });
}

export const DRIVER_STATUSES = ["AVAILABLE", "ON_TRIP", "OFF_DUTY", "MAINTENANCE"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];
