# AI Integration & Remaining Roadmap

## Part 1 — Live AI-powered recommendations

### Goal

Replace the current hardcoded "recommendations" and "KPI suggestions" on
the dashboard with **live, data-aware AI output** that:

1. Analyses the fleet as a whole (bottleneck detection, cash-flow
   risks, compliance alerts) — shown on Command Centre.
2. Makes per-case recommendations for a specific driver, vehicle, or
   trip (e.g. "Driver X's acceptance rate dropped 12% this week —
   coaching call suggested").
3. Suggests KPI targets based on historical data but lets the admin
   override them.

### What you need (your decisions)

| Decision | Options | Recommendation |
|---|---|---|
| LLM provider | OpenAI, Anthropic, Groq, local Llama | **Anthropic Claude** (claude-haiku-4-5 for speed, claude-sonnet-4-5 for depth) — best price/quality right now. OpenAI gpt-4o-mini is a close second if you prefer them. |
| Where runs | Vercel serverless function | Already have Next.js API routes — zero new infra. |
| Data source | Neon Postgres | Already set up. Need to wire dashboard pages to read from it (currently all static). |
| API key storage | Vercel env var `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Set in Vercel → Settings → Environment Variables. |
| Budget guardrail | Rate limit per user | 1 req/5s/user, 100 req/day/fleet for free-tier comfort. |

### Architecture (what gets built)

```
┌────────────────┐       ┌──────────────────┐       ┌────────────────┐
│  Dashboard     │──────▶│ /api/ai/         │──────▶│ Anthropic /    │
│  (browser)     │       │   - fleet-summary│       │ OpenAI API     │
│                │       │   - driver-advice│       │                │
│  polls every   │◀──────│   - kpi-suggest  │◀──────│ model reply    │
│  2–10 min      │       │                  │       │ (streaming)    │
└────────────────┘       └────────┬─────────┘       └────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ Neon Postgres    │
                         │  (trips, drivers │
                         │   vehicles,      │
                         │   maintenance,   │
                         │   fuel_logs)     │
                         └──────────────────┘
```

### API routes to add

Create these under `src/app/api/ai/`:

1. **`/api/ai/fleet-summary`** — POST, returns 3–5 bullet recommendations
   for the whole fleet today. Prompt includes last-7-day revenue,
   profit, cancellation rate, vehicle utilisation, open alerts, and
   top 3 anomalies.

2. **`/api/ai/driver-advice`** — POST `{ driverId }` — returns a
   coaching note for one driver based on their 30-day stats + tenure +
   commission tier + trend vs peer cohort.

3. **`/api/ai/vehicle-diagnosis`** — POST `{ carId }` — "This vehicle's
   fuel cost per km is 18% over fleet average; potential causes: tyre
   pressure, bad injector, aggressive driver." Cross-references
   maintenance history and telematics.

4. **`/api/ai/kpi-suggest`** — GET, returns suggested KPI targets
   (daily revenue, rev/hr, utilisation, accept rate) derived from the
   previous 90 days + seasonality. Frontend shows them as
   grey/dashed lines next to the admin-editable blue input.

### Prompt strategy (important)

- **System prompt** per endpoint states the role ("You are the
  operations analyst for a Norwegian taxi fleet of ~19 drivers and
  ~14 vehicles"). Locks the model to that domain.
- **Data context** is built server-side: fetch exact figures from
  Neon, render them as a compact JSON block, and include in the user
  message. Never let the client choose what data the LLM sees.
- **Output format** is enforced as JSON with a schema so you can
  render it consistently:
  ```json
  {
    "headline": "Short one-sentence insight",
    "recommendations": [
      { "priority": "high" | "medium" | "low",
        "area": "driver" | "vehicle" | "finance" | "dispatch",
        "title": "...", "body": "...", "actionLabel": "...",
        "actionHref": "...optional deep link into dashboard..." }
    ],
    "generatedAt": "2026-04-13T12:00:00Z"
  }
  ```
- Cache the result server-side for 5–10 minutes per tenant/scope
  to keep costs down. Invalidate on significant data change.

### Frontend wiring

Add a "FleetAI" panel component on Command Centre, each driver detail
page, and each vehicle detail page. It shows:

- A "Refresh" icon (clock auto-refresh every 10 min)
- A **status** pill: `Up to date` / `Generating…` / `Failed — retry`
- Skeleton rows (the `.skeleton-text` class just added) while loading
- Error banner (`.panel-error`) with retry on network failure

Also on the Settings → KPI Targets page, each numeric input already
has the admin's chosen value. Next to it, render a grey label:
*"AI suggests: 48 200 kr (based on 90-day average)"* — click to accept.

### Steps (in order)

1. Pick provider. Get API key. Add to Vercel env (`ANTHROPIC_API_KEY`).
2. Build one API route end-to-end: `/api/ai/fleet-summary`. Uses `env()`
   from `src/lib/env.ts` for runtime validation.
3. Wire it to Command Centre with skeleton + error states.
4. Validate it works, costs acceptable.
5. Add the other 3 routes following the same shape.
6. Add the KPI-suggest hook to the Settings page.

### Cost estimate

For Claude Haiku 4.5, with 10-min cache and ~20 active admins:
- ~2 000 requests/day
- ~1 KB input + 0.5 KB output each
- Approx **$0.10–0.30/day** total fleet AI budget.

For OpenAI gpt-4o-mini:
- Similar volume, approx **$0.30–0.60/day**.

Both are negligible — you'll hit Vercel function invocation limits long
before you hit LLM token cost.

### Security

- LLM requests always leave the user session attached (so the LLM can
  be reminded who's asking, in case of multi-tenancy later).
- Never include raw passwords, personal driver addresses, or rider PII
  in prompts. Sanitise payloads server-side.
- Log prompt + response to a Neon table `ai_call_log` with cost,
  latency, user — so you can audit and cap usage.

---

## Part 2 — Remaining roadmap items 28–34

### 28 — Norway costs page doesn't tie into the P&L

**What's wrong:** `page-norway-costs` has its own cost structure table
(lease, insurance, employer social, etc.) with concrete NOK figures.
But those numbers don't flow into the P&L cards on `page-financial`,
`page-finance-monthly`, or the Reports CSVs. If you change a number
in Norway Costs, nothing else updates.

**What to do:** One source of truth. Move the cost constants to a
`public/demo-data.js` module as a single `COSTS = { ... }` object.
Both pages read from it and render. Later, when we wire the DB, that
object is replaced by a fetch. Small refactor — half a day's work.

### 29 — dashboard.html is 4 000+ lines

**What's wrong:** Everything lives in one file — CSS, JS, navigation,
data, auth, 60+ page sections. Any edit risks collateral damage (the
menu-click bug we hit was exactly this).

**What to do:** Split by concern:
- `public/design-system.css` already holds shared styles → move dashboard
  styles there too.
- Extract page-level chunks into separate HTML fragments and include
  them with `fetch()` into a `<main>` container on navigation. Or go
  all-in on a Next.js refactor and make each dashboard page a real
  route (`/dashboard/financial`, `/dashboard/drivers`, etc.).
- Data literals → `public/demo-data.js` (see 28).

This is 2–3 days of careful work. Big payoff in maintainability.

### 30 — Driver data is duplicated

**What's wrong:** The driver roster exists in **three places**:
- `public/auth.js` DEMO_USERS (for login)
- `public/dashboard.html` `const drivers=[...]` (for tables)
- `public/driver.html` `const driverStats=[...]` (for driver portal)

Changing a driver's name means editing all three. Easy to drift.

**What to do:** Put the canonical roster in `public/fleet-data.js` as
`window.FLEET_DATA = { drivers: [...], vehicles: [...] }`. All three
files read from it. 1–2 hours work.

### 31 — Commit messages

You asked about this. Rewriting git history is destructive and risks
overwriting other people's work. What we can do **going forward** is
enforce a commit message format (type(scope): subject) via a
`commit-msg` git hook — but on existing history, let it be.

### 32 — Dead NestJS `backend/` folder

You have a fully-configured NestJS backend in `/backend` with tests,
Docker, CI — but it's **not deployed anywhere**. The current live app
is Next.js static HTML. The backend was excluded from tsconfig to
unblock the Vercel build.

**Options:**

- **A. Delete it entirely.** Fastest. Loses the work but removes
  confusion. `rm -rf backend/ docker-compose.*.yml`. Keep the
  Prisma schema + seed — those are small and useful.
- **B. Turn it into the real API.** Deploy the NestJS app to Fly.io /
  Railway (since Vercel can't run a persistent NestJS server). The
  static dashboard then hits this backend's REST API. Needs ~1 day of
  deployment + wiring.
- **C. Keep as-is, add a README explaining it's dormant.**

**My recommendation: A.** The same API can be built as Next.js API
routes (we already have `src/app/api/*`) running on Vercel serverless
— simpler, cheaper, fewer moving parts.

**Your call:** Reply "delete backend" / "deploy backend" / "keep".

### 33 — Unused API routes in `src/app/api/`

**What's wrong:** We built `/api/stats`, `/api/trips`, `/api/vehicles`,
`/api/drivers`, `/api/fuel`, `/api/maintenance`, `/api/seed`,
`/api/export/*` — but the static dashboard.html never calls any of
them. They're dead code that compiles but doesn't run.

**What to do:** Once we flip on AI recommendations (Part 1) and/or
move demo data into Neon, these routes become the bridge. Until then,
either:
- Leave them — they don't hurt. They'll be used for AI + migration.
- Or remove them — they'll have to be rewritten when AI lands.

**Recommendation:** Leave them. We'll use them in Part 1.

### 34 — Env validation

**Done in this commit.** New `src/lib/env.ts` runs at first import,
throws a clear error if `DATABASE_URL` is missing, and exposes
`envSoft()` for optional keys like `ANTHROPIC_API_KEY` and
`RESEND_API_KEY` (AI + email). `src/lib/prisma.ts` now reads from it.

---

## TL;DR — what to do next, in order

1. **Decide on AI provider** → set `ANTHROPIC_API_KEY` (or
   `OPENAI_API_KEY`) in Vercel.
2. **Decide on the NestJS backend** (delete / deploy / keep).
3. Tell me, I'll build the first AI endpoint + wire it to Command
   Centre as a proof-of-concept.
4. After that works, iterate on the other 3 AI routes + KPI suggest.
5. Separately: start extracting data to `public/fleet-data.js`
   (items 28 + 30).
6. Finally: the big dashboard.html refactor (item 29) once data is
   decoupled.
