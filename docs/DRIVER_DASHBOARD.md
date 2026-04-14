# Driver Dashboard — Information Architecture

This doc is the map from **"every data element we want to track per driver"**
(from the 2026-04-14 product brief) to the **Prisma model** that stores it and
the **UI surface** that displays it. If you're adding a new field, decide
where it lives here first — don't scatter new fields across unrelated pages.

The single-driver admin drilldown lives at `/driver-profile?id=<driverId>`
(source: `public/driver-profile.html`). It's linked from the driver name
in the **Operations → Drivers → Roster & Profiles** table on
`/dashboard`. The page is organised into eight tabs, matching the
information-architecture groups below.

## Element → Model → UI map

| # | Element (from brief) | Prisma model · field | UI surface |
|---|----------------------|----------------------|------------|
| 1 | Driver full name | `Driver.name` | Identity tab · hero strip |
| 2 | Driver email | `Driver.email` | Identity tab · hero strip |
| 3 | Driver phone | `Driver.phone` | Identity tab · hero strip |
| 4 | Driver address | `Driver.address` | Identity tab |
| 5 | Licence / passport / ID pictures (front + back) | `DriverDocument.{type,side,fileUrl}` | Documents tab |
| 6 | D-number / personal number | `Driver.personalNumber` (11-digit NO fødselsnummer / D-nummer, redacted client-side) | Identity tab |
| 7 | Account number + bank | `Driver.{bankAccount,bankName}` | Identity tab + Finance tab |
| 8 | Car model | `Vehicle.{make,model,year}` | Vehicles tab |
| 9 | Car ID (fleet tag) | `Vehicle.carId` | Vehicles tab |
| 10 | Car licence plate | `Vehicle.plateNumber` | Vehicles tab |
| 11 | Insurance + expiry | `Vehicle.{insuranceProvider,insurancePolicyNumber,insuranceExpiry,insuranceMonthlyNok}` | Vehicles tab + alerts |
| 12 | EU-kontroll | `Vehicle.{euKontrollLast,euKontrollNext}` | Vehicles tab + alerts |
| 13 | Tyres — winter / summer | `Vehicle.{tyreSeason,tyreChangedAt}` | Vehicles tab |
| 14 | Washing cost per car per use | `WashEvent.{vehicleId,washedAt,type,costNok,vendor}` | Operations tab |
| 15 | Charging @ 3 kr/kWh, tracked per car per event (Tesla / NIO API) | `ChargingSession.{vehicleId,kwh,ratePerKwhNok,totalCostNok,source,externalId}` | Operations tab |
| 16 | Battery swap (NIO only, per use, priced) | `BatterySwap.{vehicleId,swappedAt,packKwh,costNok,stationName}` | Operations tab |
| 17 | Depreciation (NO accounting — saldogruppe c 24%) | `Vehicle.depreciationMethod` + `DepreciationEntry.{periodStart,openingValueNok,amountNok,closingValueNok}` | Accounting tab |
| 18 | Extra km per driver (Bolt / Uber API + Norgestaxi daily CSV) | `ExtraKm.{driverId,vehicleId,day,km,source,externalId}` | Operations tab |
| 19 | Parking tickets per car | `ParkingTicket.{vehicleId,amountNok,paid,chargedBackToDriverId}` | Operations tab |
| 20 | Repairs & operations per car | `Repair.{vehicleId,category,description,costNok,status}` | Repairs tab + Vehicle maintenance |
| 21 | Repair cost + fault (driver / insurance / other) | `Repair.{faultCategory,faultDriverId,insuranceClaim,deductibleNok}` | Repairs tab |
| 22 | Taxes per revenue, every granularity (instant → yearly) | `TaxEntry.{granularity,periodStart,periodEnd,kind,baseNok,rate,amountNok}` (indexed `[granularity,periodStart]`) | Tax tab |
| 23 | Taxes per NO laws + accounting | `TaxEntry.rulesVersion` (default `NO-2026`) | Tax tab |
| 24 | Commission % per driver | `Driver.commissionPct` | Identity + Finance tab |
| 25 | Employment type (EMPLOYEE / ENK / AS) → different tax brackets | `Driver.{employmentType,orgNumber,vatRegistered}` | Identity + Finance + Tax tabs |
| 26 | Accounting costs | `FixedCost` with category `ACCOUNTING` (fleet-wide rows have `vehicleId=null`) | Accounting tab |
| 27 | Employees (role + personal + work info) | `Employee.{role,employmentType,niZone,monthlySalaryNok,...}` | `/employee` portal + Norway Cost Structure page |

## UI layout — `/driver-profile`

```
┌──────────────────────────────────────────────────────────────────────┐
│ HERO STRIP — avatar · name · email · phone · address                 │
│              tags: [Employment] [Commission %] [Rating] [Trips]      │
│              score · MTD payout                                      │
├──────────────────────────────────────────────────────────────────────┤
│ ALERTS — licence expiring · insurance expiring · EU-kontroll due     │
├──────────────────────────────────────────────────────────────────────┤
│ [Identity] [Documents] [Vehicles] [Operations] [Repairs]             │
│ [Finance]  [Tax]       [Accounting]                                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 1. Identity

Two-column card: **Personal** (name, email, phone, address, D-number,
joined) and **Employment & Tax** (engagement type, org number, MVA status,
commission %, bank, account). The employment pill colour-codes payroll
behaviour: blue = PAYE employee, purple = ENK, teal = AS.

### 2. Documents

- Gallery of `DriverDocument` rows, grouped by `type`+`side`. Front and
  back of licence/ID get separate cards so reviewers can eyeball each.
- Expiry tracker table below the gallery — highlights expired (red),
  <60-day (amber), valid (green).

### 3. Vehicles

Joined view of `DriverVehicle → Vehicle` for this driver. Per row:
car ID, plate, make/model/year, fuel type, **insurance provider + expiry**,
**EU-kontroll next**, **tyre season**, mileage, status.

### 4. Operations

Five KPI cards (30-day rollups) + five tables:

- **Extra km** — `source` = `BOLT` / `UBER` / `CSV_TAXI` / `ODOMETER_DELTA`.
  Platforms with APIs (Bolt, Uber) push rows through `/api/import/extra-km`.
  Norgestaxi posts a daily CSV that the importer writes with `source=CSV_TAXI`.
  Reconciled nightly against the odometer delta from Samsara / Tesla / NIO
  APIs (rows with `source=ODOMETER_DELTA`).
- **Wash events** — per-use cost, vendor, type.
- **Charging sessions** — kWh × rate (default 3 NOK/kWh via
  `ChargingSession.ratePerKwhNok`). Rows ingested from Tesla Fleet API,
  NIO Power API, or Smartcar; deduped on `(source, externalId)`.
- **Battery swaps** — NIO-only; empty state for other brands.
- **Parking tickets** — with `chargedBackToDriverId` + `chargedBackAmountNok`
  so the fleet can reassign cost to a driver after investigation.

### 5. Repairs

Distinct from scheduled `Maintenance` — repairs are incident-driven. KPI
cards: driver-at-fault YTD, other-insurance claims, fleet-absorbed,
open. Full log table with fault pill (`DRIVER` / `OTHER_INSURANCE` /
`FLEET` / `MANUFACTURER` / `UNKNOWN`), insurance claim #, and
`deductibleNok` ("egenandel").

### 6. Finance

- KPIs: revenue, commission %, driver payout, fleet share, next payout.
- Payroll-breakdown table (gross → platform fee → net → commission →
  charge-backs → bonuses → payout).
- Bank details card (beneficiary, bank, account, tax bracket summary).

### 7. Tax

Period selector: `INSTANT` · `DAILY` · `WEEKLY` · `MONTHLY` · `QUARTERLY`
· `YEARLY`. The `TaxEntry` table is indexed on `[granularity, periodStart]`
so each click is a single indexed scan. Five KPI tiles:

- **VAT collected (12%)** — taxi services low-rate MVA (`VAT_COLLECTED`)
- **VAT deductible** — input MVA on fleet expenses (`VAT_DEDUCTIBLE`)
- **Income tax withheld** — forskuddstrekk for `EMPLOYEE` drivers only
- **Employer NI** — arbeidsgiveravgift (0–14.1 % by sone)
- **Net to state** — sum of the above

The rules version is surfaced as a chip (`NO-2026`) so analysts can tell
which bracket set produced each entry after legislation changes.

### 8. Accounting

- **Depreciation** — monthly `DepreciationEntry` rows per vehicle.
  Default method is `DECLINING_24` (saldogruppe c); `STRAIGHT_LINE`
  overrides for management reporting.
- **Fixed costs** — every `FixedCost` row allocated to this driver's
  assigned vehicles, plus fleet-wide costs (`vehicleId=null`).
- **Fleet-wide accounting touchpoints** — chart-of-accounts mapping
  (NS 4102) that feeds the Tripletex / PowerOffice / Fiken export.

## Data source precedence

When multiple sources disagree (manual edit vs. API import vs. CSV), the
importer resolves conflicts in this order, high → low trust:

1. `TESLA_API` / `NIO_API` / `SMARTCAR` — vehicle-native telemetry.
2. `SAMSARA` — fleet telematics gateway.
3. `BOLT` / `UBER` — platform APIs (authoritative for trip counts).
4. `CSV_TAXI` — Norgestaxi nightly export.
5. `MANUAL` — human entry; never overwrites an API row with the same
   `externalId`.

Every row carries `(source, externalId)` so re-imports are idempotent.
Manual entries always keep `externalId=null` and can be freely re-run.

## API contract

```
GET /api/drivers/:id/profile

→ {
  driver: { id, name, email, phone, address, personalNumber,
            licenseNumber, licenseExpiry, employmentType, orgNumber,
            vatRegistered, commissionPct, bankAccount, bankName,
            status, rating, totalTrips, joinedAt },
  documents: DriverDocument[],
  vehicles:  Vehicle[],
  extraKm:       ExtraKm[],
  washes:        WashEvent[],
  charging:      ChargingSession[],
  batterySwaps:  BatterySwap[],
  parking:       ParkingTicket[],
  repairs:       Repair[],
  payroll:       { periodLabel, lines: [{label, amountNok, note?}] },
  tax: {
    rulesVersion: "NO-2026",
    INSTANT?:   { entries, vat, vatDeductible, withheld, employerNi, netToState },
    DAILY?:     { ... },
    WEEKLY?:    { ... },
    MONTHLY?:   { ... },
    QUARTERLY?: { ... },
    YEARLY?:    { ... },
  },
  depreciation:  DepreciationEntry[],
  fixedCosts:    FixedCost[]
}
```

## Migration notes

Schema changes in this PR require `prisma migrate dev`. After migration,
`prisma generate` will add typed accessors for `driverDocument`,
`washEvent`, `chargingSession`, `batterySwap`, `extraKm`, `parkingTicket`,
`repair`, `depreciationEntry`, `taxEntry`, `employee`. The
`/api/drivers/:id/profile` route already uses them via dynamic access
and guards missing tables so the endpoint degrades gracefully on
pre-migration deploys.
