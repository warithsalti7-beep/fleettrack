# Standard Operating Procedure — FleetTrack Data Entry

**Audience:** Dispatch office / admin assistants / fleet operations staff
**Updated:** 2026-04 · **Version:** 1.0
**Purpose:** Every data point in the FleetTrack dashboard comes from this workflow. If you follow these steps, every KPI, chart, P&L, and driver scorecard auto-updates. If you skip steps, the dashboard shows stale numbers.

---

## 1. The two files you'll work with

There are only **two CSV files**. You can open them in Excel, Google Sheets, or Numbers.

| File | How often | Who fills it | What's in it |
|---|---|---|---|
| **`fleet-setup.csv`** | **Once, then rarely** | Office manager | Drivers, vehicles, monthly fixed costs (lease, insurance, etc.) |
| **`weekly-operations.csv`** | **Every Monday** (or daily if easier) | Dispatch / ops assistant | Every shift, every trip, every refill, every maintenance visit |

Download templates from:
- `https://<your-domain>/templates/fleet-setup.csv`
- `https://<your-domain>/templates/weekly-operations.csv`

Both files use a `record_type` column — the system uses that to know what kind of row it is. **Leave any column blank if it doesn't apply.**

---

## 2. First-time setup (30–60 minutes — do once)

### Step 1: Fill `fleet-setup.csv`

#### DRIVER rows — one per driver

| Column | Required? | Example | Where to find it |
|---|---|---|---|
| `record_type` | ✅ | `DRIVER` | Always "DRIVER" for a driver row |
| `name` | ✅ | `Olsztynski Mariusz Zbigniew` | Driver's passport / ID card |
| `email` | ✅ | `olsztynski@fleettrack.no` | Driver's work email (used as login) |
| `phone` | ✅ | `+47 900 11 111` | Employee records |
| `license_number` | ✅ | `NO-20148-91` | Driver's Norwegian taxi licence (løyvebevis) |
| `license_expiry` | ✅ | `2027-08-14` | Same document, expiry date |
| `hire_date` | ✅ | `2024-01-15` | Employment contract / HR records |
| `car_id` | ⚠️ Recommended | `TR2518` | Internal tag on the vehicle (fleet sticker or registration) |
| `shift` | ⬜ | `AM` or `PM` | Operations schedule |
| `brand` | ⬜ | `NIO ET5` | Model of their assigned car |
| `commission_pct` | ⬜ | `65` | Driver's revenue share (%) from contract |
| `status` | ⬜ | `active` | "active" or "inactive" |
| `address` | ⬜ | `Storgata 1, Oslo` | HR records |

#### VEHICLE rows — one per car

| Column | Required? | Example | Where to find it |
|---|---|---|---|
| `record_type` | ✅ | `VEHICLE` | Always "VEHICLE" for a car row |
| `car_id` | ✅ | `TR2518` | Your internal fleet tag |
| `make` | ✅ | `NIO` | Vehicle registration card |
| `model` | ✅ | `ET5` | Registration card |
| `year` | ✅ | `2024` | Registration card |
| `color` | ⬜ | `Black` | Look at the car |
| `plate_number` | ✅ | `ZB12345` | Norwegian plate (Statens vegvesen) |
| `fuel_type` | ✅ | `Electric` | "Electric" / "Hybrid" / "Diesel" / "Petrol" |
| `purchase_date` | ⚠️ | `2024-01-15` | Purchase agreement / lease contract |
| `purchase_price_nok` | ⚠️ | `485000` | Purchase invoice (excl. VAT if you can reclaim it) |
| `current_mileage_km` | ⚠️ | `18230` | Odometer reading today |
| `lease_monthly_nok` | ⬜ | `0` or `12800` | Lease contract (0 if purchased outright) |
| `insurance_monthly_nok` | ⚠️ | `1320` | Insurance policy (If AS / Gjensidige / etc.) |
| `status` | ⬜ | `active` | "active" / "workshop" / "no-driver" |

#### FIXED_COST rows — one per recurring monthly expense

Every Norwegian taxi operator has these. Add one row per item.

| Column | Example for LEASE | Example for INSURANCE | Example for LØYVE |
|---|---|---|---|
| `record_type` | `FIXED_COST` | `FIXED_COST` | `FIXED_COST` |
| `category` | `LEASE` | `INSURANCE` | `LOYVE` |
| `description` | `Monthly operating lease` | `Annual insurance (paid monthly)` | `Oslo taxi løyve` |
| `amount_nok` | `12800` | `1320` | `480` |
| `frequency` | `MONTHLY` | `MONTHLY` | `MONTHLY` |
| `start_date` | `2024-01-15` | `2024-01-01` | `2024-01-01` |
| `end_date` | (blank = ongoing) | (blank) | (blank) |
| `car_id` | `TR2518` (per-car) | `TR2518` | (blank = fleet-wide) |
| `vendor` | `NIO Norway` | `If Skadeforsikring` | `Oslo kommune` |
| `notes` | `60-month lease` | `Comp + liability` | `Required løyvebevis` |

**Category list** (use exactly one of these):
`LEASE`, `INSURANCE`, `FINANCING`, `PARKING`, `WASH`, `LOYVE`, `TAXIMETER`, `REGISTRATION`, `DEPRECIATION`, `OFFICE`, `SOFTWARE`, `SALARY`, `EMPLOYER_NI`, `ACCOUNTING`, `OTHER`

**Frequency list:** `ONCE`, `MONTHLY`, `QUARTERLY`, `YEARLY` — the system normalises all to monthly-equivalent.

#### Don't forget these common Norwegian fixed costs

Most fleets miss these. Add them all:

- [ ] `LEASE` — one row per financed/leased vehicle
- [ ] `INSURANCE` — taxi commercial insurance per vehicle
- [ ] `LOYVE` — løyveavgift (taxi licence) per vehicle
- [ ] `TAXIMETER` — certified taximeter rental / service (if applicable)
- [ ] `REGISTRATION` — årsavgift / trafikkforsikringsavgift
- [ ] `WASH` — monthly car wash contract
- [ ] `PARKING` — garage / parking permit
- [ ] `OFFICE` — office / dispatch rental
- [ ] `SOFTWARE` — FleetTrack + any dispatch software subscription
- [ ] `ACCOUNTING` — regnskapsfører monthly fee
- [ ] `SALARY` — any salaried employee (dispatcher, office staff)
- [ ] `EMPLOYER_NI` — arbeidsgiveravgift (typically 14.1%)
- [ ] `FINANCING` — loan interest (if purchased with a loan)

### Step 2: Upload `fleet-setup.csv`

1. Sign in as admin at `https://<your-domain>/login`
2. Sidebar → **System** → **Settings** → **Data Import**
3. Paste your `SEED_TOKEN` (ask IT; stored in Vercel env)
4. Drag `fleet-setup.csv` into the **One-Shot Bundle Upload** zone
5. Review the preview → click **Import to database**
6. Report shows: `DRIVER: 19 inserted, VEHICLE: 14 inserted, FIXED_COST: 13 inserted`

**You only do this once** — or whenever you add a new driver / buy a new car / change a fixed cost.

---

## 3. Weekly workflow (Monday morning — 15–30 minutes for a 19-driver fleet)

Every Monday morning, fill `weekly-operations.csv` with everything that happened the prior week. Four row types, all in one file.

### SHIFT row — one per driver-day

Records that a driver worked a shift on a specific car.

| Column | Example | Source |
|---|---|---|
| `record_type` | `SHIFT` | Always "SHIFT" |
| `date` | `2025-09-01` | Shift date |
| `driver_email` | `olsztynski@fleettrack.no` | From setup file |
| `car_id` | `TR2518` | Which car the driver used |
| `shift_start` | `06:00` | When they clocked on |
| `shift_end` | `14:30` | When they clocked off |
| `hours_online` | `8.5` | Total hours the dispatch app was on — from Bolt/Uber driver app summary |
| `zone` | `City Centre` | Primary operating zone that shift |
| `platform` | `Bolt` | Primary dispatch platform (or "Bolt+Uber") |
| `status` | `completed` | "completed" / "cancelled" / "no-show" |

**Where to get shift data:**
- Bolt Driver App → Earnings tab → weekly summary shows hours online per day
- Uber Driver app → Earnings → weekly statement
- Your own dispatch log if you maintain one

### TRIP row — one per completed ride

This is the biggest section. Every completed trip = one row.

| Column | Example | Source |
|---|---|---|
| `record_type` | `TRIP` | Always "TRIP" |
| `date` | `2025-09-01` | Trip date |
| `time` | `07:12` | Trip start time (HH:MM, 24h) |
| `driver_email` | `olsztynski@fleettrack.no` | |
| `car_id` | `TR2518` | |
| `pickup_address` | `Oslo Airport T2` | |
| `dropoff_address` | `Aker Brygge` | |
| `distance_km` | `48.2` | Kilometres driven with passenger |
| `duration_min` | `42` | Trip duration in minutes |
| `fare_nok` | `582` | Gross fare (before Bolt/Uber commission) |
| `platform` | `Bolt` | "Bolt" / "Uber" / "Norgestaxi" / "Direct" |
| `payment_method` | `CARD` | "CARD" / "CASH" / "APP" |
| `rating` | `5.0` | Customer rating (1.0–5.0) |
| `status` | `completed` | "completed" / "cancelled" |

**Where to get trip data:**

| Source | Export name | How to access |
|---|---|---|
| **Bolt** | Bolt Fleet Portal → Reports → Trips | Login → Reports → filter date range → Export CSV |
| **Uber Fleet** | Uber Fleet → Payments → Weekly Summary | Login → each driver's report |
| **Uber (driver-level)** | Driver app → Earnings → Past Week | Each driver exports their own CSV |
| **Norgestaxi** | Operator portal → Trip log | Weekly export |
| **Direct booking** | Your dispatch log | Phone/email bookings you handle in-house |

**Pro tip:** Combine all platform exports into one big `weekly-operations.csv` with `record_type=TRIP` for every row. Duplicate trips are auto-detected and skipped (10-second window on same driver + vehicle).

### FUEL row — every refill / charge session

| Column | Example (EV) | Example (Petrol) | Source |
|---|---|---|---|
| `record_type` | `FUEL` | `FUEL` | Always "FUEL" |
| `date` | `2025-09-01` | `2025-09-02` | Receipt date |
| `car_id` | `TR2518` | `TR731` | Sticker on vehicle |
| `liters_or_kwh` | `42` (kWh) | `38` (litres) | Receipt / charging session |
| `price_per_unit_nok` | `3.85` | `22.50` | Receipt |
| `total_cost_nok` | `162` | `855` | Receipt total |
| `mileage_km` | `18230` | `42180` | Odometer at time of refill |
| `station` | `Circle K Aker Brygge` | `Shell Sinsen` | Receipt |

**Where to get fuel data:**
- **Circle K fleet card** → monthly statement (CSV download from their portal)
- **Shell fleet card** → same
- **Driver-paid receipts** → drivers photograph receipts → you enter weekly
- **Tesla Supercharger** → in-car history / Tesla app → each session logged
- **Home-charging reimbursement** → driver reports kWh, you enter at agreed rate

### MAINTENANCE row — every workshop visit

| Column | Example | Source |
|---|---|---|
| `record_type` | `MAINTENANCE` | Always "MAINTENANCE" |
| `date` | `2025-09-05` | Service date |
| `car_id` | `TR2518` | |
| `type` | `OIL_CHANGE` | See list below |
| `description` | `Routine 10 000 km service` | Workshop invoice |
| `total_cost_nok` | `2070` | Invoice |
| `mileage_km` | `18000` | Odometer at service |
| `workshop` | `AutoFix GmbH` | Workshop name |
| `status` | `completed` | "scheduled" / "in_progress" / "completed" |
| `notes` | `Replaced cabin filter` | Optional |

**Type values:** `OIL_CHANGE`, `TYRES`, `BRAKES`, `INSPECTION`, `REPAIR`, `ACCIDENT`, `OTHER`

**Where to get maintenance data:**
- Workshop invoice (always email or paper)
- Keep a shared drive folder "Workshop receipts" — dispatch enters Monday

---

## 4. Uploading the weekly file

1. Sign in at `https://<your-domain>/login` as admin
2. Sidebar → **System** → **Settings** → **Data Import**
3. Drag `weekly-operations.csv` into the **One-Shot Bundle Upload** zone
4. Click **Import to database**
5. Success report looks like:

   ```
   SHIFT:       95 inserted, 0 errors
   TRIP:       847 inserted, 3 skipped (duplicates), 0 errors
   FUEL:        34 inserted, 0 errors
   MAINTENANCE:  2 inserted, 0 errors
   Duration: 4.2s
   ```

6. Refresh the dashboard — every page pulls fresh data.

---

## 5. What you'll see on the dashboard

These KPIs update **immediately** after a successful upload:

### Live (auto-updates from CSV data)

| KPI | Page | Formula |
|---|---|---|
| Today Revenue | Command Centre | Sum of `fare_nok` for all TRIP rows where `date = today` |
| Total Trips Today | Command Centre / Trips | Count of TRIP rows where `date = today` & `status = completed` |
| Active Drivers | Command Centre / Roster | Count of drivers with a SHIFT row where `date = today` |
| MTD Revenue | Financial | Sum of `fare_nok` since 1st of month |
| MTD Fuel Cost | Financial | Sum of `total_cost_nok` FUEL rows since 1st |
| MTD Maintenance | Financial | Sum COMPLETED MAINTENANCE rows since 1st |
| Fixed Costs (prorated) | Financial | `sum(monthly_equivalent_fixed_costs) × (days_elapsed / days_in_month)` |
| Net Profit | Financial | Revenue − Variable costs − Prorated fixed |
| Profit Margin % | Financial | `Net Profit / Revenue × 100` |
| VAT Payable | Financial | `Revenue × 12%` (Norwegian ride-share reduced rate) |
| Revenue / km | Financial | `Total fare / Total distance` (all MTD trips) |
| Break-even day of month | Financial | Estimated day when cumulative revenue covers all costs |
| Avg Trip Fare | Trip Log | `Sum(fare) / count(trips)` |
| Avg Rating | Driver Roster | Average of `rating` across all trips |

### Live (auto-updates when you refresh the page)

| Section | Source |
|---|---|
| Driver Roster table | `/api/drivers` |
| Vehicle Fleet table | `/api/vehicles` |
| Trip Log table | `/api/trips` |
| Fuel Log table | `/api/fuel` |
| Maintenance Log table | `/api/maintenance` |

### Not yet live (still shows demo data)

| Section | Plan |
|---|---|
| Command Centre charts (revenue trend, platform split) | Chart.js currently reads hardcoded arrays — to be wired to live data in a future deploy |
| Driver coaching scores (composite) | Formula needs historical trip data for rolling 7d average; works after 7+ days of data |
| Some detail-page charts | Will be wired incrementally |

---

## 6. Where to find data — quick reference for each provider

### Bolt

1. Go to [fleets.bolt.eu](https://fleets.bolt.eu) → sign in as fleet manager
2. **Reports** → **Trips** → select date range → **Export CSV**
3. Export gives: trip time, driver, pickup/dropoff, fare, distance, platform commission, payment method, rating
4. Map columns to `weekly-operations.csv` TRIP row:
   - Bolt `Trip Date` → `date`
   - Bolt `Pickup Time` → `time`
   - Bolt `Driver` → `driver_email` (match via internal directory)
   - Bolt `Price` → `fare_nok`
   - Bolt `Distance` → `distance_km`
   - Bolt `Duration` → `duration_min`
   - Platform → always `Bolt`

### Uber

1. Go to [fleet.uber.com](https://fleet.uber.com) — fleet owner login
2. **Financials** → **Weekly Payments** → each driver's statement
3. Export PDF or CSV per driver
4. Map to TRIP rows: platform = `Uber`

### Norgestaxi / Oslo Taxi / local dispatch

1. Log into the operator portal (whichever central you work with)
2. Reports → Trip Log → date range → Export CSV
3. Map columns similarly; platform = central's name

### Fuel (Circle K / Shell fleet card)

1. Circle K Fleet portal: [circlekfleet.com](https://circlekfleet.com)
2. Reports → Fleet Card Transactions → monthly CSV
3. Shell: [shellfleethub.com](https://shellfleethub.com) → similar
4. Map to FUEL rows

### Tesla (for Model 3 / Y / S in the fleet)

1. Tesla app → Driver's Tesla account → **Charging History**
2. Export by email (Tesla sends CSV on request)
3. Or: use the upcoming Tesla Fleet API sync (once wired — see `docs/INTEGRATIONS.md`)

### Workshop / garage

- Most workshops email a PDF invoice
- Create a Gmail folder rule: "auto-forward to ops@fleettrack.no"
- Every Monday, dispatch enters the week's invoices into MAINTENANCE rows

---

## 7. Daily habits (for drivers & dispatch)

### What drivers do

- Nothing extra — just drive. They already log trips in Bolt/Uber apps.
- At end of shift, photograph any paper receipts (fuel, wash, etc.) and text to ops.

### What dispatch does daily (5–10 min)

- Photograph any workshop invoices that came in
- Note any shift no-shows or cancellations in a notepad
- Enter trip count from each platform into a spreadsheet (optional — just nice-to-have)

### What dispatch does every Monday (15–30 min)

- Download Bolt + Uber + Norgestaxi CSVs for the prior week
- Download Circle K / Shell fleet card transactions
- Scan workshop invoices into MAINTENANCE rows
- Combine all into `weekly-operations.csv`
- Upload to FleetTrack

---

## 8. Troubleshooting

### "Unknown driver_email — import drivers first"

You added a TRIP or SHIFT row for a driver who isn't in the DRIVER list.
**Fix:** Add that driver to `fleet-setup.csv` first, re-upload setup, then re-try.

### "Unknown car_id — import vehicles first"

Same but for vehicles.
**Fix:** Add the vehicle to `fleet-setup.csv` → re-upload.

### "Missing date, driver_email, or car_id"

These three columns are required on every SHIFT and TRIP row. Check the row number from the error report.

### "X duplicates skipped"

Normal and safe. The system de-dupes trips if the same driver+car+start-time appears twice (within 10 seconds). Means you probably uploaded the same CSV twice — no data was corrupted.

### Dashboard still shows old numbers

Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac).
Still old? Check the top-right "updated X ago" indicator on the Command Centre — if it's recent, the data is live. The charts (not KPI numbers) may still show demo data if they haven't been wired yet (see section 5).

### Can't log in after weekly upload

You may have accidentally changed the admin row in `users.csv`. Don't include a USERS section in the weekly file — only SHIFT / TRIP / FUEL / MAINTENANCE.

---

## 9. What data you cannot get from CSV (yet)

The following need external APIs wired (see `docs/INTEGRATIONS.md`):

- **Live odometer readings** (currently updated only on refuel; Tesla / Smartcar API would give minute-by-minute)
- **Real-time driver status** (online / offline / on-trip) — Bolt + Uber partner webhooks
- **Live GPS location** — Tesla / Smartcar API
- **Battery state of charge** — Tesla / Smartcar API

Until those are wired, CSV weekly sync is sufficient for ops, P&L, and compliance.

---

## 10. Retention & backups

- Keep all uploaded CSVs in a shared drive (Dropbox / Google Drive) — FleetTrack does not store your original files
- Export a full DB snapshot monthly via **Data Import → Download full backup** (or curl `/api/export/all`)
- For real-time backup: upgrade Neon to Launch tier ($19/month) for 7-day point-in-time recovery

See `docs/BACKUPS.md` for the full recovery strategy.

---

## 11. Who to ask for help

- **Template questions:** Office manager
- **Dashboard not updating:** IT / admin
- **A column seems wrong:** Send the full CSV + error message to ops lead — don't guess
- **API errors on upload:** Usually a missing env var in Vercel — IT's job

---

*End of SOP. Print this page to PDF via your browser's Print menu for physical reference.*
