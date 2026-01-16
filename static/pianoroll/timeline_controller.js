/* Hum2Song Studio MVP - timeline_controller.js (v1)
   Plain script (NO modules). Provides a stable Timeline controller that:
   - renders timeline lanes + instances
   - handles instance selection, drag (in-place), and double-click open
   - prevents DOM rebuild during drag (root cause of prior regressions)
   - optional debug probes (URL ?debug_timeline=1 or localStorage.h2s_timeline_debug="1")
*/
(function(){
  'use strict';

  const VERSION = 'timeline_controller_v1';

  function $(sel){ return document.querySelector(sel); }

  function escapeHtml(s){
    return String(s || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function fmtSec(sec){
    const n = Number(sec || 0);
    return n.toFixed(2) + 's';
  }

  function isDebugEnabled(){
    try{
      const u = new URL(window.location.href);
      if (u.searchParams.get('debug_timeline') === '1') return true;
    }catch(e){}
    try{
      return String(localStorage.getItem('h2s_timeline_debug') || '') === '1';
    }catch(e){}
    return false;
  }

  function dbg(ctrl, ...args){
    if (!ctrl._debug) return;
    console.log('[Timeline]', ...args);
  }

  /**
   * createTimelineController(config)
   * Required config:
   * - tracksEl: the #tracks container
   * - getProject(): returns current project doc
   * - getState(): returns app state (must include selectedInstanceId, dragCandidate, draggingInstance)
   * - onSelectInstance(instId, el)
   * - onOpenClipEditor(clipId)
   * - onAddClipToTimeline(clipId, startSec, trackIndex)
   * - onPersistAndRender(): called on commit (pointerup after drag OR click empty moves playhead)
   *
   * Optional:
   * - escapeHtml, fmtSec
   * - pxPerSec(): returns px-per-sec (default 160, or project.ui.pxPerSec)
   * - labelWidthPx (default 120)
   */
  function create(config){
    const ctrl = {
      VERSION,
      _cfg: config || {},
      _debug: (config && typeof config.debug === 'boolean') ? config.debug : isDebugEnabled(),
      _bound: false,
      _tracksEl: config.tracksEl,
      _labelW: (config && typeof config.labelWidthPx === 'number') ? config.labelWidthPx : 120,
      _dragThresholdPx: (config && typeof config.dragThresholdPx === 'number') ? config.dragThresholdPx : 4,
      _escapeHtml: (config && config.escapeHtml) ? config.escapeHtml : escapeHtml,
      _fmtSec: (config && config.fmtSec) ? config.fmtSec : fmtSec,
      _getPxPerSec(){
        const proj = config.getProject();
        const ui = proj && proj.ui ? proj.ui : null;
        const v = ui && typeof ui.pxPerSec === 'number' ? ui.pxPerSec : 160;
        return v;
      },
      _ensureBound(){
        if (ctrl._bound) return;
        ctrl._bound = true;

        // Global pointer handlers for timeline drag.
        window.addEventListener('pointermove', onPointerMove, {passive:true});
        window.addEventListener('pointerup', onPointerUp, {passive:true});
        window.addEventListener('pointercancel', onPointerCancel, {passive:true});

        dbg(ctrl, 'bound global pointer handlers', VERSION);
      },
      render(){
        ctrl._ensureBound();

        const tracks = ctrl._tracksEl;
        if (!tracks) return;

        const proj = config.getProject();
        const state = config.getState();
        const pxPerSec = ctrl._getPxPerSec();

        // HARD RULE: never rebuild timeline while dragging (DOM replacement breaks capture/dblclick)
        const cand = state && state.dragCandidate;
        if (cand && cand.started){
          dbg(ctrl, 'render() skipped because dragging is active');
          return;
        }

        tracks.innerHTML = '';

        for (let ti=0; ti<(proj.tracks||[]).length; ti++){
          const lane = document.createElement('div');
          lane.className = 'trackLane';

          const label = document.createElement('div');
          label.className = 'trackLabel';
          label.textContent = (proj.tracks[ti] && proj.tracks[ti].name) ? proj.tracks[ti].name : ('Track ' + (ti+1));
          lane.appendChild(label);

          const grid = document.createElement('div');
          grid.className = 'laneGrid';
          lane.appendChild(grid);

          // drop target
          lane.addEventListener('dragover', (e)=>{ e.preventDefault(); });
          lane.addEventListener('drop', (e)=>{ 
            e.preventDefault();
            const clipId = e.dataTransfer.getData('text/plain');
            if (!clipId) return;
            const rect = tracks.getBoundingClientRect();
            const contentX = (e.clientX - rect.left) + (tracks.scrollLeft || 0);
            const x = contentX - ctrl._labelW;
            const startSec = Math.max(0, x / pxPerSec);
            dbg(ctrl, 'drop clip', clipId, 'start', startSec.toFixed(3), 'track', ti);
            config.onAddClipToTimeline(clipId, startSec, ti);
            // addClipToTimeline likely persists/renders via app, but we don't assume.
          });

          // instances on this track
          for (const inst of (proj.instances||[]).filter(x => (x.trackIndex||0) === ti)){
            const clip = (proj.clips||[]).find(c => c.id === inst.clipId);
            if (!clip) continue;

            const st = (window.H2SProject && window.H2SProject.scoreStats) ? window.H2SProject.scoreStats(clip.score) : {count:0, spanSec:1};
            const w = Math.max(80, (st.spanSec || 1) * pxPerSec);
            const x = ctrl._labelW + (inst.startSec || 0) * pxPerSec;

            const el = document.createElement('div');
            el.className = 'instance';
            if (state && state.selectedInstanceId === inst.id) el.classList.add('selected');
            el.style.left = x + 'px';
            el.style.width = w + 'px';
            el.dataset.instId = inst.id;

            // Prefer view helper (keeps markup stable + supports instBody + data-act remove).
            if (window.H2STimelineView && typeof window.H2STimelineView.instanceInnerHTML === 'function'){
              el.innerHTML = window.H2STimelineView.instanceInnerHTML({
                clipName: clip.name,
                startSec: (typeof inst.startSec === 'number') ? inst.startSec : 0,
                noteCount: (typeof st.count === 'number') ? st.count : 0,
                fmtSec: ctrl._fmtSec.bind(ctrl),
                escapeHtml: ctrl._escapeHtml.bind(ctrl),
              });
            } else {
              el.innerHTML = `
                <div class="instBody" data-role="inst-body">
                  <div class="instTitle">${ctrl._escapeHtml(clip.name)}</div>
                  <div class="instSub"><span>${ctrl._fmtSec(inst.startSec)}</span><span>${st.count} notes</span></div>
                </div>
                <button class="instRemove" type="button" data-act="remove" title="Remove" aria-label="Remove">×</button>
              `;
            }

            // Remove button should not start drag / change playhead.
            const btnRemove = el.querySelector('[data-act="remove"], .instRemove');
            if (btnRemove){
              btnRemove.addEventListener('pointerdown', (e)=>{ e.preventDefault(); e.stopPropagation(); });
              btnRemove.addEventListener('click', (e)=>{
                e.preventDefault();
                e.stopPropagation();
                dbg(ctrl, 'remove inst', inst.id);
                if (config.onRemoveInstance) config.onRemoveInstance(inst.id);
              });
            }

            // IMPORTANT: selection is handled in pointerdown to keep DOM stable for drag/dblclick.
            const hit = el.querySelector('.instBody') || el;
            hit.addEventListener('pointerdown', (e)=> instancePointerDown(e, inst.id, el));
            // Stop bubbling so the timeline background handler won't move the playhead.
            el.addEventListener('click', (e)=>{ e.stopPropagation(); });
            // Native dblclick is reliable as long as we don't rebuild DOM between clicks.
            hit.addEventListener('dblclick', (e)=>{ e.stopPropagation(); dbg(ctrl,'dblclick inst', inst.id); if (config.onOpenClipEditor) config.onOpenClipEditor(inst.clipId); });

            lane.appendChild(el);
          }

          tracks.appendChild(lane);
        }

        // playhead line
        const playhead = document.createElement('div');
        playhead.className = 'playhead';
        const x = ctrl._labelW + ((proj.ui && proj.ui.playheadSec) ? proj.ui.playheadSec : 0) * pxPerSec;
        playhead.style.left = x + 'px';
        tracks.appendChild(playhead);

        // Click empty timeline -> move playhead
        tracks.onclick = (e) => {
          if (e.target && e.target.closest && e.target.closest('.instance')) return;
          const rect = tracks.getBoundingClientRect();
          const contentX = (e.clientX - rect.left) + (tracks.scrollLeft || 0);
          const sec = Math.max(0, (contentX - ctrl._labelW) / pxPerSec);
          dbg(ctrl, 'click empty -> playhead', sec.toFixed(3));
          const proj2 = config.getProject();
          proj2.ui = proj2.ui || {};
          proj2.ui.playheadSec = sec;
          config.onPersistAndRender();
        };
      }
    };

    function instancePointerDown(ev, instId, el){
      // Never preventDefault for mouse; dblclick relies on native click stream.
      if (ev.pointerType && ev.pointerType !== 'mouse'){
        try{ ev.preventDefault(); }catch(e){}
      }
      ev.stopPropagation();

      const proj = config.getProject();
      const state = config.getState();

      // Select without rebuilding whole timeline.
      config.onSelectInstance(instId, el);

      const rect = el.getBoundingClientRect();
      state.dragCandidate = {
        instId,
        el,
        pointerId: ev.pointerId,
        startClientX: ev.clientX,
        offsetX: ev.clientX - rect.left,
        started: false,
        _elConnectedAtDown: el.isConnected
      };
      dbg(ctrl, 'pointerdown inst', instId);
    }

    function onPointerMove(ev){
      const state = config.getState();
      const cand = state.dragCandidate;
      if (!cand) return;
      if (cand.pointerId !== ev.pointerId) return;

      const dx = ev.clientX - cand.startClientX;

      if (!cand.started){
        if (Math.abs(dx) < ctrl._dragThresholdPx) return;

        // Start dragging only after threshold.
        cand.started = true;
        state.draggingInstance = cand.instId;

        // Capture pointer now so drag remains stable even if cursor leaves element.
        try{ cand.el.setPointerCapture(cand.pointerId); }catch(e){}

        // Probe: DOM must stay connected
        if (!cand.el.isConnected){
          console.warn('[Timeline] Drag started but element is disconnected. This usually means timeline was re-rendered during pointerdown.');
        }
        dbg(ctrl, 'drag start', cand.instId);
      }

      // Probe: if element got replaced during drag, warn loudly
      if (!cand.el.isConnected){
        console.warn('[Timeline] Drag element disconnected mid-drag. DO NOT rebuild timeline DOM during drag (render must be deferred to pointerup).');
        return;
      }

      const proj = config.getProject();
      const inst = (proj.instances||[]).find(x => x.id === cand.instId);
      if (!inst) return;

      const pxPerSec = ctrl._getPxPerSec();
      const tracks = ctrl._tracksEl;

      // Convert clientX to timeline content X (tracks is scrollable)
      const rect = tracks.getBoundingClientRect();
      const contentX = (ev.clientX - rect.left) + (tracks.scrollLeft || 0);

      // Keep the pointer at the same offset inside the block
      const left = contentX - cand.offsetX;

      // Convert left (relative to tracks content) to startSec
      let startSec = Math.max(0, (left - ctrl._labelW) / pxPerSec);

      // Snap (music grid): default 1/16, hold Alt to bypass snap.
      if (!ev.altKey){
        const bpm = (proj && proj.bpm) ? proj.bpm : 120;
        const beatSec = 60 / bpm;
        const gridSec = beatSec / 4; // 1/16 note in seconds
        if (gridSec > 0){
          startSec = Math.round(startSec / gridSec) * gridSec;
        }
      }

      inst.startSec = startSec;

      // Update DOM in-place (NO full render!)
      cand.el.style.left = (ctrl._labelW + startSec * pxPerSec) + 'px';

      dbg(ctrl, 'drag move', cand.instId, startSec.toFixed(3));
    }

    function onPointerUp(ev){
      const state = config.getState();
      const cand = state.dragCandidate;
      if (!cand) return;
      if (cand.pointerId !== ev.pointerId) return;

      if (cand.started){
        dbg(ctrl, 'drag end', cand.instId);
        try{ cand.el.releasePointerCapture(cand.pointerId); }catch(e){}
        state.draggingInstance = null;
        state.dragCandidate = null;

        // Commit
        config.onPersistAndRender();
      } else {
        // Click without drag: selection already handled in pointerdown.
        dbg(ctrl, 'click (no drag)', cand.instId);
        state.dragCandidate = null;
      }
    }

    function onPointerCancel(ev){
      const state = config.getState();
      const cand = state.dragCandidate;
      if (!cand) return;
      if (cand.pointerId !== ev.pointerId) return;

      dbg(ctrl, 'pointercancel', cand.instId);
      try{ cand.el.releasePointerCapture(cand.pointerId); }catch(e){}
      state.draggingInstance = null;
      state.dragCandidate = null;
    }

    return ctrl;
  }

  window.H2STimeline = { VERSION, create };
})();
