# Real-Time Architecture & WebSocket Event Reference

## Architecture Overview

```
Telematics APIs (Tesla/Smartcar/Samsara)
           │
           ▼
   BullMQ Job Queue (Redis)
   └─ telematics-sync queue
       ├─ @Cron every 10s → enqueues "sync-all" job
       └─ Processor → fetches API → writes DB + Redis cache
                                         │
                                         ▼
                                  WebSocket Gateway
                                  (Socket.io, port 3001)
                                         │
                                 ┌───────┴────────┐
                            Dashboard           Driver App
                          (fleet-updates)    (driver:<id>)
```

## WebSocket Connection

```js
import { io } from 'socket.io-client';

const socket = io('wss://your-backend.onrender.com', {
  auth: { token: 'Bearer eyJ...' }
});

socket.on('connect', () => console.log('Connected:', socket.id));
socket.on('connect_error', (err) => console.error(err.message));
```

## Subscribing to Rooms

```js
// All fleet-wide updates (vehicle locations, statuses, fleet stats)
socket.emit('subscribe:fleet');

// Updates for a specific trip
socket.emit('subscribe:trip', 'trip-uuid-here');

// Updates for a specific driver
socket.emit('subscribe:driver', 'driver-uuid-here');

// Unsubscribe
socket.emit('unsubscribe:fleet');
```

## Events

### `vehicle:location`
Emitted every 10 seconds per vehicle with telematics enabled.
```ts
{
  vehicleId: string;
  lat: number;
  lng: number;
  heading: number | null;    // 0-360 degrees
  speedKph: number | null;
  altitude: number | null;   // meters
  ts: string;                // ISO 8601
}
```

### `vehicle:status`
Emitted when vehicle status changes (AVAILABLE → ON_TRIP, etc.)
```ts
{
  vehicleId: string;
  status: 'AVAILABLE' | 'ON_TRIP' | 'MAINTENANCE' | 'CHARGING' | 'OFFLINE';
  ts: string;
}
```

### `vehicle:charging`
Emitted when EV battery/charging state updates.
```ts
{
  vehicleId: string;
  batteryLevel: number;        // 0-100%
  chargingState: 'CHARGING' | 'COMPLETE' | 'NOT_CHARGING' | 'UNPLUGGED';
  rangeKm: number | null;
  chargeRate: number | null;   // kW
  timeToFullMin: number | null;
  ts: string;
}
```

### `driver:status`
Emitted when driver status or online state changes.
```ts
{
  driverId: string;
  status: 'AVAILABLE' | 'ON_TRIP' | 'OFFLINE' | 'BREAK';
  isOnline: boolean;
  ts: string;
}
```

### `trip:update`
Emitted on every trip status transition.
```ts
{
  tripId: string;
  status: 'PENDING' | 'DRIVER_ASSIGNED' | 'DRIVER_EN_ROUTE' | 'ARRIVED_PICKUP' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  driverId: string | null;
  vehicleId: string | null;
  ts: string;
}
```

### `fleet:stats`
Broadcast every 30 seconds to all `fleet-updates` subscribers.
```ts
{
  online: number;       // drivers with active heartbeat
  onTrip: number;       // vehicles with status ON_TRIP
  available: number;    // vehicles with status AVAILABLE
  total: number;        // total active vehicles
  ts: string;
}
```

## Redis Key Patterns

| Key | TTL | Value |
|-----|-----|-------|
| `vehicle:location:{id}` | 30s | JSON `{ lat, lng, heading, speedKph, ts }` |
| `driver:heartbeat:{id}` | 15s | `1` (presence flag) |
| `maps:geocode:{hash}` | 7d | JSON geocode result |
| `maps:directions:{hash}` | 5m | JSON directions result |
| `tesla:token:{vehicleId}` | 1h | JSON Tesla OAuth token |

## Driver Heartbeat Protocol

Driver apps must call `POST /api/v1/drivers/:id/heartbeat` every **5 seconds** to remain "online". The backend caches a Redis key with 15s TTL. When the key expires, the driver appears offline in `GET /drivers/online`.

```js
// Client-side heartbeat loop
setInterval(() => {
  fetch(`/api/v1/drivers/${driverId}/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}, 5000);
```
