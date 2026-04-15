/**
 * FleetTrack Auth System v2.0
 *
 * v1 stored passwords + sessions in localStorage (demo only, trivially
 * bypassable). v2 is a thin client over real server endpoints:
 *
 *   POST /api/auth/login   { email, password } -> Set-Cookie ft_session
 *   POST /api/auth/logout                      -> clears cookie
 *   GET  /api/auth/me                          -> { user } or 401
 *
 * A read-only *mirror* of the session is cached in localStorage so that
 * page-top `FleetAuth.getSession()` stays synchronous (dashboard/driver
 * pages depend on that). The mirror is re-validated against the server
 * on every page load via refreshSession(); if the server says the cookie
 * is gone, the mirror is cleared and the user is bounced to /login.
 *
 * This file also hosts: Toast, FleetCurrency, FleetTheme, CSV helpers.
 * Kept in one file so every page gets them with a single <script> tag.
 */

// ── Sentry error monitoring (loads async on first error) ───────────────
(function loadSentry(){
  if (window.__sentryLoaded) return;
  window.__sentryLoaded = true;
  const s = document.createElement('script');
  s.src = 'https://js.sentry-cdn.com/42763199881812ceccc81884f1381002.min.js';
  s.crossOrigin = 'anonymous';
  s.async = true;
  s.onload = () => {
    try {
      if (window.Sentry && window.Sentry.init) {
        window.Sentry.onLoad(() => {
          window.Sentry.init({
            dsn: 'https://42763199881812ceccc81884f1381002@o4511217410048000.ingest.us.sentry.io/4511217411686400',
            environment: location.hostname === 'localhost' ? 'development' : 'production',
            initialScope: (() => {
              try {
                const sess = JSON.parse(localStorage.getItem('ft_session') || 'null');
                return sess ? {
                  user: { id: sess.userId, email: sess.email, role: sess.role, username: sess.name },
                } : {};
              } catch(e){ return {}; }
            })(),
            tracesSampleRate: 0.1,
            replaysSessionSampleRate: 0,
            replaysOnErrorSampleRate: 1.0,
            ignoreErrors: [
              'ResizeObserver loop limit exceeded',
              'Non-Error promise rejection captured',
            ],
          });
        });
      }
    } catch(e){}
  };
  document.head.appendChild(s);
})();

const FleetAuth = (() => {

  // Mirror key — plain sessionless snapshot of the server session so page
  // guards can run synchronously. Security is enforced by the server
  // ft_session httpOnly cookie; the mirror is advisory only.
  const SESSION_KEY = 'ft_session';

  // ── Role defaults (permissions are UI affordances, real checks on server)
  const ROLE_DEFAULT_PERMS = {
    admin:    ['all'],
    employee: [],
    driver:   [],
  };

  function initialsOf(nameOrEmail){
    if (!nameOrEmail) return 'FT';
    const parts = String(nameOrEmail).split(/[\s@._-]+/).filter(Boolean);
    const first = parts[0] ? parts[0][0] : '';
    const last = parts.length > 1 ? parts[parts.length-1][0] : (parts[0] ? parts[0][1] : '');
    return (first + (last || '')).toUpperCase().slice(0, 2) || 'FT';
  }

  function mirrorFromUser(u){
    if (!u) return null;
    const permOverride = (()=>{ try { return JSON.parse(localStorage.getItem('ft_perms_'+u.id) || 'null'); } catch(e){ return null; } })();
    return {
      userId: u.id,
      name:   u.name || u.email,
      email:  u.email,
      role:   u.role,
      avatar: initialsOf(u.name || u.email),
      permissions: permOverride || (ROLE_DEFAULT_PERMS[u.role] || []),
      // Driver-only metadata that legacy UI code reads; empty until
      // server /api/users exposes it.
      carId:  null, brand: null, shift: null,
      loginAt: Date.now(),
    };
  }

  function readMirror(){
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch(e){ return null; }
  }
  function writeMirror(m){
    try {
      if (m) localStorage.setItem(SESSION_KEY, JSON.stringify(m));
      else   localStorage.removeItem(SESSION_KEY);
    } catch(e){}
  }

  // ── Login / logout ────────────────────────────────────────────────
  async function login(email, password){
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      if (r.status === 429) {
        let j = {}; try { j = await r.json(); } catch(e){}
        const wait = j.retryAfterSec ? (' Try again in '+j.retryAfterSec+'s.') : '';
        return { ok: false, error: 'Too many login attempts.' + wait };
      }
      if (r.status === 401) return { ok: false, error: 'Invalid email or password.' };
      if (!r.ok) return { ok: false, error: 'Login failed. Please try again.' };
      const data = await r.json();
      const mirror = mirrorFromUser(data.user);
      writeMirror(mirror);
      return { ok: true, session: mirror };
    } catch (e) {
      return { ok: false, error: 'Network error. Check your connection and try again.' };
    }
  }

  async function logout(redirectTo){
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch(e){}
    writeMirror(null);
    try { localStorage.removeItem('ft_preview_as'); } catch(e){}
    window.location.href = redirectTo || '/login';
  }

  // ── Session access ───────────────────────────────────────────────
  function getSession(){ return readMirror(); }

  async function refreshSession(){
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) { writeMirror(null); return null; }
      if (!r.ok) return readMirror(); // transient: keep mirror
      const { user } = await r.json();
      const m = mirrorFromUser(user);
      writeMirror(m);
      return m;
    } catch(e){
      return readMirror();
    }
  }

  function requireAuth(allowedRoles, redirectTo){
    const mirror = readMirror();
    const bounce = (why) => {
      const url = redirectTo || ('/login' + (why ? '?error='+encodeURIComponent(why) : ''));
      window.location.href = url;
    };
    if (!mirror) { bounce(); return null; }
    if (allowedRoles && !allowedRoles.includes(mirror.role)) { bounce('unauthorized'); return null; }

    // Background validation — if the server disagrees, redirect.
    refreshSession().then((fresh) => {
      if (!fresh) { bounce(); return; }
      if (allowedRoles && !allowedRoles.includes(fresh.role)) { bounce('unauthorized'); }
    }).catch(() => { /* keep mirror on transient error */ });

    return mirror;
  }

  function hasPermission(permission){
    const s = readMirror();
    if (!s) return false;
    if (s.role === 'admin') return true;
    return (s.permissions || []).includes(permission) || (s.permissions || []).includes('all');
  }

  function validatePassword(pw){
    if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter.';
    if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
    return null;
  }

  // ── Admin-only user management (server-backed) ──────────────────
  // Cache so legacy synchronous call sites (dashboard.html admin panel)
  // don't have to be rewritten as async. hydrateUsers() runs on demand
  // and fires an `auth:users:updated` event once the list is fresh.
  let _usersCache = [];
  let _usersHydrated = false;
  let _hydrating = null;

  function mapServerUser(u){
    // Legacy UI expects an `avatar` field (initials) and a permissions list.
    const permOverride = (()=>{ try { return JSON.parse(localStorage.getItem('ft_perms_'+u.id) || 'null'); } catch(e){ return null; } })();
    return {
      id: u.id,
      email: u.email,
      name: u.name || u.email,
      role: u.role,
      avatar: initialsOf(u.name || u.email),
      permissions: permOverride || (ROLE_DEFAULT_PERMS[u.role] || []),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || null,
      carId: null, brand: null, shift: null,
    };
  }

  function hydrateUsers(force){
    if (_hydrating && !force) return _hydrating;
    _hydrating = fetch('/api/users', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        _usersCache = Array.isArray(list) ? list.map(mapServerUser) : [];
        _usersHydrated = true;
        try { window.dispatchEvent(new CustomEvent('auth:users:updated', { detail: { count: _usersCache.length } })); } catch(e){}
        return _usersCache;
      })
      .catch(() => _usersCache)
      .finally(() => { _hydrating = null; });
    return _hydrating;
  }

  function getAllUsers(){
    if (!_usersHydrated) hydrateUsers();
    return _usersCache.slice();
  }
  function getUsersByRole(role){
    if (!_usersHydrated) hydrateUsers();
    return _usersCache.filter(u => u.role === role);
  }

  async function addCustomUser(u){
    if (!u || !u.email || !u.password) return { ok:false, error:'Email and password are required.' };
    if (!u.name) return { ok:false, error:'Name is required.' };
    if (!['admin','employee','driver'].includes(u.role)) return { ok:false, error:'Invalid role.' };
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(u),
      });
      if (r.ok) { const user = await r.json(); return { ok: true, user }; }
      let detail = ''; try { detail = (await r.json()).detail || ''; } catch(e){}
      return { ok: false, error: detail || ('Request failed ('+r.status+')') };
    } catch(e){ return { ok:false, error:'Network error.' }; }
  }

  async function removeCustomUser(userId){
    try {
      const r = await fetch('/api/users/' + encodeURIComponent(userId), {
        method: 'DELETE', credentials: 'same-origin',
      });
      return { ok: r.ok || r.status === 204 };
    } catch(e){ return { ok:false }; }
  }

  // ── Role override (local-only; server role is authoritative) ────
  function setRoleOverride(uid, role){
    // v2 no longer supports client-side role overrides — use
    // PATCH /api/users/:id { role } instead. Kept as a no-op so legacy
    // UI code doesn't throw; returns a descriptive warning.
    if (typeof Toast !== 'undefined') {
      Toast.warning('Role changes are saved via server — use the Edit button.');
    }
    return false;
  }
  function getRoleOverride(){ return null; }

  return {
    login, logout, getSession, refreshSession, requireAuth, hasPermission, validatePassword,
    getAllUsers, getUsersByRole, hydrateUsers, addCustomUser, removeCustomUser,
    setRoleOverride, getRoleOverride,
  };

})();

// On first load, sync the mirror with the server so stale mirrors from
// v1 get cleared before any page-guard runs. Only fires when there is a
// mirror present (i.e. we're potentially already "logged in").
if (typeof FleetAuth !== 'undefined' && typeof window !== 'undefined') {
  const hasMirror = (() => { try { return !!localStorage.getItem('ft_session'); } catch(e){ return false; } })();
  if (hasMirror) { FleetAuth.refreshSession().catch(() => {}); }
}

// ── Toast notification system ──────────────────────────────────────
const Toast = (() => {
  let container;
  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }
  function show(msg, type = 'info', duration = 4000) {
    const icons = { success:'✓', error:'✗', warning:'⚠', info:'ℹ' };
    const colors = { success:'var(--green)', error:'var(--red)', warning:'var(--amber)', info:'var(--blue2)' };
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span style="color:${colors[type]};font-size:16px;flex-shrink:0">${icons[type]}</span><span style="flex:1">${msg}</span><button onclick="this.closest('.toast').remove()" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:16px;padding:0;line-height:1">×</button>`;
    getContainer().appendChild(t);
    if (duration > 0) {
      setTimeout(() => {
        t.classList.add('leaving');
        setTimeout(() => t.remove(), 280);
      }, duration);
    }
    return t;
  }
  return {
    success: (msg, d) => show(msg, 'success', d),
    error:   (msg, d) => show(msg, 'error', d),
    warning: (msg, d) => show(msg, 'warning', d),
    info:    (msg, d) => show(msg, 'info', d),
  };
})();

// ── Currency (NOK <-> EUR) ────────────────────────────────────────────────
const FleetCurrency=(()=>{
  const KEY='ft_currency',RATE=0.087;
  const get=()=>{try{return localStorage.getItem(KEY)||'NOK';}catch(e){return 'NOK';}};
  const set=c=>{try{localStorage.setItem(KEY,c);}catch(e){}};
  function fmtNum(n){
    const abs=Math.abs(n);
    if(abs>0 && abs<10) return n.toFixed(2).replace('.',',');
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'\u202F');
  }
  function fmtNOK(n){return fmtNum(n)+'\u00a0kr';}
  function fmtEUR(n){const abs=Math.abs(n);if(abs>0 && abs<10) return '\u20ac'+n.toFixed(2);return '\u20ac'+(Math.round(n)).toLocaleString('en-US');}
  function format(nok){const n=parseFloat(nok);if(isNaN(n))return '';if(get()==='EUR'){const e=n*RATE;return (e<0?'\u2212':'')+fmtEUR(Math.abs(e));}return (n<0?'\u2212':'')+fmtNOK(Math.abs(n));}
  function formatCompact(nok){if(get()==='EUR'){const e=Math.round(nok*RATE);return '\u20ac'+(Math.abs(e)>=1000?(e/1000).toFixed(1)+'k':e);}return (Math.abs(nok)>=1000?(nok/1000).toFixed(1)+'k':Math.round(nok))+'\u00a0kr';}
  function rerender(){
    document.querySelectorAll('.cur').forEach(el=>{
      const nok=parseFloat(el.dataset.nok);
      if(!isNaN(nok)) el.textContent = format(nok);
    });
  }
  const toggle=()=>{set(get()==='NOK'?'EUR':'NOK');rerender();const b=document.getElementById('ft-cur-btn');if(b)b.innerHTML=get()==='NOK'?'NOK \u2192 \u20ac':'\u20ac \u2192 NOK';};
  function injectToggle(){
    if(document.getElementById('ft-cur-btn'))return;
    const cur=get(),btn=document.createElement('button');
    btn.id='ft-cur-btn';btn.title='Switch currency';
    btn.innerHTML=cur==='NOK'?'NOK \u2192 \u20ac':'\u20ac \u2192 NOK';
    btn.style.cssText='position:fixed;bottom:70px;right:14px;z-index:9999;background:var(--bg3);border:1px solid var(--b2);border-radius:20px;color:var(--t2);font-size:11.5px;font-weight:700;font-family:var(--mono);padding:5px 12px;cursor:pointer;box-shadow:var(--shadow-sm);transition:border-color .15s,color .15s';
    btn.onmouseover=()=>{btn.style.borderColor='var(--blue)';btn.style.color='var(--blue2)';};
    btn.onmouseout=()=>{btn.style.borderColor='var(--b2)';btn.style.color='var(--t2)';};
    btn.onclick=toggle;document.body.appendChild(btn);
  }
  return{get,set,toggle,format,formatCompact,injectToggle,rerender};
})();

// ── Theme (dark / light) ────────────────────────────────────────────────
const FleetTheme = (()=>{
  const KEY = 'ft_theme';
  const get = () => { try { return localStorage.getItem(KEY) || 'dark'; } catch(e){ return 'dark'; } };
  const set = (t) => {
    try { localStorage.setItem(KEY, t); } catch(e){}
    document.documentElement.setAttribute('data-theme', t);
  };
  const toggle = () => { set(get()==='dark' ? 'light' : 'dark'); const b=document.getElementById('ft-theme-btn'); if(b) b.textContent = get()==='dark' ? '☾' : '☀'; };
  function apply(){ document.documentElement.setAttribute('data-theme', get()); }
  function injectToggle(){
    if (document.getElementById('ft-theme-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ft-theme-btn';
    btn.title = 'Switch theme (dark / light)';
    btn.setAttribute('aria-label','Toggle theme');
    btn.textContent = get() === 'dark' ? '☾' : '☀';
    btn.style.cssText = 'position:fixed;bottom:70px;right:64px;z-index:9999;background:var(--bg3);border:1px solid var(--b2);border-radius:50%;color:var(--t2);font-size:14px;font-weight:700;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--shadow-sm);transition:border-color .15s,color .15s';
    btn.onmouseover = () => { btn.style.borderColor='var(--blue)'; btn.style.color='var(--blue2)'; };
    btn.onmouseout  = () => { btn.style.borderColor='var(--b2)';  btn.style.color='var(--t2)'; };
    btn.onclick = toggle;
    document.body.appendChild(btn);
  }
  apply();
  return { get, set, toggle, apply, injectToggle };
})();

// ── CSV export helper ────────────────────────────────────────────────
function exportTableToCSV(tableSelector, filename){
  const table = typeof tableSelector==='string' ? document.querySelector(tableSelector) : tableSelector;
  if(!table) return (typeof Toast!=='undefined' && Toast.error) ? Toast.error('No table found to export') : alert('No table');
  const rows = [...table.querySelectorAll('tr')].map(tr =>
    [...tr.querySelectorAll('th,td')].map(c => {
      const t = c.innerText.replace(/\s+/g,' ').trim().replace(/"/g,'""');
      return /[",\n]/.test(t) ? `"${t}"` : t;
    }).join(',')
  ).join('\n');
  const blob = new Blob([rows], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'export.csv';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{a.remove(); URL.revokeObjectURL(url);}, 100);
  if(typeof Toast!=='undefined') Toast.success('Exported: '+a.download);
}

function exportNearestTable(btn, prefix){
  const scope = btn.closest('.page, .tab-panel, .card, section') || document.body;
  const table = scope.querySelector('table') || document.querySelector('.page.active table') || document.querySelector('table');
  const date = new Date().toISOString().slice(0,10);
  exportTableToCSV(table, (prefix||'export')+'-'+date+'.csv');
}

function reportDownload(tableSelector, filenamePrefix){
  const table = document.querySelector(tableSelector);
  if(!table){
    if(typeof Toast!=='undefined') Toast.error('Report source not found: '+tableSelector);
    else alert('Report not available');
    return;
  }
  if(typeof FleetCurrency!=='undefined' && typeof FleetCurrency.rerender==='function'){
    try{ FleetCurrency.rerender(); } catch(e){}
  }
  const date = new Date().toISOString().slice(0,10);
  exportTableToCSV(table, (filenamePrefix||'report')+'-'+date+'.csv');
}
