# 🚖 FleetTrack — Enterprise Fleet Management Platform

A complete multi-portal fleet management system for taxi/ride-hailing operations.

## 📁 Project Structure

```
fleettrack/
├── login.html                    ← Unified login for all portals
├── admin/
│   ├── dashboard.html            ← Full admin fleet dashboard
│   └── access-management.html   ← Grant/revoke employee permissions
├── driver/
│   └── index.html                ← Mobile-first driver portal
├── employee/
│   └── index.html                ← Role-restricted employee portal
├── shared/
│   ├── css/design-system.css     ← Shared design tokens + components
│   └── js/auth.js                ← Auth system + session management
└── api-mock/                     ← (Future) API mock server
```

## 🚀 Getting Started (Local)

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/fleettrack.git
cd fleettrack

# Serve locally (Python)
python3 -m http.server 8080

# OR with Node.js
npx serve .

# Open in browser
open http://localhost:8080/login.html
```

## 🔐 Demo Credentials

| Portal   | Email                        | Password      |
|----------|------------------------------|---------------|
| Admin    | stefan@oslofleet.no          | Admin2024!    |
| Admin    | manager@fleettrack.no        | Manager2024!  |
| Employee | dispatch@fleettrack.no       | Dispatch2024! |
| Employee | accounts@regnskap.no         | Finance2024!  |
| Employee | ops@fleettrack.no            | Ops2024!      |
| Driver   | olsztynski@fleettrack.no     | Driver2024!   |
| Driver   | (any driver email)           | Driver2024!   |

## 🌐 Deploy to GitHub Pages

1. Push to GitHub:
```bash
git init
git add .
git commit -m "Initial FleetTrack deployment"
git remote add origin https://github.com/YOUR_USERNAME/fleettrack.git
git push -u origin main
```

2. Enable GitHub Pages:
   - Go to repo → **Settings** → **Pages**
   - Source: **Deploy from a branch**
   - Branch: `main` / `/ (root)`
   - Click **Save**

3. Your site will be live at:
   ```
   https://YOUR_USERNAME.github.io/fleettrack/login.html
   ```

## 🏛️ Portal Overview

### Admin Dashboard (`/admin/dashboard.html`)
- Full fleet KPI overview (revenue, profit, utilization, alerts)
- 40+ pages: drivers, vehicles, P&L, zones, platforms, compliance
- API Integration settings (Bolt, Uber, NIO, Tesla)
- Access Management for employee permissions
- Norway cost structure (VAT, Arbeidsgiveravgift, EV costs)
- Dashboard checklist tracker

### Driver Portal (`/driver/index.html`)
- Mobile-first design (max-width 600px, bottom nav)
- Today's stats: earnings, trips, acceptance rate, online hours
- Trip log with Bolt/Uber split
- Weekly earnings chart + payslip breakdown
- 7-day shift schedule
- Performance score with breakdown (0–100)
- Notifications and alerts

### Employee Portal (`/employee/index.html`)
- Sidebar navigation with locked sections based on permissions
- Available pages: Overview, Drivers, Trips, Vehicles, Alerts, Dispatch, Finance, Payroll
- Permissions granted manually by admin via Access Management page

### Access Management (`/admin/access-management.html`)
- Toggle each permission on/off per employee
- Grant All / Revoke All controls
- Permissions: view:drivers, view:trips, view:vehicles, view:alerts,
  view:financial, view:payroll, view:zones, manage:dispatch,
  manage:maintenance, export:reports

## 🔌 API Integration (Next Steps for Claude Code)

The following APIs need to be wired in `shared/js/auth.js` and the admin API settings page:

| API     | Docs URL                              | Auth Method              |
|---------|---------------------------------------|--------------------------|
| Bolt    | fleet.bolt.eu                         | OAuth2 client_credentials|
| Uber    | developer.uber.com                    | OAuth2 Bearer token      |
| NIO     | developer.nio.io                      | App Key + Secret + MQTT  |
| Tesla   | fleet-api.prd.na.vn.cloud.tesla.com   | OAuth2 refresh_token     |
| Spot    | Your FMS provider                     | API Key                  |

Each API config field is in Admin → Settings → API Integrations.

## 🔒 Production Security Checklist (IMPORTANT)

Before going live, Claude Code must implement:

- [ ] Replace localStorage auth with JWT tokens (httpOnly cookies)
- [ ] Add a real backend (Node.js/Express or Python/FastAPI)
- [ ] Move all API keys to environment variables (.env)
- [ ] Add rate limiting to login endpoint (max 5 attempts/15 min)
- [ ] Add HTTPS (mandatory — never serve over HTTP with real credentials)
- [ ] Replace hardcoded passwords in auth.js with hashed passwords (bcrypt)
- [ ] Add CSRF protection on all POST endpoints
- [ ] Add proper session invalidation on logout (server-side)
- [ ] Set Content-Security-Policy headers
- [ ] Enable GitHub repository secret scanning

## 📊 Tech Stack

- **Frontend**: Pure HTML5 + CSS3 + Vanilla JavaScript (no framework dependency)
- **Charts**: Chart.js 4.4.1 (CDN)
- **Fonts**: Google Fonts (Outfit + JetBrains Mono)
- **Auth**: Frontend session system → replace with backend JWT
- **Hosting**: GitHub Pages (static) → upgrade to Vercel/Railway for backend

## 🗄️ Database Schema (for backend implementation)

See Admin Dashboard → Data Model page for full schema with 7 tables:
`Drivers`, `Vehicles`, `Trips`, `Payments`, `Expenses`, `Maintenance`, `Driver_Shifts`

## 📞 Support

Contact: stefan@oslofleet.no | manager@fleettrack.no

---
Built with FleetTrack Platform v1.0 · © 2025
