/**
 * fleet-forms.js — shared lightweight modal form helper used by the
 * dashboard "+ Add Driver", "+ Add Vehicle" etc. buttons. Each helper
 * builds a modal, collects fields, POSTs to the matching /api/* route
 * and fires `fleetdata:updated` so the tables re-render.
 *
 * Depends on: Toast, FleetAuth (for auth.js side-effects), FleetData.
 */
(function(){
  if (typeof window === 'undefined') return;

  function buildModal({ title, subtitle, fields, submitLabel, onSubmit }){
    const modal = document.createElement('div');
    modal.className = 'ft-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:var(--s4)';

    const fieldHtml = fields.map(f => {
      const id = 'ff-' + f.name;
      const req = f.required ? ' required' : '';
      const placeholder = f.placeholder || '';
      if (f.type === 'select') {
        const opts = f.options.map(o =>
          '<option value="' + o.value + '"' + (o.value === f.value ? ' selected' : '') + '>' + o.label + '</option>'
        ).join('');
        return `<div class="form-group">
          <label class="form-label" for="${id}">${f.label}${f.required?' *':''}</label>
          <select class="form-input" id="${id}" name="${f.name}"${req}>${opts}</select>
        </div>`;
      }
      return `<div class="form-group">
        <label class="form-label" for="${id}">${f.label}${f.required?' *':''}</label>
        <input class="form-input" id="${id}" name="${f.name}" type="${f.type||'text'}" placeholder="${placeholder}" value="${f.value||''}"${req}${f.min?' min="'+f.min+'"':''}${f.max?' max="'+f.max+'"':''}>
        ${f.hint ? '<div style="font-size:11px;color:var(--t3);margin-top:var(--s1)">'+f.hint+'</div>' : ''}
      </div>`;
    }).join('');

    modal.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:var(--r4);padding:var(--s6);max-width:480px;width:100%;box-shadow:var(--shadow-lg);max-height:92vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s5)">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--t1)">${title}</div>
          ${subtitle ? '<div style="font-size:12px;color:var(--t3);margin-top:2px">'+subtitle+'</div>' : ''}
        </div>
        <button type="button" aria-label="Close" style="background:none;border:none;font-size:20px;color:var(--t3);cursor:pointer;line-height:1" onclick="this.closest('.ft-modal').remove()">×</button>
      </div>
      <form id="ff-form" novalidate>
        ${fieldHtml}
        <div id="ff-error" style="display:none;background:var(--redbg);border:1px solid var(--redborder);color:var(--red);padding:var(--s2) var(--s3);border-radius:var(--r2);font-size:12.5px;margin-bottom:var(--s3)"></div>
        <div style="display:flex;gap:var(--s2);justify-content:flex-end;margin-top:var(--s4)">
          <button type="button" class="btn" onclick="this.closest('.ft-modal').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="ff-submit">${submitLabel}</button>
        </div>
      </form>
    </div>`;

    document.body.appendChild(modal);
    const first = modal.querySelector('input, select');
    if (first) first.focus();

    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.remove(); });

    modal.querySelector('#ff-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = modal.querySelector('#ff-error');
      err.style.display = 'none';
      const data = {};
      for (const f of fields) {
        const el = modal.querySelector('#ff-' + f.name);
        let v = el.value;
        if (f.type === 'number') v = v === '' ? null : Number(v);
        if (f.required && (v === '' || v === null || v === undefined)) {
          err.textContent = 'Missing required field: ' + f.label;
          err.style.display = 'block';
          el.focus();
          return;
        }
        data[f.name] = v;
      }
      const submitBtn = modal.querySelector('#ff-submit');
      submitBtn.disabled = true;
      const oldText = submitBtn.textContent;
      submitBtn.textContent = 'Saving…';
      try {
        const res = await onSubmit(data);
        if (res && res.ok) {
          modal.remove();
          if (typeof Toast !== 'undefined') Toast.success(res.message || 'Saved.');
          if (window.FleetData && typeof window.FleetData.refresh === 'function') {
            window.FleetData.refresh().catch(() => {});
          }
        } else {
          err.textContent = (res && res.error) || 'Could not save.';
          err.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = oldText;
        }
      } catch (ex) {
        err.textContent = ex && ex.message ? ex.message : 'Unexpected error.';
        err.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
      }
    });

    return modal;
  }

  async function postJson(path, body){
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401) return { ok:false, error:'You need to sign in again.' };
    if (r.status === 403) return { ok:false, error:'You don\'t have permission to do this.' };
    if (r.ok) return { ok:true };
    let detail = '';
    try { const j = await r.json(); detail = j.detail || j.error || ''; } catch(e){}
    return { ok:false, error: detail || 'Request failed (' + r.status + ')' };
  }

  window.openAddDriverModal = function(){
    buildModal({
      title: 'Add Driver',
      subtitle: 'Creates a new driver record. Pair with a login account via Users & Permissions if they should sign in.',
      submitLabel: 'Create driver',
      fields: [
        { name:'name', label:'Full name', required:true, placeholder:'Jane Doe' },
        { name:'email', label:'Email', type:'email', required:true, placeholder:'jane@example.com' },
        { name:'phone', label:'Phone', placeholder:'+47 40 00 00 00' },
        { name:'licenseNumber', label:'Licence number', required:true, placeholder:'NO-12345678' },
        { name:'licenseExpiry', label:'Licence expiry', type:'date', required:true, hint:'YYYY-MM-DD' },
        { name:'address', label:'Address' },
        { name:'status', label:'Status', type:'select', value:'AVAILABLE', options:[
          { value:'AVAILABLE', label:'Available' },
          { value:'OFF_DUTY',  label:'Off duty' },
          { value:'ON_TRIP',   label:'On trip' },
        ] },
      ],
      onSubmit: (d) => postJson('/api/drivers', d),
    });
  };

  window.openAddVehicleModal = function(){
    buildModal({
      title: 'Add Vehicle',
      subtitle: 'Registers a new vehicle. Assign a driver once created.',
      submitLabel: 'Create vehicle',
      fields: [
        { name:'plateNumber', label:'Plate number', required:true, placeholder:'TR2525' },
        { name:'make', label:'Make', required:true, placeholder:'NIO' },
        { name:'model', label:'Model', required:true, placeholder:'ET5' },
        { name:'year', label:'Year', type:'number', required:true, min:'1990', max:'2100', value: String(new Date().getFullYear()) },
        { name:'color', label:'Colour', placeholder:'White' },
        { name:'fuelType', label:'Fuel type', type:'select', value:'ELECTRIC', options:[
          { value:'ELECTRIC', label:'Electric' },
          { value:'HYBRID',   label:'Hybrid' },
          { value:'PETROL',   label:'Petrol' },
          { value:'DIESEL',   label:'Diesel' },
        ] },
        { name:'mileage', label:'Current mileage (km)', type:'number', value:'0', min:'0' },
        { name:'status', label:'Status', type:'select', value:'AVAILABLE', options:[
          { value:'AVAILABLE',      label:'Available' },
          { value:'ON_TRIP',        label:'On trip' },
          { value:'MAINTENANCE',    label:'Maintenance' },
          { value:'OUT_OF_SERVICE', label:'Out of service' },
        ] },
      ],
      onSubmit: (d) => postJson('/api/vehicles', d),
    });
  };

  window.openLogServiceModal = function(){
    // Pull vehicle options from FleetData; fall back to a free-text id.
    const veh = (window.FleetData && window.FleetData.vehicles) || [];
    const vehicleField = veh.length
      ? { name:'vehicleId', label:'Vehicle', type:'select', required:true,
          options: veh.map(v => ({ value:v.vehicleId || v.id, label:(v.plateNumber||v.id) + ' · ' + (v.make||'') + ' ' + (v.model||'') })) }
      : { name:'vehicleId', label:'Vehicle ID', required:true, placeholder:'Paste vehicle id (import CSV first)' };

    buildModal({
      title: 'Log Service',
      subtitle: 'Schedule a maintenance record against a vehicle.',
      submitLabel: 'Create service record',
      fields: [
        vehicleField,
        { name:'type', label:'Type', type:'select', value:'GENERAL', options:[
          { value:'OIL_CHANGE',    label:'Oil change' },
          { value:'TIRE_ROTATION', label:'Tire rotation' },
          { value:'BRAKE_SERVICE', label:'Brake service' },
          { value:'INSPECTION',    label:'Inspection' },
          { value:'REPAIR',        label:'Repair' },
          { value:'GENERAL',       label:'General service' },
        ] },
        { name:'description', label:'Description', required:true, placeholder:'What is being serviced?' },
        { name:'priority', label:'Priority', type:'select', value:'NORMAL', options:[
          { value:'LOW', label:'Low' }, { value:'NORMAL', label:'Normal' },
          { value:'HIGH', label:'High' }, { value:'URGENT', label:'Urgent' },
        ] },
        { name:'scheduledAt', label:'Scheduled date', type:'date', required:true },
        { name:'cost', label:'Estimated cost (NOK)', type:'number', min:'0' },
        { name:'technicianName', label:'Technician' },
        { name:'notes', label:'Notes' },
      ],
      onSubmit: (d) => postJson('/api/maintenance', d),
    });
  };

  window.openNewShiftModal = function(){
    if (typeof Toast !== 'undefined') {
      Toast.info('Shifts are created via CSV import at Settings → Data Import. Per-shift creation UI coming soon.');
    }
  };
  window.openReportIncidentModal = function(){
    if (typeof Toast !== 'undefined') {
      Toast.info('Incident model is not wired to the API yet — file in your external workflow for now.');
    }
  };
  window.openLogComplaintModal = function(){
    if (typeof Toast !== 'undefined') {
      Toast.info('Complaints are not stored server-side yet.');
    }
  };
})();
