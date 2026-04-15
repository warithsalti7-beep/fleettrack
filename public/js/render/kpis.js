/**
 * KPI render module — fills every element marked `data-kpi="<name>"` or
 * `data-kpi-cur="<name>"` with live values from FleetState.
 *
 * Element contract:
 *   <span data-kpi="tripsToday">—</span>
 *   <span class="cur" data-kpi-cur="revenueToday" data-nok="0">—</span>
 *
 * The HTML is pure structure — no baked numbers. This module owns the
 * filling; FleetCurrency owns NOK/EUR formatting of the .cur spans.
 */
(function(){
  if (!window.FleetState) return;

  // Plain-text tiles. Each value is a formatter from state -> string.
  const TEXT_FORMATTERS = {
    revenueToday:   (s) => String(Math.round(s.kpis.revenueToday)),
    netRevenue:     (s) => String(Math.round(s.kpis.netRevenue)),
    netProfit:      (s) => String(Math.round(s.kpis.netProfit)),
    marginPct:      (s) => (s.kpis.marginPct || 0).toFixed(1) + '%',
    breakEven:      (s) => String(Math.round(s.kpis.breakEven)),
    tripsToday:     (s) => String(s.kpis.tripsToday),
    avgTripFare:    (s) => (s.kpis.avgTripFare || 0).toFixed(2),
    driversTotal:   (s) => String(s.kpis.driversTotal),
    driversActive:  (s) => String(s.kpis.driversActive),
    vehiclesTotal:  (s) => String(s.kpis.vehiclesTotal),
    vehiclesOnRoad: (s) => String(s.kpis.vehiclesOnRoad),
    vehiclesShop:   (s) => String(s.kpis.vehiclesShop),
    vehiclesIdle:   (s) => String(s.kpis.vehiclesIdle),
    // Composite / formatted displays
    driversActiveRatio:  (s) => s.kpis.driversActive + ' / ' + s.kpis.driversTotal,
    vehiclesOnRoadRatio: (s) => s.kpis.vehiclesOnRoad + ' / ' + s.kpis.vehiclesTotal,
  };

  // Currency tiles — the target value is a NOK amount which FleetCurrency
  // then formats as NOK or EUR depending on user preference.
  const CUR_FORMATTERS = {
    revenueToday:   (s) => s.kpis.revenueToday,
    netRevenue:     (s) => s.kpis.netRevenue,
    netProfit:      (s) => s.kpis.netProfit,
    breakEven:      (s) => s.kpis.breakEven,
    avgTripFare:    (s) => s.kpis.avgTripFare,
  };

  function render(state){
    // Text tiles
    document.querySelectorAll('[data-kpi]').forEach(el => {
      const name = el.getAttribute('data-kpi');
      const fn = TEXT_FORMATTERS[name];
      if (fn) el.textContent = fn(state);
    });

    // Currency tiles. Update data-nok so FleetCurrency.rerender picks it up.
    let curChanged = 0;
    document.querySelectorAll('[data-kpi-cur]').forEach(el => {
      const name = el.getAttribute('data-kpi-cur');
      const fn = CUR_FORMATTERS[name];
      if (!fn) return;
      const v = fn(state);
      if (!Number.isFinite(v)) return;
      el.setAttribute('data-nok', String(v));
      curChanged++;
    });
    if (curChanged && typeof FleetCurrency !== 'undefined' && FleetCurrency.rerender) {
      FleetCurrency.rerender();
    }
  }

  window.FleetState.subscribe(render);
})();
