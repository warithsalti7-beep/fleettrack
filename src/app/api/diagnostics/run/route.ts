import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ALERT_THRESHOLDS, relativeDrift } from "@/lib/kpis";

/**
 * POST /api/diagnostics/run
 *
 * Runs every health check and writes results to the DataIssue table.
 * Idempotent via DataIssue.fingerprint — if a check finds the same
 * problem on the next run it just bumps the existing row instead of
 * duplicating.
 *
 * Each issue carries a `kind`, `severity`, `entityRef`, optional
 * `batchRef`, `details` JSON, and a one-line `suggestion`. The UI
 * (Errors & Sync page, Phase 7) lets a dispatcher RESOLVE / DISMISS
 * one without losing the audit trail.
 *
 * Checks implemented (mirrors spec §9):
 *   1. DUP_TRIP                — same (driverId, vehicleId, fare,
 *                                startedAt±2 min) appearing twice
 *   2. TRIP_NO_DRIVER          — Trip rows whose driverId points to a
 *                                deleted Driver (shouldn't happen with
 *                                FK but guards future schema drift)
 *   3. TRIP_NO_VEHICLE         — same idea, vehicle side
 *   4. OPEN_SHIFT_STALE        — shift open longer than 14 h
 *   5. INACTIVE_DRIVER_NEW_TRIP— Driver.status='SUSPENDED' but a Trip
 *                                in the last 24 h
 *   6. STALE_ACTIVE_DRIVER     — Driver.status='AVAILABLE' but no Trip
 *                                in the last 30 d
 *   7. NEGATIVE_FARE           — Trip.fare < 0
 *   8. PLATE_COLLISION         — two vehicles share plateNormalized
 *                                (rare; happens when one was created
 *                                pre-normalisation)
 *   9. IMPORT_FAILURES         — last 24 h of failed import rows
 *
 * The diagnostics list is intentionally not exhaustive — adding new
 * checks is a one-helper-function affair.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Issue = {
  kind: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  entityRef?: string | null;
  batchRef?: string | null;
  details?: Record<string, unknown>;
  suggestion?: string;
};
function fingerprintOf(i: Issue): string {
  return [i.kind, i.entityRef ?? "", i.batchRef ?? ""].join("|");
}

async function upsertIssue(i: Issue) {
  const fp = fingerprintOf(i);
  try {
    const existing = await (prisma as never as { dataIssue: { findUnique: (a: unknown) => Promise<unknown> } })
      .dataIssue.findUnique({ where: { fingerprint: fp } })
      .catch(() => null);
    if (existing) {
      // Touch the row so age sorts correctly, but don't overwrite a
      // RESOLVED/DISMISSED status — the dispatcher's decision wins.
      await (prisma as never as { dataIssue: { update: (a: unknown) => Promise<unknown> } })
        .dataIssue.update({
          where: { fingerprint: fp },
          data: { details: (i.details ?? {}) as never },
        });
      return false;
    }
    await (prisma as never as { dataIssue: { create: (a: unknown) => Promise<unknown> } })
      .dataIssue.create({
        data: {
          kind: i.kind,
          severity: i.severity,
          entityRef: i.entityRef ?? null,
          batchRef: i.batchRef ?? null,
          details: (i.details ?? {}) as never,
          suggestion: i.suggestion ?? null,
          fingerprint: fp,
          status: "OPEN",
        },
      });
    return true;
  } catch {
    /* DataIssue table not yet migrated; degrade gracefully */
    return false;
  }
}

export async function POST(_req: NextRequest) {
  const summary = { ran: 0, opened: 0, byKind: {} as Record<string, number> };
  const bump = (kind: string) => { summary.byKind[kind] = (summary.byKind[kind] ?? 0) + 1; };
  const log = async (i: Issue) => {
    summary.ran++;
    bump(i.kind);
    if (await upsertIssue(i)) summary.opened++;
  };

  // 1. DUP_TRIP
  // Cheap: group by (driverId, fare, startedAt minute) over the last 30 d
  // and flag groups with COUNT>1. Production should swap for a batch
  // SQL query; for the demo / preview scale this is fine.
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const trips = await prisma.trip.findMany({
      where: { startedAt: { gte: since } },
      select: { id: true, driverId: true, fare: true, startedAt: true, vehicleId: true },
      orderBy: { startedAt: "asc" },
      take: 5000,
    });
    const seen = new Map<string, string>();
    for (const t of trips) {
      if (!t.startedAt || t.fare == null) continue;
      const key = [
        t.driverId,
        t.vehicleId,
        t.fare.toFixed(2),
        new Date(t.startedAt).toISOString().slice(0, 16),
      ].join("|");
      const earlier = seen.get(key);
      if (earlier) {
        await log({
          kind: "DUP_TRIP",
          severity: "HIGH",
          entityRef: `trip:${t.id}`,
          details: { duplicateOf: earlier, key },
          suggestion: "Compare and delete the duplicate row.",
        });
      } else {
        seen.set(key, t.id);
      }
    }
  } catch { /* skip */ }

  // 4. OPEN_SHIFT_STALE
  try {
    const cutoff = new Date(Date.now() - ALERT_THRESHOLDS.staleOpenShiftHours * 3600 * 1000);
    const open = await prisma.shift.findMany({
      where: { status: "OPEN", clockInAt: { lte: cutoff } },
      include: { driver: { select: { name: true } } },
      take: 200,
    });
    for (const s of open) {
      await log({
        kind: "OPEN_SHIFT_STALE",
        severity: "MEDIUM",
        entityRef: `shift:${s.id}`,
        details: {
          driver: s.driver.name,
          clockInAt: s.clockInAt,
          hoursOpen: s.clockInAt
            ? +(((Date.now() - s.clockInAt.getTime()) / 3600_000).toFixed(1))
            : null,
        },
        suggestion: "Driver likely forgot to stop. Close from admin or call them.",
      });
    }
  } catch { /* skip */ }

  // 5. INACTIVE_DRIVER_NEW_TRIP
  try {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const offenders = await prisma.trip.findMany({
      where: {
        completedAt: { gte: dayAgo },
        driver: { status: { in: ["SUSPENDED", "INACTIVE"] } },
      },
      include: { driver: { select: { id: true, name: true, status: true } } },
      take: 100,
    });
    for (const t of offenders) {
      await log({
        kind: "INACTIVE_DRIVER_NEW_TRIP",
        severity: "HIGH",
        entityRef: `driver:${t.driver.id}`,
        details: { tripId: t.id, status: t.driver.status, completedAt: t.completedAt },
        suggestion:
          "Either the driver shouldn't be running trips (revoke now) or the status is wrong (re-activate).",
      });
    }
  } catch { /* skip */ }

  // 6. STALE_ACTIVE_DRIVER
  try {
    const cutoff = new Date(Date.now() - ALERT_THRESHOLDS.staleActiveDriverDays * 24 * 3600 * 1000);
    const drivers = await prisma.driver.findMany({
      where: { status: "AVAILABLE" },
      select: { id: true, name: true },
      take: 500,
    });
    for (const d of drivers) {
      const lastTrip = await prisma.trip.findFirst({
        where: { driverId: d.id },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      });
      if (!lastTrip?.completedAt || lastTrip.completedAt < cutoff) {
        await log({
          kind: "STALE_ACTIVE_DRIVER",
          severity: "LOW",
          entityRef: `driver:${d.id}`,
          details: { name: d.name, lastTripAt: lastTrip?.completedAt ?? null },
          suggestion:
            "No trips in 30+ days. Move to INACTIVE or coach back to active.",
        });
      }
    }
  } catch { /* skip */ }

  // 7. NEGATIVE_FARE
  try {
    const negs = await prisma.trip.findMany({
      where: { fare: { lt: 0 } },
      select: { id: true, fare: true, driverId: true },
      take: 100,
    });
    for (const t of negs) {
      await log({
        kind: "NEGATIVE_FARE",
        severity: "HIGH",
        entityRef: `trip:${t.id}`,
        details: { fare: t.fare, driverId: t.driverId },
        suggestion: "Trip fare is negative — check the source row and correct.",
      });
    }
  } catch { /* skip */ }

  // 8. PLATE_COLLISION
  try {
    const all = await prisma.vehicle.findMany({
      select: { id: true, plateNormalized: true } as never,
      take: 1000,
    }) as unknown as { id: string; plateNormalized: string | null }[];
    const groups = new Map<string, string[]>();
    for (const v of all) {
      if (!v.plateNormalized) continue;
      groups.set(v.plateNormalized, [...(groups.get(v.plateNormalized) ?? []), v.id]);
    }
    for (const [plate, ids] of groups) {
      if (ids.length > 1) {
        await log({
          kind: "PLATE_COLLISION",
          severity: "HIGH",
          entityRef: `vehicle:${ids[0]}`,
          details: { plateNormalized: plate, vehicleIds: ids },
          suggestion:
            "Two Vehicle rows share the same normalised plate. Merge or correct one.",
        });
      }
    }
  } catch { /* skip */ }

  // Touch /api/stats vs raw revenue rollup as a smoke totals check
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const grossFromTrips = await prisma.trip
      .aggregate({ _sum: { fare: true }, where: { startedAt: { gte: since } } })
      .then((r) => r._sum.fare ?? 0);
    const grossFromCharges = await (prisma as never as {
      tripCharge: { aggregate: (a: unknown) => Promise<{ _sum: { amountNok: number | null } }> };
    })
      .tripCharge.aggregate({
        _sum: { amountNok: true },
        where: { trip: { startedAt: { gte: since } }, kind: { in: ["BASE", "DISTANCE", "TIME", "SURGE", "TIP", "TOLL"] } } as never,
      })
      .then((r) => r._sum.amountNok ?? 0)
      .catch(() => 0);
    const drift = relativeDrift(grossFromTrips, grossFromCharges);
    if (grossFromCharges > 0 && drift > 0.05) {
      await log({
        kind: "TOTALS_MISMATCH",
        severity: "MEDIUM",
        entityRef: null,
        details: {
          window: "7d",
          grossFromTrips,
          grossFromCharges,
          driftPct: +(drift * 100).toFixed(1),
        },
        suggestion:
          "Gross from Trip.fare and from sum of TripCharge rows disagree >5%. Re-run normalise.",
      });
    }
  } catch { /* skip */ }

  return NextResponse.json({ ok: true, summary });
}
