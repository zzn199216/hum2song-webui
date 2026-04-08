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

function clipCardInnerHTML(clip, stats, fmtSec, escapeHtml, revInfo, selectedPreset, selectedClipId){
    clip = clip || {};
    stats = stats || {};
    fmtSec = (typeof fmtSec === 'function') ? fmtSec : _defaultFmtSec;
    escapeHtml = (typeof escapeHtml === 'function') ? escapeHtml : _defaultEscapeHtml;

    const _tDefaults = { 'cliplib.play':'Play', 'cliplib.addToSong':'Add to Song', 'cliplib.convertToEditable':'Convert to editable', 'cliplib.convertToEditableTitle':'Transcribe to an editable note clip (server)', 'cliplib.edit':'Edit', 'cliplib.remove':'Remove', 'cliplib.optimize':'Optimize', 'cliplib.details':'Details', 'cliplib.preset':'Preset', 'cliplib.default':'Default', 'cliplib.notes':'notes', 'cliplib.badgeAudio':'Original audio', 'cliplib.lastOptimized':'Last optimized', 'cliplib.last':'Last', 'opt.dynamicsAccent':'Dynamics Accent', 'opt.dynamicsLevel':'Dynamics Level', 'opt.durationGentle':'Duration Gentle' };
    const win = (typeof window !== 'undefined') ? window : null;
    const t = (win && win.I18N && typeof win.I18N.t === 'function') ? (k) => win.I18N.t(k) : (k) => (_tDefaults[k] !== undefined ? _tDefaults[k] : k);

    const id = escapeHtml(clip.id || '');
    const isSelected = selectedClipId && String(clip.id || '') === String(selectedClipId);
    const presetVal = (selectedPreset != null && selectedPreset !== '') ? String(selectedPreset) : '';
    const presetLabel = presetVal === 'dynamics_accent' ? t('opt.dynamicsAccent') : presetVal === 'dynamics_level' ? t('opt.dynamicsLevel') : presetVal === 'duration_gentle' ? t('opt.durationGentle') : t('cliplib.default');
    const name = escapeHtml(clip.name || 'Untitled');
    const notes = Number(stats.count ?? stats.notes ?? 0) || 0;
    const spanSec = Number(stats.spanSec ?? 0) || 0;
    const isAudio = (clip.kind === 'audio');
    const subLine = isAudio
      ? (escapeHtml(t('cliplib.badgeAudio') || 'Original audio') + ' · ' + fmtSec(spanSec))
      : (notes + ' ' + t('cliplib.notes') + ' · ' + fmtSec(spanSec));

    
    
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


    // PR-D2a: History (versions/Use/Rollback/A-B) moved to Inspector; not rendered per-card.
// Optimize feedback: short line for primary, full block for advanced
    let lastOptimizeShort = '';
    let optStatusFullHtml = '';
    try{
      const agent = !isAudio && clip && clip.meta && clip.meta.agent;
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
          lastOptimizeShort = `${t('cliplib.last')}: ${escapeHtml(msg)}`;

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

          optStatusFullHtml =
            `<div class="clip-opt-status" data-role="optStatus" data-id="${id}" ` +
            `style="margin-top:6px; font-size:12px; opacity:0.75;">` +
            `Optimize: ${escapeHtml(msg)}${badgeText}` +
            (when ? ` · ${escapeHtml(when)}` : ``) +
            `</div>`;
        }
      }
    }catch(_){ /* ignore */ }

    const lastLineHtml = (!isAudio && lastOptimizeShort) ? `<div class="clip-last-opt" style="font-size:11px; opacity:0.75; margin-top:2px;">${lastOptimizeShort}</div>` : '';

    const advancedHtml =
      `<details class="clipAdvanced" style="margin-top:6px; font-size:12px;">` +
        `<summary style="cursor:pointer; user-select:none; opacity:0.8;">${escapeHtml(t('cliplib.details'))}</summary>` +
        `<div class="clip-advanced-content" style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06);">` +
          revLine +
          optStatusFullHtml +
          `<div style="margin-top:8px;">` +
            `<button class="btn" data-act="remove" data-id="${id}" style="padding:4px 8px;">${escapeHtml(t('cliplib.remove'))}</button>` +
          `</div>` +
        `</div>` +
      `</details>`;

    const primaryActions = isAudio
      ? (
          `<button class="btn" data-act="play" data-id="${id}">${escapeHtml(t('cliplib.play'))}</button>` +
          `<button class="btn" data-act="add" data-id="${id}">${escapeHtml(t('cliplib.addToSong'))}</button>` +
          `<button class="btn primary" data-act="convertToEditable" data-id="${id}" title="${escapeHtml(t('cliplib.convertToEditableTitle'))}">${escapeHtml(t('cliplib.convertToEditable'))}</button>`
        )
      : (
          `<button class="btn" data-act="play" data-id="${id}">${escapeHtml(t('cliplib.play'))}</button>` +
          `<button class="btn" data-act="add" data-id="${id}">${escapeHtml(t('cliplib.addToSong'))}</button>` +
          `<button class="btn" data-act="edit" data-id="${id}">${escapeHtml(t('cliplib.edit'))}</button>` +
          (presetVal ? `<span class="clip-preset-label" style="font-size:11px; opacity:0.7;">${escapeHtml(t('cliplib.preset'))}: ${escapeHtml(presetLabel)}</span>` : '') +
          `<button class="btn" data-act="optimize" data-id="${id}">${escapeHtml(t('cliplib.optimize'))}</button>`
        );

    return (
      `<div class="clip-card clipCard${isSelected ? ' clipSelected' : ''}${isAudio ? ' clip-card-audio' : ''}" data-clip-id="${id}" data-clip-kind="${isAudio ? 'audio' : 'note'}">` +
        `<div class="clip-title">${isAudio ? ('<span class="clip-badge">' + escapeHtml(t('cliplib.badgeAudio') || 'Original audio') + '</span> ') : ''}${name}</div>` +
        `<div class="clip-sub">${subLine}</div>` +
        lastLineHtml +
        `<div class="clip-actions" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; align-items:center;">` +
          primaryActions +
        `</div>` +
        advancedHtml +
      `</div>`
    );
  }

  /** PR-D2a: History controls HTML for Inspector (versions + Use/Rollback/A-B). */
  function historyControlsHTML(clipId, revInfo, escapeHtml){
    escapeHtml = (typeof escapeHtml === 'function') ? escapeHtml : _defaultEscapeHtml;
    const id = escapeHtml(clipId || '');
    const clip = {};
    const headRevId = '';
    const headParentId = '';
    let revHtml = '';
    if (revInfo && Array.isArray(revInfo.items) && revInfo.items.length >= 1){
      const active = String(revInfo.activeRevisionId || '');
      const items = revInfo.items || [];
      const activeItem = items.find(it => String(it.revisionId || '') === active) || items.find(it => it && it.isActive) || items[0] || null;
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
        `<div class="clip-revisions" style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">` +
          `<span style="font-size:12px; opacity:0.7;">Version</span>` +
          `<select data-act="inspRevSelect" data-id="${id}" style="padding:4px 6px; max-width:220px;"${selectDisabled}>${opts}</select>` +
          `<button class="btn" data-act="inspRevActivate" data-id="${id}" style="padding:4px 8px;"${useDisabled}>Use</button>` +
          `<button class="btn" data-act="inspRollbackRev" data-id="${id}" style="padding:4px 8px;"${rollbackDisabled}>Rollback</button>` +
          `<button class="btn" data-act="inspAbToggle" data-id="${id}" style="padding:4px 8px;"${abDisabled}>A/B</button>` +
        `</div>`
      );
    }
    return revHtml;
  }

  return {
    emptyMessage,
    clipCardInnerHTML,
    historyControlsHTML,
  };
});
