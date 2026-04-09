# External API Integrations Setup

## 1. Tesla Fleet API

Tesla requires OAuth 2.0 PKCE flow and a registered third-party app.

### Steps
1. Go to [developer.tesla.com](https://developer.tesla.com) and create an application
2. Add your redirect URI: `https://your-backend.onrender.com/api/v1/auth/tesla/callback`
3. Request scopes: `openid offline_access vehicle_device_data vehicle_location`
4. Copy **Client ID** and **Client Secret** to your `.env`:
   ```
   TESLA_CLIENT_ID=your_client_id
   TESLA_CLIENT_SECRET=your_client_secret
   TESLA_REDIRECT_URI=https://your-backend.onrender.com/api/v1/auth/tesla/callback
   ```

### Auth flow
- `GET /api/v1/integrations/tesla/auth-url` → redirect driver to Tesla
- Tesla redirects back to `/api/v1/auth/tesla/callback?code=...`
- Backend exchanges code for tokens, stores in DB, begins syncing

### Rate limits
Tesla enforces ~200 API calls/day per vehicle. The sync processor introduces a 61-second delay between vehicles to stay within budget. For fleets > 25 vehicles, use **Fleet Telemetry** (streaming via WebSocket) instead of polling.

---

## 2. Smartcar API (NIO, BMW, Ford, Hyundai, VW, 40+ brands)

Smartcar is the recommended integration for non-Tesla EVs, including NIO.

### Steps
1. Sign up at [smartcar.com/dashboard](https://dashboard.smartcar.com)
2. Create an application and add redirect URI:
   `https://your-backend.onrender.com/api/v1/auth/smartcar/callback`
3. Required scopes: `read_vehicle_info read_location read_odometer read_battery read_charge`
4. Copy credentials to `.env`:
   ```
   SMARTCAR_CLIENT_ID=your_client_id
   SMARTCAR_CLIENT_SECRET=your_client_secret
   SMARTCAR_REDIRECT_URI=https://your-backend.onrender.com/api/v1/auth/smartcar/callback
   ```

### Rate limits
- Free tier: 1 API call/vehicle/second
- The sync processor uses 1.1s delays between vehicles for safety

---

## 3. Google Maps Platform

### Steps
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project and enable these APIs:
   - **Geocoding API**
   - **Directions API**
   - **Distance Matrix API**
3. Create an API key and restrict it to the above APIs + your server IP
4. Add to `.env`:
   ```
   GOOGLE_MAPS_API_KEY=AIza...
   ```

### Usage in FleetTrack
- **Geocoding** — convert addresses to lat/lng on trip creation (cached 7 days in Redis)
- **Directions** — calculate route, distance, duration (cached 5 minutes in Redis)
- **Nearest driver** — Haversine pre-filter → real ETA for top 5 candidates

### Cost management
- Geocoding: $5/1000 requests (free tier: 40,000/month)
- Directions: $5/1000 requests (free tier: 40,000/month)
- Redis caching significantly reduces API calls in production

---

## 4. Samsara Telematics (OBD-based, any vehicle)

Samsara provides GPS trackers and OBD-II dongles that work with any vehicle.

### Steps
1. Purchase Samsara hardware (VG54 gateway or SG1 OBD dongle)
2. Log into [cloud.samsara.com](https://cloud.samsara.com)
3. Generate an **API token** with scopes: `read:vehicles read:locations read:engine`
4. Add to `.env`:
   ```
   SAMSARA_API_KEY=samsara_api_...
   ```

### Sync
Samsara data is polled every 10 seconds via the BullMQ `telematics-sync` queue. Vehicle records must have `telematicsProvider = 'SAMSARA'` and `telematicsEnabled = true`.

---

## 5. Setting `telematicsProvider` per vehicle

When creating or updating a vehicle via `PATCH /api/v1/vehicles/:id`:
```json
{
  "telematicsEnabled": true,
  "telematicsProvider": "TESLA",
  "telematicsVehicleId": "5YJ3E7EA1NF..."
}
```

Supported values for `telematicsProvider`:
- `TESLA` — Tesla Fleet API
- `SMARTCAR` — Smartcar (NIO, BMW, Ford, etc.)
- `SAMSARA` — Samsara OBD/GPS hardware
- `MANUAL` — No telematics, manual updates only
