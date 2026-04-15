# Security model

Updated: 2026-04-15 — post Deploy 1 (real server-side auth + API gating).

## Summary

All `/api/*` endpoints now require one of:
- a valid `ft_session` httpOnly cookie (for browser traffic), OR
- a valid `X-Admin-Token: $SEED_TOKEN` header (for `/api/seed`, `/api/import/*`, and `/api/auth/bootstrap` — pre-session bootstrap tools only).

The two public exceptions are:
- `GET /api/health` — uptime probe
- `POST /api/auth/login` / `POST /api/auth/logout` — anonymous by necessity

## Rate limiting

Per-IP fixed-window counters held in the proxy's memory (see `src/lib/rate-limit.ts`):

| Bucket  | Matches                           | Limit     |
|---------|-----------------------------------|-----------|
| `auth`  | `/api/auth/*`                     | 10 / min  |
| `write` | any non-GET request on other APIs | 30 / min  |
| `read`  | GET/HEAD on other APIs            | 120 / min |

When limits trip the response is `HTTP 429` with a `Retry-After` header.

**Trade-off**: the counter is single-process. On multi-instance serverless
(Vercel) the effective limit is `instances × limit`. Good enough for MVP
anti-scraping; upgrade to Upstash/Vercel KV when traffic warrants.

## Password storage

Passwords are hashed with **PBKDF2-SHA256, 210 000 iterations, 16-byte salt,
32-byte hash** via Web Crypto (`src/lib/passwords.ts`). Storage format is a
single column:

```
pbkdf2$<iterations>$<salt_b64url>$<hash_b64url>
```

Iteration count is read from the stored record so we can raise
`PBKDF2_ITERATIONS` later without invalidating existing hashes.

## Sessions

Signed HMAC cookies (`src/lib/session.ts`), **httpOnly**, `SameSite=Lax`,
`Secure` in production. 8-hour TTL. Payload: `{ userId, email, role, name,
exp }`. Signed with `AUTH_SECRET` — rotate to force-logout everyone.

The client keeps a *mirror* of the session in `localStorage` as an advisory
cache so page-load guards can run synchronously. The mirror is never
trusted for authorization; the server re-checks every API call and the
`/api/auth/me` refresh on page load reconciles disagreements.

## Roles and authorization

Three roles, checked server-side on every mutation:

| Role       | Access                                              |
|------------|-----------------------------------------------------|
| `admin`    | Everything. User management, deletes, bootstrap.    |
| `employee` | Read all, create/update drivers/vehicles/trips/fuel/maintenance. No deletes. No user management. |
| `driver`   | Read *own* driver record + *own* trips + vehicles assigned to them. No writes.                   |

Role checks live in route handlers via `requireAdmin`, `requireStaff`,
`requireSession` from `src/lib/auth-guard.ts`.

## First-time setup

After a fresh deploy the database has no login accounts. Bootstrap the
three defaults:

```bash
curl -X POST "https://your-host/api/auth/bootstrap" \
  -H "X-Admin-Token: $SEED_TOKEN"
```

That creates:
- `admin@fleettrack.no` / `Admin2024!` (role: admin)
- `employee@fleettrack.no` / `Employee2024!` (role: employee)
- `driver@fleettrack.no` / `Driver2024!` (role: driver)

**Change those passwords immediately** via the Users & Permissions page or:

```bash
curl -X PATCH "https://your-host/api/users/<id>" \
  -H "Cookie: ft_session=..." \
  -H "Content-Type: application/json" \
  -d '{"password":"new-strong-password"}'
```

Or pass overrides to bootstrap:

```bash
curl -X POST "https://your-host/api/auth/bootstrap" \
  -H "X-Admin-Token: $SEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"admin":{"email":"me@example.com","password":"MyStrong!2026","name":"Alice"}}'
```

## Audit log

Every mutation writes an `AuditLog` row (`src/lib/audit-log.ts`). Schema
includes actor id + email, action, target, meta JSON, IP, and timestamp.
Query via Prisma Studio or a future `/admin/audit` page.

## Required environment

See `.env.example`. Required for the app to start:
- `DATABASE_URL`
- `AUTH_SECRET` — 32+ random bytes

Admin-gated tools also need:
- `SEED_TOKEN`

## Permissions storage

Per-user permissions are stored server-side in `User.permissions`
(JSONB array of strings). `PATCH /api/users/:id` with
`{ permissions: ["view:drivers", ...] }` writes them, and
`/api/auth/me` returns them on every page load.

**Client storage is memory-only** as of Deploy 3. All legacy
`ft_perms_<id>` localStorage keys were removed. The session mirror
(`ft_session` in localStorage) now contains only `{ userId, email,
role, name }` — never permissions. Permissions live in an in-memory
variable inside `FleetAuth` and are repopulated on every page load
via `refreshSession()`, so a server-side permission change takes
effect without the user signing out.

The admin UI (`/access-management` and dashboard's Users & Permissions
page) PATCHes the server on every toggle and re-hydrates the users
cache to reflect the new value. There is no client-side fallback path.

Current permission strings recognised by the UI:

```
view:drivers view:trips view:vehicles view:alerts view:financial
view:payroll view:zones manage:dispatch manage:maintenance export:reports
```

Adding a new one: pick a string, reference it in `hasPermission('x')`,
and admins can grant it from the UI. No schema change needed.

## Exports — pagination

`/api/export/*` now accepts `?limit=N&offset=M`. Default 1 000 rows,
max 5 000 per request. Response carries `X-Total-Count` so a client
can fetch subsequent pages until total is reached. All 5 exports
(drivers, vehicles, trips, fuel, maintenance) share the same helper
(`src/lib/export-helpers.ts`).

## Known remaining work (post Deploy 2)

- Dashboard KPI tiles that don't have a canonical mapping in
  `dashboard-live.js` (e.g. hourly trip volume chart, per-driver
  leaderboard numbers) still show zeros; a `/api/stats/per-driver`
  endpoint is the natural next step.
- Per-shift creation UI, incident/complaint models — not yet wired.
  Those buttons surface a clear "not wired yet" toast rather than
  silently doing nothing.
- Fleet-level dark-mode CSS in `dashboard.html` added (both themes),
  but some inline gradients in the login backdrop are still calibrated
  for dark mode; visually acceptable in light mode but worth tuning.
- Apply both migrations in order before the new endpoints will work:
  `20260415200000_user_auth` (adds passwordHash) then
  `20260415210000_user_permissions` (adds permissions JSONB). Both
  are already in `prisma/migrations/`; `prisma migrate deploy` picks
  them up.
