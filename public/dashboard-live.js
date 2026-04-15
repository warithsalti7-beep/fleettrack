/**
 * dashboard-live.js — bridges static dashboard.html to live data.
 *
 * This is an incremental step away from the historical snapshot embedded
 * in dashboard.html. On page load it:
 *
 *   1. Pulls live KPIs from FleetData.kpis (filled by /api/stats).
 *   2. Overwrites the KPI tiles whose .cur[data-nok] number matches a
 *      known canonical value (revenue today, net profit, break-even) with
 *      the live value. Live values are tagged with data-live="1" so the
 *      FleetCurrency rerender picks them up on NOK<->EUR toggle.
 *   3. Shows a top banner summarising data freshness / empty-state with
 *      a direct link to /api/import docs so admins know how to load data.
 *
 * When the full dashboard HTML is rewritten to read from FleetData at
 * render time (follow-up work), this file becomes unnecessary.
 */
(function(){
  if (typeof window === 'undefined' || typeof window.FleetData === 'undefined') return;

  // Canonical hardcoded numbers that used to be baked into dashboard.html.
  // We swap any .cur[data-nok="<value>"] that matches one of these for the
  // live KPI. This is a best-effort bridge; not every tile has a mapping.
  const CANONICAL_TO_KPI = {
    55430: 'revenueToday',
    47115: 'netRevenue',
     9200: 'netProfit',
    38800: 'breakEven',
  };

  function banner(message, tone){
    const existing = document.getElementById('ft-live-banner');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'ft-live-banner';
    const colors = {
      info:    { bg: 'var(--bluebg)',   bd: 'var(--blueborder)',  fg: 'var(--blue2)' },
      warn:    { bg: 'var(--amberbg)',  bd: 'var(--amberborder)', fg: 'var(--amber)' },
      success: { bg: 'var(--greenbg)',  bd: 'var(--greenborder)', fg: 'var(--green)' },
    }[tone] || { bg: 'var(--bg3)', bd: 'var(--b2)', fg: 'var(--t2)' };
    el.style.cssText = 'position:sticky;top:0;z-index:150;padding:8px 16px;font-size:12px;text-align:center;background:' + colors.bg + ';color:' + colors.fg + ';border-bottom:1px solid ' + colors.bd + ';font-family:var(--mono);';
    el.innerHTML = message;
    // Insert above the main content wrapper.
    document.body.insertAdjacentElement('afterbegin', el);
  }

  function applyLiveKpis(kpis){
    if (!kpis) return;
    let replaced = 0;
    document.querySelectorAll('.cur[data-nok]').forEach(el => {
      const v = parseFloat(el.dataset.nok);
      const kpiName = CANONICAL_TO_KPI[v];
      if (!kpiName) return;
      const live = kpis[kpiName];
      if (!Number.isFinite(live)) return;
      el.dataset.nok = String(live);
      el.dataset.live = '1';
      replaced++;
    });
    if (replaced && typeof FleetCurrency !== 'undefined' && FleetCurrency.rerender) FleetCurrency.rerender();
  }

  function freshnessBanner(counts, kpis){
    const dr = counts.drivers || 0;
    const vh = counts.vehicles || 0;
    const hasData = dr > 0 || vh > 0 || (kpis && (kpis.revenueToday > 0 || kpis.tripsToday > 0));
    if (!hasData){
      banner(
        'No fleet data yet. Import CSVs via <a href="#data-import" style="color:inherit;text-decoration:underline">Data Import</a> ' +
        'or POST to /api/import/* with an admin token. The numbers below are a static design snapshot, not real data.',
        'warn'
      );
    } else {
      const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      banner(
        'Live data: ' + dr + ' driver' + (dr===1?'':'s') + ' · ' + vh + ' vehicle' + (vh===1?'':'s') +
        ' · synced at ' + now +
        ' <a href="#" style="color:inherit;text-decoration:underline;margin-left:8px" onclick="event.preventDefault();window.FleetData&&window.FleetData.refresh().then(()=>location.reload())">Refresh</a>',
        'info'
      );
    }
  }

  function hook(){
    try { applyLiveKpis(window.FleetData.kpis); } catch(e){}
    try { freshnessBanner({ drivers: window.FleetData.drivers.length, vehicles: window.FleetData.vehicles.length }, window.FleetData.kpis); } catch(e){}
  }

  window.addEventListener('fleetdata:ready',   hook);
  window.addEventListener('fleetdata:updated', hook);
  // If FleetData was already loaded before this script ran, render now.
  if (window.FleetData && (window.FleetData.drivers.length || window.FleetData.vehicles.length)) hook();
  // Handle session expiry globally — one toast + bounce.
  window.addEventListener('fleetdata:unauthorized', () => {
    try { localStorage.removeItem('ft_session'); } catch(e){}
    window.location.href = '/login?error=unauthorized';
  });
})();
