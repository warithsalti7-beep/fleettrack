# Phase 2 Upgrade — Plan, Gap Analysis, Rollout

_This doc is the contract for the multi-source imports + shift start/stop +
data-integrity upgrade. It was produced by inspecting the existing
codebase against the 12-phase spec **before** any code was written._

_Last updated: 2026-04-15 · branch `claude/driver-dashboard-62RJr`
· backup at `backup/2026-04-15-driver-dashboard-audit-v2`._

---

## 1. Current system snapshot (what exists today)

### 1.1 Master entities

| Entity | Model | Status | Reusable? | Missing vs spec |
|---|---|---|---|---|
| Drivers | `Driver` | ✅ rich | ✅ Yes | `externalDriverCode`, `contractType`, `payoutScheme`, `shiftType` — **add as optional additive columns** |
| Vehicles | `Vehicle` | ✅ rich | ✅ Yes | `vin`, `ownershipType`, `taxiLicenseExpiry`, normalized-plate column — **add optionally** |
| Users | `User` | ✅ basic | ✅ Yes | n/a |
| Driver docs | `DriverDocument` | ✅ | ✅ Yes | n/a — already covers compliance |

### 1.2 Normalized fact tables

| Spec asks for | Existing model | Gap |
|---|---|---|
| Trips/Rides normalized | `Trip` | ✅ Reuse. Already has `externalPlatform` + `externalId` + `@@unique`. Gaps: needs `sourceTripId` alias (keep `externalId`), `rawRecordId` FK to raw table (**add**), `dedupeHash` field (**add**) |
| Expenses normalized | `FixedCost` (+ `FuelLog`, `WashEvent`, `ParkingTicket`, `Repair`) | Mostly there; no single `Expense` table — the spec lets us reuse by view or a `NormalizedExpenseView`. **Decision: add a lightweight `Expense` model** only if needed for cross-category analytics. Skip for now; existing category-specific tables serve each cost subdomain. |
| Shifts normalized | `Shift` | ✅ Reuse. Has `clockInAt`/`clockOutAt`/`firstTripAt`/`hoursOnline`/`zone`/`platformPrimary`. Gaps: needs `source` field (APP / MANUAL / IMPORT / SYSTEM) and `open/closed` derivation. **Add `source` column.** |
| Settlements/Payouts | **missing** | ⚠ No model yet. **Add `Settlement` model.** |
| Documents/compliance | `DriverDocument` + expiry fields on `Driver` / `Vehicle` | ✅ Reuse |

### 1.3 Raw import tables

**Currently none.** Every existing `/api/import/*` route parses the CSV in-
memory, runs the normalization, and writes directly to the normalized
table. There is **no raw-per-source staging** yet.

The spec explicitly wants raw layers per source so Uber/Bolt/Taxi data stays
traceable and separately importable. **We will add** (all additive):

- `UberRawTrip`
- `BoltRawTrip`
- `TaxiRawTrip` (generic dispatch/Norgestaxi)
- `SettlementRawRow`

Each preserves: `importBatchId`, `sourceName`, `fileName`, `importedAt`,
`rowNumber`, `rawPayload (Json)`, `parseStatus`, `normalizationStatus`,
`errorMessage`, `normalizedTripId` (FK back to the `Trip` row it
produced). This meets the spec's raw-import record requirements.

### 1.4 Ingestion today

| What it does | Where | Reusable? |
|---|---|---|
| Signed-session middleware on `/api/*` | `src/middleware.ts` | ✅ |
| Idempotent UPSERT via natural keys | all `/api/import/*` | ✅ — keep as-is for drivers/vehicles/users/shifts/fuel/maintenance/fixed_costs |
| `runImport()` writes `ImportLog` + redacts PII | `src/lib/import.ts` | ✅ — the new per-source routes use the same helper |
| CSV parsing | `src/lib/csv.ts` (parseCsv, asStr, asInt, asFloat, asDate) | ✅ |
| SEED_TOKEN gate | `src/lib/import.ts:requireAdmin` | ⚠ will move gradually to session-cookie role check once login is live |

### 1.5 Dashboard surfaces today

| Page | Purpose | Reusable? |
|---|---|---|
| `/dashboard` (public/dashboard.html, 5886 lines) | admin | ✅ add sections |
| `/driver` (public/driver.html, 509 lines) | driver portal | ✅ adds start/stop |
| `/driver-profile?id=<id>` | admin driver deep-dive | ✅ already has action-row |
| `/employee` | employee portal | ✅ |
| `/access-management` | perms | ✅ |
| `/login` | auth | ✅ |

All 6 pages now share `design-system.css` + `ft-shell.css` — no design
rewrite needed.

Existing sidebar groups: **Command · Operations (Drivers/Vehicles/Trips/
Dispatch) · Financial (P&L/Costs) · Analytics · Compliance & Safety ·
Customer · System · Intelligence**. Perfectly usable — we add
sub-items rather than restructure.

### 1.6 Problems identified

| # | Problem | Severity | Fix plan |
|---|---------|----------|----------|
| P1 | All source CSVs go through one generic `/api/import/trips` — operator uploads a Uber file into that same slot hoping the `platform` column disambiguates. Spec wants distinct, visible upload pipes per source. | High | Add `/api/import/trips/uber`, `/bolt`, `/taxi` (per-source parsers feed the same normalized `Trip` table). Keep the generic route for manual entry. |
| P2 | No raw-per-source storage — a failed row is lost after parsing. | Medium | Add `UberRawTrip` etc. with `parseStatus`. |
| P3 | No live shift start/stop API — driver portal currently just reads. | High | Add `POST /api/shifts/start` + `/stop` + `GET /api/shifts/current`. |
| P4 | No settlement/payout storage even though driver-profile renders it — demo data only. | Medium | Add `Settlement` + `/api/import/settlements` + weekly roll-up query. |
| P5 | No data-diagnostics surface; broken joins / duplicate detection scattered. | Medium | Add `DataIssue` model + `/api/diagnostics/run` + "Errors & Sync" page. |
| P6 | Plate-number normalisation not consistent — `EL 12 345` vs `EL12345` vs `el12345` match by accident today. | Medium | Add `Vehicle.plateNormalized` generated column + helper in `src/lib/matching.ts`. |
| P7 | Formulas duplicated client vs server — driver score is computed both in `dashboard.html` and (soon) in server KPI endpoints. | Medium | Extract `src/lib/kpis.ts` as single source of truth; import into the one or two server routes that need it; keep client copy as thin fallback that imports the same constants. |
| P8 | No "stale-but-active" detector (driver with 0 trips ≥30 d). | Low | Diagnostics check catches this. |

---

## 2. What we'll reuse (explicit)

- **Every existing model** stays. None dropped, no data migration of
  existing rows.
- `runImport()`, `parseCsv()`, `asDate()/asStr()/asInt()/asFloat()`,
  `redactPii()`, `ImportLog`, `AuditLog` — used by every new route.
- `ft-shell.css` + `design-system.css` — used by every new page.
- The Ctrl-K search already indexes drivers/vehicles/pages — the new
  Imports subpages auto-appear in it because they register via `go()`.
- Driver scoring v2 stays; new shift-punctuality signal is already part
  of v2 (`avgLateMin`), it will just start having real data once
  start/stop is live.

## 3. What we'll add (additive only)

### 3.1 Schema (new migration)

```prisma
// Drivers — optional additive columns
//  externalDriverCode, contractType, payoutScheme, shiftType

// Vehicles — optional additive columns
//  vin, ownershipType, taxiLicenseExpiry, plateNormalized (indexed)

// Shift — add source column
//  source: APP | MANUAL | IMPORT | SYSTEM

// New models
model UberRawTrip    { ... rawPayload Json, parseStatus, normalizedTripId }
model BoltRawTrip    { ... same shape }
model TaxiRawTrip    { ... same shape }
model SettlementRawRow { ... }
model Settlement     { driverId, periodStart, periodEnd, gross, commission,
                       net, bonusTotal, deductionsTotal, payoutTotal,
                       vatTotal?, status, importBatchId }
model DataIssue      { kind, severity, entityRef, batchRef, details Json,
                       suggestion, status: OPEN|RESOLVED|DISMISSED,
                       resolvedAt, openedAt }
```

Every new column is nullable and every new model is additive. `prisma
migrate dev` produces a single forward-only migration.

### 3.2 API routes

```
POST /api/import/trips/uber          ← parses Uber CSV, stages raw, normalizes into Trip
POST /api/import/trips/bolt          ← parses Bolt CSV, ditto
POST /api/import/trips/taxi          ← parses Norgestaxi/dispatch CSV, ditto
POST /api/import/settlements         ← weekly payout rows → Settlement
POST /api/shifts/start               ← { vehicleId? }  → creates open Shift (source=APP)
POST /api/shifts/stop                ← closes open shift, computes duration
GET  /api/shifts/current             ← returns the caller's open shift (if any)
GET  /api/shifts/live                ← admin: all drivers currently on shift
GET  /api/diagnostics/run            ← runs all health checks, writes DataIssue rows
GET  /api/diagnostics/issues         ← lists open DataIssues for the UI
```

Every route uses the existing `runImport()` / `requireApiSession()` /
`redactPii()` infrastructure.

### 3.3 Formula consolidation

Single file `src/lib/kpis.ts`:

```ts
export const KPI_WEIGHTS = { rev: 0.30, util: 0.15, accept: 0.15, ... }
export function driverScore(d) { ... }       // identical to scoreV2
export function revenuePerHour(shiftMin, fareSum) { ... }
export function netRevenue(gross, platformFee) { ... }
export function payout(netRevenue, commissionPct, deductions, bonuses) { ... }
```

Server routes import it. `dashboard.html` inlines a tiny copy that
reads the same constants via a `/api/kpis/config` endpoint so weights
cannot drift between client & server.

### 3.4 UI additions

- Sidebar group **Imports** gets 8 sub-items:
  Uber · Bolt · Taxi/Dispatch · Expenses · Driver Settlements · Shifts
  · Drivers master · Vehicles master. Each is a tab on `#data-import`
  with a dedicated drop-zone + preview + validation report.
- **Driver portal** gains a sticky Start/Stop shift control, connected
  to `/api/shifts/start|stop|current`.
- **Admin dashboard** gets a new top-level page **Live Shifts** (under
  Operations → Drivers) showing everyone currently on shift with
  duration + vehicle.
- **New page "Errors & Sync"** under System shows open `DataIssue` rows
  with one-click "Resolve" / "Dismiss".
- Drivers/Vehicles pages gain a `status=active` filter pill and a
  "stale but active" badge for rows in the diagnostic set.

## 4. Roll-out order

1. Commit A — this plan doc ← **you're reading it**
2. Commit B — schema additions + migration
3. Commit C — raw-per-source trip import routes (Uber/Bolt/Taxi)
4. Commit D — shift start/stop API + driver portal buttons
5. Commit E — Settlement model + import route
6. Commit F — admin Live Shifts + per-source import UI
7. Commit G — DataIssue model + diagnostics API + Errors & Sync page
8. Commit H — `src/lib/kpis.ts` formula consolidation
9. Commit I — Playwright tests (re-import dedupe, shift start/stop,
   totals reconciliation) + Phase-12 deliverables doc

Every commit keeps the existing routes working. No destructive migrations.
Existing data survives untouched.

## 5. Risks, tracked

| Risk | Mitigation |
|---|---|
| Prisma client not regenerated on target deploy | Each new route guards `findMany`/`create` with try/catch fall-back so the /api surface degrades gracefully until `prisma generate` runs. |
| SEED_TOKEN still required for imports | Documented. Next sprint replaces it with session-role check (admin/dispatcher). |
| Plate normalisation edge cases (Norwegian `ZZ 12345` vs EU `EL-12345`) | Normaliser uppercases, strips `-` and spaces, preserves digits. Will also expose a per-vehicle override field. |
| Re-importing an old Uber CSV into the new `/api/import/trips/uber` route shouldn't duplicate rows already imported via the legacy generic route | Dedupe key `(externalPlatform, externalId)` is enforced at the normalized `Trip` level — same constraint catches both paths. |
| Driver start/stop timezone drift | All timestamps are stored as UTC; UI formats in the browser's timezone. Existing pattern via `new Date()` stays. |

## 6. Definition of done

- [ ] All new routes covered by a Playwright smoke test.
- [ ] Re-importing the same Uber CSV **twice** in a row produces
      `updated=n, inserted=0`.
- [ ] Start Shift → refresh → page still shows open shift.
- [ ] Driver dashboard today's totals equal fleet dashboard driver-row
      totals for the same period.
- [ ] `/api/diagnostics/run` returns 0 open issues on a freshly-seeded
      DB.
- [ ] `docs/AUDIT_2026_04_PHASE2.md` "Deferred" list gets each resolved
      item checked off.

---

_Ready for implementation. Proceed commit-by-commit; do not batch
multiple phases into a single commit._
