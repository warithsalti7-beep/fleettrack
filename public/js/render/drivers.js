/**
 * Driver table render module.
 *
 * Owns the two driver tables in dashboard.html:
 *   #roster-tbody   — Driver Roster & Profiles
 *   #perf-tbody     — Driver Performance leaderboard
 *
 * Each row is built from FleetState.drivers (which FleetState already
 * merged with /api/stats/per-driver so perf columns are live).
 */
(function(){
  if (!window.FleetState) return;

  function tier(s){ return s>=80?['Top','b-green']:s>=60?['Avg','b-blue']:['Low','b-red']; }
  function scColor(s){ return s>=80?'#10b981':s>=60?'#3b82f6':'#ef4444'; }

  function emptyRow(cols, msg){
    return `<tr><td colspan="${cols}" style="text-align:center;color:var(--t3);font-size:13px;padding:var(--s7)">${msg}</td></tr>`;
  }

  function fmtCur(n){
    if (!Number.isFinite(n) || n === 0) return '—';
    return `<span class="cur" data-nok="${n}">${(typeof FleetCurrency!=='undefined'?FleetCurrency.format(n):n)}</span>`;
  }

  function roster(drivers){
    const el = document.getElementById('roster-tbody');
    if (!el) return;
    if (!drivers.length) { el.innerHTML = emptyRow(10, 'No drivers yet. Import from CSV via Data Import.'); return; }
    el.innerHTML = drivers.map(d => {
      const s = d.score || 0;
      const [, tc] = tier(s);
      const shiftBadge = d.shift==='AM'?'<span class="badge b-blue">AM</span>':d.shift==='PM'?'<span class="badge b-purple">PM</span>':'<span class="badge b-gray">—</span>';
      const sharedCar = d.car && drivers.filter(x=>x.car===d.car).length>1;
      const carCell = sharedCar
        ? `<strong style="color:var(--amber)">${d.car}</strong> <span class="badge b-amber">2-shift</span>`
        : `<strong>${d.car||'—'}</strong>`;
      const scoreBadge = s > 0 ? `<span class="badge ${tc}">${s}</span>` : '<span style="color:var(--t3)">—</span>';
      const statusBadge = d.status
        ? `<span class="badge b-gray">${d.status}</span>`
        : '<span class="badge b-gray">—</span>';
      return `<tr>
        <td>${d.r}</td>
        <td><strong>${d.n}</strong></td>
        <td>${carCell}</td>
        <td>${d.brand||'—'}</td>
        <td>${shiftBadge}</td>
        <td>${d.comm?d.comm+'%':'—'}</td>
        <td><span class="badge b-gray">—</span></td>
        <td>${d.zone||'—'}</td>
        <td>${scoreBadge}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');
  }

  function perf(drivers){
    const el = document.getElementById('perf-tbody');
    if (!el) return;
    if (!drivers.length) { el.innerHTML = emptyRow(14, 'No drivers yet.'); return; }
    el.innerHTML = drivers.map(d => {
      const s = d.score || 0;
      const [t, tc] = tier(s);
      const cls = s > 0 && s < 40 ? ' class="tr-red"' : s > 0 && s < 60 ? ' class="tr-amber"' : '';
      const shiftBadge = d.shift==='AM'?'<span class="badge b-blue">AM</span>':d.shift==='PM'?'<span class="badge b-purple">PM</span>':'<span class="badge b-gray">—</span>';
      const sharedCar = d.car && drivers.filter(x=>x.car===d.car).length>1;
      const carCell = sharedCar ? `<span style="color:var(--amber);font-weight:600">${d.car}</span>` : (d.car||'—');
      const scoreCell = s > 0
        ? `<div class="sbar-wrap"><span class="sbar-num">${s}</span><div class="sbar"><div class="sbar-fill" style="width:${s}%;background:${scColor(s)}"></div></div></div>`
        : '<span style="color:var(--t3)">—</span>';
      const tierCell = s > 0 ? `<span class="badge ${tc}">${t}</span>` : '—';
      return `<tr${cls}>
        <td>${d.r}</td>
        <td>${d.n}</td>
        <td>${carCell}</td>
        <td>${shiftBadge}</td>
        <td>${fmtCur(d.rev)}</td>
        <td>${fmtCur(d.revhr)}</td>
        <td>${d.triphr?d.triphr.toFixed(1):'—'}</td>
        <td>${d.acc?d.acc+'%':'—'}</td>
        <td>${d.can?d.can+'%':'—'}</td>
        <td>${d.idle?d.idle+'%':'—'}</td>
        <td>${d.util?d.util+'%':'—'}</td>
        <td>${scoreCell}</td>
        <td>${tierCell}</td>
        <td>—</td>
      </tr>`;
    }).join('');
  }

  window.FleetState.subscribe((state) => {
    try { roster(state.drivers); } catch(e){ console.error('drivers roster:', e); }
    try { perf(state.drivers); }   catch(e){ console.error('drivers perf:', e); }
    if (typeof FleetCurrency !== 'undefined' && FleetCurrency.rerender) FleetCurrency.rerender();
  });
})();
