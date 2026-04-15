# FleetTrack — Legacy → React migration plan

_Updated 2026-04-15, covering Deploys 1 → 5._

## End state

A single React (Next.js App Router) admin UI at `/admin/*`, backed by
the consolidated `/api/*` routes. The static HTML in `public/*.html`
is deprecated, then deleted. Drivers continue using `/driver`
(simpler page, kept until a dedicated driver-portal migration).

## Target architecture

```
src/
├── app/
│   ├── admin/                      # all admin UI (React)
│   │   ├── layout.tsx              # auth gate + <AdminShell>
│   │   ├── overview/page.tsx       # MIGRATED (RSC)
│   │   ├── drivers/page.tsx        # MIGRATED (RSC)
│   │   ├── drivers/[id]/page.tsx   # TODO — driver detail
│   │   ├── vehicles/page.tsx       # TODO — next
│   │   ├── vehicles/[id]/page.tsx  # TODO
│   │   ├── trips/page.tsx          # TODO
│   │   ├── financial/page.tsx      # TODO (P&L, costs, VAT)
│   │   ├── maintenance/page.tsx    # TODO
│   │   ├── users/page.tsx          # TODO (replaces access-management.html)
│   │   └── data-import/page.tsx    # TODO
│   ├── api/                        # REST API (stable; every route
│   │                               #   now uses lib/validation helpers)
│   └── globals.css                 # single token source via Tailwind @theme
│
├── components/
│   ├── ui/                         # pure primitives; no domain logic
│   │   ├── button.tsx · card.tsx · input.tsx · select.tsx
│   │   ├── badge.tsx · status-chip.tsx · table.tsx
│   │   ├── modal.tsx · skeleton.tsx
│   │   └── export-button.tsx · sort-bar.tsx  (kept, not yet in use)
│   └── admin/
│       ├── admin-shell.tsx         # client shell with mobile drawer
│       ├── admin-sidebar.tsx       # client — active-link highlight
│       ├── admin-topbar.tsx        # pure — role chip + title
│       ├── sign-out-button.tsx     # client — POST /api/auth/logout
│       ├── live-kpi-grid.tsx       # pure — for overview
│       └── drivers/
│           ├── driver-table.tsx    # client — sort/filter/mutations
│           ├── driver-form-modal.tsx
│           └── types.ts            # shared shape + normaliser
│
├── lib/
│   ├── server-fetch.ts             # apiJson + resolveSessionOrRedirect
│   ├── format.ts                   # presentation formatters + tone helpers
│   ├── http.ts                     # unified API error shapes
│   ├── validation.ts               # typed body coercion for API routes
│   ├── auth-guard.ts · session.ts · passwords.ts
│   ├── audit-log.ts · rate-limit.ts
│   └── prisma.ts · env.ts · sentry.ts
│
public/                             # legacy static HTML (being retired)
├── login.html                      # KEEP until React /login page ships
├── dashboard.html                  # DEPRECATE section-by-section
├── driver.html                     # KEEP — driver portal
├── access-management.html          # TO BE REPLACED by /admin/users
└── js/ fleet-state.js etc.         # STAYS until legacy dashboard retires
```

## API contract (consolidated April 2026)

All entity routes follow the same shape. Error bodies: `{ error, detail?, fields? }`.
Success bodies: the entity as-is (list or object).

| Resource  | List          | Create | Read            | Update          | Delete           |
|-----------|---------------|--------|-----------------|-----------------|------------------|
| Drivers   | `GET /api/drivers`  | `POST` (staff) | `GET /:id`    | `PATCH /:id` all fields (staff) | `DELETE /:id` (admin) |
| Vehicles  | `GET /api/vehicles` | `POST` (staff) | `GET /:id`    | `PATCH /:id` all fields (staff) | `DELETE /:id` (admin) |
| Trips     | `GET /api/trips`    | `POST` (staff) | `GET /:id`    | `PATCH /:id` all fields (staff) | `DELETE /:id` (admin) |
| Users     | `GET /api/users` (admin) | `POST` (admin) | — | `PATCH /:id` (admin) | `DELETE /:id` (admin) |

Consolidation highlights:
- Every write route runs payload through `lib/validation.ts` helpers;
  type coercion errors return `400 { error: "validation_failed", fields }`.
- Unique-constraint violations return `409 { error: "conflict", detail }`.
- Missing rows return `404 { error: "not_found" }`.
- All mutations append to `AuditLog` via `lib/audit-log.ts`.
- Side effects on trip lifecycle (auto-release driver/vehicle on
  COMPLETED / CANCELLED) run server-side atomically.

## Shared front-end contracts

- **Fetching from RSC**: `apiJson<T>(path)` — forwards session cookie,
  returns `T | null`. Null = UI shows an error state.
- **Session**: `resolveSessionOrRedirect(allowedRoles?)` — used in every
  admin layout; bounces non-staff.
- **Formatters**: `formatNok`, `formatPercent`, `formatDateIso`,
  `humanizeEnum` — one source of truth.
- **Tones**: `driverStatusTone`, `vehicleStatusTone`, `tripStatusTone`,
  `roleTone`, `scoreTone` — fed into `<Badge tone="...">` and
  `<StatusChip>` wrappers.
- **Design tokens**: exposed via CSS variables in `globals.css` and
  bridged into Tailwind via `@theme inline`. Use utilities like
  `bg-surface-1`, `text-muted`, `border-border-subtle`, `text-brand-2`,
  `bg-success-bg` — not raw hex.

## Migration order

| # | Section              | State     | Criteria-to-delete-legacy |
|---|----------------------|-----------|---------------------------|
| 1 | Overview             | DONE      | When dashboard.html `#page-overview` is no longer the default landing |
| 2 | Drivers              | DONE      | 1 week stable usage + legacy roster marked deprecated |
| 3 | Vehicles             | NEXT      | feature parity with `#page-fleet-register` + fixed-cost view |
| 4 | Trips                | SOON      | live-ops feature parity (dispatch, cancel, complete) |
| 5 | Users & Permissions  | SOON      | parity with `access-management.html` |
| 6 | Financial (P&L)      | LATER     | requires `/api/stats/pnl` endpoint |
| 7 | Maintenance          | LATER     |
| 8 | Data Import          | LATER     | requires file-upload UI |
| 9 | Driver portal        | LATER     | separate track; `/driver.html` can stay longer |

### Criteria for "ready to delete a legacy page"
A legacy page `#page-X` can be removed from `dashboard.html` only when:

1. A React equivalent at `/admin/X` exists and is the default from
   the landing sidebar.
2. All actions (create / edit / delete / export) work via the API
   the React page uses.
3. The legacy page has carried a `deprecated` banner for ≥ 7 days.
4. No audit-log entries show non-admin staff using the legacy page.
5. All permission checks / role filtering are handled server-side
   (no client-only gating).

### Deleting the whole legacy dashboard
`public/dashboard.html` and `public/js/` can be removed when:
- Every section above is migrated.
- `/admin/overview` is the default post-login redirect for staff.
- `next.config.ts` no longer rewrites `/dashboard` → `dashboard.html`.
- `dashboard-live.js` / the render modules have no imports from anywhere.

At that point the diff is a simple delete.

## Current deprecations

- `public/dashboard-live.js` — already deleted.
- `public/fleet-data.js` — already deleted.
- `public/employee.html` — already deleted.
- Per-user `ft_perms_<id>` localStorage — all reads/writes removed.
- `FleetAuth.setRoleOverride` / `getRoleOverride` — now no-ops with
  deprecation notices; scheduled for removal after the Users page ships.

## Risks still to address

1. **Mobile polish on /admin/drivers**: the 10-column table scrolls
   horizontally on narrow screens. Consider card-style row layout
   below `md` breakpoint.
2. **No optimistic create/edit yet** — only delete is optimistic. The
   rest rely on server round-trip + `router.refresh()`. Adds ~200ms
   perceived latency on fast networks; fine for MVP.
3. **Legacy dashboard still loads Chart.js via CDN** — bundle for
   React side uses Recharts (already a dependency). When we migrate
   the charts, drop the Chart.js CDN link.
4. **Classic auth flow still uses localStorage mirror**; React side
   pulls `/api/auth/me` on every RSC render. Two auth paths coexist
   cleanly, but add mental overhead. Remove the mirror when /login is
   rebuilt in React.
