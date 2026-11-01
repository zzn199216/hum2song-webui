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

  function _t(key, fallback){
    try{
      const I = (typeof globalThis !== 'undefined' && globalThis.I18N) ? globalThis.I18N : null;
      if (I && typeof I.t === 'function'){
        const v = I.t(key);
        if (v && v !== key) return v;
      }
    }catch(_){ /* ignore */ }
    return fallback;
  }

  function emptyMessage(){
    return _t('cliplib.noClips', 'Start from a sound — import audio or record a take.');
  }

  function emptyMessageHTML(){
    const title = _t('cliplib.emptyTitle', 'Start from a sound');
    const lead = _t('cliplib.emptyLead', 'Import audio or record — Hum2Song will generate an editable melody.');
    const step1 = _t('cliplib.emptyStep1', 'Step 1: Record or upload a hum / melody');
    const step2 = _t('cliplib.emptyStep2', 'Step 2: Hum2Song turns it into editable notes');
    const step3 = _t('cliplib.emptyStep3', 'Step 3: Edit the melody or let AI arrange a full song');
    const ctaImport = _t('cliplib.emptyCtaImport', 'Import audio');
    const ctaRecord = _t('cliplib.emptyCtaRecord', 'Record');
    const ctaSample = _t('cliplib.emptyCtaSample', 'Open sample');
    const ctaSampleHint = _t('cliplib.emptyCtaSampleHint', 'Guided sample coming soon.');
    return (
      '<div class="clipListEmpty" role="region" aria-label="' + _defaultEscapeHtml(title) + '">' +
        '<p class="clipListEmptyTitle">' + _defaultEscapeHtml(title) + '</p>' +
        '<p class="clipListEmptyLead">' + _defaultEscapeHtml(lead) + '</p>' +
        '<ol class="clipListEmptySteps">' +
          '<li>' + _defaultEscapeHtml(step1) + '</li>' +
          '<li>' + _defaultEscapeHtml(step2) + '</li>' +
          '<li>' + _defaultEscapeHtml(step3) + '</li>' +
        '</ol>' +
        '<div class="clipListEmptyActions">' +
          '<button type="button" class="btn" data-h2s-empty-act="import">' + _defaultEscapeHtml(ctaImport) + '</button>' +
          '<button type="button" class="btn" data-h2s-empty-act="record">' + _defaultEscapeHtml(ctaRecord) + '</button>' +
          '<button type="button" class="btn ghost" data-h2s-empty-act="sample" disabled title="' + _defaultEscapeHtml(ctaSampleHint) + '">' + _defaultEscapeHtml(ctaSample) + '</button>' +
        '</div>' +
      '</div>'
    );
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

  function revisionItems(info){
    const seen=new Set();
    return ((info && Array.isArray(info.items)) ? info.items : []).filter(function(item){
      const id=String(item && item.revisionId || '');
      if(!id || seen.has(id))return false;
      seen.add(id);return true;
    });
  }
  function revisionLabel(item,index,total,active){
    let label=_t('revision.number','Version {{number}}').replace('{{number}}',String(Math.max(1,total-index)));
    if(String(item.revisionId||'')===active)label+=' · '+_t('revision.current','Current');
    else if(item.parentRevisionId===null)label+=' · '+_t('revision.original','Original');
    if(item.createdAt){
      try{
        const I=typeof globalThis!=='undefined'?globalThis.I18N:null;
        const lang=I&&typeof I.getLang==='function'?I.getLang():'en';
        const date=new Date(item.createdAt);
        if(!isNaN(date.getTime()))label+=' · '+date.toLocaleString(lang==='zh'?'zh-CN':lang==='ja'?'ja-JP':'en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      }catch(_){}
    }
    return label;
  }

function clipCardInnerHTML(clip, stats, fmtSec, escapeHtml, revInfo, selectedPreset, selectedClipId, audioConvertState, multiSelectOpts){
    clip = clip || {};
    stats = stats || {};
    multiSelectOpts = multiSelectOpts || {};
    fmtSec = (typeof fmtSec === 'function') ? fmtSec : _defaultFmtSec;
    escapeHtml = (typeof escapeHtml === 'function') ? escapeHtml : _defaultEscapeHtml;

    const _tDefaults = { 'cliplib.play':'Play', 'cliplib.addToSong':'Add to Song', 'cliplib.convertSegment':'Convert selected segment', 'cliplib.convertSegmentTitle':'Transcribe the selected time range into editable notes (server)', 'cliplib.edit':'Edit', 'cliplib.remove':'Remove', 'cliplib.optimize':'Optimize', 'cliplib.details':'Details', 'cliplib.preset':'Preset', 'cliplib.default':'Default', 'cliplib.notes':'notes', 'cliplib.badgeAudio':'Original audio', 'cliplib.lastOptimized':'Last optimized', 'cliplib.last':'Last', 'cliplib.renameClip':'Clip name', 'transcription.settings':'Transcription settings', 'opt.dynamicsAccent':'Dynamics Accent', 'opt.dynamicsLevel':'Dynamics Level', 'opt.durationGentle':'Duration Gentle' };
    const win = (typeof window !== 'undefined') ? window : null;
    const t = (win && win.I18N && typeof win.I18N.t === 'function') ? (k) => win.I18N.t(k) : (k) => (_tDefaults[k] !== undefined ? _tDefaults[k] : k);

    const id = escapeHtml(clip.id || '');
    const selectedIds = Array.isArray(multiSelectOpts.selectedClipIds) ? multiSelectOpts.selectedClipIds.map(String) : [];
    const isMulti = selectedIds.indexOf(String(clip.id || '')) >= 0;
    const isSelected = isMulti || (selectedClipId && String(clip.id || '') === String(selectedClipId));
    const presetVal = (selectedPreset != null && selectedPreset !== '') ? String(selectedPreset) : '';
    const presetLabel = presetVal === 'dynamics_accent' ? t('opt.dynamicsAccent') : presetVal === 'dynamics_level' ? t('opt.dynamicsLevel') : presetVal === 'duration_gentle' ? t('opt.durationGentle') : t('cliplib.default');
    const rawName = String(clip.name || 'Untitled');
    const SG = (win && win.H2SClipSplitGroup) ? win.H2SClipSplitGroup : null;
    const splitBadge = SG && typeof SG.formatSplitGroupBadge === 'function' ? SG.formatSplitGroupBadge(clip) : '';
    const name = escapeHtml(rawName + splitBadge);
    const notes = Number(stats.count ?? stats.notes ?? 0) || 0;
    const spanSec = Number(stats.spanSec ?? 0) || 0;
    const isAudio = (clip.kind === 'audio');
    const subLine = isAudio
      ? (escapeHtml(t('cliplib.badgeAudio') || 'Original audio') + ' · ' + fmtSec(spanSec))
      : (notes + ' ' + t('cliplib.notes') + ' · ' + fmtSec(spanSec));

    
    
    const headRevId = String(clip.revisionId || '');
    const revItems = revisionItems(revInfo);
    const versions = revItems.length;
    const activeRevId = String((revInfo && revInfo.activeRevisionId) || headRevId || '');

    const activeIndex = Math.max(0,revItems.findIndex(it=>String(it.revisionId||'')===activeRevId));
    const activeItem = revItems[activeIndex] || {revisionId:headRevId,createdAt:clip.updatedAt};
    const activeLabel = revisionLabel(activeItem,activeIndex,Math.max(1,versions),activeRevId);

    const revLine = headRevId
      ? (`<div class="clip-rev" style="margin-top:4px; font-size:12px; opacity:0.7;">` +
         escapeHtml(activeLabel) +
         (versions>1 ? ' · '+escapeHtml(_t('revision.total','{{count}} versions').replace('{{count}}',String(versions))) : '') +
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

    const convPhase = (audioConvertState && audioConvertState.phase) ? String(audioConvertState.phase) : '';
    const convActive = convPhase === 'queued' || convPhase === 'uploading' || convPhase === 'processing';
    const convFailed = convPhase === 'failed' || convPhase === 'timed_out';
    let convStatusHtml = '';
    if (isAudio && convPhase){
      const convKey = convPhase === 'failed' && audioConvertState.errorBucket === 'missing_audio'
        ? 'convert.fail.needImportAudio'
        : (convPhase === 'timed_out' ? 'convert.phase.timedOut' : ('convert.phase.' + convPhase));
      const convFallback = convPhase === 'timed_out'
        ? 'Conversion took too long or timed out. Try again later.'
        : (convPhase === 'failed' ? 'Conversion failed. Try again.' : ('Converting (' + convPhase + ')…'));
      const convMsg = t(convKey, convFallback);
      convStatusHtml = `<div class="clip-convert-status muted" style="font-size:11px;margin-top:4px;word-break:break-word;">${escapeHtml(convMsg)}</div>`;
    }
    const primaryActions = isAudio
      ? (
          `<button class="btn" data-act="play" data-id="${id}">${escapeHtml(t('cliplib.play'))}</button>` +
          `<button class="btn" data-act="downloadAudio" data-id="${id}" title="${escapeHtml(t('cliplib.downloadOriginalTitle'))}">${escapeHtml(t('cliplib.downloadOriginal'))}</button>` +
          `<button class="btn" data-act="add" data-id="${id}">${escapeHtml(t('cliplib.addToSong'))}</button>` +
          `<button class="btn" data-act="audioSeparation" data-id="${id}">${escapeHtml(t('audio.waveform.separate', 'AI stem separation'))}</button>` +
          `<button class="btn primary" data-act="convertToEditable" data-id="${id}" title="${escapeHtml(t('cliplib.convertSegmentTitle'))}"${convActive ? ' disabled' : ''}>${escapeHtml(t('cliplib.convertSegment'))}</button>` +
          `<button class="btn transcriptionSettingsIconBtn" type="button" data-act="transcriptionSettings" data-id="${id}" title="${escapeHtml(t('transcription.settings'))}" aria-label="${escapeHtml(t('transcription.settings'))}"${convActive ? ' disabled' : ''}>&#9881;</button>`
        )
      : (
          `<button class="btn" data-act="play" data-id="${id}">${escapeHtml(t('cliplib.play'))}</button>` +
          `<button class="btn" data-act="add" data-id="${id}">${escapeHtml(t('cliplib.addToSong'))}</button>` +
          `<button class="btn" data-act="edit" data-id="${id}">${escapeHtml(t('cliplib.edit'))}</button>` +
          (presetVal ? `<span class="clip-preset-label" style="font-size:11px; opacity:0.7;">${escapeHtml(t('cliplib.preset'))}: ${escapeHtml(presetLabel)}</span>` : '') +
          `<button class="btn" data-act="optimize" data-id="${id}">${escapeHtml(t('cliplib.optimize'))}</button>`
        );

    return (
      `<div class="clip-card clipCard${isSelected ? ' clipSelected' : ''}${isMulti && selectedIds.length > 1 ? ' clipMultiSelected' : ''}${isAudio ? ' clip-card-audio' : ''}" data-clip-id="${id}" data-clip-kind="${isAudio ? 'audio' : 'note'}">` +
        `<div class="clip-title">${isAudio ? ('<span class="clip-badge">' + escapeHtml(t('cliplib.badgeAudio') || 'Original audio') + '</span> ') : ''}` +
          `<input type="text" class="clip-name-input" data-act="clipName" data-id="${id}" data-initial-value="${name}" value="${name}" aria-label="${escapeHtml(t('cliplib.renameClip'))}" />` +
        `</div>` +
        `<div class="clip-sub">${subLine}</div>` +
        lastLineHtml +
        `<div class="clip-actions" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; align-items:center;">` +
          primaryActions +
        `</div>` +
        convStatusHtml +
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
      const items = revisionItems(revInfo);
      const activeItem = items.find(it => String(it.revisionId || '') === active) || items.find(it => it && it.isActive) || items[0] || null;
      const hasParent = !!(activeItem && activeItem.parentRevisionId);

      const opts = items.map((it,index) => {
        const ridRaw = String(it.revisionId || '');
        const rid = escapeHtml(ridRaw);
        const label = escapeHtml(revisionLabel(it,index,items.length,active));
        const sel = (ridRaw === active) ? ' selected' : '';
        return `<option value="${rid}"${sel}>${label}</option>`;
      }).join('');

      const selectDisabled = (items.length <= 1) ? ' disabled' : '';
      const rollbackDisabled = hasParent ? '' : ' disabled';
      const useDisabled = (items.length <= 1) ? ' disabled' : '';
      const abDisabled = hasParent ? '' : ' disabled';

      revHtml = (
        `<div class="clip-revisions" style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">` +
          `<span style="font-size:12px; opacity:0.7;">${escapeHtml(_t('revision.heading','Version'))}</span>` +
          `<select data-act="inspRevSelect" data-id="${id}" aria-label="${escapeHtml(_t('revision.select','Select clip version'))}" style="padding:4px 6px; max-width:220px;"${selectDisabled}>${opts}</select>` +
          `<button class="btn" data-act="inspRevActivate" data-id="${id}" style="padding:4px 8px;"${useDisabled}>${escapeHtml(_t('revision.use','Use version'))}</button>` +
          `<button class="btn" data-act="inspRollbackRev" data-id="${id}" style="padding:4px 8px;"${rollbackDisabled}>${escapeHtml(_t('revision.rollback','Restore previous version'))}</button>` +
          `<button class="btn" data-act="inspAbToggle" data-id="${id}" title="${escapeHtml(_t('revision.compare','Compare versions'))}" style="padding:4px 8px;"${abDisabled}>A/B</button>` +
        `</div>`
      );
    }
    return revHtml;
  }

  return {
    emptyMessage,
    emptyMessageHTML,
    clipCardInnerHTML,
    historyControlsHTML,
  };
});
