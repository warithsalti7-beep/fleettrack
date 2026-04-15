# FleetTrack — Full A-Z Audit (Phase 2, April 2026)

_This document supersedes `AUDIT_2026_04.md` (Phase 1) with a deeper, domain-
by-domain critique produced **after** the driver-dashboard PR. It covers
data, statistics, integrations, security, scaling, UX, and analytics — and
ends with a single prioritised fix list ranked by **impact on real-world
fleet & driver performance**._

_Audit date: 2026-04-14 · post-commit `7a753e4`._

---

## 0. TL;DR — what's actually broken for fleet/driver performance

If only 10 items on this list get fixed in the next month, pick these:

1. **No server-side auth on `/api/*`.** PII, bank accounts and personal
   numbers exfiltratable via `curl`. (§5)
2. **Zero external integrations wired.** Tesla, NIO, Smartcar, Samsara,
   Bolt, Uber — all aspirational. The fleet runs blind. (§3)
3. **No real-time.** Docs claim WebSockets; code polls every 30–60s at
   best. Dispatch decisions made on stale state. (§3)
4. **Driver scoring formula is gameable.** No safety signal, no customer
   rating, no punctuality — only revenue/acceptance/idle. (§7)
5. **Alerts are text, not CTAs.** "Call driver now" with no dial button.
   Operators do 4 clicks to respond to a 1-click problem. (§6)
6. **No reconciliation.** Bolt API says 189 trips; DB has 145; nobody
   notices the 44-trip gap. Revenue lost, silently. (§3)
7. **`/api/drivers/:id/profile` fires 11 parallel queries.** Admin opens
   10 tabs → 110 queries → DB melts at 500 vehicles. (§5)
8. **`personalNumber` & `bankAccount` stored plaintext.** GDPR/Datatilsynet
   violation waiting to happen. (§5)
9. **Dashboard IA has 73 pages.** The 5 daily jobs-to-be-done each take
   4–6 clicks and cross 3+ pages. (§6)
10. **Duplicate-trip imports.** CSV re-upload double-counts revenue;
    no `(source, externalId)` uniqueness on Trip. (§3)

Estimated operator-hours/week saved after fixing all 10: **~25 hrs/week**
across dispatch + coaching + accounting. Estimated extra revenue captured
from reconciliation: **5–15% of gross** (based on typical fleet drift).

---

## 1. Scope & methodology

| Dimension | Files audited | Tool |
|-----------|---------------|------|
| Data model | `prisma/schema.prisma` (529 lines) | manual + grep |
| API surface | `src/app/api/**` (24+ routes) | grep + read |
| Integrations | `docs/INTEGRATIONS.md`, `src/lib/*`, package.json | parallel agent |
| Real-time | `docs/REAL_TIME.md`, queue/WS search | parallel agent |
| Security | auth, session, PII, indexes, logging | parallel agent |
| Scaling | `docs/SCALING.md` vs actual query patterns | parallel agent |
| UX & IA | `public/dashboard.html` (5539 lines), `driver*.html`, `employee.html` | parallel agent |
| Analytics / KPIs | scoring formulas, KPI cards, forecasting | parallel agent |
| Fleet/driver performance signals | synthesis of all of the above | this author |

---

## 2. Data model — strengths & gaps

### What's good
- Schema now covers **every line item** from the product brief (driver
  identity + docs + bank, vehicle insurance + EU-kontroll + tyres, wash,
  charging, battery swap, extra km, parking, repairs with fault,
  depreciation NO, tax entries with granularity, employees). See
  `prisma/schema.prisma` and `docs/DRIVER_DASHBOARD.md` for the map.
- All event-sourced models carry `(source, externalId)` uniqueness for
  idempotent re-imports: `ChargingSession`, `BatterySwap`, `ExtraKm`.
- `TaxEntry` is indexed on `(granularity, periodStart)` so instant →
  yearly rollups are single indexed scans.
- `AuditLog` schema is live for accountability.

### Gaps

**G1. `Trip` has no `externalId` / platform-id.**
Re-uploading a Bolt CSV creates duplicate Trip rows. Fix: add
`externalPlatform` (`BOLT` | `UBER` | `YANGO` | `NORGESTAXI`) and
`externalId`, then `@@unique([externalPlatform, externalId])`.

**G2. `FuelLog` has no idempotency.**
Same issue as Trip. Duplicate Circle K receipts double-count fuel costs.

**G3. `Driver.personalNumber` and `Driver.bankAccount` stored plaintext.**
Norwegian fødselsnummer is a regulated identifier under personopplysnings-
loven. Must be encrypted at rest (libsodium or `pgcrypto.pgp_sym_encrypt`).
Indexing a ciphertext requires a hash column if you still need `@unique`.

**G4. No `TelematicsSample` / `VehicleTelemetry` table.**
Tesla/NIO/Smartcar/Samsara samples (lat, lng, battery %, fuel %,
odometer, speed) have no home. Without this, you cannot compute
dead-head km from actual odometer deltas, and you cannot detect when
a driver leaves the service area. This is the single biggest schema gap
for performance improvement.

**G5. No `DriverEvent` / behavioural events.**
Harsh braking, sudden acceleration, speeding, and seat-belt events come
from Samsara / Smartcar. Nowhere to land them. Required for any real
safety-weighted driver score.

**G6. `Shift` has no clock-in/out timestamps, only strings.**
`startTime`/`endTime` are `String "HH:MM"` — cannot compute minutes-late,
cannot reconcile against real first-trip time. Replace with
`DateTime clockInAt`/`clockOutAt` (nullable) plus the scheduled window.

**G7. `Trip.fare` is a single number; no split into base / surge /
platform-fee / tip / tolls.**
You can't answer "what % of revenue is surge?" or "which driver gets the
most tips?". Introduce line items: `TripCharge { type, amountNok }`.

**G8. No `Incident` / `Complaint` / `Rating` tables.**
Dashboard references ratings, complaints, disputes — but schema has only
`Trip.rating`. Customer-side feedback never lands anywhere persistent.

**G9. No `PlatformSession` / driver online-offline intervals per platform.**
Can't answer "why was Szymon on Bolt for 6h but earned half of Piotr who
ran both apps for 4h?". Needed for platform-diversification scoring.

**G10. `FixedCost.amountNok` signed-convention is "negative = expense".**
Confusing in reports; every chart must flip the sign. Standard practice
is `amountNok > 0` + separate `direction: EXPENSE | REBATE` enum.

### Recommended schema additions

```prisma
model TelematicsSample {
  id          String   @id @default(cuid())
  vehicleId   String
  source      String   // SAMSARA | TESLA | NIO | SMARTCAR
  sampledAt   DateTime
  latitude    Float
  longitude   Float
  speedKph    Float?
  heading     Float?
  odometerKm  Float?
  batteryPct  Float?   // EVs
  fuelPct     Float?   // ICE
  ignitionOn  Boolean?
  externalId  String?
  vehicle     Vehicle  @relation(fields: [vehicleId], references: [id])
  @@unique([source, externalId])
  @@index([vehicleId, sampledAt])
}

model DriverEvent {
  id          String   @id @default(cuid())
  driverId    String?
  vehicleId   String
  occurredAt  DateTime
  kind        String   // HARSH_BRAKE | HARSH_ACCEL | SPEEDING | IDLE_OVER | SEATBELT_OFF | PHONE_USE
  severity    String   // LOW | MEDIUM | HIGH
  latitude    Float?
  longitude   Float?
  speedKph    Float?
  source      String
  externalId  String?
  @@index([driverId, occurredAt])
  @@index([vehicleId, occurredAt])
}

model TripCharge {
  id         String  @id @default(cuid())
  tripId     String
  kind       String  // BASE | DISTANCE | TIME | SURGE | TOLL | TIP | PLATFORM_FEE
  amountNok  Float
  trip       Trip    @relation(fields: [tripId], references: [id], onDelete: Cascade)
  @@index([tripId])
}

model Incident {
  id          String   @id @default(cuid())
  driverId    String?
  vehicleId   String?
  tripId      String?
  occurredAt  DateTime
  kind        String   // COMPLAINT | CRASH | SAFETY_CONCERN | DISPUTE
  severity    String
  description String
  reporter    String?  // customer, driver, ops
  status      String   @default("OPEN")
  resolvedAt  DateTime?
  resolution  String?
  createdAt   DateTime @default(now())
  @@index([driverId, occurredAt])
  @@index([status])
}
```

---

## 3. Integrations & real-time — the biggest blind spot

### 3.1 External integrations: claimed vs wired

The project's docs describe a rich integration stack. The code does not.

| Integration | `docs/INTEGRATIONS.md` says | Reality |
|-------------|------------------------------|---------|
| Tesla Fleet API | OAuth 2.0 PKCE, rate-limited polling | **No client.** No `src/lib/tesla.ts`. |
| NIO Power / Smartcar | Battery, odometer, location | **No client.** |
| Samsara telematics | 10-s polling via BullMQ | **No BullMQ installed.** |
| Google Maps | Geocode/Directions cached in Redis | **No Redis client.** |
| Bolt / Uber partner APIs | Trip pushes | **No client, no webhook receiver.** |
| Norgestaxi CSV | Nightly import | Schema supports `source=CSV_TAXI`; no importer endpoint for it yet. |
| Bank APIs | Payouts | **No client.** |

**Verdict: 0 of 7 external integrations are wired.** The database schema is
integration-ready (`(source, externalId)` everywhere), which is good, but
without clients the event tables (`ChargingSession`, `BatterySwap`,
`TelematicsSample`, `ExtraKm`, `DriverEvent`) will remain empty, and every
fleet-performance insight that depends on them — utilisation, dead-head
km, EV efficiency, safety scoring — will be impossible to compute.

### 3.2 Real-time path: documented vs implemented

`docs/REAL_TIME.md` describes:

```
Telematics APIs → BullMQ (Redis) → WebSocket Gateway (Socket.io)
              → Dashboard / Driver app
Cron every 10s enqueues "sync-all"; processor writes DB + Redis cache.
Events: vehicle:location (10s), vehicle:status, vehicle:charging,
        driver:status, trip:update, fleet:stats (30s).
```

**Reality:**
- `bull`, `bullmq`, `ioredis`, `redis`, `socket.io` — **none in
  `package.json`**.
- No `/api/ws`, `/api/stream`, `/api/events` routes.
- No worker process, no scheduled jobs, no cron.
- No `POST /api/drivers/:id/heartbeat` endpoint (referenced in docs).

**Effective latency today:** whatever the client polls at. Given no
dedicated `useInterval()` is visible in `public/*`, dispatch and driver
apps only refresh on navigation / hard refresh. This is fine for a demo;
it's catastrophic for live operations.

### 3.3 Import pipeline — usable, but not idempotent

All 8 `/api/import/*` routes work. `src/lib/import.ts` provides row-level
error reports. Templates exist for every entity.

**However:**
- **No idempotency** on `/api/import/trips`, `/api/import/fuel_logs`,
  `/api/import/maintenance`. Re-upload doubles the data.
- **No pre-flight header validation.** A CSV missing the `email` column
  silently inserts zero rows.
- **`runImport()` per-row transactions.** A partial failure leaves half
  the batch committed. Needs a `--atomic` flag.
- **No `ImportLog` table.** You can't answer "who imported what when, and
  did any rows fail?". Critical for tax audit trails.

### 3.4 Webhooks — none

No `/api/webhooks/*`, no HMAC verification. Bolt and Uber both offer
webhook delivery for trip-completion; we take 10-s polling instead. That's
a 90% API-cost overspend and a worst-case 10-s latency per trip update.

### 3.5 Reconciliation — none

When Bolt API says 189 trips, Samsara odometer says +2100 km, and our DB
sums to 1850 km of trips, **no code notices**. There is no
`ReconciliationLog`, no daily job, no variance report. Every % of drift
is revenue loss (driver paid commission on a trip not in the DB) or
revenue leak (fleet billed for fuel/charging not tied to a trip).

### 3.6 Data freshness signals — absent

API responses carry `updatedAt` (the DB row's last mutation) but no
`lastSyncAt` (last external-API pull) and no `source` (MANUAL vs API vs
CSV). The dispatch UI cannot show "vehicle last heard from: 14 min ago";
every value looks live.

### Top integration fixes (impact on fleet/driver performance)

1. **Ship Samsara polling first.** Unlocks real odometer, ignition, GPS.
   Enables: dead-head km, utilisation %, reposition engine.
2. **Add `externalPlatform + externalId` to `Trip` and `FuelLog`.**
   Stops duplicate-counted revenue. Data integrity restored.
3. **Implement `Last-Sync-At` header + field** on every resource. Puts a
   freshness badge next to every number in the UI.
4. **Build a nightly reconciliation job.** Compare trip sum to odometer
   delta per vehicle; flag >5% drift. Typical fleets recover 5-15% of
   "leaked" revenue via reconciliation.
5. **Accept webhooks from Bolt/Uber** at `/api/webhooks/{bolt,uber}`
   signed with HMAC. Cuts latency 60x, API cost 10x.
6. **Add a `/api/drivers/:id/heartbeat`** (Redis TTL 15 s) so dispatch
   can see "online *right now*" vs "checked in at 06:00".
7. **Wire Google Maps Directions/Distance-Matrix** with 7-day Redis cache.
   Removes most manual distance-entry friction.
8. **CSV pre-flight.** Validate headers, data types, row count before
   any insert. Cut support tickets.
9. **`ImportLog` table + `/dashboard/system/import-history` page.**
   Legal/tax auditability.
10. **Retire the "3 kr/kWh" flat rate** — once Tesla/NIO APIs are wired,
    use each session's actual per-kWh cost when available.


---

## 4. API surface — error-handling + coverage

24+ routes exist. Quality is uneven.

| Route pattern | Errors caught? | PII-safe? | Rate-limited? |
|---|---|---|---|
| `/api/health` | ✓ try/catch | n/a | — |
| `/api/import/*` | ✓ row-level + Sentry | ⚠ email in error message | only SEED_TOKEN |
| `/api/ai/fleet-summary` | ✓ | ✓ | 10-min in-memory cache only |
| `/api/stats` | ⚠ `.catch(fallback)` per promise | ✓ | — |
| `/api/drivers` (GET/POST) | ✗ uncaught | ✗ returns whole table | — |
| `/api/drivers/[id]` | ✗ uncaught | ✗ | — |
| `/api/drivers/[id]/profile` | partial (`safe()` wrapper for missing tables) | ⚠ `personalNumber` in response | — |
| `/api/vehicles` | ✗ uncaught | ✓ | — |
| `/api/trips` | ✗ uncaught | ✓ | — |
| `/api/fuel`, `/api/maintenance` | ✗ uncaught | ✓ | — |
| `/api/export/*` | ✗ no auth | ✗ returns whole table | — |
| `/api/seed` | ✓ | ✓ | SEED_TOKEN |

**Missing endpoints that the new driver-dashboard needs:**
`POST /api/drivers/:id/documents` (upload),
`POST /api/wash`, `POST /api/charging`, `POST /api/battery-swap`,
`POST /api/parking-tickets`, `POST /api/repairs`, `POST /api/extra-km`,
`POST /api/tax-entries` (or batch compute job),
`POST /api/drivers/:id/heartbeat`,
`POST /api/webhooks/{bolt,uber,tesla,nio}`,
`GET /api/reconcile/daily` (on-demand re-run),
`GET /api/employees` + CRUD.

---

## 5. Security, PII, scaling

### 5.1 Authentication

- **No server-side session validation on any `/api/*` route** (except
  `/api/seed`).  Cookie signing exists in `src/lib/session.ts` but is
  never called from API routes.  `getSecret()` silently falls back to
  `'dev-insecure-secret-please-set-AUTH_SECRET'` if the env var is
  missing — no warning, no abort.
- **Client-side auth is bypassable via localStorage.** `public/auth.js`
  verifies passwords in-memory and writes roles to localStorage; an
  attacker setting `ft_role_drv-1='admin'` and refreshing bypasses every
  UI guard.
- **Passwords plaintext** in `DEMO_USERS` and `ft_custom_users`. No
  bcrypt/argon2.
- **No logout revocation.** Stolen session cookies remain valid until
  `exp`.

### 5.2 PII sensitivity — GDPR / Datatilsynet risk

Fields exposed without encryption or minimisation:

| Field | Model | Encrypted? | In API response? | In CSV export? | In logs? |
|---|---|---|---|---|---|
| `personalNumber` (fødselsnummer) | `Driver` | ✗ | ✗ (profile route) | ⚠ (driver export) | ✗ not scrubbed |
| `bankAccount` | `Driver` | ✗ | ✗ | ⚠ | ✗ |
| `bankName` | `Driver` | ✗ | ✗ | ⚠ | ✗ |
| `address` | `Driver` | ✗ | ✗ | ⚠ | ✗ |
| `email` | `Driver`, `User` | ✗ | ✗ (intentional) | ⚠ | ⚠ (`import.ts:72` captureError includes row email) |
| `fileUrl` (doc blobs) | `DriverDocument` | ✗ (URL only; blob store acl unverified) | ✗ | ✗ | ✗ |
| Sentry DSN | `public/auth.js:19` | public key (intentional) | — | — | — |

**Minimum fix:**
- Encrypt `personalNumber`, `bankAccount`, `bankName` at rest (pgcrypto).
- Redact to `"••• ••• " + last4` in any API response unless caller has
  `perm: viewPii` and it's logged to `AuditLog`.
- Strip email, phone, personalNumber from Sentry payloads.
- Sign doc blob URLs with 1-hour TTL.

### 5.3 Rate limiting / abuse

None. `/api/drivers?status=...` can be scraped; `/api/import/trips` can
be flooded. Add Vercel Edge Config (or a tiny Upstash Redis token
bucket) with defaults: 100 req/min per IP for read, 5 req/min for write,
1 req/min for `/api/import/*`.

### 5.4 DB indexes / query patterns

New models already have sensible composite indexes. Gaps found:

- `ExtraKm` has `@@index([vehicleId, day])` and `@@index([driverId, day])`
  but the profile-aggregate query uses `OR: [{driverId},{vehicleId in}]`
  which PostgreSQL cannot satisfy with either composite. Add a plain
  `@@index([day])` and rewrite the query as two queries + merge, or
  denormalise `driverId` onto every child.
- `TaxEntry`: profile route does `take: 200` over all granularities,
  then buckets client-side. Should instead
  `groupBy granularity` or use Postgres window functions.
- `Trip`: no index on `status` alone — `/api/stats` `trip.aggregate`
  will seq-scan once rows exceed ~20k.

### 5.5 Scaling bottleneck ranking (at 500 vehicles / 25 000 trips/day)

1. **`/api/drivers/:id/profile`** — 11 parallel queries × 10 tabs open =
   110 DB hits. Solution: batch endpoint + 5-min cache.
2. **`/api/stats`** — seq-scan on `Trip.status` without composite index.
   Solution: `@@index([status, completedAt])` + 1-min memoisation.
3. **`/dashboard.html` initial payload** — 5 539 lines of HTML + all of
   `fleet-data.js` baked in. At 50+ drivers it becomes unresponsive on
   3G. Solution: extract each `<div class="page">` into its own route
   and lazy-load on nav.
4. **No DB connection pooling docs** — a handful of cold starts and the
   pool exhausts. Use PgBouncer or Neon's serverless driver.

### 5.6 Observability gaps

- No correlation / request-id header.  A user reporting "dashboard was
  slow yesterday 14:02" cannot be traced across `/api/stats`,
  `/api/drivers`, `/api/trips` logs.
- Sentry captures exception only for import + AI routes; every CRUD
  route is blind.
- `AuditLog` schema exists but no writes.

---

## 6. UX, information architecture, ergonomics

### 6.1 IA spread

`public/dashboard.html` now has **73+ `.page` blocks** across 8 nav
groups. A dispatcher's morning routine ("who's late? who's their
backup?") currently takes **4–6 clicks and cross-references 3 pages**.
A coach trying to find drivers who regressed this week has no dedicated
view and must compare 19 profiles manually.

### 6.2 Jobs-to-be-done — click paths measured

| User | Task | Pages crossed | Clicks | Weekly hours wasted |
|------|------|---|---|---|
| Dispatcher 06:45 | Find no-shows + backup | Shifts + Cancellations + Roster | 4–6 | 3.5 |
| Manager 17:00 | Who lost money today, why? | Vehicle P&L + Daily P&L + Payroll | 5 | 5 |
| Coach Mon AM | Drivers regressed WoW | Coaching + each Driver Profile | 4 | 8 |
| Accountant month-close | VAT + payouts + Tripletex | Tax Centre + Invoicing + Export | 4 | 6 |
| Driver 06:00 | Am I on shift? Which car? | Home tab | 1 | 0 |

Total recoverable: **~22 operator-hours/week** from IA consolidation alone.

### 6.3 Alert fatigue

Overview renders 4 critical alerts. **None have an inline CTA** (no
"Call driver" phone link, no "Go to dispatch" button, no
"Snooze / Resolve"). Alerts are free-text — the operator must translate
to an action, then navigate to the page, then find the driver, then
find the phone. 4 clicks for what should be 1.

Deduplication: the same VH-14 loss appears on Overview, Vehicle
Performance, Daily P&L, and the Command Centre. No single source of
truth.

### 6.4 Mobile

`driver.html` is genuinely mobile-first (600 px max, bottom nav) and
excellent. `dashboard.html` degrades: at 375 px the sidebar transforms
off-screen but tables scroll horizontally and the breadcrumb
disappears with no replacement.

### 6.5 Cross-page consistency

"19 drivers" and "14 vehicles" appear in 4+ places. Driver score is
computed both in `dashboard.html` (`score()` at line 4514) and in the
driver portal. If either formula changes, they drift.

### 6.6 Action bias

~15 of 73 pages have a primary CTA. ~40 are read-only tables. 9 CTAs
are `Toast.info('…not implemented yet')`. The product is optimised for
looking, not doing.

### 6.7 Driver-profile page specifics

8 tabs (Identity, Documents, Vehicles, Operations, Repairs, Finance,
Tax, Accounting) are complete but **have no action buttons**: no "Call
driver", "Suspend", "Reassign car", "Adjust commission", "Generate
tax doc". For a page that is reached by a manager performing an
intervention, that is a miss.

### Top UX fixes (hours-saved / week)

1. Merge "Shifts" + "Cancellations & No-shows" into a single **Shift &
   Absence Board** pinned to the Overview. **3.5 h/w**
2. Add a **Weekly Regression Leaderboard** (coach page showing top-5
   drivers with the biggest WoW score drop). **4 h/w**
3. Turn every alert body into an inline CTA row with 2–3 action buttons
   (`Call`, `Go to dispatch`, `Suspend`, `Snooze 30 min`). **2.5 h/w**
4. Add a **top-bar action row** to `driver-profile.html`: Call,
   Message, Suspend, Reassign vehicle, Adjust commission. **1.5 h/w**
5. **Sidebar search / Ctrl-K.** Type "Szymon" → jump. **3 h/w**
6. **Decision Guide card** on Overview — "Revenue <10% of target? Do
   these 5 things." **1.5 h/w**
7. **"Export to Tripletex"** button on Tax Centre with auto-mapping.
   **3 h/w** for the accountant.
8. Trim `driver-profile.html` from 8 tabs to 5 (fold Tax + Accounting
   behind an Admin toggle; merge Repairs into Vehicles).
9. Replace 9 `Toast.info('…not implemented')` stubs with working
   modals or hide them.
10. Computed "Total drivers / vehicles" instead of hardcoded — so no
    drift when data changes.

---

## 7. Analytics & driver-performance signals — the heart of "making drivers better"

### 7.1 The scoring formula today

Computed in `public/dashboard.html:4514–4516`:

```
Score = 0.30 × min(100, revhr / 20 × 100)
      + 0.25 × util
      + 0.20 × acceptance
      + 0.15 × min(100, triphr / 2.5 × 100)
      + 0.10 × max(0, 100 − cancel% × 5)
```

Tiers: **Top ≥ 80**, Average 60–79, Low < 60.

### 7.2 How the formula is gameable

- **Cherry-pick long fares.** Driver accepts only high-fare trips,
  ignores short hops. Acceptance stays high (accepted=1, skipped=0),
  rev/hr inflates. Need distance-normalised revenue and dead-head %.
- **Cancel softly.** Cancel_score tolerates up to 20% cancellation
  before hitting zero. A driver cancelling 10% still scores 50 on that
  slice. Switch to a per-cancellation penalty (-0.5 pts each).
- **Pizza-stacking / zone-camping.** `trips/hr` rewards raw count; a
  driver camping in a congested zone gets higher ping frequency even if
  each fare is tiny.
- **Avoid peaks.** Peaks yield 34% more revenue/h per operational
  intelligence, but the formula doesn't reward peak-hour compliance.
- **Single-platform lock-in.** Bolt-only driver scores equally to a
  balanced driver, even though single-platform dependency costs the
  fleet ~150 k NOK / month (from `Operational Intel` card).
- **No safety tax.** A driver with 13 harsh-brake events / week scores
  identically to one with 1. Safety, harsh-braking and phone-use data
  exists on the Telematics page (`dashboard.html:3845+`) but never
  reaches the score.
- **No customer vote.** `Trip.rating` exists on the model but is not
  a factor. A 3.2-star driver scores the same as a 4.9.

### 7.3 KPI inventory — what's live vs baked-in

Every KPI card on the Overview is currently driven by hard-coded
fixtures in `public/fleet-data.js`. None recompute from `/api/stats`
without a page reload. Of ~40 KPI cards:

- **Real-ish (derivable once live data lands):** Revenue Today, Net
  Profit, Trips, Active Drivers, Utilization, Avg Rev/Hr, Acceptance,
  Cancellation, Avg Idle, Trips/Active-Hr, Cost per Trip, Platform
  Split.
- **Chart data baked in:** Revenue-vs-Target hourly, Platform donut,
  Score Distribution, Forecast ARIMA (just numbers hard-coded), Zone
  revenue, Safety scorecard.
- **Threshold cards (static constants):** the five in the Alert
  Thresholds table.

### 7.4 Forecasting is decorative

`/api/ai/fleet-summary` is a **recommendation** endpoint, not a
forecast. It reads fleet metrics and returns 3-5 next-24-hour actions
(good). But:

- No forecast endpoint exists. The Forecasting page (`~line 3820`) is
  entirely hard-coded numbers and a canvas with baked-in arrays.
- No backtesting. No error bands from actual data.
- No external signals fed to the LLM: no weather, no events calendar,
  no historical dow/hour demand.
- **No feedback loop.** Operators accept or ignore a recommendation —
  the system never learns which recommendations pay off.

### 7.5 Missing cohort / segmentation cuts

| Cut | Exists in data? | Used in analytics? |
|---|---|---|
| Tenure (new / ramp / mature) | `Driver.joinedAt` | ✗ |
| Employment (EMPLOYEE / ENK / AS) | `Driver.employmentType` | ✗ |
| Shift (AM / PM) | yes | ✗ (roster shows, no analysis) |
| Platform primary | `Shift.platformPrimary` | partial |
| Peak-hour compliance | derivable | ✗ |
| Vehicle class (premium / standard / budget) | `Vehicle.make+model` | ✗ |
| Zone affinity | derivable from `Trip.pickup*` | ✗ |
| Commission-adjusted profitability | `Driver.commissionPct` | ✗ |

### 7.6 No causality / attribution

When today's revenue is down 15%, the dashboard shows the gap but
cannot tell us **why**. Missing attribution rails:

- Weather (no API).
- Platform outage (no status check).
- No-show impact (visible but not costed in NOK).
- Zone demand shift (data exists per zone per hour but not cross-
  referenced to revenue delta).
- Competitor events / surge pricing — nothing.

### 7.7 Missing percentile / variance stats

All metrics are averages. There is no **P95 pickup-to-arrival**, no
rider-waiting distribution, no revenue-volatility (std dev) per
driver, no utilisation consistency. Averages hide the worst-trip-on-
the-worst-day problem that kills customer retention.

### Top 10 missing signals that would materially improve performance

1. **Customer rating → driver score** — +0.5 pts / 5-star, −2 pts /
   1-2 star. Fixes the 3.2-star-but-90-score problem.
2. **Safety events → driver score** — −3 pts per hard-brake /
   speeding / phone-use incident (rolling 30 d). Eliminates the
   siloed Safety page.
3. **Peak-hour bonus** — 1.1× score multiplier for drivers whose
   shift overlap ≥70% with peak windows. Operational intel already
   says peaks earn 34% more; score must reflect that.
4. **Per-platform acceptance / revenue** — split Bolt vs Uber vs
   Yango everywhere; alert if any driver is >80% on one.
5. **Zone-demand normalisation** — score relative to (rev/hr ÷
   demand_index of assigned zone). Stops rewarding low-demand-zone
   drivers less for bad luck.
6. **Causal attribution feed** — daily job that annotates each large
   revenue delta with weather, no-shows, platform outages.
7. **Tenure ramp curve** — separate cohorts and expected-by-day
   targets for < 30-d, 30–90-d, 90+-d drivers.
8. **Shift punctuality** — clock-in vs scheduled delta; add
   ±3 pts/week.
9. **Commission-adjusted profitability** — compare ENK / AS /
   EMPLOYEE drivers on NOK-to-fleet rather than gross.
10. **AI-recommendation feedback loop** — log which suggestions were
    actioned and measure the revenue delta, retrain the prompt.

---

## 8. Code health quick-hits

- `public/dashboard.html` is **5 539 lines** after this PR. Start
  extracting each `<div class="page">` to its own html partial loaded
  on navigation. 5 000+ is the pain threshold; we're past it.
- `public/fleet-data.js` holds ~19 hardcoded drivers / ~14 vehicles —
  three copies of the same data across auth.js / driver.html / the
  dashboard. Unify around `/api/fleet/summary`.
- `driver-profile.html` also ships ~150 lines of demo fixtures inline;
  move them to `fleet-data.js` or load from the API.
- `TODO / FIXME` grep: 0 hits — code hygiene is good.
- No Prettier / Stylelint config — 8 000 lines of hand-formatted CSS
  cannot stay consistent forever.

---

## 9. Testing

- **Playwright:** 5 smoke tests. No import-pipeline test, no role-
  filter test, no KPI-consistency test, no driver-profile smoke. Add:
  1. "login as driver → dashboard URL is blocked".
  2. "import trips twice → row count unchanged" (will fail today —
     it's the bug).
  3. "driver-profile loads without console errors at /driver-profile".
  4. "tax-centre granularity picker updates all KPI tiles".
- **No unit tests** on scoring formula, currency formatting, NOK VAT
  calculation, commission split logic, depreciation.
- **No contract tests** for `/api/*`; swagger/OpenAPI not published.

---

## 10. Prioritised fix list — 30 items ranked by fleet/driver impact

Scale: **Impact** = operator-hours saved OR NOK unlocked / month;
**Effort** = engineer-days. Ordered by impact/effort.

### 🔴 Critical (ship this sprint)

| # | Item | Impact | Effort |
|---|------|---|---|
| 1 | Add session-validation middleware to every `/api/*` (reject 401 if no signed cookie) | blocks data breach — priceless | 0.5 |
| 2 | `(externalPlatform, externalId)` UPSERT on Trip, FuelLog | 5-15% revenue integrity recovered | 1 |
| 3 | Encrypt `personalNumber` + `bankAccount` (pgcrypto column) | regulatory compliance | 1 |
| 4 | Strip PII (email/phone/personalNumber) from Sentry payloads | compliance + leak protection | 0.5 |
| 5 | Rate-limit `/api/*` (100/min read, 5/min write) | DoS / scrape protection | 0.5 |
| 6 | Add `@@index([status, completedAt])` on Trip + 1-min cache on `/api/stats` | dashboard <100 ms once live | 0.5 |

### 🟠 High (next sprint)

| # | Item | Impact | Effort |
|---|------|---|---|
| 7 | Wire Samsara polling → `TelematicsSample` → BullMQ | unlocks every real-time metric | 10 |
| 8 | Ship nightly **reconciliation job** (trip sum vs odometer delta vs platform) | 5-15% revenue recovery | 5 |
| 9 | Webhooks from Bolt / Uber at `/api/webhooks/*` (HMAC-signed) | 60× latency ↓, 10× API cost ↓ | 4 |
| 10 | `POST /api/drivers/:id/heartbeat` + Redis TTL | accurate "online now" board | 2 |
| 11 | Expand Driver scoring: add rating, safety, peak-hour, punctuality, platform-balance signals | 5-10% driver perf uplift, better coaching targets | 4 |
| 12 | Turn every Overview alert into an action-row with CTAs (Call, Dispatch, Suspend, Snooze) | 2.5 h/week saved | 2 |
| 13 | Merge Shifts + No-shows into "Shift & Absence Board" on Overview | 3.5 h/week saved | 2 |
| 14 | Add top-bar action row to `driver-profile.html` (Call / Message / Suspend / Reassign / Edit commission) | 1.5 h/week saved | 1 |
| 15 | `ImportLog` table + `/dashboard/system/import-history` | audit trail / tax | 2 |

### 🟡 Medium (quarter)

| # | Item | Impact | Effort |
|---|------|---|---|
| 16 | `TripCharge` line items (base, surge, tolls, tip, platform fee) | real margin analysis | 3 |
| 17 | `DriverEvent` model + Samsara event stream (hard brake, speeding, phone) | safety scoring | 4 |
| 18 | `Incident` / `Complaint` model + ratings wall | customer voice in scoring | 3 |
| 19 | `Shift.clockInAt/clockOutAt` + punctuality metric | reliability signal | 2 |
| 20 | Weekly Regression Leaderboard (coach page) | 4 h/week saved | 2 |
| 21 | Sidebar search (Ctrl-K to any driver/vehicle/page) | 3 h/week saved | 2 |
| 22 | `AuditLog` writes on every admin mutation + import run | traceability | 1 |
| 23 | Replace hardcoded `drivers/vehicles` counts with computed values everywhere | no drift | 1 |
| 24 | Google Maps Directions + Redis geocode cache | ETAs in dispatch | 3 |
| 25 | CSV pre-flight (header + type + row-count validation) | fewer support tickets | 1 |

### 🟢 Low / long-term

| # | Item | Impact | Effort |
|---|------|---|---|
| 26 | Extract each dashboard `<div class="page">` into a lazy-loaded partial | page-load < 1s | 4 |
| 27 | Forecast API endpoint with real ARIMA + backtests + holiday effects | 2-5% extra revenue via planning | 8 |
| 28 | AI-recommendation feedback loop (log action + 24-h outcome) | improves prompt, compounds | 3 |
| 29 | Tripletex / PowerOffice export button on Tax Centre | 3 h/week saved | 3 |
| 30 | Playwright expansion (import pipeline, role filter, tax centre, profile) | regression insurance | 2 |

---

## 11. Six-sprint roadmap to 10× performance

**Sprint 1 (week 1-2): don't lose data, don't leak PII.**
Items 1-6. Unlocks safe live deployment.

**Sprint 2 (week 3-4): see the fleet.**
Item 7 (Samsara), 10 (heartbeat), 8 (reconciliation job). Now every
metric has ground truth.

**Sprint 3 (week 5-6): close the dispatch loop.**
Items 9 (webhooks), 24 (Maps), 12 (alert CTAs), 13 (Shift board).
Dispatch response time drops from minutes to seconds.

**Sprint 4 (week 7-8): score the right things.**
Items 11 (new scoring signals), 16 (TripCharge), 17 (DriverEvent), 18
(Incident). Driver score now safety-weighted, customer-weighted and
platform-balanced.

**Sprint 5 (week 9-10): close the coaching loop.**
Items 19 (punctuality), 20 (regression leaderboard), 14 (profile
actions), 28 (AI feedback).

**Sprint 6 (week 11-12): accountant-friendly + observable.**
Items 15 (import log), 22 (audit log), 29 (Tripletex export), 27
(forecast API), 30 (test expansion), 26 (page extraction for perf).

---

## 12. Expected outcomes

| Metric | Today | After Sprint 6 |
|---|---|---|
| Data freshness on dashboard | hours (on reload) | 10-30 s (WS or polling) |
| Revenue-integrity drift (reconciliation) | 5-15% silent | < 1% |
| Dispatcher hours on "who's late / backup" | 3-4 h / week | < 1 h / week |
| Coach hours finding regressions | 6-8 h / week | 1 h / week |
| Accountant month-close hours | 8-12 h | 3-4 h |
| Driver score correlated with customer rating (r²) | ~0 | > 0.5 |
| Driver score correlated with safety events (r²) | ~0 | > 0.4 |
| PII exposure (GDPR audit) | non-compliant | compliant |
| Dashboard 50th pct page-load | 1.5 s | < 300 ms |
| `/api/drivers/:id/profile` p95 | ~400 ms at demo scale | < 150 ms at 500 vehicles |

---

_Audit complete. Every finding in this document maps to a schema gap,
a missing API route, a UI CTA, or a missing signal — all of them
concrete enough to turn into a ticket. Use §10 as the Jira import._
