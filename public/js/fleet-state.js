/**
 * FleetState — unified, API-only state store.
 *
 * Architecture:
 *   1. Fetch      — pulls /api/drivers, /api/vehicles, /api/stats,
 *                    /api/stats/per-driver, /api/stats/hourly in parallel.
 *   2. Store      — normalises rows into a structured state object.
 *   3. Notify     — fires `fleet:state` events so render modules
 *                    recompute UI from state. No DOM patching from here.
 *
 * Every render module subscribes via FleetState.subscribe(fn) and
 * receives the full state whenever it changes. Rendering is the
 * module's job — this file never touches the DOM.
 *
 * Replaces: public/fleet-data.js + public/dashboard-live.js.
 */
window.FleetState = (function(){
  const listeners = new Set();
  const state = {
    loading: false,
    error:   null,
    drivers: [],           // normalised
    vehicles: [],          // normalised
    kpis: emptyKpis(),
    perDriver: [],         // from /api/stats/per-driver
    hourly:  emptyHourly(),// from /api/stats/hourly
    trips: [],             // most recent, for trip log
    lastLoadedAt: null,
  };

  function emptyKpis(){
    return {
      revenueToday: 0, netRevenue: 0, netProfit: 0, marginPct: 0, breakEven: 0,
      tripsToday: 0, avgTripFare: 0,
      driversTotal: 0, driversActive: 0,
      vehiclesTotal: 0, vehiclesOnRoad: 0, vehiclesShop: 0, vehiclesIdle: 0,
    };
  }
  function emptyHourly(){
    return { buckets: Array.from({length:24},(_,h)=>({hour:h,trips:0,revenueNok:0})), totalTrips:0, totalRevenueNok:0 };
  }

  function normaliseDriver(d, i, perDriverIndex){
    const perf = perDriverIndex[d.id] || {};
    const firstVehicle = Array.isArray(d.vehicles) && d.vehicles[0] ? d.vehicles[0].vehicle : null;
    return {
      r: i + 1,
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
      // Live perf metrics
      rev:    Number(perf.revenueNok || 0),
      revhr:  Number(perf.revenuePerHour || 0),
      triphr: Number(perf.tripsPerHour || 0),
      acc:    Number(perf.acceptanceRate || 0),
      can:    Number(perf.cancellationRate || 0),
      idle:   0,                     // needs /api/stats/shifts — future
      util:   perf.onlineHours ? Math.min(100, Math.round(perf.onlineHours / 9 * 100)) : 0,
      zone:   '',
      comm:   0,
      score:  Number(perf.score || 0),
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
      drivers: Array.isArray(v.drivers) ? v.drivers.map(dv => dv.driver && dv.driver.name).filter(Boolean) : [],
      shifts:  Array.isArray(v.drivers) ? v.drivers.length : 0,
      rev: 0, profit: 0, cpkm: 0, tkm: 0, bkm: 0, ikm: 0, down: 0,
    };
  }

  async function fetchJson(url){
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) {
      try { window.dispatchEvent(new CustomEvent('fleet:unauthorized', { detail: { url } })); } catch(e){}
      return null;
    }
    if (!r.ok) return null;
    try { return await r.json(); } catch(e){ return null; }
  }

  function notify(){
    for (const fn of listeners) {
      try { fn(state); } catch(e){ console.error('FleetState listener:', e); }
    }
    try { window.dispatchEvent(new CustomEvent('fleet:state', { detail: { lastLoadedAt: state.lastLoadedAt } })); } catch(e){}
  }

  let inflight = null;
  async function load(){
    if (inflight) return inflight;
    state.loading = true;
    notify();
    inflight = (async () => {
      const [dr, vh, st, pd, hr, tp] = await Promise.all([
        fetchJson('/api/drivers'),
        fetchJson('/api/vehicles'),
        fetchJson('/api/stats'),
        fetchJson('/api/stats/per-driver?days=7&limit=200'),
        fetchJson('/api/stats/hourly?days=1'),
        fetchJson('/api/trips?limit=50'),
      ]);

      const perDriverArr = (pd && Array.isArray(pd.drivers)) ? pd.drivers : [];
      const perDriverIndex = {};
      for (const p of perDriverArr) perDriverIndex[p.driverId] = p;

      state.drivers  = Array.isArray(dr) ? dr.map((d, i) => normaliseDriver(d, i, perDriverIndex)) : [];
      state.vehicles = Array.isArray(vh) ? vh.map(normaliseVehicle) : [];
      state.perDriver = perDriverArr;
      state.hourly    = hr && hr.buckets ? hr : emptyHourly();
      state.trips     = Array.isArray(tp) ? tp : [];
      if (st && typeof st === 'object') {
        Object.assign(state.kpis, {
          revenueToday:   num(st.revenueToday, 0),
          netRevenue:     num(st.netRevenue, 0),
          netProfit:      num(st.netProfit, 0),
          marginPct:      num(st.marginPct, 0),
          breakEven:      num(st.breakEven, 0),
          tripsToday:     num(st.tripsToday, 0),
          avgTripFare:    num(st.avgTripFare, 0),
          driversTotal:   num(st.driversTotal, state.drivers.length),
          driversActive:  num(st.driversActive, 0),
          vehiclesTotal:  num(st.vehiclesTotal, state.vehicles.length),
          vehiclesOnRoad: num(st.vehiclesOnRoad, 0),
          vehiclesShop:   num(st.vehiclesShop, 0),
          vehiclesIdle:   num(st.vehiclesIdle, 0),
        });
      }
      state.lastLoadedAt = new Date();
      state.loading = false;
      state.error = null;
      notify();
      return state;
    })();
    try { return await inflight; }
    finally { inflight = null; }
  }

  function num(v, fallback){ const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  function subscribe(fn){
    listeners.add(fn);
    // Fire once with current state so late subscribers render immediately.
    try { fn(state); } catch(e){}
    return () => listeners.delete(fn);
  }
  function getState(){ return state; }
  async function refresh(){ return load(); }

  return { load, refresh, subscribe, getState };
})();

// Backwards-compatible shim: fleet-data.js used to expose FleetData.drivers etc.
// Some legacy code paths still read window.FleetData. Provide live bindings.
window.FleetData = {
  get drivers(){ return window.FleetState.getState().drivers; },
  get vehicles(){ return window.FleetState.getState().vehicles; },
  get kpis(){ return window.FleetState.getState().kpis; },
  load:    () => window.FleetState.load().then(() => window.FleetState.getState()),
  refresh: () => window.FleetState.refresh().then(() => window.FleetState.getState()),
  findDriver: (id) => window.FleetState.getState().drivers.find(d => d.id === id || d.car === id || d.email === id),
  findVehicle: (id) => window.FleetState.getState().vehicles.find(v => v.id === id || v.vehicleId === id || v.plateNumber === id || v.carId === id),
};

// Kick off the first load after a tick so render modules can subscribe first.
setTimeout(() => {
  window.FleetState.load().catch(() => {});
}, 30);

// Session bounce on auth failures.
window.addEventListener('fleet:unauthorized', () => {
  try { localStorage.removeItem('ft_session'); } catch(e){}
  if (!/\/login/.test(location.pathname)) window.location.href = '/login?error=unauthorized';
});
