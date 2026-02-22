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

  function _shortRev(rid){
    const s = String(rid || '');
    if (!s) return '';
    // Keep short but stable; ids like "rev_abcdef012345"
    if (s.length <= 12) return s;
    return s.slice(0, 12) + '…';
  }

  function _defaultFmtSec(sec){
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s - m*60;
    const ss = (r < 10 ? '0' : '') + r.toFixed(2);
    return m + ':' + ss;
  }

  
  function _safeJson(obj, maxLen){
    let s = '';
    try{
      s = JSON.stringify(obj, null, 2);
    }catch(_e){
      try{ s = String(obj); }catch(_){ s = ''; }
    }
    if (maxLen && s && s.length > maxLen){
      s = s.slice(0, maxLen) + "\n…(truncated)…";
    }
    return s;
  }

  function _fmtTs(ts){
    const n = Number(ts);
    if (!isFinite(n) || n <= 0) return '';
    try{
      return new Date(n).toLocaleString();
    }catch(_){
      return String(n);
    }
  }

function clipCardInnerHTML(clip, stats, fmtSec, escapeHtml, revInfo, selectedPreset){
    clip = clip || {};
    stats = stats || {};
    fmtSec = (typeof fmtSec === 'function') ? fmtSec : _defaultFmtSec;
    escapeHtml = (typeof escapeHtml === 'function') ? escapeHtml : _defaultEscapeHtml;

    const id = escapeHtml(clip.id || '');
    const presetVal = (selectedPreset != null && selectedPreset !== '') ? String(selectedPreset) : '';
    const name = escapeHtml(clip.name || 'Untitled');
    const notes = Number(stats.count ?? stats.notes ?? 0) || 0;
    const spanSec = Number(stats.spanSec ?? 0) || 0;

    
    
    const headRevId = String(clip.revisionId || '');
    const headParentId = String(clip.parentRevisionId || '');

    const revItems = (revInfo && Array.isArray(revInfo.items)) ? revInfo.items : null;
    const versions = revItems ? revItems.length : 0;
    const activeRevId = String((revInfo && revInfo.activeRevisionId) || headRevId || '');

    let activeLabel = '';
    try{
      if (revItems && activeRevId){
        const it = revItems.find(it => String(it.revisionId || '') === activeRevId) || revItems.find(it => it && it.isActive) || null;
        if (it){
          activeLabel = it.label || (it.parentRevisionId
            ? (`Rev ${_shortRev(activeRevId)} ← ${_shortRev(it.parentRevisionId)}`)
            : (`Original ${_shortRev(activeRevId)}`));
        }
      }
    }catch(_){ /* ignore */ }

    const revLine = headRevId
      ? (`<div class="clip-rev" style="margin-top:4px; font-size:12px; opacity:0.7;">` +
         `Rev: ${escapeHtml(_shortRev(activeRevId || headRevId))}` +
         (headParentId ? ` · Parent: ${escapeHtml(_shortRev(headParentId))}` : ``) +
         (versions ? ` · Versions: ${versions}` : ``) +
         (activeLabel ? ` · Active: ${escapeHtml(activeLabel)}` : ``) +
         `</div>`)
      : '';


    let revHtml = '';
    if (revInfo && Array.isArray(revInfo.items) && revInfo.items.length >= 1){
      const active = String(revInfo.activeRevisionId || headRevId || '');
      const items = revInfo.items || [];
      const activeItem = items.find(it => String(it.revisionId || '') === active) || items.find(it => it.isActive) || items[0] || null;
      const hasParent = !!(activeItem && activeItem.parentRevisionId);

      const opts = items.map(it => {
        const ridRaw = String(it.revisionId || '');
        const rid = escapeHtml(ridRaw);
        let label = it.label;
        if (!label){
          const shortRid = _shortRev(ridRaw);
          const shortPar = _shortRev(it.parentRevisionId || '');
          label = it.parentRevisionId ? (`Rev ${shortRid}${shortPar ? ` ← ${shortPar}` : ''}`) : (`Original ${shortRid}`);
        }
        label = escapeHtml(label);
        const sel = (ridRaw === active) ? ' selected' : '';
        return `<option value="${rid}"${sel}>${label}</option>`;
      }).join('');

      const selectDisabled = (items.length <= 1) ? ' disabled' : '';
      const rollbackDisabled = hasParent ? '' : ' disabled';
      const useDisabled = (items.length <= 1) ? ' disabled' : '';
      const abDisabled = hasParent ? '' : ' disabled';

      revHtml = (
        `<div class="clip-revisions" style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">` +
          `<span style="font-size:12px; opacity:0.7;">Version</span>` +
          `<select data-act="revSelect" data-id="${id}" style="padding:4px 6px; max-width:260px;"${selectDisabled}>${opts}</select>` +
          `<button class="btn" data-act="revActivate" data-id="${id}" style="padding:4px 8px;"${useDisabled}>Use</button>` +
          `<button class="btn" data-act="rollbackRev" data-id="${id}" style="padding:4px 8px;"${rollbackDisabled}>Rollback</button>` +
          `<button class="btn" data-act="abToggle" data-id="${id}" style="padding:4px 8px;"${abDisabled}>A/B</button>` +
        `</div>`
      );
    }
// Optimize feedback: short line for primary, full block for advanced
    let lastOptimizeShort = '';
    let optStatusFullHtml = '';
    try{
      const agent = clip && clip.meta && clip.meta.agent;
      if (agent){
        const opsRaw = (agent.patchOps != null) ? agent.patchOps : (agent.patchSummary && agent.patchSummary.ops);
        const ops = Number(opsRaw);
        const hasInfo =
          (agent.appliedAt != null) ||
          (agent.patchOps != null) ||
          (agent.patchSummary && agent.patchSummary.ops != null) ||
          agent.lastError;

        if (hasInfo){
          let msg = '';
          if (agent.lastError){
            msg = 'Error: ' + String(agent.lastError);
          } else if (Number.isFinite(ops) && ops > 0){
            msg = 'Optimized ✓ (ops=' + ops + ')';
          } else {
            msg = 'No changes (0 ops)';
          }

          const when = _fmtTs(agent.appliedAt);

          // Short line for primary
          lastOptimizeShort = `Last: ${escapeHtml(msg)}`;

          // PR-3: Display executedPreset, ops, reason from patchSummary (compute BEFORE using in template)
          let presetBadge = '';
          let reasonBadge = '';
          try{
            if (agent.patchSummary && typeof agent.patchSummary === 'object'){
              const ps = agent.patchSummary;
              const execPreset = ps.executedPreset || ps.preset || '';
              if (execPreset && execPreset !== 'pseudo_v0'){
                presetBadge = `Preset: ${escapeHtml(execPreset)}`;
              }
              const reason = ps.reason;
              if (reason && reason !== 'empty_ops' && reason !== 'ok'){
                reasonBadge = `reason: ${escapeHtml(String(reason))}`;
              }
            }
          }catch(_){ /* ignore */ }
          
          const badgeParts = [
            presetBadge,
            `ops: ${ops}`,
            reasonBadge
          ].filter(Boolean);
          const badgeText = badgeParts.length > 0 ? ` | ${badgeParts.join(' | ')}` : '';

          let detailHtml = '';
          try{
            if (agent.patchSummary && typeof agent.patchSummary === 'object'){
              const js = _safeJson(agent.patchSummary, 2200);
              detailHtml =
                `<details class="clip-opt-detail" style="margin-top:6px; font-size:12px; opacity:0.85;">` +
                  `<summary style="cursor:pointer; user-select:none;">Patch summary</summary>` +
                  `<pre style="white-space:pre-wrap; margin:6px 0 0 0; padding:6px; border-radius:8px; background:rgba(255,255,255,0.04); max-width:420px; overflow:auto;">` +
                    `${escapeHtml(js)}` +
                  `</pre>` +
                `</details>`;
            }
          }catch(_){ /* ignore */ }
          
          optStatusFullHtml =
            `<div class="clip-opt-status" data-role="optStatus" data-id="${id}" ` +
            `style="margin-top:6px; font-size:12px; opacity:0.75;">` +
            `Optimize: ${escapeHtml(msg)}${badgeText}` +
            (when ? ` · ${escapeHtml(when)}` : ``) +
            `</div>` +
            detailHtml;
        }
      }
    }catch(_){ /* ignore */ }

    const lastLineHtml = lastOptimizeShort ? `<div class="clip-last-opt" style="font-size:11px; opacity:0.75; margin-top:2px;">${lastOptimizeShort}</div>` : '';

    const advancedHtml =
      `<details class="clipAdvanced" style="margin-top:6px; font-size:12px;">` +
        `<summary style="cursor:pointer; user-select:none; opacity:0.8;">Details</summary>` +
        `<div class="clip-advanced-content" style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06);">` +
          revLine +
          revHtml +
          optStatusFullHtml +
          `<div style="margin-top:8px;">` +
            `<button class="btn" data-act="remove" data-id="${id}" style="padding:4px 8px;">Remove</button>` +
          `</div>` +
        `</div>` +
      `</details>`;

    return (
      `<div class="clip-card clipCard" data-clip-id="${id}">` +
        `<div class="clip-title">${name}</div>` +
        `<div class="clip-sub">${notes} notes · ${fmtSec(spanSec)}</div>` +
        lastLineHtml +
        `<div class="clip-actions" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; align-items:center;">` +
          `<button class="btn" data-act="play" data-id="${id}">Play</button>` +
          `<button class="btn" data-act="add" data-id="${id}">Add to Song</button>` +
          `<button class="btn" data-act="edit" data-id="${id}">Edit</button>` +
          `<select data-act="optimizePreset" data-id="${id}" style="padding:4px 6px; font-size:13px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.3); color:inherit;">` +
            `<option value=""${presetVal === '' ? ' selected' : ''}>Default</option>` +
            `<option value="dynamics_accent"${presetVal === 'dynamics_accent' ? ' selected' : ''}>Dynamics Accent</option>` +
            `<option value="dynamics_level"${presetVal === 'dynamics_level' ? ' selected' : ''}>Dynamics Level</option>` +
            `<option value="duration_gentle"${presetVal === 'duration_gentle' ? ' selected' : ''}>Duration Gentle</option>` +
          `</select>` +
          `<button class="btn" data-act="optimize" data-id="${id}">Optimize</button>` +
        `</div>` +
        advancedHtml +
      `</div>`
    );
  }

  return {
    emptyMessage,
    clipCardInnerHTML,
  };
});
