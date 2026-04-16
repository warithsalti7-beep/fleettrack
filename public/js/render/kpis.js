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

  // Helpers. Each returns "—" when the underlying KPI is 0 or missing,
  // so empty-state reads as "no data" not "zero performance".
  const dash = (v, fmt) => (Number.isFinite(v) && v !== 0) ? fmt(v) : '—';
  const pct1 = (n) => n.toFixed(1) + '%';
  const one  = (n) => n.toFixed(1);
  const int0 = (n) => String(Math.round(n));

  // Plain-text tiles. Each value is a formatter from state -> string.
  const TEXT_FORMATTERS = {
    // Counts + money (zero allowed, shown as numeric)
    revenueToday:   (s) => int0(s.kpis.revenueToday || 0),
    netRevenue:     (s) => int0(s.kpis.netRevenue || 0),
    netProfit:      (s) => int0(s.kpis.netProfit || 0),
    marginPct:      (s) => pct1(s.kpis.marginPct || 0),
    breakEven:      (s) => int0(s.kpis.breakEven || 0),
    tripsToday:     (s) => String(s.kpis.tripsToday || 0),
    avgTripFare:    (s) => (s.kpis.avgTripFare || 0).toFixed(2),
    driversTotal:   (s) => String(s.kpis.driversTotal || 0),
    driversActive:  (s) => String(s.kpis.driversActive || 0),
    vehiclesTotal:  (s) => String(s.kpis.vehiclesTotal || 0),
    vehiclesOnRoad: (s) => String(s.kpis.vehiclesOnRoad || 0),
    vehiclesShop:   (s) => String(s.kpis.vehiclesShop || 0),
    vehiclesIdle:   (s) => String(s.kpis.vehiclesIdle || 0),
    // Composite displays
    driversActiveRatio:  (s) => (s.kpis.driversActive || 0) + ' / ' + (s.kpis.driversTotal || 0),
    vehiclesOnRoadRatio: (s) => (s.kpis.vehiclesOnRoad || 0) + ' / ' + (s.kpis.vehiclesTotal || 0),
    // Performance KPIs — dash when zero so empty fleets don't show fake 0%
    acceptanceRate:       (s) => dash(s.kpis.acceptanceRate, pct1),
    cancellationRate:     (s) => dash(s.kpis.cancellationRate, pct1),
    tripsPerHour:         (s) => dash(s.kpis.tripsPerHour, one),
    utilizationPct:       (s) => dash(s.kpis.utilizationPct, pct1),
    idlePct:              (s) => dash(s.kpis.idlePct, pct1),
    timeBetweenTripsMin:  (s) => dash(s.kpis.timeBetweenTripsMin, (n) => one(n) + ' min'),
    avgTripDistanceKm:    (s) => dash(s.kpis.avgTripDistanceKm, (n) => one(n) + ' km'),
    peakCoverage:         (s) => s.kpis.peakCoverage || '—',
  };

  // Currency tiles — the target value is a NOK amount which FleetCurrency
  // then formats as NOK or EUR depending on user preference.
  const CUR_FORMATTERS = {
    revenueToday:   (s) => s.kpis.revenueToday,
    netRevenue:     (s) => s.kpis.netRevenue,
    netProfit:      (s) => s.kpis.netProfit,
    breakEven:      (s) => s.kpis.breakEven,
    avgTripFare:    (s) => s.kpis.avgTripFare,
    revenuePerHour: (s) => s.kpis.revenuePerHour,
  };

  function render(state){
    document.querySelectorAll('[data-kpi]').forEach(el => {
      const name = el.getAttribute('data-kpi');
      const fn = TEXT_FORMATTERS[name];
      if (fn) el.textContent = fn(state);
    });

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
