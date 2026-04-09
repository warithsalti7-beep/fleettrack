# Scaling Guide — 100+ Vehicles

## Current Architecture (< 50 vehicles)

- Single NestJS process
- PostgreSQL (Neon/Render starter)
- Redis (Upstash free/starter)
- BullMQ queue with 10s cron
- Socket.io in-process

Works well up to ~50 vehicles without changes.

---

## Phase 2: 50–200 vehicles

### 1. TimescaleDB for telematics logs

Replace standard PostgreSQL for the `TelematicsLog` table with [TimescaleDB](https://www.timescale.com/):

```sql
-- Convert to hypertable (partitioned by time automatically)
SELECT create_hypertable('telematics_logs', 'recorded_at');

-- Add compression (70-80% space savings for time-series data)
ALTER TABLE telematics_logs SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'recorded_at DESC'
);
SELECT add_compression_policy('telematics_logs', INTERVAL '7 days');
```

Enable in `render.yaml` by switching to a TimescaleDB-enabled PostgreSQL instance.

### 2. Horizontal BullMQ workers

Run multiple sync processors as separate Render services:

```yaml
# render.yaml addition
- type: worker
  name: fleettrack-sync-worker
  runtime: docker
  dockerfilePath: ./backend/Dockerfile
  startCommand: node dist/services/queue/processors/telematics-sync.processor.js
  numInstances: 3
```

BullMQ distributes jobs across all workers automatically. No code changes needed.

### 3. Redis Cluster or Upstash Pro

Switch to Redis Cluster (or Upstash Pro plan) to handle increased pub/sub throughput from multiple workers.

---

## Phase 3: 200–1000+ vehicles

### 1. Socket.io → Socket.io with Redis Adapter

When running multiple NestJS instances, Socket.io events must be broadcast across processes:

```ts
// realtime.module.ts
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
```

Install: `pnpm add @socket.io/redis-adapter`

### 2. Kafka for telematics event streaming

Replace BullMQ with Apache Kafka for high-throughput telematics ingestion:

```
Tesla Fleet Telemetry → Kafka topic: fleet.telematics.raw
                              │
                    Kafka Consumer (NestJS)
                              │
                    ┌─────────┴──────────┐
                 PostgreSQL          Redis cache
               (batch inserts)      (TTL 30s)
```

- Use `kafkajs` with `@nestjs/microservices` Kafka transporter
- Batch write to TimescaleDB every 1s (reduces write IOPS by 10x)
- Use Confluent Cloud or self-hosted Kafka on Render

### 3. Read replicas for analytics

Add a PostgreSQL read replica for heavy analytics queries:

```ts
// prisma.service.ts — add replica connection
const prismaReplica = new PrismaClient({
  datasourceUrl: process.env.DATABASE_REPLICA_URL,
});

// Use prismaReplica for all GET/analytics queries
// Use primary prisma for writes
```

### 4. CDN for dashboard assets

- Deploy frontend to Vercel (already configured in `vercel.json`)
- Vercel Edge Network automatically caches static assets globally
- Use `next/image` with remote patterns for vehicle photos

---

## Capacity Planning

| Vehicles | Update freq | Events/min | DB rows/day | Recommended stack |
|----------|-------------|------------|-------------|-------------------|
| < 50 | 10s | 300 | 432K | Single process + Neon starter |
| 50–200 | 10s | 1,200 | 1.7M | TimescaleDB + 3 BullMQ workers |
| 200–500 | 5s | 6,000 | 8.6M | Kafka + TimescaleDB + Redis Cluster |
| 500–2000 | 5s | 24,000 | 34M | Kafka + TimescaleDB + read replicas + CDN |

---

## Caching Strategy

| Data type | Cache TTL | Invalidation |
|-----------|-----------|--------------|
| Vehicle location | 30s | Overwrite on sync |
| Driver heartbeat | 15s | Overwrite on heartbeat |
| Geocode results | 7 days | Never (addresses don't move) |
| Directions/ETA | 5 min | TTL expiry |
| Fleet stats | 30s | Recomputed by cron |
| Tesla OAuth tokens | 1 hour | Refresh on expiry |

---

## Monitoring Checklist

- [ ] **Sentry** — error tracking (configured via `SENTRY_DSN`)
- [ ] **Pino + Loki** — structured logs, queryable via Grafana
- [ ] **Prometheus + Grafana** — BullMQ queue depth, job latency, DB connections
- [ ] **PgBouncer** — connection pooling (add between NestJS and PostgreSQL in prod)
- [ ] **Uptime robot** — ping `/health` every 60s, alert on failure
