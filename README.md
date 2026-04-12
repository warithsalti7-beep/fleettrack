# FleetTrack — Taxi Fleet Management Dashboard

A production-ready full-stack fleet management platform for taxi and EV fleets. Built with Next.js 16, NestJS 10, PostgreSQL, Redis, and real-time WebSocket telemetry.

## Features

- **Dashboard** — KPI cards, revenue charts, fleet status, recent trips
- **Vehicle management** — Status tracking, EV battery levels, telematics sync
- **Driver management** — Online presence, trip history, earnings, ratings
- **Trip dispatch** — Auto fare estimation, route calculation via Google Maps
- **Real-time telemetry** — Tesla Fleet API, Smartcar (NIO + 40 brands), Samsara OBD
- **Live map** — Vehicle locations updated every 10 seconds via WebSocket
- **Analytics** — Revenue trends, peak hours, top drivers, payment breakdown
- **Maintenance** — Scheduled service records, priority tracking
- **Authentication** — JWT + refresh token rotation, RBAC (Admin/Dispatcher/Driver)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, Recharts, Leaflet |
| Backend | NestJS 10, Prisma 7, Passport JWT |
| Database | PostgreSQL (Neon/Render) + SQLite for local frontend dev |
| Cache / Queue | Redis + BullMQ |
| Real-time | Socket.io with room-based subscriptions |
| Telematics | Tesla Fleet API, Smartcar, Samsara |
| Maps | Google Maps (Directions, Geocoding, ETA) |
| Monitoring | Sentry, Pino structured logging |
| Deploy | Vercel (frontend) + Render (backend) |

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose (for PostgreSQL + Redis)

### 1. Clone and install
```bash
git clone git@github.com:warithsalti7-beep/fleettrack.git
cd fleettrack
pnpm install            # install frontend deps
cd backend && pnpm install && cd ..
```

### 2. Environment variables
```bash
cp .env.example .env
# Fill in required values: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
```

### 3. Start infrastructure
```bash
pnpm docker:dev         # starts PostgreSQL + Redis
```

### 4. Database setup
```bash
# Frontend (SQLite — for local Next.js dev)
npx prisma generate
pnpm db:seed

# Backend (PostgreSQL)
cd backend
pnpm prisma migrate dev --name init
cd ..
```

### 5. Start development servers
```bash
pnpm dev                # Next.js on :3000
pnpm dev:backend        # NestJS on :3001
# or both at once:
pnpm dev:all
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
fleettrack/
├── src/                    # Next.js frontend
│   ├── app/
│   │   ├── dashboard/      # All dashboard pages
│   │   │   ├── page.tsx    # Overview (KPIs, charts)
│   │   │   ├── vehicles/
│   │   │   ├── drivers/
│   │   │   ├── trips/
│   │   │   ├── analytics/
│   │   │   ├── maintenance/
│   │   │   └── fuel/
│   │   └── api/            # Next.js API routes (proxies to backend)
│   ├── components/         # Sidebar, Topbar, KPI cards, charts
│   └── lib/                # Prisma client, utils
├── prisma/                 # Frontend SQLite schema + seed
├── backend/                # NestJS API server
│   ├── src/
│   │   ├── modules/        # auth, vehicles, drivers, trips, telematics, realtime
│   │   ├── services/       # tesla, smartcar (nio), maps, queue processors
│   │   └── config/         # env validation, typed config
│   └── prisma/             # Backend PostgreSQL schema + migrations
├── database/               # init.sql for Docker PostgreSQL
├── docs/                   # API.md, INTEGRATIONS.md, REAL_TIME.md, SCALING.md
├── .github/workflows/      # CI/CD (GitHub Actions)
├── docker-compose.yml      # Dev: PostgreSQL + Redis + backend
├── docker-compose.prod.yml # Prod: backend only (uses managed DB/Redis)
├── vercel.json             # Vercel frontend config
└── render.yaml             # Render backend + database config
```

---

## API Documentation

See [docs/API.md](./docs/API.md) for the complete REST API reference.

Base URL (local): `http://localhost:3001/api/v1`

Key endpoints:
- `POST /auth/login` — Get JWT tokens
- `GET /vehicles` — List all vehicles
- `GET /trips/active` — Live active trips
- `GET /telematics/fleet/ev-summary` — EV battery health
- `GET /telematics/fleet/locations` — All vehicle GPS positions

---

## Deployment

### Frontend → Vercel
```bash
npx vercel --prod
```
Set environment variables in Vercel dashboard (see `vercel.json`).

### Backend → Render
```bash
# Render reads render.yaml automatically on push to main
git push origin main
```
Or deploy manually via [Render Dashboard](https://dashboard.render.com).

### One-command infrastructure (Docker)
```bash
pnpm docker:up     # all services
pnpm docker:down   # stop all
pnpm docker:logs   # tail logs
```

---

## External API Setup

See [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) for step-by-step setup:
- **Tesla Fleet API** — OAuth 2.0 PKCE, developer.tesla.com
- **Smartcar** — Covers NIO + 40 other EV brands, dashboard.smartcar.com
- **Google Maps Platform** — Geocoding + Directions APIs
- **Samsara** — OBD-II hardware telematics, cloud.samsara.com

---

## Real-Time Events

See [docs/REAL_TIME.md](./docs/REAL_TIME.md) for the complete WebSocket event reference and Redis key patterns.

---

## Scaling

See [docs/SCALING.md](./docs/SCALING.md) for guidance on scaling from 50 to 1000+ vehicles, including TimescaleDB, Kafka, and Redis Cluster configurations.

---

## License

MIT
