/**
 * FleetTrack single source of truth for fleet data.
 *
 * Pattern:
 *   1. Ships with baked-in demo data so the UI is never empty.
 *   2. Exposes FleetData.load() — an async function that tries to hydrate
 *      the same shape from /api/* endpoints (live Neon data). Returns the
 *      live arrays on success; returns the baked-in arrays on failure.
 *   3. Consumers (dashboard.html, driver.html, auth.js) read from
 *      window.FleetData.drivers / .vehicles / .trips instead of redefining
 *      their own local copies.
 *
 * This kills the cross-file duplication (item 30 in the audit) and sets
 * up the one-line migration from static -> API-fed data:
 *   BEFORE:  const drivers = FleetData.drivers;
 *   AFTER:   const drivers = (await FleetData.load()).drivers;
 */
  // ── Demo-data baseline (intentionally empty after the 2026-04-15 wipe).
  //
  // The previous build shipped 19 hardcoded demo drivers and 14 demo
  // vehicles so the dashboard was never blank during the prototype. The
  // owner has now uploaded the real driver + vehicle master lists into
  // the database, so the baked-in fixtures are no longer truthful and
  // are gone. Everything below comes from the API at runtime — see the
  // `load()` function further down — and the dashboard renders empty
  // states until the operator uploads real CSVs (drivers, vehicles,
  // trips, settlements, etc.) via Dashboard → System → Data Import.
  //
  // Why this is safe: every page that consumed `FleetData.drivers` /
  // `.vehicles` / `.kpis` already calls `FleetData.load()` (or runs
  // through `bootstrap()` below), which prefers the live API arrays
  // over the baked-in ones. Empty arrays just mean the API answer is
  // displayed without a stale-demo overlay.
  const drivers = [];
  const vehicles = [];

  // Fleet-level KPI placeholders — all zero until /api/stats fills them in.
  const kpis = {
    revenueToday:   0,
    netRevenue:     0,
    netProfit:      0,
    marginPct:      0,
    breakEven:      0,
    tripsToday:     0,
    avgTripFare:    0,
    driversTotal:   0,
    driversActive:  0,
    vehiclesTotal:  0,
    vehiclesOnRoad: 0,
    vehiclesShop:   0,
    vehiclesIdle:   0,
  };

  // ── Live-sync API (opt-in — UI calls FleetData.load() when ready) ─
  let liveCache = null;
  async function load(){
    if (liveCache) return liveCache;
    const out = { drivers, vehicles, kpis };
    try {
      const [dr, vh, st] = await Promise.allSettled([
        fetch('/api/drivers').then(r => r.ok ? r.json() : null),
        fetch('/api/vehicles').then(r => r.ok ? r.json() : null),
        fetch('/api/stats').then(r => r.ok ? r.json() : null),
      ]);
      const d = dr.status === 'fulfilled' && Array.isArray(dr.value) ? dr.value : null;
      const v = vh.status === 'fulfilled' && Array.isArray(vh.value) ? vh.value : null;
      const s = st.status === 'fulfilled' && st.value ? st.value : null;
      if (d && d.length) out.drivers  = d;
      if (v && v.length) out.vehicles = v;
      if (s && typeof s === 'object') out.kpis = Object.assign({}, kpis, s);
    } catch (err) {
      if (window.Sentry && typeof window.Sentry.captureException === 'function') {
        window.Sentry.captureException(err, { tags: { where: 'FleetData.load' } });
      }
    }
    liveCache = out;
    return out;
  }

  // Mutate the exported arrays in place with live data. Anyone who captured
  // `FleetData.drivers` earlier will see the new rows without a re-import.
  async function refresh(){
    const live = await load();
    liveCache = null; // allow future re-fetch
    drivers.splice(0, drivers.length, ...(live.drivers || []));
    vehicles.splice(0, vehicles.length, ...(live.vehicles || []));
    if (live.kpis) Object.assign(kpis, live.kpis);
    return { drivers, vehicles, kpis };
  }

  // Non-blocking bootstrap: on page load, try hydrating from the API.
  // If successful AND data differs from baked-in, fire a custom event so
  // the dashboard can show a 'New data available — Reload' banner.
  function bootstrap(){
    const baselineDriverCount  = drivers.length;
    const baselineVehicleCount = vehicles.length;
    load().then(live => {
      if (!live) return;
      const d = live.drivers || [];
      const v = live.vehicles || [];
      const diff = (d.length !== baselineDriverCount) || (v.length !== baselineVehicleCount);
      if (diff) {
        try {
          window.dispatchEvent(new CustomEvent('fleetdata:live-available', { detail: { counts: { drivers: d.length, vehicles: v.length } } }));
        } catch (e){}
      }
    }).catch(() => { /* silent */ });
  }
  // Run bootstrap after a tick so page-render scripts complete first
  setTimeout(bootstrap, 200);

  function findDriver(idOrCar){ return drivers.find(d => d.id === idOrCar || d.car === idOrCar); }
  function findVehicle(id){ return vehicles.find(v => v.id === id); }

  return { drivers, vehicles, kpis, load, refresh, findDriver, findVehicle };
})();
