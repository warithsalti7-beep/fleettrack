@AGENTS.md

# CLAUDE.md — project memory and session history

This file is Claude's long-term memory for this repo. Start every new
session by reading it; end every session by appending a short entry at
the bottom. It lives alongside `AGENTS.md` (which carries the
non-standard Next.js warning) so both loads are one import away.

---

## What FleetTrack is

Fleet management app for a small Norwegian taxi fleet (Bolt + Uber).
Hybrid architecture mid-migration from a **static HTML legacy
dashboard** (`public/*.html` + plain JS render modules) to a **React
Next.js admin UI** (`src/app/admin/*`) backed by a consolidated
`/api/*` REST surface on Prisma + Neon Postgres.

Production domain: **https://fleettrack.no** (Vercel, auto-deploys from
`main`).

Read before doing anything substantive:
- `docs/SECURITY.md` — auth model, PBKDF2, rate limits
- `docs/MIGRATION.md` — legacy → React migration roadmap + "ready to
  delete" criteria
- `docs/DEPLOY.md` — exact runbook (env vars, migrations, bootstrap)

---

## Critical facts Claude tends to forget

1. **This is Next.js 16, NOT the Next.js you know.** `proxy.ts` (not
   `middleware.ts`). Read `node_modules/next/dist/docs/` for
   anything routing/runtime-related before writing code.
2. **Prisma 7 + Neon adapter.** No `prisma db push` in the Vercel
   build — migrations are applied manually via `prisma migrate deploy`.
3. **Strict auth by default.** Every `/api/*` needs a session cookie
   except `/api/health`, `/api/auth/login`, `/api/auth/logout`, and the
   SEED_TOKEN-gated `/api/seed` + `/api/import/*` + `/api/auth/bootstrap`.
4. **Zero hardcoded data in the UI.** Legacy HTML uses `data-kpi` /
   `data-kpi-cur` attributes filled by `public/js/render/kpis.js`.
   React pages read from API via `apiJson()` in `src/lib/server-fetch.ts`.
5. **Always work on the designated branch** given at session start;
   never push directly to `main`. Merges happen via PR.
6. **Sandbox can't reach fleettrack.no** — egress allowlist. Don't
   waste time trying `WebFetch` or `curl` against the live domain.
   Use the GitHub MCP tools for PRs/checks and git state for truth.

---

## Architecture at a glance

```
src/
├── app/
│   ├── admin/                   # MIGRATED React pages
│   │   ├── layout.tsx           # auth gate + AdminShell
│   │   ├── overview/page.tsx    # RSC — /api/stats
│   │   ├── drivers/page.tsx     # RSC — /api/drivers + /api/stats/per-driver
│   │   ├── loading.tsx / error.tsx / not-found.tsx
│   └── api/                     # REST routes. All gated by src/proxy.ts
├── components/
│   ├── ui/                      # Button/Card/Input/Select/Badge/Modal/
│   │                            # Table/Skeleton/StatusChip — pure primitives
│   └── admin/                   # AdminShell/Sidebar/Topbar/SignOut/
│                                # LiveKpiGrid/PageHeader/drivers/*
└── lib/
    ├── server-fetch.ts          # apiJson + resolveSessionOrRedirect
    ├── format.ts                # formatNok, humanizeEnum, tone helpers
    ├── http.ts / validation.ts  # unified error shapes + typed coercion
    ├── auth-guard.ts / session.ts / passwords.ts
    ├── audit-log.ts / rate-limit.ts

public/
├── login.html                   # redesigned; no portal tabs
├── dashboard.html               # LEGACY — ~5k lines, zero hardcoded data
├── driver.html                  # driver portal, kept as-is
├── js/fleet-state.js            # unified state store
└── js/render/{kpis,drivers,vehicles,trips,charts}.js  # render modules
```

---

## Deploy history (what's on main)

| PR | Commit | Summary |
|----|--------|---------|
| #4 | `1459684` | **Deploys 1–7**: hardened auth (PBKDF2 + proxy gate), React `/admin/*` migration, design-system tokens + primitives, login redesign, full responsive + polish |
| #5 | `305d90d` | CI smoke tests rewritten for DB-less CI + new login UI |
| #6 | `f8160ce` | 8 new formula-based KPIs in `/api/stats` + FT brand mark in legacy sidebar + React topbar |

Each PR has a detailed description on GitHub. The `Deploys 1–7` PR is
the one to read if you want the full history of security + React
migration work.

---

## Operational commands

### One-time post-deploy (user runs on their laptop)
```
export DATABASE_URL="<prod neon url>"
pnpm prisma migrate deploy
curl -X POST "https://fleettrack.no/api/auth/bootstrap" \
  -H "X-Admin-Token: $SEED_TOKEN"
```

### Local dev
```
pnpm install
pnpm prisma generate
pnpm dev                  # Next.js on :3000
pnpm test:e2e             # Playwright smoke tests
```

### Default login (change immediately)
- `admin@fleettrack.no` / `Admin2024!`
- `employee@fleettrack.no` / `Employee2024!`
- `driver@fleettrack.no` / `Driver2024!`

### Env vars required in Vercel
- `DATABASE_URL` — Neon Postgres URL
- `AUTH_SECRET` — 32+ random bytes (`openssl rand -base64 32`)
- `SEED_TOKEN` — 24+ random bytes (`openssl rand -base64 24`)
- `ANTHROPIC_API_KEY` — optional, unlocks `/api/ai/fleet-summary`
- `SENTRY_DSN` — optional

---

## Session log (append newest on top)

### 2026-04-15 — session `01JEkWjrqQrrhhrmM8gxKFGy`
Branch: `claude/audit-refactor-fleet-app-GjOac`.

Landed (all merged to main):
- **PR #4 (Deploys 1–7)** — full architecture refactor. Real
  server-side auth with PBKDF2, `/api/*` session gate + rate limits,
  AuditLog writes, unified CRUD shapes, React admin at
  `/admin/overview` + `/admin/drivers`, shared primitives,
  dark/light tokens, mobile drawer + responsive driver card-row, full
  login redesign (no portal tabs), legacy deprecation banners.
- **PR #5** — CI smoke rewritten to be DB-independent.
- **PR #6** — 8 new formula-based KPIs (acceptance / cancellation /
  trips-per-hr / revenue-per-hr / utilization / idle / time-between-
  trips / avg-trip-distance / peak-coverage) in `/api/stats`, 7+
  remaining hardcoded legacy values blanked to `data-kpi` tags, FT
  brand mark in sidebar + React topbar.

User actions completed this session:
- Set AUTH_SECRET + SEED_TOKEN + ANTHROPIC_API_KEY + DATABASE_URL in
  Vercel.
- Applied both Prisma migrations (`20260415200000_user_auth` +
  `20260415210000_user_permissions`) via Neon SQL editor.
- Ran `/api/auth/bootstrap` — 3 default users created.

Open items carried to next session:
- AUTH_SECRET + SEED_TOKEN values were visible in chat transcripts —
  user advised to rotate both.
- Default passwords still need to be changed via admin UI.
- Vehicles / Trips / Users / Financial pages still legacy; next
  migration candidates per docs/MIGRATION.md.
- PR #1 from `claude/driver-dashboard-62RJr` is still open with
  parallel AI work — now significantly conflicting with main after
  PR #4/#5/#6 merged.

### 2026-04-14 — pre-Claude foundation
Neon DB + Next.js 16 app scaffolded. `docs/AUDIT_2026_04.md` captures
the pre-refactor state with a 7-item TL;DR of critical issues that
drove Deploys 1–7.

---

## How to use this file next time

When a new session starts:
1. Read the **Critical facts** section — those are the landmines.
2. Skim the **Deploy history** to know what's already landed.
3. Read the **latest session log entry** for where the previous
   session left off and what remains open.

When a session ends:
1. Append a `### YYYY-MM-DD — session <id>` block at the top of the
   session log listing what shipped, what the user did, and what's
   open.
2. If you touched architecture, update the relevant arch block above.
3. Commit this file as part of the final PR.
