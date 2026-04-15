# External API Integrations — Honest Feasibility Matrix

> Status 2026-04: this doc describes what's **actually possible** per provider,
> what's **partner-gated**, and what's **CSV-export-only**. Do not assume a
> provider offers a public API just because they're a big brand.

## TL;DR — what you can and can't do

| Provider | Live API | Webhooks | CSV export | Workflow |
|---|---|---|---|---|
| **Tesla Fleet API** | ✅ Yes (OAuth) | ❌ | ❌ | Full live sync — car location, odometer, charge state, trip starts/stops |
| **Smartcar (NIO, BMW, Ford, Hyundai, VW, 40+ brands)** | ✅ Yes (OAuth) | ❌ | ❌ | Live sync for anything not Tesla |
| **Uber Fleet / Direct** | 🟡 Partner-gated | ✅ (partner) | ✅ | Earnings + trip history via partner API; apply at `developer.uber.com` |
| **Bolt Business / Drive** | 🟡 Partner-gated | ✅ (partner) | ✅ | Operator Console CSV download; webhook/API only with Bolt partnership |
| **Norgestaxi / Oslo Taxi / 07000** | ❌ No public API | ❌ | ✅ | Download dispatch CSV from their operator portal; import via `/api/import/bulk` |
| **Skatteetaten (Norwegian tax auth)** | 🟡 Certified POS only | ❌ | ❌ | Taximeter receipts already go to Skatt per Norwegian law via your taxameter |
| **Google Maps / Mapbox** | ✅ Yes | ❌ | ❌ | Geocoding, distance matrix, routing — useful for validating trip addresses |

## 1. Tesla Fleet API ✅ **Full live sync**

Tesla has a real OAuth 2.0 Fleet API for commercial fleets.

### What you get

- Vehicle location (live)
- Odometer (real mileage — auto-fills FleetTrack's `mileage` field)
- Charge state (battery %, cable plugged in, charging rate)
- Trip starts/stops (when driver begins and ends a trip)
- Climate state, door state (if you want advanced fleet ops)

### Setup

1. Go to [developer.tesla.com](https://developer.tesla.com) → Create Application
2. **Redirect URI:** `https://<your-domain>/api/integrations/tesla/callback`
3. **Scopes:** `openid offline_access vehicle_device_data vehicle_location vehicle_charging_cmds`
4. Add to Vercel env vars:

   ```
   TESLA_CLIENT_ID=<your_client_id>
   TESLA_CLIENT_SECRET=<your_client_secret>
   TESLA_REDIRECT_URI=https://<your-domain>/api/integrations/tesla/callback
   ```

5. Each driver/owner completes Tesla OAuth flow once; refresh tokens stored per-vehicle in DB.

### Rate limits

**~200 calls/vehicle/day** on the polling API. For fleets with > 25 vehicles,
use **Fleet Telemetry** (WebSocket streaming) — no poll limit.

### Status

🟡 Scaffold shipped at `src/lib/integrations/tesla.ts`. Full OAuth handler + sync loop are not wired yet — see implementation checklist at bottom of this doc.

---

## 2. Smartcar (NIO, BMW, Ford, Hyundai, VW, 40+ brands) ✅ **Full live sync**

NIO does NOT expose a public fleet API directly. **Smartcar** is the standard intermediary — they've built connectors to NIO's car cloud and speak a unified OAuth 2.0 API across brands.

### What you get (from NIO specifically)

- Odometer
- Battery level + range
- Charging state
- Location
- VIN, make/model confirmation

What Smartcar can't do on NIO (yet): remote lock/unlock, climate control. Those are Tesla-only features.

### Setup

1. Sign up at [smartcar.com](https://smartcar.com/dashboard) → Create Application
2. **Redirect URI:** `https://<your-domain>/api/integrations/smartcar/callback`
3. **Required scopes:** `read_vehicle_info read_location read_odometer read_battery read_charge`
4. Add to Vercel env vars:

   ```
   SMARTCAR_CLIENT_ID=<your_client_id>
   SMARTCAR_CLIENT_SECRET=<your_client_secret>
   SMARTCAR_REDIRECT_URI=https://<your-domain>/api/integrations/smartcar/callback
   ```

### Cost

- **Free tier:** 1 API call per vehicle per second, 250 vehicles, `read_*` scopes
- Sufficient for FleetTrack at our scale

### Status

🟡 Scaffold shipped at `src/lib/integrations/smartcar.ts`. OAuth + sync not wired — see checklist.

---

## 3. Uber Fleet Management 🟡 **Partner-gated**

Uber's Fleet API is real but access is **gated behind a partnership agreement**. You need to:

1. Register a fleet/operator account at [supplier-help.uber.com](https://supplier-help.uber.com) or through the Uber Fleet team
2. Request API access — Uber approves fleets above a minimum trip volume (typically 1000+ trips/month)
3. Once approved, you get OAuth 2.0 client credentials for the Partner API

### What you get

- Per-driver daily/weekly earnings
- Trip history with pickup/dropoff, fare, distance, duration
- Driver ratings + cancellation rates
- Payment statements

### Fallback (what you can do today without partner access)

- Download **Uber Driver Weekly Summary CSV** from each driver's Uber Driver app
- Upload via FleetTrack's `/api/import/bulk` → TRIP rows
- Same data, 15-minute weekly ritual per driver

### Env vars (when partner approved)

```
UBER_CLIENT_ID=<from_uber_partner_dashboard>
UBER_CLIENT_SECRET=<from_uber_partner_dashboard>
UBER_FLEET_ID=<your_fleet_id>
```

### Status

🟡 Stub shipped at `src/lib/integrations/uber.ts` — just the shape so we can wire it quickly once you have partner credentials.

---

## 4. Bolt Business / Drive 🟡 **Partner-gated**

Same situation as Uber. Public API = no. Partner API = yes if Bolt approves your fleet.

### How to apply

Contact: `fleets@bolt.eu` — they route you to the Nordic operations team. Norwegian fleets with 10+ drivers typically get approved.

### What you get (with partner API)

- Webhook on trip completion (real-time)
- Weekly earnings summary API
- Driver performance metrics (acceptance %, rating, cancellation)

### Fallback (today, no partner)

- Bolt Operator Console → Reports → download weekly `bolt-trips-export.csv`
- Upload via `/api/import/bulk` → TRIP rows

### Env vars (when approved)

```
BOLT_API_KEY=<from_bolt_partner_dashboard>
BOLT_FLEET_ID=<your_fleet_id>
BOLT_WEBHOOK_SECRET=<for_verifying_webhook_signatures>
```

### Status

🟡 Stub shipped at `src/lib/integrations/bolt.ts`.

---

## 5. Norwegian taxi centrals ❌ **No public APIs**

Norgestaxi, Oslo Taxi 07000, Taxifix, Drosjesentralen — all dispatch via proprietary in-car units. None expose a public API.

### What's possible

- Every Norwegian taxi central's **operator portal** exports driver statements + trip logs as CSV (required by Norwegian accounting law)
- Export → save as `norgestaxi-trips-YYYY-WW.csv` → upload via `/api/import/bulk`

### What's impossible without them cooperating

- Real-time trip feed
- Driver status (online/offline/on-trip)
- Acceptance rates

Bottom line: **CSV weekly sync is the only path** for dispatch data from these providers unless you're a partner operator with a direct integration agreement.

---

## 6. Skatteetaten / Norwegian taximeter regulation 🟡 **Mandatory, not a sync target**

Norway requires all commercial taxis to have a **certified taximeter** (Skattedirektoratet standard). The taximeter itself reports revenue directly to Skatt per trip. This is NOT something FleetTrack needs to "integrate" — it happens in the car.

What FleetTrack DOES need:

- **Per-driver revenue reconciliation** — compare what Skatt says the taximeter reported vs what the driver turned in
- **Monthly VAT filing support** — the `VAT payable` KPI in `/api/stats` is a start; tie it to Altinn export for Regnskapsfører

### Status

Out of scope for the live-API scaffold. Handled via FixedCost (`ACCOUNTING` category) + VAT KPI already shipped.

---

## 7. Google Maps Platform ✅ **Real-time, optional**

Used for address validation, distance matrix (for trip-fare sanity checks), and route planning.

### Setup

1. [Google Cloud Console](https://console.cloud.google.com) → Create project
2. Enable: **Geocoding API**, **Distance Matrix API**, **Directions API**
3. Create API key → restrict to above APIs + your Vercel deployment URLs
4. Add to Vercel env vars:

   ```
   GOOGLE_MAPS_API_KEY=<key>
   ```

### Cost

$200/month free credit covers typical fleet use (~20k Geocoding calls, ~40k Distance Matrix).

### Status

🟡 Optional — not wired yet. Only needed if you want the dashboard to show "fare per km vs expected per km" sanity checks.

---

## Implementation checklist (per provider)

To go from the scaffold to live sync, each provider needs:

- [ ] Add env vars to Vercel (names listed above)
- [ ] Add `OAuthToken` model to `prisma/schema.prisma` (per-user, per-provider refresh tokens)
- [ ] Build `GET /api/integrations/<provider>/auth` — returns OAuth URL
- [ ] Build `GET /api/integrations/<provider>/callback` — exchanges code → tokens
- [ ] Build `POST /api/integrations/<provider>/sync` — pull last N days, upsert into DB
- [ ] Add cron (`/api/cron/sync`) that fires sync on schedule (Vercel Cron — free tier fine)
- [ ] Add admin UI button to trigger OAuth + sync manually

Each provider is ~4 hours of focused work once the credentials are in hand.

## What I recommend you do first

**Week 1:** Keep using `/api/import/bulk` with CSV from Bolt/Uber/Norgestaxi operator portals. Zero setup, works today, covers all historical data.

**Week 2:** Apply for Tesla Fleet API access (instant) + Smartcar account (instant). Wire these — they give you *live* odometer/battery data you can't get from CSV.

**Week 3:** Apply to Bolt + Uber partner programs. Takes 2-4 weeks to hear back. While waiting, keep doing weekly CSV.

**When partner-approved:** send me the credentials via Vercel env vars (never in chat) and I'll wire the sync loops.
