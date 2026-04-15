/**
 * Chart render module — owns every <canvas data-chart="..."> in the
 * dashboard. Currently drives:
 *
 *   <canvas data-chart="trips-hourly">  — trips per hour (today)
 *   <canvas data-chart="revenue-hourly"> — NOK per hour (today)
 *
 * Expects Chart.js to be loaded globally. If it isn't (offline / CDN
 * failure) the canvas is left untouched and we don't throw.
 */
(function(){
  if (!window.FleetState) return;

  const instances = new Map(); // canvas id -> Chart instance

  function getCtx(el){
    if (!el || typeof el.getContext !== 'function') return null;
    return el.getContext('2d');
  }

  function destroyIfExists(key){
    const inst = instances.get(key);
    if (inst && typeof inst.destroy === 'function') inst.destroy();
    instances.delete(key);
  }

  function renderHourlyTrips(state){
    if (typeof Chart === 'undefined') return;
    const el = document.querySelector('canvas[data-chart="trips-hourly"]');
    if (!el) return;
    const ctx = getCtx(el);
    if (!ctx) return;

    const labels = state.hourly.buckets.map(b => String(b.hour).padStart(2,'0') + ':00');
    const data   = state.hourly.buckets.map(b => b.trips);
    destroyIfExists('trips-hourly');
    instances.set('trips-hourly', new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Trips',
          data,
          backgroundColor: 'rgba(59,127,245,0.55)',
          borderColor: 'rgba(59,127,245,1)',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--t3') } },
          y: { beginAtZero: true, ticks: { color: cssVar('--t3'), precision: 0 }, grid: { color: cssVar('--b1') } },
        },
      },
    }));
  }

  function renderHourlyRevenue(state){
    if (typeof Chart === 'undefined') return;
    const el = document.querySelector('canvas[data-chart="revenue-hourly"]');
    if (!el) return;
    const ctx = getCtx(el);
    if (!ctx) return;
    const labels = state.hourly.buckets.map(b => String(b.hour).padStart(2,'0') + ':00');
    const data   = state.hourly.buckets.map(b => b.revenueNok);
    destroyIfExists('revenue-hourly');
    instances.set('revenue-hourly', new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'NOK',
          data,
          borderColor: 'rgba(16,185,129,1)',
          backgroundColor: 'rgba(16,185,129,0.18)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--t3') } },
          y: { beginAtZero: true, ticks: { color: cssVar('--t3') }, grid: { color: cssVar('--b1') } },
        },
      },
    }));
  }

  function cssVar(name){
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
    catch(e){ return '#888'; }
  }

  window.FleetState.subscribe((state) => {
    try { renderHourlyTrips(state); }   catch(e){ console.error('chart trips-hourly:', e); }
    try { renderHourlyRevenue(state); } catch(e){ console.error('chart revenue-hourly:', e); }
  });
})();
