/* Hum2Song Studio MVP - controllers/library_controller.js
   Plain script (no import/export). Exposes window.H2SLibraryController.

   Responsibilities:
   - Render clip cards using H2SLibraryView
   - Wire up actions: play/add/edit/remove
   - T3-1: show clip version chain (revisionId/parentRevisionId) and allow rollback (activate revision)
*/
(function(){
  'use strict';

  function _escapeHtmlDefault(s){
    return String(s ?? '').replace(/[&<>"']/g, m=>({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m]));
  }

  function _fmtSecDefault(sec){
    const s = Number(sec||0);
    if (!isFinite(s)) return '0:00';
    const mm = Math.floor(s/60);
    const ss = Math.max(0, Math.round(s - mm*60));
    return mm + ':' + String(ss).padStart(2,'0');
  }

  function _getProjectClips(project){
    if (!project) return [];
    const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
    const isV2 = !!(P && typeof P.isProjectV2 === 'function' && P.isProjectV2(project));
    if (isV2){
      const map = (project.clips && typeof project.clips === 'object' && !Array.isArray(project.clips)) ? project.clips : {};
      const order = Array.isArray(project.clipOrder) ? project.clipOrder : Object.keys(map);
      const out = [];
      const seen = new Set();
      for (const id of order){
        if (map[id]){ out.push(map[id]); seen.add(id); }
      }
      for (const id of Object.keys(map)){
        if (!seen.has(id)) out.push(map[id]);
      }
      return out;
    }
    if (Array.isArray(project.clips)) return project.clips;
    return [];
  }

  function _clipStats(project, clip){
    clip = clip || {};
    // Prefer v2 meta if available
    const meta = clip.meta || {};
    const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
    if (meta && typeof meta.spanBeat === 'number' && P && typeof P.beatToSec === 'function'){
      const bpm = (P && typeof P.getProjectBpm === 'function') ? P.getProjectBpm(project) : (project && project.meta ? project.meta.bpm : 120);
      const spanSec = P.beatToSec(meta.spanBeat, bpm);
      return { count: meta.notes || 0, spanSec: spanSec };
    }
    if (meta && typeof meta.spanSec === 'number'){
      return { count: meta.notes || 0, spanSec: meta.spanSec };
    }
    if (P && typeof P.scoreStats === 'function' && clip.score){
      const st = P.scoreStats(clip.score);
      return { count: st.count || 0, spanSec: st.spanSec || 0 };
    }
    return { count: 0, spanSec: 0 };
  }

  function create(opts){
    opts = opts || {};
    const rootEl = opts.rootEl;
    const view = (typeof window !== 'undefined' && window.H2SLibraryView) ? window.H2SLibraryView : null;
    const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;

    if (!rootEl){
      console.warn('[LibraryController] missing rootEl');
    }

    const escapeHtml = opts.escapeHtml || _escapeHtmlDefault;
    const fmtSec = opts.fmtSec || _fmtSecDefault;

    function getProject(){
      if (typeof opts.getProject === 'function') return opts.getProject();
      return opts.project;
    }

    function dbg(){
      // Debug-gated logging.
      // Prefer app.dbg (Patch A). Fallback to localStorage.h2s_debug gate.
      try{
        const app = opts.app || (typeof window !== 'undefined' ? window.H2SApp : null);
        if (app && typeof app.dbg === 'function') return app.dbg.apply(app, arguments);
      }catch(_){ /* ignore */ }
      try{
        if (typeof localStorage !== 'undefined' && localStorage.h2s_debug === '1'){
          console.log.apply(console, arguments);
        }
      }catch(_){ /* ignore */ }
    }

    function getProjectV2(){
      // Prefer v2 as the single source of truth.
      if (typeof opts.getProjectV2 === 'function') return opts.getProjectV2();
      const app = opts.app || (typeof window !== 'undefined' ? window.H2SApp : null);
      if (app && typeof app.getProjectV2 === 'function') return app.getProjectV2();
      const p = getProject();
      if (P && typeof P.isProjectV2 === 'function' && P.isProjectV2(p)) return p;
      return null;
    }

    function _notifyChanged(reason){
      if (typeof opts.onChange === 'function') opts.onChange(reason || 'library');
      if (typeof opts.onPersist === 'function') opts.onPersist(reason || 'library');
      try{
        if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined'){
          window.dispatchEvent(new CustomEvent('h2s:projectChanged', { detail: { reason: reason || 'library' } }));
        }
      }catch(_){ /* no-op */ }
    }

    function render(){
      if (!rootEl || !view) return;
      const project = getProjectV2() || getProject();
      const clips = _getProjectClips(project);
      if (!clips.length){
        rootEl.innerHTML = view.emptyMessage();
        return;
      }
      const app = opts.app || (typeof window !== 'undefined' ? window.H2SApp : null);
      const getPresetForClip = (app && typeof app.getOptimizePresetForClip === 'function') ? app.getOptimizePresetForClip.bind(app) : null;
      const selectedClipId = (app && app.state && app.state.selectedClipId) ? app.state.selectedClipId : null;
      let html = '';
      for (const clip of clips){
        const stats = _clipStats(project, clip);
        const revInfo = (P && typeof P.listClipRevisions === 'function') ? P.listClipRevisions(clip) : null;
        const selectedPreset = getPresetForClip ? getPresetForClip(clip.id) : null;
        html += view.clipCardInnerHTML(clip, stats, fmtSec, escapeHtml, revInfo, selectedPreset, selectedClipId);
      }
      rootEl.innerHTML = html;
    }

    function _handleClick(e){
      const btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn){
        const t = e.target;
        if (t && t.closest && t.closest('details, summary, button, select, input, textarea, a')) return;
        const card = t && t.closest ? t.closest('.clip-card, .clipCard') : null;
        if (card){
          const clipId = card.getAttribute('data-clip-id');
          if (clipId && typeof opts.onSelectClip === 'function') opts.onSelectClip(clipId);
        }
        return;
      }
      const act = btn.getAttribute('data-act');
      const clipId = btn.getAttribute('data-id') || btn.getAttribute('data-clip-id');
      if (!act || !clipId) return;

      // Prefer explicit callbacks; fallback to common app methods if opts.app is provided.
      const app = opts.app || (typeof window !== 'undefined' ? window.H2SApp : null);
      const projectV2 = getProjectV2();

      if (act === 'play'){
        if (typeof opts.onPlay === 'function') return opts.onPlay(clipId);
        if (app && typeof app.playClip === 'function') return app.playClip(clipId);
        return;
      }
      if (act === 'add'){
        if (typeof opts.onAdd === 'function') return opts.onAdd(clipId);
        if (app && typeof app.addClipToSong === 'function') return app.addClipToSong(clipId);
        if (app && typeof app.addClipInstance === 'function') return app.addClipInstance(clipId);
        return;
      }
      if (act === 'edit'){
        if (typeof opts.onEdit === 'function') return opts.onEdit(clipId);
        if (app && typeof app.openClipEditor === 'function') return app.openClipEditor(clipId);
        return;
      }
      if (act === 'remove'){
        if (typeof opts.onRemove === 'function') return opts.onRemove(clipId);
        if (app && typeof app.removeClip === 'function') return app.removeClip(clipId);
        return;
      }

      // T3-4: Optimize (agent runner v0)
      // PR-D2d: Preset moved to Inspector; Optimize uses stored per-clip options via getOptimizeOptions.
      if (act === 'optimize'){
        // Important: bind this handler in capture phase so we can reliably intercept
        // optimize clicks even if a fallback listener is added later.
        // This also prevents double-handling (e.g. App fallback + controller).
        try{ e.preventDefault(); e.stopPropagation(); }catch(_){ /* ignore */ }
        
        const fn = (app && typeof app.optimizeClip === 'function') ? app.optimizeClip : null;
        if (!fn){
          console.warn('[LibraryController] optimize requested but app.optimizeClip is not available');
          return;
        }
        Promise.resolve(fn.call(app, clipId)).then((res)=>{
          if (res && res.ok && typeof res.ops === 'number'){
            if (res.ops === 0){
              dbg('[opt] no changes (0 ops)', { clipId, revisionId: res.revisionId });
            }else{
              dbg('[opt] applied ops', { clipId, ops: res.ops, revisionId: res.revisionId });
            }
          }
          if (res && res.ok === false){
            console.warn('[LibraryController] optimize returned not ok', res, { clipId });
          }
          // app.optimizeClip is expected to update projectV2 internally; still re-render & persist.
          _notifyChanged('optimize');
          render();
          return res;
        }).catch((err)=>{
          console.warn('[LibraryController] optimize failed', err);
        });
        return;
      }

      // PR-D2a: rollbackRev, abToggle, revActivate moved to Inspector
    }

    function _handleChange(e){
      const el = e.target;
      if (!el || !el.getAttribute) return;
      // PR-D2d: optimizePreset moved to Inspector (inspOptimizePreset)
      // PR-D2a: revSelect moved to Inspector (inspRevSelect)
    }

    if (rootEl){
      // Guard against duplicate bindings if create() is called multiple times.
      // We store handler refs on the root element so we can safely rebind.
      try{
        const prev = rootEl.__h2sLibraryHandlers;
        if (prev){
          // removeEventListener must match the same capture flag used in addEventListener.
          rootEl.removeEventListener('click', prev.click, true);
          rootEl.removeEventListener('click', prev.summaryClick);
          rootEl.removeEventListener('change', prev.change);
        }
      }catch(_){ /* ignore */ }
      function _handleSummaryClick(e){
        const t = e.target;
        if (t && t.closest && t.closest('.clipAdvanced summary, summary')){
          e.stopPropagation();
        }
      }
      try{
        rootEl.__h2sLibraryHandlers = { click: _handleClick, summaryClick: _handleSummaryClick, change: _handleChange };
      }catch(_){ /* ignore */ }
      // Use capture so Optimize can be handled even if a fallback listener is attached later.
      rootEl.addEventListener('click', _handleClick, true);
      rootEl.addEventListener('click', _handleSummaryClick, false);
      rootEl.addEventListener('change', _handleChange);
    }

    return { render };
  }

  window.H2SLibraryController = { create };
  if (typeof module !== 'undefined') module.exports = window.H2SLibraryController;
})();
