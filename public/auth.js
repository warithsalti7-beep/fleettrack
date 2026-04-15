/**
 * FleetTrack Auth System v1.0
 * Shared across admin / driver / employee portals
 *
 * IMPORTANT: This is a FRONTEND-ONLY demo auth system.
 * In production, replace all localStorage logic with:
 *   - Backend JWT tokens (Node.js / Python / etc.)
 *   - Secure httpOnly cookies
 *   - Server-side session validation on every request
 *
 * Claude Code will wire this to a real backend.
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
            // Attach session info if we have one
            initialScope: (() => {
              try {
                const sess = JSON.parse(localStorage.getItem('ft_session') || 'null');
                return sess ? {
                  user: { id: sess.userId, email: sess.email, role: sess.role, username: sess.name },
                } : {};
              } catch(e){ return {}; }
            })(),
            // Keep release noise low; increase later when we want full replay
            tracesSampleRate: 0.1,
            replaysSessionSampleRate: 0,
            replaysOnErrorSampleRate: 1.0,
            ignoreErrors: [
              // Browser quirks that aren't actionable
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

  // ── Demo login accounts ─────────────────────────────────────────
  // Three generic role-test accounts. Names and avatars are neutral so
  // the UI never fakes a real driver. Real driver / employee logins
  // come from /api/users once the owner uploads the users CSV.
  const DEMO_USERS = [
    { id:'admin-1', email:'admin@fleettrack.no',    password:'Admin2024!',    name:'Fleet Admin',      role:'admin',    avatar:'FA', permissions:['all'] },
    { id:'emp-1',   email:'employee@fleettrack.no', password:'Employee2024!', name:'Dispatch Officer', role:'employee', avatar:'DO', permissions:['view:drivers','view:trips','view:zones','manage:dispatch','view:alerts'] },
    { id:'drv-1',   email:'driver@fleettrack.no',   password:'Driver2024!',   name:'Demo Driver',      role:'driver',   avatar:'DD' },
  ];

  // ── Session management ─────────────────────────────────────────────
  const SESSION_KEY = 'ft_session';
  const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

  // Admin can reassign a user's role at runtime via the Users & Permissions
  // page. Overrides live in localStorage keyed by user id. Applied when a
  // session is created and also when getAllUsers() / getUsersByRole() are read.
  function getRoleOverride(uid){
    try { return localStorage.getItem('ft_role_' + uid) || null; } catch(e){ return null; }
  }
  function setRoleOverride(uid, role){
    try {
      if (role) localStorage.setItem('ft_role_' + uid, role);
      else localStorage.removeItem('ft_role_' + uid);
    } catch(e){}
  }

  // Role definitions — what permissions each role defaults to.
  const ROLE_DEFAULT_PERMS = {
    admin:    ['all'],
    employee: [], // blank by default — admin assigns
    driver:   [], // drivers have fixed self-only access, perms ignored
  };

  function applyRoleOverride(user){
    const override = getRoleOverride(user.id);
    if (!override || override === user.role) return user;
    return {
      ...user,
      role: override,
      permissions: ROLE_DEFAULT_PERMS[override] !== undefined ? ROLE_DEFAULT_PERMS[override] : user.permissions,
    };
  }

  function saveSession(user) {
    // Honour admin role override at login-time too.
    const effective = applyRoleOverride(user);
    const session = {
      userId: effective.id,
      name:   effective.name,
      email:  effective.email,
      role:   effective.role,
      avatar: effective.avatar,
      permissions: effective.permissions || [],
      carId:  effective.carId  || null,
      brand:  effective.brand  || null,
      shift:  effective.shift  || null,
      loginAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL,
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch(e) {}
    return session;
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (Date.now() > s.expiresAt) { clearSession(); return null; }
      return s;
    } catch(e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
  }

  // ── Custom users (created by admin at runtime) ────────────────────
  // Stored in localStorage under 'ft_custom_users'. Merged with DEMO_USERS
  // on every read so newly-created users can log in without a rebuild.
  const CUSTOM_USERS_KEY = 'ft_custom_users';
  function loadCustomUsers(){
    try { return JSON.parse(localStorage.getItem(CUSTOM_USERS_KEY) || '[]') || []; }
    catch(e){ return []; }
  }
  function saveCustomUsers(list){
    try { localStorage.setItem(CUSTOM_USERS_KEY, JSON.stringify(list)); } catch(e){}
  }
  function allUsersRaw(){
    return [...DEMO_USERS, ...loadCustomUsers()];
  }
  function addCustomUser(u){
    // u: { name, email, password, role, avatar?, permissions? }
    if (!u || !u.email || !u.password) return { ok:false, error:'Email and password are required.' };
    if (!u.name) return { ok:false, error:'Name is required.' };
    if (!['admin','employee','driver'].includes(u.role)) return { ok:false, error:'Invalid role.' };
    if (allUsersRaw().find(x => x.email.toLowerCase() === u.email.toLowerCase())){
      return { ok:false, error:'A user with that email already exists.' };
    }
    const id = 'usr-' + Date.now().toString(36);
    const avatar = (u.name.split(/\s+/).map(p=>p[0]).join('').substring(0,2) || 'US').toUpperCase();
    const defaultPerms = u.role==='admin'?['all']:u.role==='employee'?[]:[];
    const rec = {
      id,
      name: u.name.trim(),
      email: u.email.trim().toLowerCase(),
      password: u.password,
      role: u.role,
      avatar: u.avatar || avatar,
      permissions: u.permissions || defaultPerms,
      carId: u.carId || null,
      brand: u.brand || null,
      shift: u.shift || null,
      createdAt: Date.now(),
      createdByAdmin: true,
    };
    const list = loadCustomUsers();
    list.push(rec);
    saveCustomUsers(list);
    return { ok:true, user: rec };
  }
  function removeCustomUser(userId){
    const list = loadCustomUsers().filter(u => u.id !== userId);
    saveCustomUsers(list);
    // Clean up any role / perm overrides for this user
    try {
      localStorage.removeItem('ft_perms_' + userId);
      localStorage.removeItem('ft_role_' + userId);
    } catch(e){}
    return { ok:true };
  }

  // ── Core auth functions ────────────────────────────────────────────
  function login(email, password) {
    const user = allUsersRaw().find(u =>
      u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!user) return { ok: false, error: 'Invalid email or password.' };
    const session = saveSession(user);
    return { ok: true, session };
  }

  function logout(redirectTo) {
    clearSession();
    window.location.href = redirectTo || '../login.html';
  }

  function requireAuth(allowedRoles, redirectTo) {
    const session = getSession();
    if (!session) {
      window.location.href = redirectTo || '../login.html';
      return null;
    }
    if (allowedRoles && !allowedRoles.includes(session.role)) {
      window.location.href = redirectTo || '../login.html?error=unauthorized';
      return null;
    }
    return session;
  }

  function hasPermission(permission) {
    const session = getSession();
    if (!session) return false;
    if (session.role === 'admin') return true;
    return session.permissions.includes(permission) || session.permissions.includes('all');
  }

  // ── Password helpers ───────────────────────────────────────────────
  function validatePassword(pw) {
    if (pw.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter.';
    if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
    return null;
  }

  // ── Get all users (admin only) — role overrides applied ───────────
  function getAllUsers() {
    return allUsersRaw().map(u => {
      const effective = applyRoleOverride(u);
      return { ...effective, password: '••••••••' };
    });
  }
  function getUsersByRole(role) { return getAllUsers().filter(u => u.role === role); }

  // ── Public API ─────────────────────────────────────────────────────
  return { login, logout, requireAuth, getSession, hasPermission, validatePassword, getAllUsers, getUsersByRole, setRoleOverride, getRoleOverride, addCustomUser, removeCustomUser };

})();

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
  // Norwegian style formatting with thin-space thousand separators
  function fmtNum(n){
    // Use 2 decimals for small absolute values (<10) so per-km / per-trip costs display sensibly
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
  // Apply immediately so there's no FOUC (flash of unstyled content)
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

// Export the nearest table within the same page/panel as the clicked button.
function exportNearestTable(btn, prefix){
  const scope = btn.closest('.page, .tab-panel, .card, section') || document.body;
  const table = scope.querySelector('table') || document.querySelector('.page.active table') || document.querySelector('table');
  const date = new Date().toISOString().slice(0,10);
  exportTableToCSV(table, (prefix||'export')+'-'+date+'.csv');
}

// Download a specific report as CSV (used from the Reports & Exports page).
// Handles the currency-format spans so exported numbers match the on-screen currency.
function reportDownload(tableSelector, filenamePrefix){
  const table = document.querySelector(tableSelector);
  if(!table){
    if(typeof Toast!=='undefined') Toast.error('Report source not found: '+tableSelector);
    else alert('Report not available');
    return;
  }
  // Force FleetCurrency to re-render any .cur spans inside the hidden table so the
  // CSV reflects the user's currently selected currency.
  if(typeof FleetCurrency!=='undefined' && typeof FleetCurrency.rerender==='function'){
    try{ FleetCurrency.rerender(); } catch(e){}
  }
  const date = new Date().toISOString().slice(0,10);
  exportTableToCSV(table, (filenamePrefix||'report')+'-'+date+'.csv');
}
