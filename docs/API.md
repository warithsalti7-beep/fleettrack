# FleetTrack REST API Reference

Base URL: `https://your-backend.onrender.com/api/v1`
All endpoints require `Authorization: Bearer <access_token>` unless marked public.

---

## Authentication

### POST /auth/register *(public)*
Create a new user account.
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "Str0ng!Pass",
  "role": "DISPATCHER"
}
```
Response: `{ accessToken, refreshToken, user: { id, email, role } }`

### POST /auth/login *(public)*
```json
{ "email": "jane@example.com", "password": "Str0ng!Pass" }
```
Response: `{ accessToken, refreshToken, user }`

### POST /auth/refresh *(public)*
```json
{ "refreshToken": "..." }
```
Response: `{ accessToken, refreshToken }`

### POST /auth/logout
Revokes the refresh token supplied in the request body.

---

## Vehicles

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | /vehicles | ADMIN, DISPATCHER, SUPER_ADMIN | List vehicles (paginated) |
| GET | /vehicles/live | ADMIN, DISPATCHER, SUPER_ADMIN | Live status from DB + Redis cache |
| GET | /vehicles/:id | ADMIN, DISPATCHER, SUPER_ADMIN, DRIVER | Single vehicle with relations |
| POST | /vehicles | ADMIN, SUPER_ADMIN | Create vehicle |
| PATCH | /vehicles/:id | ADMIN, SUPER_ADMIN | Update vehicle fields |
| DELETE | /vehicles/:id | SUPER_ADMIN | Soft-delete vehicle |

### Query params for GET /vehicles
| Param | Type | Description |
|-------|------|-------------|
| status | VehicleStatus | Filter by status |
| fuelType | FuelType | Filter by fuel type |
| page | number | Page number (default 1) |
| limit | number | Results per page (default 50, max 100) |

### VehicleStatus enum
`AVAILABLE` | `ON_TRIP` | `MAINTENANCE` | `CHARGING` | `OFFLINE`

---

## Drivers

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | /drivers | ADMIN, DISPATCHER, SUPER_ADMIN | List drivers (paginated) |
| GET | /drivers/online | ADMIN, DISPATCHER, SUPER_ADMIN | Online drivers (DB + Redis heartbeat) |
| GET | /drivers/stats | ADMIN, SUPER_ADMIN | Aggregate revenue/distance/rating stats |
| GET | /drivers/:id | ADMIN, DISPATCHER, SUPER_ADMIN, DRIVER | Single driver |
| POST | /drivers | ADMIN, SUPER_ADMIN | Create driver |
| PATCH | /drivers/:id | ADMIN, SUPER_ADMIN | Update driver |
| POST | /drivers/:id/heartbeat | DRIVER | Update online presence (call every 5s) |
| POST | /drivers/:id/assign-vehicle | ADMIN, DISPATCHER, SUPER_ADMIN | Assign vehicle to driver |
| DELETE | /drivers/:id | SUPER_ADMIN | Soft-delete driver |

### DriverStatus enum
`AVAILABLE` | `ON_TRIP` | `OFFLINE` | `BREAK`

---

## Trips

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | /trips | ADMIN, DISPATCHER, SUPER_ADMIN | List trips (paginated + filtered) |
| GET | /trips/active | ADMIN, DISPATCHER, SUPER_ADMIN | Active trips with driver/vehicle locations |
| GET | /trips/stats | ADMIN, SUPER_ADMIN | Revenue, distance, rating aggregates |
| GET | /trips/:id | ADMIN, DISPATCHER, SUPER_ADMIN, DRIVER | Trip detail |
| POST | /trips | ADMIN, DISPATCHER, SUPER_ADMIN | Dispatch new trip |
| PATCH | /trips/:id/status | ADMIN, DISPATCHER, SUPER_ADMIN, DRIVER | Advance trip status |
| PATCH | /trips/:id | ADMIN, DISPATCHER, SUPER_ADMIN | Update trip fields |

### Trip lifecycle
```
PENDING → DRIVER_ASSIGNED → DRIVER_EN_ROUTE → ARRIVED_PICKUP → IN_PROGRESS → COMPLETED
                                                                             ↘ CANCELLED
```

### POST /trips body
```json
{
  "driverId": "uuid",
  "vehicleId": "uuid",
  "pickupAddress": "JFK Airport, NY",
  "dropoffAddress": "Times Square, NY",
  "pickupLat": 40.6413,
  "pickupLng": -73.7781,
  "dropoffLat": 40.7580,
  "dropoffLng": -73.9855,
  "passengerName": "John Smith",
  "passengerPhone": "+1234567890",
  "passengerCount": 2,
  "paymentMethod": "CARD"
}
```

### PATCH /trips/:id/status body
```json
{
  "status": "COMPLETED",
  "fare": 45.50,
  "distanceKm": 22.3,
  "durationMin": 38
}
```

### TripStatus enum
`PENDING` | `DRIVER_ASSIGNED` | `DRIVER_EN_ROUTE` | `ARRIVED_PICKUP` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`

### PaymentMethod enum
`CASH` | `CARD` | `WALLET` | `CORPORATE`

---

## Telematics

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | /telematics/fleet/ev-summary | ADMIN, DISPATCHER, SUPER_ADMIN | Fleet EV health overview |
| GET | /telematics/fleet/locations | ADMIN, DISPATCHER, SUPER_ADMIN | All vehicle GPS positions |
| GET | /telematics/vehicles/:id/latest | ADMIN, DISPATCHER, SUPER_ADMIN, DRIVER | Latest telemetry entry |
| GET | /telematics/vehicles/:id/battery-history | ADMIN, DISPATCHER, SUPER_ADMIN | Battery % over time |
| GET | /telematics/vehicles/:id/logs | ADMIN, SUPER_ADMIN | Raw telemetry logs |

### GET /telematics/vehicles/:id/battery-history params
| Param | Default | Description |
|-------|---------|-------------|
| hours | 24 | Number of hours of history to return |

### GET /telematics/vehicles/:id/logs params
| Param | Description |
|-------|-------------|
| from | ISO date string |
| to | ISO date string |
| limit | Max records (default 100, max 500) |

---

## WebSocket Events (Socket.io)

Connect to: `wss://your-backend.onrender.com`

### Subscribe to rooms
```js
socket.emit('subscribe:fleet');       // all vehicle updates
socket.emit('subscribe:trip', tripId);
socket.emit('subscribe:driver', driverId);
```

### Events emitted by server
| Event | Room | Payload |
|-------|------|---------|
| `vehicle:location` | fleet-updates | `{ vehicleId, lat, lng, heading, speedKph, ts }` |
| `vehicle:status` | fleet-updates | `{ vehicleId, status, ts }` |
| `vehicle:charging` | fleet-updates | `{ vehicleId, batteryLevel, chargingState, rangeKm, ts }` |
| `driver:status` | fleet-updates | `{ driverId, status, isOnline, ts }` |
| `trip:update` | trip:<id> | `{ tripId, status, driverId, vehicleId, ts }` |
| `fleet:stats` | fleet-updates | `{ online, onTrip, available, total, ts }` |

---

## Health Check

### GET /health *(public)*
Returns `200 OK` when the service is healthy.
```json
{
  "status": "ok",
  "info": { "database": { "status": "up" }, "redis": { "status": "up" } }
}
```

---

## Error Responses

All errors follow RFC 7807:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

| Code | Meaning |
|------|---------|
| 400 | Bad request / validation error |
| 401 | Missing or invalid JWT |
| 403 | Insufficient role |
| 404 | Resource not found |
| 409 | Conflict (duplicate email, license, etc.) |
| 429 | Rate limit exceeded (100 req/60s) |
| 500 | Internal server error |
