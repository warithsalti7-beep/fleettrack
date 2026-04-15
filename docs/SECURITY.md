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

## Known remaining work (post Deploy 1)

- Dashboard.html still embeds a historical-snapshot KPI set as design
  placeholders. `dashboard-live.js` overwrites them with live values on
  page load, but a full rewrite to fetch-then-render is follow-up work.
- Permission overrides on a per-user basis still live in client-side
  `localStorage`; server-side perm storage is not modeled.
- `/api/export/*` returns the whole table. Paginate / stream for large
  fleets.
- Migration `20260415200000_user_auth` adds `passwordHash` to the User
  table — apply via `prisma migrate deploy` against Neon before the new
  auth endpoints will work.
