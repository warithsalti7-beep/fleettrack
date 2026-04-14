/**
 * AIPanel — fetches AI recommendations from /api/ai/* endpoints and
 * renders them into any element with [data-ai-panel="<name>"].
 *
 * Usage:
 *   <div class="ai-card" data-ai-panel="fleet-summary">
 *     <div class="ai-body" id="ai-fleet-body"></div>
 *     <span class="ai-status" id="ai-fleet-status"></span>
 *   </div>
 *
 * Then: AIPanel.render('fleet-summary'); // on page load
 *       AIPanel.refresh('fleet-summary'); // force reload
 */
(function(){
  'use strict';

  const PANELS = {
    'fleet-summary': {
      endpoint: '/api/ai/fleet-summary',
      bodyId: 'ai-fleet-body',
      statusId: 'ai-fleet-status',
      emptyMsg: 'No recommendations — fleet is running within all thresholds.',
    },
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(panel, text, tone) {
    const el = document.getElementById(panel.statusId);
    if (!el) return;
    el.textContent = text || '';
    el.style.color = tone === 'err' ? 'var(--red)' : tone === 'ok' ? 'var(--green)' : 'var(--t3)';
  }

  function renderSkeleton(panel) {
    const body = document.getElementById(panel.bodyId);
    if (!body) return;
    body.innerHTML = '<div class="ai-skeleton"><div class="sk-line sk-1"></div><div class="sk-line sk-2"></div><div class="sk-line sk-3"></div></div>';
    setStatus(panel, 'thinking…');
  }

  function renderError(panel, message, retryable) {
    const body = document.getElementById(panel.bodyId);
    if (!body) return;
    body.innerHTML =
      '<div class="ai-error">' +
      '<strong>Couldn\'t load AI recommendations.</strong><br>' +
      escapeHtml(message || 'Unknown error.') +
      (retryable ? '<br><a class="ai-retry" onclick="AIPanel.refresh(\'' + escapeHtml(panel.name) + '\')">Retry</a>' : '') +
      '</div>';
    setStatus(panel, 'error', 'err');
  }

  function renderDisabled(panel, message) {
    const body = document.getElementById(panel.bodyId);
    if (!body) return;
    body.innerHTML = '<div class="ai-disabled">' + escapeHtml(message) + '</div>';
    setStatus(panel, 'offline');
  }

  function renderData(panel, data) {
    const body = document.getElementById(panel.bodyId);
    if (!body) return;
    const recs = Array.isArray(data.recommendations) ? data.recommendations : [];
    const parts = [];
    if (data.headline) {
      parts.push('<div class="ai-headline">' + escapeHtml(data.headline) + '</div>');
    }
    if (recs.length === 0) {
      parts.push('<div class="ai-disabled">' + escapeHtml(panel.emptyMsg) + '</div>');
    } else {
      recs.forEach(r => {
        const pri = ['high','medium','low'].includes(r.priority) ? r.priority : 'medium';
        const href = r.actionHref ? ('#' + String(r.actionHref).replace(/^#/, '')) : '';
        parts.push(
          '<div class="ai-rec">' +
            '<div class="ai-rec-pri ' + pri + '"></div>' +
            '<div>' +
              '<div class="ai-rec-title">' +
                '<span class="ai-rec-area">' + escapeHtml(r.area || '') + '</span>' +
                escapeHtml(r.title || '(no title)') +
              '</div>' +
              '<div class="ai-rec-body">' + escapeHtml(r.body || '') + '</div>' +
            '</div>' +
            (r.actionLabel && href
              ? '<a class="ai-rec-action" href="' + escapeHtml(href) + '" onclick="if(typeof go===\'function\'){go(\'' +
                  escapeHtml(String(r.actionHref).replace(/^#/, '')) +
                  '\');return false;}">' + escapeHtml(r.actionLabel) + ' →</a>'
              : '<span></span>') +
          '</div>'
        );
      });
    }
    body.innerHTML = parts.join('');
    const when = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '';
    setStatus(panel, (data.cached ? 'cached · ' : '') + (when ? 'updated ' + when : 'updated'), 'ok');
  }

  async function render(name, opts) {
    opts = opts || {};
    const panel = PANELS[name];
    if (!panel) return;
    panel.name = name;
    if (!document.getElementById(panel.bodyId)) return; // panel not mounted
    renderSkeleton(panel);
    try {
      const res = await fetch(panel.endpoint + (opts.force ? '?_t=' + Date.now() : ''), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        renderError(panel, 'Please sign in to load AI recommendations.', false);
        return;
      }
      if (res.status === 503) {
        const j = await res.json().catch(() => ({}));
        renderDisabled(panel, j.message || 'AI is not configured on this server. Add ANTHROPIC_API_KEY to Vercel env vars.');
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        renderError(panel, j.error || ('HTTP ' + res.status), true);
        return;
      }
      const data = await res.json();
      renderData(panel, data);
    } catch (err) {
      renderError(panel, (err && err.message) || 'Network error.', true);
    }
  }

  function refresh(name) { return render(name, { force: true }); }

  // Auto-render any mounted panels on page load
  function autoRender() {
    Object.keys(PANELS).forEach(name => {
      const panel = PANELS[name];
      if (document.getElementById(panel.bodyId)) render(name);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoRender);
  } else {
    autoRender();
  }

  window.AIPanel = { render, refresh };
})();
