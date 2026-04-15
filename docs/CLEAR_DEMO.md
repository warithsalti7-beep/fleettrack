# Clearing demo data — preserve drivers + vehicle plates/models

This doc covers the 2026-04-15 cleanup: wipe every operational and
demo row from the database while keeping the real **drivers** and
**vehicle plates / models** the owner already loaded.

## What gets deleted

Every row in:

- `Trip`, `TripCharge`, `Shift`, `Settlement`, `SettlementRawRow`
- `UberRawTrip`, `BoltRawTrip`, `TaxiRawTrip`
- `WashEvent`, `ChargingSession`, `BatterySwap`, `ExtraKm`
- `ParkingTicket`, `Repair`, `DepreciationEntry`, `TaxEntry`
- `FuelLog`, `Maintenance`, `FixedCost`
- `DriverDocument`, `DriverEvent`, `Incident`, `TelematicsSample`
- `DriverVehicle` (assignment join — links rebuilt on next CSV import)
- `ImportLog`, `AuditLog`, `DataIssue`

Every Vehicle row stays, but these columns are **reset to NULL/defaults**
because they were demo-only:

- `mileage`, `fuelLevel`, `latitude`, `longitude`
- `lastService`, `nextService`
- `insuranceProvider`, `insurancePolicyNumber`, `insuranceExpiry`,
  `insuranceMonthlyNok`
- `leaseMonthlyNok`, `purchasePriceNok`, `purchaseDate`,
  `residualValueNok`, `depreciationYears`
- `euKontrollLast`, `euKontrollNext`, `tyreSeason`, `tyreChangedAt`
- `status` → `'AVAILABLE'`
- `depreciationMethod` → `'DECLINING_24'`

## What is preserved (verified post-wipe)

- **Every `User` row** (auth)
- **Every `Driver` row** (full record — id, email, phone, license, etc.)
- **Every `Vehicle` row** with these columns intact:
  `id`, `carId`, `plateNumber`, `plateNormalized`, `vin`, `make`,
  `model`, `year`, `color`, `fuelType`, `ownershipType`,
  `taxiLicenseExpiry`

## Two ways to run the wipe

### Option A — script from your terminal (recommended)

```bash
# 1. Dry-run first — just prints how many rows would be deleted per table.
DATABASE_URL="postgres://…neon…" pnpm tsx prisma/scripts/clear-demo-data.ts

# 2. Apply for real. Both flags required.
CLEAR_CONFIRM=YES \
DATABASE_URL="postgres://…neon…" \
pnpm tsx prisma/scripts/clear-demo-data.ts --apply
```

The script wraps every DELETE in a single transaction, so a failure
mid-way rolls everything back. It also asserts at the end that the
User / Driver / Vehicle counts didn't change and exits non-zero
otherwise.

### Option B — one-click HTTP endpoint

For when you don't have a terminal handy. Two gates:
- `X-Admin-Token: $SEED_TOKEN` header
- request body must be exactly `{"confirm":"YES"}`

```bash
curl -X POST https://YOUR-DEPLOY/api/admin/clear-demo \
  -H "X-Admin-Token: $SEED_TOKEN" \
  -H "content-type: application/json" \
  -d '{"confirm":"YES"}'
```

Response body:

```json
{
  "ok": true,
  "preservation": {
    "users":    { "before": 5,  "after": 5,  "ok": true },
    "drivers":  { "before": 19, "after": 19, "ok": true },
    "vehicles": { "before": 14, "after": 14, "ok": true }
  },
  "deleted":  { "Trip": 1284, "Shift": 312, "FuelLog": 88, … },
  "vehiclesReset": 14,
  "note": "Driver, Vehicle (plate/model/year/carId/vin) and User rows preserved. Vehicle operational columns reset to defaults. Re-import via Dashboard → System → Data Import."
}
```

## Front-end: baked-in demo arrays already cleared

`public/fleet-data.js` no longer ships the 19 hardcoded demo
drivers / 14 demo vehicles. The arrays are `[]` and the KPI bag is
all-zeroes; everything fills in from `/api/drivers`, `/api/vehicles`,
`/api/stats` on first paint via `FleetData.bootstrap()`. So the
dashboard is honest: empty-state until you upload real data, then
populated immediately.

## After the wipe — re-import order

Use **Dashboard → System → Data Import** and upload in this sequence
(each step's data is the lookup target for the next):

1. Drivers (already loaded — skip if no changes)
2. Vehicles (already loaded — skip if no changes)
3. Shifts master CSV (optional — live shifts also captured by driver
   Start/Stop in the portal)
4. Per-source trip CSVs:
   - Uber → **Per-source uploads → Uber CSV**
   - Bolt → **Per-source uploads → Bolt CSV**
   - Taxi/Norgestaxi → **Per-source uploads → Taxi CSV**
5. Settlements → **Per-source uploads → Settlements CSV** (prompts for
   `?source=BOLT|UBER|DISPATCHER|MANUAL`)
6. Expenses (FixedCost CSV)
7. Fuel logs / Maintenance as they accumulate

Re-uploading the same file is always safe — every importer is
idempotent (see `docs/PHASE2_DELIVERABLES.md` §7 for the full
duplicate-prevention rule table).

## After the wipe — verify

Run the diagnostics page once to confirm there are no leftover orphan
rows:

> Dashboard → System → **Errors & Sync** → click **Run diagnostics**

Expected: zero issues. If anything appears, the suggestion column tells
you exactly what to do.
