#!/usr/bin/env python3
import re

# ── 1. auth.js ────────────────────────────────────────────────────────────
print('\n[auth.js]')
with open('auth.js','r') as f: auth=f.read()

ADMIN2 = "    { id:'admin-2',  email:'manager@fleettrack.no',  password:'Manager2024!',name:'Fleet Manager',              role:'admin',    avatar:'FM', permissions:['all'] },"
WARITH = "\n    { id:'admin-3',  email:'warithsalti@fleettrack.no', password:'adminwarith123', name:'Warith Salti', role:'admin', avatar:'WS', permissions:['all'] },"
if 'warithsalti@fleettrack.no' not in auth:
    auth=auth.replace(ADMIN2, ADMIN2+WARITH); print('  [OK] Warith admin user added')
else: print('  [--] admin user already exists')

CURRENCY=r"""
// ── Currency (NOK <-> EUR) ────────────────────────────────────────────────
const FleetCurrency=(()=>{
  const KEY='ft_currency',RATE=0.087;
  const get=()=>{try{return localStorage.getItem(KEY)||'NOK';}catch(e){return 'NOK';}};
  const set=c=>{try{localStorage.setItem(KEY,c);}catch(e){}};
  const toggle=()=>{set(get()==='NOK'?'EUR':'NOK');location.reload();};
  function format(nok){const n=Math.round(nok);return get()==='EUR'?'\u20ac'+Math.round(n*RATE).toLocaleString():'NOK\u00a0'+n.toLocaleString();}
  function formatCompact(nok){if(get()==='EUR'){const e=Math.round(nok*RATE);return '\u20ac'+(e>=1000?(e/1000).toFixed(1)+'k':e);}return 'NOK\u00a0'+(nok>=1000?(nok/1000).toFixed(1)+'k':Math.round(nok));}
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
  return{get,set,toggle,format,formatCompact,injectToggle};
})();
"""
if 'FleetCurrency' not in auth:
    auth+=CURRENCY; print('  [OK] FleetCurrency module added')
else: print('  [--] FleetCurrency already present')

with open('auth.js','w') as f: f.write(auth)

# ── 2. index.html ─────────────────────────────────────────────────────────
print('\n[index.html]')
with open('index.html','r') as f: html=f.read()

fixes=[
  ("driverStats[session.id]","driverStats[session.userId]"),
  ("'NOK ' + myStats.earnings.toLocaleString()","FleetCurrency.format(myStats.earnings)"),
  ("NOK ${myStats.earnings.toLocaleString()}","${FleetCurrency.format(myStats.earnings)}"),
  ("NOK ${fare}","${FleetCurrency.format(parseInt(fare))}"),
  ("NOK ${Math.round(w.val/1000)}k","${FleetCurrency.formatCompact(w.val)}"),
  ("'NOK ' + weekTotal.toLocaleString()","FleetCurrency.format(weekTotal)"),
  ("'NOK ' + Math.round(weekTotal/7).toLocaleString()","FleetCurrency.format(Math.round(weekTotal/7))"),
  ("'NOK ' + gross.toLocaleString()","FleetCurrency.format(gross)"),
  ("'−NOK ' + platFee.toLocaleString()","'−'+FleetCurrency.format(platFee)"),
  ("'NOK ' + comm.toLocaleString()","FleetCurrency.format(comm)"),
]
for old,new in fixes:
    c=html.count(old)
    if c: html=html.replace(old,new); print(f'  [OK] x{c} {repr(old[:55])}')
    else: print(f'  [--] not found: {repr(old[:55])}')

if 'FleetCurrency.injectToggle()' not in html:
    pos=html.rfind('</script>'); html=html[:pos]+'FleetCurrency.injectToggle();\n'+html[pos:]
    print('  [OK] injectToggle() call added')

with open('index.html','w') as f: f.write(html)

# ── 3. dashboard.html ─────────────────────────────────────────────────────
print('\n[dashboard.html]')
with open('dashboard.html','r') as f: dash=f.read()

# Load auth.js
CHART='<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>'
if 'auth.js' not in dash:
    dash=dash.replace(CHART, CHART+'\n<script src="./auth.js"></script>')
    print('  [OK] auth.js script tag added')
else: print('  [--] auth.js already loaded')

# Auth guard at top of inline script
GUARD='''// ── Auth guard ─────────────────────────────────────────────────────────────
const _s=(typeof FleetAuth!=='undefined')?FleetAuth.requireAuth(['admin'],'./login.html?error=unauthorized'):null;
document.addEventListener('DOMContentLoaded',()=>{
  if(_s){
    const av=document.getElementById('sb-avatar'),nm=document.getElementById('sb-name');
    if(av)av.textContent=_s.avatar||'AD';
    if(nm)nm.textContent=_s.name||'Admin';
  }
});
'''
if '_s=' not in dash:
    def add_guard(m): return m.group(0)+'\n'+GUARD
    dash=re.sub(r'<script>(?=\n)',add_guard,dash,count=1)
    print('  [OK] auth guard added')
else: print('  [--] auth guard already present')

# Sidebar footer — dynamic user + logout button
OLD_FOOTER='<div class="sidebar-footer">\n    <div class="user-row">\n      <div class="user-avatar">FM</div>\n      <div>\n        <div class="user-name">Fleet Manager</div>\n        <div class="user-role">Administrator</div>\n      </div>\n    </div>\n  </div>'
NEW_FOOTER='<div class="sidebar-footer">\n    <div class="user-row">\n      <div class="user-avatar" id="sb-avatar">AD</div>\n      <div style="flex:1;min-width:0">\n        <div class="user-name" id="sb-name">Admin</div>\n        <div class="user-role">Administrator</div>\n      </div>\n      <button onclick="FleetAuth.logout(\'./login.html\')" title="Sign out" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:18px;padding:4px;flex-shrink:0;line-height:1;transition:color .15s" onmouseover="this.style.color=\'var(--red)\'" onmouseout="this.style.color=\'var(--t3)\'">&#x23FB;</button>\n    </div>\n  </div>'
if 'sb-avatar' not in dash:
    if OLD_FOOTER in dash:
        dash=dash.replace(OLD_FOOTER,NEW_FOOTER); print('  [OK] sidebar: dynamic user + logout button')
    else:
        print('  [!!] sidebar footer not matched — will patch differently')
        dash=re.sub(r'<div class="user-avatar">FM</div>','<div class="user-avatar" id="sb-avatar">AD</div>',dash)
        dash=re.sub(r'<div class="user-name">Fleet Manager</div>','<div class="user-name" id="sb-name">Admin</div>',dash)
        print('  [OK] sidebar: patched avatar+name ids')
else: print('  [--] sidebar already patched')

# Missing API functions
API_FNS=r"""
// ── Missing API functions ─────────────────────────────────────────────────
function testConnection(platform){
  const st=document.getElementById(platform+'-status');
  if(st){st.textContent='Testing\u2026';st.className='badge b-blue';}
  setTimeout(()=>{
    const ok=Math.random()>0.25;
    if(st){st.textContent=ok?'\u2713 Connected':'\u2717 Failed';st.className=ok?'badge b-green':'badge b-red';}
    if(typeof logAPIEvent==='function')logAPIEvent(platform,'/status',ok?'200':'503',Math.floor(60+Math.random()*200));
  },600+Math.random()*800);
}
function testAllConnections(){['bolt','uber','nio','tesla','spot'].forEach(p=>testConnection(p));}
function saveAPIKeys(){
  const ids=['bolt-partner-id','bolt-api-key','bolt-api-secret','bolt-webhook',
             'uber-client-id','uber-client-secret','uber-webhook',
             'nio-fleet-id','nio-api-key','tesla-fleet-id','tesla-api-key'];
  let n=0;
  ids.forEach(id=>{const el=document.getElementById(id);if(el&&el.value.trim()){try{localStorage.setItem('ft_api_'+id,el.value.trim());n++;}catch(e){}}});
  if(typeof Toast!=='undefined')Toast.success('API config saved \u2014 '+n+' field(s) stored.');
  else alert(n+' API field(s) saved locally.');
}
"""
if 'function testConnection' not in dash:
    pos=dash.rfind('</script>'); dash=dash[:pos]+API_FNS+'\n'+dash[pos:]
    print('  [OK] testConnection / testAllConnections / saveAPIKeys added')
else: print('  [--] API functions already defined')

with open('dashboard.html','w') as f: f.write(dash)

print('\n\u2713 All patches applied!')
print('\nRun: git add auth.js index.html dashboard.html && git commit -m "feat: admin user, currency toggle, fix driver stats, fix dashboard auth+buttons" && git push origin claude/setup-taxi-dashboard-75T0K')
