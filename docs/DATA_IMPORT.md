# Data Import Guide

## How the workflow will work

1. You (or your ops person) opens one of the 6 CSV templates in `/templates`
   in Excel or Google Sheets.
2. You fill in rows with real fleet data.
3. You open **Admin Dashboard → Data → Import** (I'll build this page next).
4. Drag-drop the filled CSV. The page parses it, validates columns, shows a
   preview of the first 20 rows, flags errors (unknown car_id, missing
   required field, malformed date, etc.).
5. You click **Import**. The system writes to Neon Postgres.
6. Every menu / chart / KPI in the dashboard picks up the new data
   automatically on next load (because FleetData.load() reads from the DB).

## The 6 templates (one per entity)

All are in `/templates/*.csv`. They mirror the Prisma schema columns so
import is 1:1 with the database.

### 1. `drivers.csv` — driver roster

| Column | Required | Notes |
|---|---|---|
| name | ✅ | Full legal name |
| email | ✅ | Unique. This is their login. |
| phone | | `+47 900 11 111` format preferred |
| license_number | ✅ | Unique |
| license_expiry | ✅ | `YYYY-MM-DD` |
| hire_date | | `YYYY-MM-DD` |
| car_id | | Must match a row in vehicles.csv if present |
| shift | | `AM`, `PM`, or blank |
| brand | | Car brand+model as shorthand, e.g. `NIO ET5` |
| commission_pct | | Default 65 |
| status | | `active`, `inactive`, `on_leave`, `terminated` |
| address | | Free text |

### 2. `vehicles.csv` — fleet register

| Column | Required | Notes |
|---|---|---|
| car_id | ✅ | e.g. `TR2518`. Unique. Used as FK everywhere. |
| make, model, year, color | ✅ | |
| plate_number | ✅ | Unique |
| fuel_type | ✅ | `Electric`, `Hybrid`, `Petrol`, `Diesel` |
| purchase_date | | `YYYY-MM-DD` |
| purchase_price_nok | | Integer, for depreciation |
| current_mileage_km | | |
| lease_monthly_nok | | 0 if owned outright |
| insurance_monthly_nok | | |
| status | | `active`, `workshop`, `no-driver`, `sold` |

### 3. `shifts.csv` — when each driver was working

Used to compute hours-online, utilization, rev/hour.

| Column | Required |
|---|---|
| shift_date | ✅ |
| driver_email | ✅ |
| car_id | ✅ |
| start_time | ✅ (HH:MM) |
| end_time | ✅ |
| hours_online | | calculated if blank |
| zone | | Primary zone worked |
| platform_primary | | `Bolt` / `Uber` / `Mixed` |
| status | | `completed`, `no_show`, `cancelled` |

### 4. `trips.csv` — every completed or cancelled trip

**Most important table for financial accuracy.**

| Column | Required |
|---|---|
| trip_date, trip_time | ✅ |
| driver_email | ✅ |
| car_id | ✅ |
| pickup_address, dropoff_address | ✅ |
| distance_km, duration_min | ✅ |
| fare_nok | ✅ |
| platform | `Bolt` / `Uber` / `Private` |
| payment_method | `CARD` / `CASH` / `MOBILE` |
| rating | 1–5 or blank |
| status | `completed` / `cancelled` / `no_show` |

### 5. `fuel_logs.csv` — refills and charges

| Column | Required |
|---|---|
| fill_date | ✅ |
| car_id | ✅ |
| driver_email | | who filled |
| liters_or_kwh | ✅ |
| price_per_unit_nok | ✅ |
| total_cost_nok | ✅ |
| mileage_at_fill_km | |
| station | |

### 6. `maintenance.csv` — repairs and services

| Column | Required |
|---|---|
| service_date | ✅ |
| car_id | ✅ |
| type | ✅ | one of `OIL_CHANGE` / `TIRE_ROTATION` / `BRAKE_SERVICE` / `REPAIR` / `INSPECTION` / `GENERAL` |
| description | ✅ |
| cost_nok | ✅ |
| workshop | |
| mileage_at_service_km | |
| status | `scheduled` / `in_progress` / `completed` |

---

## How to fill for September 2024 → today

1. Fill `vehicles.csv` first (one row per physical vehicle you've had since Sept 2024). This establishes car_ids.
2. Fill `drivers.csv` (one row per driver who's worked since then). Current drivers stay active; those who left get `status: terminated`. Assign their current `car_id` — for history, shifts.csv has the actual historical assignment.
3. Fill `shifts.csv` — one row per driver per day they worked. If you have daily logs from Bolt/Uber exports this is where they go.
4. Fill `trips.csv` — one row per trip. You can bulk-export from Bolt and Uber driver-partner portals, then concat into this format.
5. Fill `fuel_logs.csv` from Circle K / Tesla charging invoices.
6. Fill `maintenance.csv` from workshop receipts.

## Format rules across all files

- **Dates:** `YYYY-MM-DD` (ISO). Never `09/01/2025`.
- **Times:** `HH:MM` 24-hour. Never `2:30 PM`.
- **Currency:** always NOK, plain integers (no `kr` symbol, no thousand separator). `55430`, not `55 430 kr` or `"55,430"`.
- **Empty cells:** leave blank, don't put `null` or `-`.
- **Car IDs:** exactly as used internally (`TR2518`, not `tr2518` or `TR 2518`).
- **Emails:** lowercase.
- **Duplicates:** `email`, `license_number`, `plate_number`, `car_id` are unique. Import will reject duplicates.

## When I build the upload UI (next)

It will:
- Live at `/dashboard` → **System → Data Import** (admin only)
- Use PapaParse client-side so parsing is instant and validation errors show before upload
- Show a **diff preview**: "12 new drivers, 3 updates, 0 deletes — proceed?"
- Send to new `/api/import/{entity}` routes
- Return a report: `{ inserted: 12, updated: 3, errors: [{ row: 7, message: "..." }] }`
- Log every import to an `import_log` table in Neon for auditability

## What you do right now

1. Open `/templates/drivers.csv` etc. in Excel / Google Sheets
2. **Fill 1-2 rows per file** so I can verify the schema with real data
3. Ship it back (I'll add it to the repo or paste it in chat)
4. I finalise the importer against your actual data

If you have **Bolt / Uber partner exports** already (they usually come as
CSV or XLSX from those portals), share one row and I can write a
format-mapper so you don't need to re-type anything into my templates.
