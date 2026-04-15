/**
 * FleetTrack runtime data source — API only, no hardcoded fallbacks.
 *
 * All data (drivers, vehicles, KPIs) comes from /api/drivers, /api/vehicles,
 * /api/stats. If the database is empty, consumers receive empty arrays and
 * zeroed KPIs — they should render an empty state telling the admin to
 * import CSVs via /api/import/* or the Data Import UI.
 *
 * Public API (kept stable for dashboard.html / driver.html):
 *   FleetData.drivers      — array (empty until load() resolves)
 *   FleetData.vehicles     — array (empty until load() resolves)
 *   FleetData.kpis         — object with the canonical dashboard KPIs
 *   FleetData.load()       — Promise<{drivers, vehicles, kpis}>
 *   FleetData.refresh()    — force re-fetch and mutate the arrays in place
 *   FleetData.findDriver(idOrCar) / FleetData.findVehicle(id)
 *
 * Events (fired on window):
 *   fleetdata:ready        — first successful load has resolved
 *   fleetdata:updated      — any subsequent refresh completed
 *   fleetdata:unauthorized — API returned 401 (session missing / expired)
 */
window.FleetData = (function(){
  // Live arrays — mutated in place by refresh() so early captures stay valid.
  const drivers = [];
  const vehicles = [];
  const kpis = {
    revenueToday: 0,
    netRevenue: 0,
    netProfit: 0,
    marginPct: 0,
    breakEven: 0,
    tripsToday: 0,
    avgTripFare: 0,
    driversTotal: 0,
    driversActive: 0,
    vehiclesTotal: 0,
    vehiclesOnRoad: 0,
    vehiclesShop: 0,
    vehiclesIdle: 0,
  };

  // Normalise a Prisma Driver row into the shape the legacy UI expects.
  // Legacy UI fields: {r, id, n, car, brand, shift, rev, revhr, triphr, acc, can, idle, util, zone, comm}
  // Many are derived fleet-performance metrics we don't yet compute server-side —
  // we emit what we have and leave the rest at zero/empty.
  function normaliseDriver(d, idx){
    const firstVehicle = Array.isArray(d.vehicles) && d.vehicles[0] ? d.vehicles[0].vehicle : null;
    return {
      r: idx + 1,
      id: d.id,
      n: d.name,
      email: d.email,
      phone: d.phone,
      car: firstVehicle ? (firstVehicle.plateNumber || firstVehicle.carId || '') : '',
      brand: firstVehicle ? [firstVehicle.make, firstVehicle.model].filter(Boolean).join(' ') : '',
      shift: '',
      status: d.status,
      rating: d.rating,
      totalTrips: d.totalTrips,
      // Performance metrics — zero until /api/stats/per-driver exists.
      rev: 0, revhr: 0, triphr: 0, acc: 0, can: 0, idle: 0, util: 0, zone: '', comm: 0,
    };
  }

  function normaliseVehicle(v){
    return {
      id: v.plateNumber || v.carId || v.id,
      vehicleId: v.id,
      carId: v.carId || null,
      plateNumber: v.plateNumber,
      make: v.make || '',
      model: v.model || '',
      year: v.year,
      color: v.color,
      fuel: v.fuelType || '',
      status: (v.status || '').toLowerCase(),
      mileage: v.mileage,
      fuelLevel: v.fuelLevel,
      drivers: Array.isArray(v.drivers) ? v.drivers.map(dv => dv.driver?.name).filter(Boolean) : [],
      shifts: Array.isArray(v.drivers) ? v.drivers.length : 0,
      // Economics we don't aggregate per-vehicle yet.
      rev: 0, profit: 0, cpkm: 0, tkm: 0, bkm: 0, ikm: 0, down: 0,
    };
  }

  async function fetchJson(url){
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) {
      try { window.dispatchEvent(new CustomEvent('fleetdata:unauthorized', { detail: { url } })); } catch(e){}
      return null;
    }
    if (!r.ok) return null;
    try { return await r.json(); } catch(e){ return null; }
  }

  let inflight = null;
  async function load(force){
    if (inflight && !force) return inflight;
    inflight = (async () => {
      const [dr, vh, st] = await Promise.all([
        fetchJson('/api/drivers'),
        fetchJson('/api/vehicles'),
        fetchJson('/api/stats'),
      ]);

      if (Array.isArray(dr)) {
        drivers.length = 0;
        dr.forEach((d, i) => drivers.push(normaliseDriver(d, i)));
      }
      if (Array.isArray(vh)) {
        vehicles.length = 0;
        vh.forEach(v => vehicles.push(normaliseVehicle(v)));
      }
      if (st && typeof st === 'object') {
        Object.assign(kpis, {
          revenueToday:   numOr(st.revenueToday, 0),
          netRevenue:     numOr(st.netRevenue, 0),
          netProfit:      numOr(st.netProfit, 0),
          marginPct:      numOr(st.marginPct, 0),
          breakEven:      numOr(st.breakEven, 0),
          tripsToday:     numOr(st.tripsToday, 0),
          avgTripFare:    numOr(st.avgTripFare, 0),
          driversTotal:   numOr(st.driversTotal, drivers.length),
          driversActive:  numOr(st.driversActive, 0),
          vehiclesTotal:  numOr(st.vehiclesTotal, vehicles.length),
          vehiclesOnRoad: numOr(st.vehiclesOnRoad, 0),
          vehiclesShop:   numOr(st.vehiclesShop, 0),
          vehiclesIdle:   numOr(st.vehiclesIdle, 0),
        });
      }
      return { drivers, vehicles, kpis };
    })();

    try { return await inflight; }
    finally { inflight = null; }
  }

  function numOr(v, fallback){ const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  async function refresh(){
    const out = await load(true);
    try { window.dispatchEvent(new CustomEvent('fleetdata:updated', { detail: { counts: { drivers: drivers.length, vehicles: vehicles.length } } })); } catch(e){}
    return out;
  }

  function findDriver(idOrCar){
    return drivers.find(d => d.id === idOrCar || d.car === idOrCar || d.email === idOrCar);
  }
  function findVehicle(id){
    return vehicles.find(v => v.id === id || v.plateNumber === id || v.carId === id || v.vehicleId === id);
  }

  // Auto-load after first paint so page-render scripts see data as soon as
  // the network allows. If /api/* returns 401 we stay silent — pages do
  // their own requireAuth() and will redirect to /login.
  let firstReady = false;
  setTimeout(() => {
    load().then(() => {
      if (!firstReady) {
        firstReady = true;
        try { window.dispatchEvent(new CustomEvent('fleetdata:ready', { detail: { counts: { drivers: drivers.length, vehicles: vehicles.length } } })); } catch(e){}
      }
    }).catch(() => { /* silent — pages render empty state */ });
  }, 50);

  return { drivers, vehicles, kpis, load, refresh, findDriver, findVehicle };
})();
