/**
 * Trip log render module — paints #trip-log-tbody from live /api/trips.
 * Pulls the most recent 50 trips; renders status badges + fare.
 */
(function(){
  if (!window.FleetState) return;

  function render(state){
    const el = document.getElementById('trip-log-tbody');
    if (!el) return;
    const trips = state.trips || [];
    if (state.loading && !state.lastLoadedAt) {
      el.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--t3);font-size:13px;padding:var(--s7)">Loading…</td></tr>';
      return;
    }
    if (!trips.length) {
      el.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--t3);font-size:13px;padding:var(--s7)">No trips yet. Import from CSV or create one from the dispatch page.</td></tr>';
      return;
    }
    el.innerHTML = trips.map(t => {
      const when = t.startedAt || t.createdAt;
      const d = when ? new Date(when) : null;
      const time = d ? String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') : '—';
      const statusBadge =
        t.status === 'COMPLETED'   ? '<span class="badge b-green">Done</span>' :
        t.status === 'CANCELLED'   ? '<span class="badge b-gray">Cancelled</span>' :
        t.status === 'IN_PROGRESS' ? '<span class="badge b-blue">Live</span>' :
                                     `<span class="badge b-gray">${t.status||'—'}</span>`;
      const fareCell = t.fare != null
        ? `<span class="cur" data-nok="${t.fare}">${typeof FleetCurrency!=='undefined'?FleetCurrency.format(t.fare):t.fare}</span>`
        : '—';
      const kmCell = t.distance != null ? Number(t.distance).toFixed(1) + 'km' : '—';
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px">${String(t.id||'').slice(0,8)}</td>
        <td>${(t.driver && t.driver.name) || '—'}</td>
        <td>${(t.vehicle && t.vehicle.plateNumber) || '—'}</td>
        <td><span class="badge b-gray">—</span></td>
        <td>${time}</td>
        <td>${(t.pickupAddress||'—').replace(/</g,'&lt;')}</td>
        <td>${(t.dropoffAddress||'—').replace(/</g,'&lt;')}</td>
        <td>${kmCell}</td>
        <td style="color:var(--green)">${fareCell}</td>
        <td>—</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');
    if (typeof FleetCurrency !== 'undefined' && FleetCurrency.rerender) FleetCurrency.rerender();
  }

  window.FleetState.subscribe(render);
})();
