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
      const project = getProject();
      const clips = _getProjectClips(project);
      if (!clips.length){
        rootEl.innerHTML = view.emptyMessage();
        return;
      }
      let html = '';
      for (const clip of clips){
        const stats = _clipStats(project, clip);
        const revInfo = (P && typeof P.listClipRevisions === 'function') ? P.listClipRevisions(clip) : null;
        html += view.clipCardInnerHTML(clip, stats, fmtSec, escapeHtml, revInfo);
      }
      rootEl.innerHTML = html;
    }

    function _handleClick(e){
      const btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const clipId = btn.getAttribute('data-id') || btn.getAttribute('data-clip-id');
      if (!act || !clipId) return;

      // Prefer explicit callbacks; fallback to common app methods if opts.app is provided.
      const app = opts.app;

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

      // T3-1: activate selected revision
      if (act === 'revActivate'){
        const sel = rootEl.querySelector(`select[data-act="revSelect"][data-id="${CSS && CSS.escape ? CSS.escape(clipId) : clipId}"]`)
                  || rootEl.querySelector(`select[data-act="revSelect"][data-id="${clipId}"]`);
        const revId = sel ? sel.value : null;
        if (!revId) return;
        const project = getProject();
        if (P && typeof P.setClipActiveRevision === 'function'){
          const res = P.setClipActiveRevision(project, clipId, revId);
          if (res && res.ok){
            _notifyChanged('clipRevision');
            render();
          }else{
            console.warn('[LibraryController] setClipActiveRevision failed', res);
          }
        }
        return;
      }
    }

    function _handleChange(e){
      // placeholder: could show preview info
      const el = e.target;
      if (!el || !el.getAttribute) return;
      const act = el.getAttribute('data-act');
      if (act === 'revSelect'){
        // no-op for now
        return;
      }
    }

    if (rootEl){
      rootEl.addEventListener('click', _handleClick);
      rootEl.addEventListener('change', _handleChange);
    }

    return { render };
  }

  window.H2SLibraryController = { create };
  if (typeof module !== 'undefined') module.exports = window.H2SLibraryController;
})();
