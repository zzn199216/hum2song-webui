/* Hum2Song Studio MVP - ui/library_view.js
   Plain script (no import/export). Browser global + Node-safe export.

   Node contract tests require this file with no DOM and no `window`.
*/
(function(root, factory){
  'use strict';
  const api = factory();

  // Node (tests)
  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
  // Browser
  if (root){
    root.H2SLibraryView = api;
  }
})(typeof window !== 'undefined' ? window : null, function(){
  'use strict';

  function emptyMessage(){
    return 'No clips yet. Record or Upload to start.';
  }

  function _defaultEscapeHtml(s){
    return String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function _defaultFmtSec(sec){
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s - m*60;
    const ss = (r < 10 ? '0' : '') + r.toFixed(2);
    return m + ':' + ss;
  }

  function clipCardInnerHTML(clip, stats, fmtSec, escapeHtml, revInfo){
    clip = clip || {};
    stats = stats || {};
    fmtSec = (typeof fmtSec === 'function') ? fmtSec : _defaultFmtSec;
    escapeHtml = (typeof escapeHtml === 'function') ? escapeHtml : _defaultEscapeHtml;

    const id = escapeHtml(clip.id || '');
    const name = escapeHtml(clip.name || 'Untitled');
    const notes = Number(stats.count ?? stats.notes ?? 0) || 0;
    const spanSec = Number(stats.spanSec ?? 0) || 0;

    let revHtml = '';
    if (revInfo && Array.isArray(revInfo.items) && revInfo.items.length > 1){
      const active = String(revInfo.activeRevisionId || '');
      const items = revInfo.items || [];
      const activeItem = items.find(it => String(it.revisionId || '') === active) || items.find(it => it.isActive) || items[0] || null;
      const hasParent = !!(activeItem && activeItem.parentRevisionId);

      const opts = items.map(it => {
        const rid = escapeHtml(it.revisionId || '');
        const label = escapeHtml(it.label || it.revisionId || '');
        const sel = (String(it.revisionId || '') === active) ? ' selected' : '';
        return `<option value="${rid}"${sel}>${label}</option>`;
      }).join('');

      const rollbackDisabled = hasParent ? '' : ' disabled';

      revHtml = (
        `<div class="clip-revisions" style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">` +
          `<span style="font-size:12px; opacity:0.7;">Version</span>` +
          `<select data-act="revSelect" data-id="${id}" style="padding:4px 6px; max-width:240px;">${opts}</select>` +
          `<button class="btn" data-act="revActivate" data-id="${id}" style="padding:4px 8px;">Use</button>` +
          `<button class="btn" data-act="rollbackRev" data-id="${id}" style="padding:4px 8px;"${rollbackDisabled}>Rollback</button>` +
          `<button class="btn" data-act="abToggle" data-id="${id}" style="padding:4px 8px;">A/B</button>` +
        `</div>`
      );
    }
    // Optimize feedback (shown after clicking Optimize, even when no-op)
    let optStatusHtml = '';
    try{
      const agent = clip && clip.meta && clip.meta.agent;
      if (agent){
        const opsRaw = (agent.patchOps != null) ? agent.patchOps : (agent.patchSummary && agent.patchSummary.ops);
        const ops = Number(opsRaw);
        const hasInfo = (agent.appliedAt != null) || (agent.patchOps != null) || (agent.patchSummary && agent.patchSummary.ops != null) || agent.lastError;
        if (hasInfo){
          let msg = '';
          if (agent.lastError){
            msg = 'Error: ' + String(agent.lastError);
          } else if (Number.isFinite(ops) && ops > 0){
            msg = 'Optimized ✓ (ops=' + ops + ')';
          } else {
            msg = 'No changes (0 ops)';
          }
          optStatusHtml =
            `<div class="clip-opt-status" data-role="optStatus" data-id="${id}" ` +
            `style="margin-top:6px; font-size:12px; opacity:0.75;">` +
            `Optimize: ${escapeHtml(msg)}` +
            `</div>`;
        }
      }
    }catch(_){ /* ignore */ }


    return (
      `<div class="clip-card" data-clip-id="${id}">` +
        `<div class="clip-title">${name}</div>` +
        `<div class="clip-sub">${notes} notes · ${fmtSec(spanSec)}</div>` +
        `<div class="clip-actions" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">` +
          `<button class="btn" data-act="play" data-id="${id}">Play</button>` +
          `<button class="btn" data-act="add" data-id="${id}">Add to Song</button>` +
          `<button class="btn" data-act="edit" data-id="${id}">Edit</button><button class="btn" data-act="optimize" data-id="${id}">Optimize</button>` +
          `<button class="btn" data-act="remove" data-id="${id}">Remove</button>` +
        `</div>` +
        optStatusHtml +
        revHtml +
      `</div>`
    );
  }

  return {
    emptyMessage,
    clipCardInnerHTML,
  };
});
