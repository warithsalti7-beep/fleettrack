# Deploy checklist — Deploys 1 → 7

This document is the single-source runbook for shipping the
`claude/audit-refactor-fleet-app-GjOac` branch to production.

## 0. What this branch contains

Seven logical deploys on top of the pre-existing `main`, squashed into
one PR after a merge with the latest `main`:

| Deploy | Summary |
|--------|---------|
| D1 | Real server-side auth (PBKDF2), rate-limited API gate, audit log |
| D2 | Live dashboard tables, server permissions, paginated exports, dark/light |
| D3 | Modular JS render pipeline, removed dashboard-live.js + fleet-data.js |
| D4 | `/admin/drivers` migrated to React (RSC + client table + modal) |
| D5 | Unified API shapes (all PATCH routes accept every editable field), design-system foundation, React primitives |
| D6 | Quality pass: field-level edit, mobile card layout, loading/error boundaries |
| D7 | Full visual polish to modern-SaaS standard, login redesign |

## 1. Merge the PR

`claude/audit-refactor-fleet-app-GjOac` → `main`. GitHub URL:
`https://github.com/warithsalti7-beep/fleettrack/pulls`

Vercel auto-deploys `main` after merge. First green build should land
~45s after the merge commit.

## 2. Vercel environment variables (one-time, verify before merge)

| Variable          | Required? | Purpose |
|-------------------|-----------|---------|
| `DATABASE_URL`    | **yes**   | Neon Postgres connection string |
| `AUTH_SECRET`     | **yes**   | HMAC secret for session cookies. Must be ≥32 random bytes. Rotating it invalidates every live session. Generate with `openssl rand -base64 32`. |
| `SEED_TOKEN`      | **yes**   | Gates `/api/seed`, `/api/import/*`, `/api/auth/bootstrap`. Treat like a password. |
| `ANTHROPIC_API_KEY` | optional | AI recommendations via `/api/ai/fleet-summary` |
| `SENTRY_DSN`      | optional | Server-side error reporting |

Check them via:
```bash
curl https://fleettrack.no/api/health
```
The response includes an `envConfigured` block + `warnings[]` for any
missing optional vars.

## 3. Database migration (required — the build no longer auto-pushes)

The `vercel.json` buildCommand is now `prisma generate && pnpm build`.
It does NOT push schema changes. Apply migrations manually before or
just after merge:

### Option A — from your local machine
```bash
export DATABASE_URL="<prod neon url>"
pnpm prisma migrate deploy
```

This applies both migrations that ship with this branch:
1. `20260415200000_user_auth` — adds `passwordHash`, `driverId`,
   `lastLoginAt` columns to the `User` table. Existing rows (if any)
   get a placeholder hash that rejects all logins until the user
   resets their password via `/api/auth/bootstrap`.
2. `20260415210000_user_permissions` — adds the `permissions` JSONB
   column on `User`.

### Option B — apply manually via Neon's SQL editor
Open each `migration.sql` under `prisma/migrations/20260415*/` and run
them in order. Both files are short and idempotent (they use
`IF NOT EXISTS` guards on column additions).

## 4. Bootstrap the three default login accounts

Creates or resets the admin / employee / driver test accounts
idempotently:

```bash
curl -X POST "https://fleettrack.no/api/auth/bootstrap" \
  -H "X-Admin-Token: $SEED_TOKEN"
```

Defaults:
- `admin@fleettrack.no`    / `Admin2024!`     (role: admin)
- `employee@fleettrack.no` / `Employee2024!`  (role: employee)
- `driver@fleettrack.no`   / `Driver2024!`    (role: driver)

**Change these immediately** via the admin Users page (`/admin/drivers`
for driver records, server-side User rows via `PATCH /api/users/:id`).
Or override at bootstrap time:

```bash
curl -X POST "https://fleettrack.no/api/auth/bootstrap" \
  -H "X-Admin-Token: $SEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"admin":{"email":"me@example.com","password":"MyStrong!2026","name":"Alice"}}'
```

## 5. Smoke-test checklist

After deploy completes, hit each of these and confirm they're on the
new version (look for the commit SHA in `/api/health`):

| URL | Expected |
|-----|----------|
| `https://fleettrack.no/api/health` | 200 JSON with the new `envConfigured` + `sha` |
| `https://fleettrack.no/login` | New redesigned card + "Sign in" (no portal tabs) |
| `https://fleettrack.no/api/auth/login` POST | 401 on bad creds, 200 + `Set-Cookie` on good |
| `https://fleettrack.no/dashboard` | Legacy dashboard, DEPRECATED banner on Driver Roster |
| `https://fleettrack.no/admin/overview` | React-rendered KPI grid, 6 tiles, responsive |
| `https://fleettrack.no/admin/drivers` | React-rendered table with sort + filter + edit |
| `https://fleettrack.no/driver` | Driver portal (unchanged from main) |

### What's live after merge

- Hardened auth: every `/api/*` requires a session except `health`,
  `/auth/login`, `/auth/logout`, `/auth/bootstrap` (SEED_TOKEN), `/seed`
  (SEED_TOKEN), `/import/*` (SEED_TOKEN).
- Rate limits: 10/min on auth, 30/min on writes, 120/min on reads.
- Full CRUD + validation on `/api/drivers`, `/api/vehicles`, `/api/trips`.
- React admin at `/admin/overview` + `/admin/drivers` with dark/light
  theme, mobile drawer, loading/error boundaries, responsive tables.
- Legacy `/dashboard` continues to work, with a deprecation banner on
  the driver roster page pointing at `/admin/drivers`.
- Redesigned `/login` (no portal tabs, clean card layout).

## 6. Rollback (in case)

The merge commit on `main` can be reverted cleanly:
```bash
git revert -m 1 <merge-commit-sha>
git push origin main
```
Vercel redeploys within ~45s. The two Prisma migrations are additive
(only column additions + indexes), so they can stay applied — the old
code just doesn't use those columns.

## 7. Known remaining work (not required for this deploy)

- `/admin/vehicles`, `/admin/trips`, `/admin/users`, `/admin/financial`
  are the next React migration targets. Legacy equivalents still work.
- Per-driver detail page `/admin/drivers/[id]` not yet built.
- Pagination in the Drivers table renders all rows client-side; fine
  up to ~1k drivers.
