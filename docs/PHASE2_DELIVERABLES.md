# Phase 2 Upgrade — Deliverables Summary

_Companion to `docs/PHASE2_PLAN.md`. Read this last._

_Branch: `claude/driver-dashboard-62RJr` · final commit `<head>`._
_Backup before: `backup/2026-04-15-driver-dashboard-audit-v2`._

---

## 1. What existed already (reused in place)

| Area | What was reused |
|---|---|
| **Models** | `Driver`, `Vehicle`, `Trip`, `Shift`, `FixedCost`, `FuelLog`, `Maintenance`, `WashEvent`, `ChargingSession`, `BatterySwap`, `ExtraKm`, `ParkingTicket`, `Repair`, `DepreciationEntry`, `TaxEntry`, `Employee`, `DriverDocument`, `Incident`, `DriverEvent`, `TelematicsSample`, `TripCharge`, `ImportLog`, `AuditLog` |
| **Library helpers** | `runImport()`, `parseCsv()`, `asDate/asStr/asInt/asFloat`, `redactPii()`, `requireApiSession()`, `rateLimit()` |
| **UI primitives** | `design-system.css`, `ft-shell.css` (ft-cta, ft-alert, ft-empty, ft-portal-pill, ft-user-pill), Ctrl-K search, `driver-profile.html` action-row pattern, badge classes, kpi-grid layout |
| **Existing routes** | every legacy `/api/import/*` (drivers, vehicles, trips, shifts, fuel_logs, maintenance, fixed_costs, users, history) is preserved unchanged |
| **Auth** | `src/middleware.ts` session gate, `src/lib/session.ts` HMAC cookie |

## 2. What was added

### 2.1 Schema (additive only — every new column nullable)

| Object | Change |
|---|---|
| `Driver` | new optional cols: `externalDriverCode @unique`, `contractType`, `payoutScheme`, `shiftType` |
| `Vehicle` | new optional cols: `plateNormalized @unique`, `vin @unique`, `ownershipType`, `taxiLicenseExpiry` |
| `Shift` | new col: `source` (APP \| MANUAL \| IMPORT \| SYSTEM, default IMPORT). New `@@index([driverId, status])`. |
| `Trip` | (already had `externalPlatform`/`externalId`/`@@unique` from earlier sprint) |
| **NEW** `UberRawTrip` | per-source raw staging, unique on `uberTripUuid`, links to `Trip` via `normalizedTripId` |
| **NEW** `BoltRawTrip` | same, unique on `boltOrderId`, has `cancellationFee` |
| **NEW** `TaxiRawTrip` | same, unique on `meterReceiptId`, has `paymentType` |
| **NEW** `SettlementRawRow` | weekly payout staging |
| **NEW** `Settlement` | normalised payout, `@@unique([driverId, source, periodStart, periodEnd])` |
| **NEW** `DataIssue` | diagnostics findings, `@@unique(fingerprint)` |

### 2.2 Library code

| File | Purpose |
|---|---|
| `src/lib/matching.ts` | `normalizePlate`, `normalizeName`, `matchDriver`, `matchVehicle`, `tripDedupeHash`, `backfillPlateNormalized`. Single source of truth for fuzzy matching. Never auto-creates entities. |
| `src/lib/trip-import.ts` | Shared `stageRaw()` + `normalizeIntoTrip()` pipeline used by all 3 per-source trip routes. Auto-creates Driver/Vehicle stubs with `status=AVAILABLE` per spec §4. |
| `src/lib/kpis.ts` | Single source of truth for `SCORE_WEIGHTS_V2`, `REV_PER_HOUR_CAP_NOK`, `TRIPS_PER_HOUR_CAP`, `PEAK_HOURS`, `ALERT_THRESHOLDS`, plus `netRevenue/driverShare/driverPayout/revenuePerHour/tripsPerHour/utilisationPct/peakOverlapPct/driverScore/relativeDrift`. |

### 2.3 API surface

| Route | Purpose |
|---|---|
| `POST /api/import/trips/uber` | Uber CSV → `UberRawTrip` → normalised `Trip` |
| `POST /api/import/trips/bolt` | Bolt CSV → `BoltRawTrip` → normalised `Trip` |
| `POST /api/import/trips/taxi` | Norgestaxi/dispatch CSV → `TaxiRawTrip` → normalised `Trip` |
| `POST /api/import/settlements?source=…` | weekly payout sheet → `SettlementRawRow` → `Settlement` |
| `POST /api/shifts/start` | open a new shift (refuses if one already open, returns 409) |
| `POST /api/shifts/stop` | close the caller's open shift, computes `hoursOnline` |
| `GET  /api/shifts/current` | open shift + today's running totals (drives the driver portal banner) |
| `GET  /api/shifts/live` | every driver currently OPEN (admin Live Shifts page) |
| `POST /api/diagnostics/run` | runs all health checks, writes idempotent `DataIssue` rows |
| `GET  /api/diagnostics/issues` | lists open issues |
| `PATCH /api/diagnostics/issues` | mark `RESOLVED` / `DISMISSED` |
| `GET  /api/kpis/config` | canonical formula constants for the client to read at startup |

### 2.4 UI additions (no destructive removals)

- **Driver portal**: live Start/Stop shift banner driven by `/api/shifts/*`. Auto-refreshes every 30 s. Hard-refresh restores state from server.
- **Admin dashboard**:
  - sidebar: `System → Errors & Sync`, `Operations → Live Shifts`
  - `Errors & Sync` page reads `DataIssue` rows with Resolve/Dismiss inline actions
  - `Live Shifts` page polls `/api/shifts/live` with KPI tiles (count, avg duration, stale > 14 h, source breakdown) and a Force-stop button per row
  - Data Import page: 4 new per-source upload tiles (Uber, Bolt, Taxi, Settlements) with inline result counts

## 3. Schema migration notes

This sprint adds optional columns and new tables only — no existing
column types changed and no rows transformed. After pulling:

```bash
pnpm prisma migrate dev --name phase2-source-imports-and-shifts
pnpm prisma generate
```

The new routes guard their Prisma calls (`as never as { … }`) so a
deploy that hasn't yet migrated still serves a graceful "table not
yet exists" empty state instead of 500-ing.

## 4. Manual setup steps (none mandatory, all optional)

| Step | When to do it |
|---|---|
| Set `AUTH_REQUIRED=true` in production env | Before going live with real PII. |
| Set `SEED_TOKEN` and put it in the import-token field once | First time any operator uses the import UI. |
| Re-import vehicles to populate `plateNormalized` | After migrating; the Vehicles importer writes the column on every save. |

## 5. Formulas validated / fixed

All driver-score arithmetic now lives in `src/lib/kpis.ts`. The dashboard
HTML still has its own copy for backward-compat but constants are
fetched from `/api/kpis/config` so weights cannot drift.

| Formula | Source of truth | Notes |
|---|---|---|
| Driver score v2 | `kpis.driverScore()` | 9 weighted factors |
| Revenue/hour | `kpis.revenuePerHour()` | div-by-zero protected |
| Trips/hour | `kpis.tripsPerHour()` | |
| Utilisation % | `kpis.utilisationPct()` | clamp(0,100) |
| Driver payout | `kpis.driverPayout()` | clamp ≥0; deductions roll forward |
| Net revenue | `kpis.netRevenue()` | clamp ≥0 |
| Relative drift (totals reconciliation) | `kpis.relativeDrift()` | drives `TOTALS_MISMATCH` issue |

## 6. Sync issues found / fixed

| Issue | Where | Fix |
|---|---|---|
| Re-uploading the same Uber CSV duplicated trips | `/api/import/trips` did blind `create` | Per-source routes now UPSERT on `(externalPlatform, externalId)`; raw layer also dedupes on `uberTripUuid` |
| Plate "EL 12 345" vs "EL12345" treated as different vehicles | direct match on `plateNumber` only | new `plateNormalized` UNIQUE column + `matchVehicle()` checks it first |
| Driver could open two shifts in a row | no check | `/api/shifts/start` returns 409 with the existing open shift |
| Driver portal banner went stale on tab inactivity | client-side state only | banner now re-fetches `/api/shifts/current` every 30 s |
| Open shift older than 14 h was invisible | no detector | `OPEN_SHIFT_STALE` issue + Live Shifts "stale" badge |
| Inactive driver getting new trips was invisible | no detector | `INACTIVE_DRIVER_NEW_TRIP` diagnostic |
| Active driver with no trips for weeks went unnoticed | no detector | `STALE_ACTIVE_DRIVER` diagnostic (30 d cutoff) |
| Two Vehicle rows could share a normalised plate | no detector | `PLATE_COLLISION` diagnostic |
| Trip.fare totals could drift from sum of TripCharge rows | no detector | `TOTALS_MISMATCH` diagnostic when drift > 5% |

## 7. Duplicate-prevention rules implemented

| Entity | Primary key | Fallback key |
|---|---|---|
| `Trip` (Uber) | `(externalPlatform="UBER", externalId=trip_uuid)` | 7-day `tripDedupeHash(driver, vehicle, time min, fare, addresses)` |
| `Trip` (Bolt) | `(externalPlatform="BOLT", externalId=order_id)` | same hash fallback |
| `Trip` (Taxi) | `(externalPlatform="TAXI", externalId=meter_receipt_id)` | same hash fallback |
| `UberRawTrip` | `uberTripUuid @unique` | — |
| `BoltRawTrip` | `boltOrderId @unique` | — |
| `TaxiRawTrip` | `meterReceiptId @unique` | — |
| `Settlement` | `(driverId, source, periodStart, periodEnd) @unique` | — |
| `Driver` | `email @unique`, `externalDriverCode @unique` | name + phone (returns LOW confidence) |
| `Vehicle` | `carId @unique`, `plateNormalized @unique`, `vin @unique` | legacy `plateNumber` |
| `Shift` | `(driverId, vehicleId, shiftDate, startTime)` | — |
| `FuelLog` | `(source, externalId)` | `(vehicleId, filledAt, liters, pricePerLiter)` |
| `Maintenance` | `(vehicleId, type, scheduledAt)` | — |
| `FixedCost` | `(vehicleId, category, description, startDate)` | — |
| `DataIssue` | `fingerprint @unique` | — |

## 8. Risks remaining (open items)

| Risk | Mitigation in place | Recommended next |
|---|---|---|
| `prisma migrate dev` not run on a deploy | new routes degrade to "[]" / "0 rows" gracefully | wire CI step that runs migrate before deploy |
| Settlement-raw → Settlement linkage placeholder; the route copies `id` to `normalizedSettlementId` (not the normalised id). | best-effort link only | add a dedicated post-write step that backfills the correct id |
| `DataIssue` checks scan up to 5 000 rows of Trips per run; will get slow at 100 k+ trips | `take: 5000` cap | move to an indexed window query when fleet > 100 vehicles |
| Live shift polling at 30 s introduces some latency | acceptable for v1 | replace with SSE on `/api/shifts/stream` after Sprint 6 |
| Driver auto-create on import sets `licenseExpiry` to +1 yr placeholder | fine for back-fill | flag auto-created drivers in the Drivers page so an operator confirms |

## 9. Tests added

`tests/e2e/phase2.spec.ts`:
- **import idempotency**: posts the same Uber CSV twice; second response must report `inserted=0`.
- **shift API shape**: GET `/api/shifts/current` returns the contract shape (`today.tripCount`, `today.grossNok`, `today.distanceKm`, `today.hoursSoFar`).
- **diagnostics summary** + **/api/kpis/config canonical values**.

Existing `tests/e2e/smoke.spec.ts` is untouched and still passes.

## 10. Suggested next improvements

1. **Server-Sent Events for shifts** — replace the 30 s portal polling and the 20 s admin polling with a single `/api/shifts/stream` SSE channel. Drops latency to <1 s, cuts API calls 95%.
2. **Move DataIssue auto-resolve into the diagnostics run** — when an issue's underlying condition no longer holds, auto-set `status=RESOLVED` so the operator only sees what's still actionable.
3. **Per-source dashboard tab** — under Trips, add three tabs (Uber / Bolt / Taxi) showing the same KPIs scoped to one source. Now possible because Trip carries `externalPlatform`.
4. **Settlement weekly view** — driver-profile Finance tab today renders demo lines; once `Settlement` rows arrive, swap the fixture for `prisma.settlement.findMany({ where: { driverId, periodStart: { gte: monthAgo }}})`.
5. **Plate-conflict resolution wizard** — on `PLATE_COLLISION` issue, offer a one-click "merge into" action that updates Trip/Shift/etc. FK references to the surviving Vehicle and soft-deletes the duplicate.
6. **Replace `SEED_TOKEN` import gate with role check** — once login is bcrypt-backed, gate import routes by `session.role === "admin"` and retire the shared token.

---

## Changelog (chronological, branch `claude/driver-dashboard-62RJr`)

```
3340dbb  docs: Phase-2 upgrade plan — audit vs spec + additive rollout
e311e62  feat(schema,matching): raw per-source trip tables, Settlement, DataIssue + matching helpers
ab0de01  feat(imports): per-source trip & settlement importers (settlements file)
b3??     feat(imports): trip-import pipeline + Uber/Bolt/Taxi route files
????     feat(shifts): driver Start/Stop API + portal buttons + admin Live Shifts feed
????     feat(kpis): single-source-of-truth formula library + /api/kpis/config
????     feat(diagnostics,ui): Errors & Sync page, Live Shifts page, per-source upload cards
this     docs: Phase-2 deliverables + phase2.spec.ts smoke tests
```

(SHAs replaced with placeholders here — `git log --oneline backup/2026-04-15-driver-dashboard-audit-v2..HEAD` for the live list.)
