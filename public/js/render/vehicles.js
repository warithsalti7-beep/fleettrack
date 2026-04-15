/**
 * Vehicle tables render module.
 *
 * Owns:
 *   #veh-perf-tbody — Vehicle Performance (with profit / cpkm / utilisation)
 *   #fleet-reg-tbody — Fleet Register (register-style listing)
 */
(function(){
  if (!window.FleetState) return;

  function vstatus(p){
    return p > 100 ? ['Top','b-green']
         : p > 30  ? ['Avg','b-blue']
         : p > 0   ? ['Watch','b-amber']
                   : ['Loss','b-red'];
  }
  function empty(cols, msg){
    return `<tr><td colspan="${cols}" style="text-align:center;color:var(--t3);font-size:13px;padding:var(--s7)">${msg}</td></tr>`;
  }
  function fmtCur(n){
    if (!Number.isFinite(n) || n === 0) return '—';
    return `<span class="cur" data-nok="${n}">${(typeof FleetCurrency!=='undefined'?FleetCurrency.format(n):n)}</span>`;
  }

  function perf(vehicles){
    const el = document.getElementById('veh-perf-tbody');
    if (!el) return;
    if (!vehicles.length) { el.innerHTML = empty(11, 'No vehicles yet. Import from CSV.'); return; }
    el.innerHTML = vehicles.map(v => {
      const [st, sc] = vstatus(v.profit);
      const cls = (v.status === 'no-driver' || v.status === 'workshop' || v.profit < 0) ? ' class="tr-red"' : '';
      const shiftBadge = v.shifts===2?'<span class="badge b-amber">2-shift</span>':v.shifts===0?'<span class="badge b-red">Idle</span>':'<span class="badge b-gray">1-shift</span>';
      const driverCell = v.drivers && v.drivers.length ? v.drivers.join('<br>') : '<span style="color:var(--t3)">—</span>';
      const profitCell = v.profit !== 0
        ? `<span style="color:var(--${v.profit>=0?'green':'red'})">${fmtCur(v.profit)}</span>`
        : '—';
      return `<tr${cls}>
        <td><strong>${v.id}</strong></td>
        <td>${v.make||'—'} ${v.model||''}</td>
        <td>${v.fuel||'—'}</td>
        <td>${shiftBadge}</td>
        <td style="font-size:11px">${driverCell}</td>
        <td>${fmtCur(v.rev)}</td>
        <td>${profitCell}</td>
        <td>${fmtCur(v.cpkm)}</td>
        <td>${v.tkm>0?v.tkm+'km':'—'}</td>
        <td>${v.down||0}%</td>
        <td><span class="badge ${sc}">${st}</span></td>
      </tr>`;
    }).join('');
  }

  function register(vehicles){
    const el = document.getElementById('fleet-reg-tbody');
    if (!el) return;
    if (!vehicles.length) { el.innerHTML = empty(9, 'No vehicles yet.'); return; }
    const statusMap = {
      active:      '<span class="badge b-green">Active</span>',
      shared:      '<span class="badge b-amber">2-shift</span>',
      workshop:    '<span class="badge b-amber">Workshop</span>',
      'no-driver': '<span class="badge b-red">No Driver</span>',
    };
    el.innerHTML = vehicles.map(v => {
      const cls = v.status==='no-driver' ? ' class="tr-red"' : v.status==='workshop' ? ' class="tr-amber"' : '';
      const driverCell = v.drivers && v.drivers.length ? v.drivers.join(' / ') : '<span style="color:var(--t3)">—</span>';
      const shiftBadge = v.shifts===2?'<span class="badge b-amber">2-shift</span>':v.shifts===0?'<span class="badge b-red">Unassigned</span>':'<span class="badge b-gray">1-shift</span>';
      const statusBadge = statusMap[v.status] || `<span class="badge b-gray">${v.status||'—'}</span>`;
      const profitCell = v.profit !== 0
        ? `<span style="color:var(--${v.profit>=0?'green':'red'})">${fmtCur(v.profit)}</span>`
        : '—';
      return `<tr${cls}>
        <td><strong>${v.id}</strong></td>
        <td>${v.make||'—'} ${v.model||''}</td>
        <td>${v.fuel||'—'}</td>
        <td>${shiftBadge}</td>
        <td style="font-size:11px">${driverCell}</td>
        <td>${fmtCur(v.rev)}</td>
        <td>${profitCell}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');
  }

  window.FleetState.subscribe((state) => {
    try { perf(state.vehicles); }     catch(e){ console.error('vehicles perf:', e); }
    try { register(state.vehicles); } catch(e){ console.error('vehicles register:', e); }
    if (typeof FleetCurrency !== 'undefined' && FleetCurrency.rerender) FleetCurrency.rerender();
  });
})();
