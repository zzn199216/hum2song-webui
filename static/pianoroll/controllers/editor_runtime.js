(function(global){
  'use strict';
  // UMD-ish: attach to window.H2SEditorRuntime for browser; module.exports for Node.
  function factory(){
    function create(opts){
      opts = opts || {};
      const root = (typeof window !== 'undefined') ? window : global;
      const H2SProject = opts.H2SProject || (root && root.H2SProject) || null;

      // Dependency injection (keeps this file testable in Node)
      const persist = typeof opts.persist === 'function' ? opts.persist : function(){};
      const log = typeof opts.log === 'function' ? opts.log : function(){};
      const render = typeof opts.render === 'function' ? opts.render : function(){};
      const getProject = typeof opts.getProject === 'function' ? opts.getProject : function(){ return null; };
      const getState = typeof opts.getState === 'function' ? opts.getState : function(){ return null; };

      const getProjectV2 = typeof opts.getProjectV2 === 'function'
        ? opts.getProjectV2
        : function(){ try{ const a = root && root.H2SApp; return (a && typeof a.getProjectV2 === 'function') ? a.getProjectV2() : null; } catch(e){ return null; } };
      const commitV2 = typeof opts.commitV2 === 'function'
        ? opts.commitV2
        : ((root && root.H2SApp && typeof root.H2SApp.commitV2 === 'function') ? function(p, reason){ return root.H2SApp.commitV2(p, reason); } : null);
      const persistFromV1 = typeof opts.persistFromV1 === 'function'
        ? opts.persistFromV1
        : ((root && root.H2SApp && typeof root.H2SApp.persistFromV1 === 'function') ? function(reason){ return root.H2SApp.persistFromV1(reason); } : null);

      const $ = opts.$ || (typeof document !== 'undefined' ? (sel)=>document.querySelector(sel) : null);
      const $$ = opts.$$ || (typeof document !== 'undefined' ? (sel)=>Array.from(document.querySelectorAll(sel)) : null);
      const fmtSec = opts.fmtSec || function(x){ return String(x); };
      const escapeHtml = opts.escapeHtml || function(s){ return String(s||''); };

      // NOTE: In the original monolithic app.js, roundRect() lived in the same closure.
      // After modularization (editor_runtime.js extracted into its own file), that helper
      // may be out of scope, causing a runtime ReferenceError and resulting in a blank
      // piano-roll (grid renders, but notes never render).
      // We define it here so editor drawing is self-contained.
      function roundRect(ctx, x, y, w, h, r){
        if (!ctx) return;
        const rr = Math.max(0, Math.min(Number(r) || 0, Math.min(w, h) / 2));
        if (typeof ctx.roundRect === 'function'){
          ctx.roundRect(x, y, w, h, rr);
          return;
        }
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
      }

      // --- Beats v2 boundary helpers (storage beat, editor works in seconds) ---
      function _firstNote(score){
        try {
          const tr = score && score.tracks && score.tracks[0];
          const n = tr && tr.notes && tr.notes[0];
          return n || null;
        } catch(e){ return null; }
      }

      function _isBeatScore(score){
        if (!score) return false;
        if (score.timebase === 'beat') return true;
        if (Number(score.version) === 2) return true;
        const n = _firstNote(score);
        return !!(n && (Object.prototype.hasOwnProperty.call(n,'startBeat') || Object.prototype.hasOwnProperty.call(n,'durationBeat')));
      }

      function _findClip(project, clipId){
        if(!project || !clipId) return null;
        const clips = project.clips;
        if (Array.isArray(clips)){
          return clips.find(c => c && c.id === clipId) || null;
        }
        if (clips && typeof clips === 'object'){
          if (clips[clipId]) return clips[clipId];
          for (const k of Object.keys(clips)){
            const c = clips[k];
            if (c && c.id === clipId) return c;
          }
        }
        return null;
      }

      function _beatToSec(beat, bpm){
        const b = Number(beat) || 0;
        const t = Number(bpm) || 120;
        if (H2SProject && typeof H2SProject.beatToSec === 'function') return H2SProject.beatToSec(b, t);
        return b * 60 / t;
      }

      function _secToBeat(sec, bpm){
        const s = Number(sec) || 0;
        const t = Number(bpm) || 120;
        if (H2SProject && typeof H2SProject.secToBeat === 'function') return H2SProject.secToBeat(s, t);
        return s * t / 60;
      }

      function _normalizeBeat(x){
        const v = Number(x);
        if (!isFinite(v)) return 0;
        if (H2SProject && typeof H2SProject.normalizeBeat === 'function') return H2SProject.normalizeBeat(v);
        // fallback: float round only (no grid snap)
        return Math.round(v * 1e6) / 1e6;
      }

      function _manualScoreBeatToSec(scoreBeat, bpm){
        const out = {
          version: 1,
          tempo_bpm: (scoreBeat && scoreBeat.tempo_bpm != null) ? scoreBeat.tempo_bpm : (Number(bpm) || 120),
          time_signature: (scoreBeat && scoreBeat.time_signature) ? scoreBeat.time_signature : '4/4',
          tracks: []
        };
        const tracks = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
        out.tracks = tracks.map(t => ({
          id: t.id,
          name: t.name,
          program: t.program,
          channel: t.channel,
          notes: (t.notes || []).map(n => ({
            id: n.id,
            pitch: n.pitch,
            velocity: n.velocity,
            start: _beatToSec(n.startBeat, bpm),
            duration: _beatToSec(n.durationBeat, bpm)
          }))
        }));
        return out;
      }

      function _manualScoreSecToBeat(scoreSec, bpm){
        const out = {
          version: 2,
          tempo_bpm: (scoreSec && scoreSec.tempo_bpm != null) ? scoreSec.tempo_bpm : null,
          time_signature: (scoreSec && scoreSec.time_signature) ? scoreSec.time_signature : null,
          tracks: []
        };
        const tracks = (scoreSec && Array.isArray(scoreSec.tracks)) ? scoreSec.tracks : [];
        out.tracks = tracks.map(t => ({
          id: t.id,
          name: t.name,
          program: t.program,
          channel: t.channel,
          notes: (t.notes || []).map(n => ({
            id: n.id,
            pitch: n.pitch,
            velocity: n.velocity,
            startBeat: _normalizeBeat(Math.max(0, _secToBeat(n.start, bpm))),
            durationBeat: _normalizeBeat(Math.max(0, _secToBeat(n.duration, bpm)))
          }))
        }));
        return out;
      }

      function _scoreBeatToSec(scoreBeat, bpm){
        if (H2SProject && typeof H2SProject.scoreBeatToSec === 'function'){
          return H2SProject.scoreBeatToSec(scoreBeat, bpm);
        }
        return _manualScoreBeatToSec(scoreBeat, bpm);
      }

      function _scoreSecToBeat(scoreSec, bpm){
        if (H2SProject && typeof H2SProject.scoreSecToBeat === 'function'){
          return H2SProject.scoreSecToBeat(scoreSec, bpm);
        }
        return _manualScoreSecToBeat(scoreSec, bpm);
      }

      function _recomputeClipMetaFromBeatScore(clip, scoreBeat){
        const meta0 = (clip && clip.meta) ? clip.meta : {};
        if (H2SProject && typeof H2SProject.recomputeClipMetaFromScoreBeat === 'function' && clip){
          try { H2SProject.recomputeClipMetaFromScoreBeat(clip); return; } catch(e){}
        }
        let count = 0;
        let minP = null;
        let maxP = null;
        let spanBeat = 0;
        const tracks = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
        for (const t of tracks){
          const notes = t && Array.isArray(t.notes) ? t.notes : [];
          for (const n of notes){
            if (!n) continue;
            count += 1;
            const p = Number(n.pitch);
            if (isFinite(p)){
              if (minP == null || p < minP) minP = p;
              if (maxP == null || p > maxP) maxP = p;
            }
            const end = (Number(n.startBeat) || 0) + (Number(n.durationBeat) || 0);
            if (isFinite(end) && end > spanBeat) spanBeat = end;
          }
        }
        if (clip){
          clip.meta = {
            notes: count,
            pitchMin: minP,
            pitchMax: maxP,
            spanBeat: spanBeat,
            sourceTempoBpm: (meta0 && meta0.sourceTempoBpm != null) ? meta0.sourceTempoBpm : ((scoreBeat && scoreBeat.tempo_bpm != null) ? scoreBeat.tempo_bpm : null)
          };
        }
      }


      // Implementation object: methods are copied from app.js modal editor section.
      const impl = {
        // Provide accessors similar to app.js
        get project(){ return getProject(); },
        get state(){ return getState(); },
        render(){
          try { render(); } catch(e){}
        },

        // Ensure Tone.js is available in the browser.
        // - In Node tests there is no `document`, so this must be guarded.
        // - In the browser, local vendor may be missing; we attempt a CDN fallback.
        async ensureTone(){
          const r = (typeof window !== 'undefined') ? window : global;
          if (r && r.Tone) return true;
          if (typeof document === 'undefined') return false;

          // If a loader helper exists on the page, try it first.
          if (r && typeof r.__ensureToneLoaded === 'function'){
            try { await r.__ensureToneLoaded(); } catch(e){}
            if (r.Tone) return true;
          }

          const SRC = 'https://cdn.jsdelivr.net/npm/tone@14.8.49/build/Tone.js';

          return await new Promise((resolve) => {
            try {
              // If a script is already present, wait for it.
              const scripts = Array.from(document.scripts || []);
              const existing = scripts.find(s => (s.src || '').includes('Tone.js') || (s.src || '').toLowerCase().includes('tone'));
              if (existing){
                if (r.Tone) return resolve(true);
                existing.addEventListener('load', () => resolve(!!r.Tone));
                existing.addEventListener('error', () => resolve(false));
                setTimeout(() => resolve(!!r.Tone), 2500);
                return;
              }

              const s = document.createElement('script');
              s.src = SRC;
              s.async = true;
              s.onload = () => resolve(!!r.Tone);
              s.onerror = () => resolve(false);
              document.head.appendChild(s);
              setTimeout(() => resolve(!!r.Tone), 3000);
            } catch(e){
              resolve(false);
            }
          });
        },
    openClipEditor(clipId){
      const clip = _findClip(this.project, clipId);
      if (!clip) return;

      const bpm = this.project && this.project.bpm ? this.project.bpm : 120;
      const projectWantsBeat = !!(this.project && (this.project.timebase === 'beat' || Number(this.project.version) === 2));
      const clipScoreIsBeat = _isBeatScore(clip.score);

      // Editor always operates on a seconds-score draft to preserve the existing interaction feel.
      // If the stored score is beats, we convert beats->seconds on open, and seconds->beats on save.
      let savedScoreSec;
      if (clipScoreIsBeat){
        try { savedScoreSec = _scoreBeatToSec(clip.score, bpm); } catch(e){ savedScoreSec = H2SProject.deepClone(clip.score); }
      } else {
        savedScoreSec = H2SProject.deepClone(clip.score);
      }

      this.state.modal.show = true;
      this.state.modal.clipId = clipId;
      this.state.modal.savedScore = H2SProject.deepClone(savedScoreSec);
      this.state.modal.draftScore = H2SProject.deepClone(savedScoreSec);
      this.state.modal.dirty = false;

      // T3-4: ghost + patch summary (revision UI bridge)
      this.state.modal.ghostScore = null;
      try{
        const parentId = clip && clip.parentRevisionId;
        if (parentId && Array.isArray(clip.revisions)){
          const parent = clip.revisions.find(r => r && r.revisionId === parentId);
          if (parent && parent.score) this.state.modal.ghostScore = H2SProject.deepClone(parent.score);
        }
      }catch(e){}

      try{
        const el = (typeof document !== 'undefined') ? document.getElementById('patchSummary') : null;
        const agent = clip && clip.meta && clip.meta.agent;
        if (el){
          if (agent && agent.patchSummary) el.textContent = JSON.stringify(agent.patchSummary, null, 2);
          else if (agent && typeof agent.patchOps === 'number') el.textContent = JSON.stringify({ ops: agent.patchOps }, null, 2);
          else el.textContent = '(none)';
        }
      }catch(e){}

      // Remember source timebase for save boundary.
      this.state.modal._sourceClipWasBeat = !!clipScoreIsBeat;
      this.state.modal._projectWantsBeat = !!projectWantsBeat;

      // Keep snap memory in sync
      const snapV = this.modalGetSnapValue();
      if (snapV !== 'off') this.state.modal.snapLastNonOff = snapV;
      this.state.modal.cursorSec = 0;
      this.state.modal.selectedNoteId = null;
      this.state.modal.selectedCell = null;
      this.state.modal.mode = 'none';

      const st = H2SProject.scoreStats(this.state.modal.draftScore);

      // Robust pitch center: avoid a single extreme outlier hiding all notes.
      // Use IQR center (mid of 25th/75th percentile), fallback to min/max center.
      let center = Math.round((st.minPitch + st.maxPitch) / 2);
      try {
        const pitches = [];
        for (const t of (this.state.modal.draftScore.tracks || [])){
          for (const n of (t.notes || [])){
            const p = Number(n.pitch);
            if (Number.isFinite(p)) pitches.push(H2SProject.clamp(Math.round(p), 0, 127));
          }
        }
        if (pitches.length){
          pitches.sort((a,b)=>a-b);
          const q = (pp) => pitches[Math.floor((pitches.length - 1) * pp)];
          center = Math.round((q(0.25) + q(0.75)) / 2);
        }
      } catch (e) {
        // ignore and keep fallback center
      }
      this.state.modal.pitchCenter = H2SProject.clamp(center, 0, 127);
      $('#rngPitchCenter').value = this.state.modal.pitchCenter;

      $('#modalTitle').textContent = `Editing: ${clip.name}`;
      $('#modalSub').textContent = `notes ${st.count} | pitch ${H2SProject.midiToName(st.minPitch)}..${H2SProject.midiToName(st.maxPitch)} | span ${fmtSec(st.spanSec)}`;
      $('#modal').classList.add('show');
      $('#modal').setAttribute('aria-hidden', 'false');

      $('#editorStatus').textContent = 'Tip: Q toggle Snap, [ ] change grid, hold Alt to bypass Snap while dragging.';

      this.modalUpdateRightPanel();
      this.modalResizeCanvasToContent();
      this.modalEnsurePitchScrollbar();
      this.modalRequestDraw();
      this.modalBindControls();
      log(`Open editor: ${clip.name}`);
    },


    closeModal(save){
      if (!this.state.modal.show) return;
      this.modalStop();

      const clipId = this.state.modal.clipId;
      const clip = _findClip(this.project, clipId);

      const p2b = getProjectV2();
      const bpm = (p2b && p2b.bpm) ? p2b.bpm : (this.project && this.project.bpm ? this.project.bpm : 120);
      const storeAsBeat = !!(this.state.modal._sourceClipWasBeat || this.state.modal._projectWantsBeat);

      if (save && clip){
        if (storeAsBeat){
          // seconds draft -> beats score (normalize-on-write; no grid snap)
          const draftSec = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
          let scoreBeat = _scoreSecToBeat(draftSec, bpm);

          // Best-effort normalize/clamp in case importer produced weird values.
          if (scoreBeat && Array.isArray(scoreBeat.tracks)) {
            for (const t of scoreBeat.tracks){
              const notes = t && Array.isArray(t.notes) ? t.notes : [];
              for (const n of notes){
                if (!n) continue;
                n.startBeat = _normalizeBeat(Math.max(0, Number(n.startBeat) || 0));
                n.durationBeat = _normalizeBeat(Math.max(0, Number(n.durationBeat) || 0));
                n.pitch = H2SProject.clamp(Number(n.pitch) || 0, 0, 127);
                n.velocity = H2SProject.clamp(Number(n.velocity) || 80, 1, 127);
              }
            }
          }

          // Writeback must go through app's v2 entry when available.
          const p2 = getProjectV2();
          const canCommitV2 = !!(commitV2 && p2 && p2.clips && (p2.clips[clipId] || _findClip(p2, clipId)));
          if (canCommitV2){
            const clip2 = p2.clips[clipId] || _findClip(p2, clipId);
            clip2.score = scoreBeat;
            _recomputeClipMetaFromBeatScore(clip2, scoreBeat);

            let committed = false;
            try { commitV2(p2, 'editor_save'); committed = true; } catch(e){}

            if (committed) log('Saved clip changes (beats, v2).');
            else {
              // If commit fails for some reason, fall back to legacy persistence.
              clip.score = scoreBeat;
              _recomputeClipMetaFromBeatScore(clip, scoreBeat);
              if (persistFromV1) persistFromV1('editor_save_legacy');
              else { persist(); this.render(); }
              log('Saved clip changes (beats, fallback).');
            }
          } else {
            // Legacy fallback: update the currently-mounted clip and persist.
            clip.score = scoreBeat;
            _recomputeClipMetaFromBeatScore(clip, scoreBeat);
            if (persistFromV1) persistFromV1('editor_save_legacy');
            else { persist(); this.render(); }
            log('Saved clip changes (beats).');
          }
        } else {
          // Legacy seconds storage (v1)
          clip.score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
          const st = H2SProject.scoreStats(clip.score);
          clip.meta = Object.assign({}, (clip && clip.meta) ? clip.meta : {}, { notes: st.count, pitchMin: st.minPitch, pitchMax: st.maxPitch, spanSec: st.spanSec });
          if (persistFromV1) persistFromV1('editor_save_legacy');
          else { persist(); this.render(); }
          log('Saved clip changes.');
        }
      } else {
        log('Canceled clip changes.');
      }

      this.state.modal.show = false;
      this.state.modal.clipId = null;
      this.state.modal.draftScore = null;
      this.state.modal.savedScore = null;
      this.state.modal.selectedNoteId = null;
      this.state.modal.selectedCell = null;
      this.state.modal.mode = 'none';
      this.state.modal._sourceClipWasBeat = false;
      this.state.modal._projectWantsBeat = false;
      this.state.modal.pitchScroll = null;

      $('#modal').classList.remove('show');
      $('#modal').setAttribute('aria-hidden', 'true');
    },


    modalTogglePlay(){
      if (this.state.modal.isPlaying) this.modalStop();
      else this.modalPlay();
    },

    modalGetSnapValue(){
      const el = $('#selSnap');
      return el ? String(el.value) : '16';
    },

    modalSetSnapValue(v, opts){
      const el = $('#selSnap');
      if (!el) return;
      const val = String(v);
      el.value = val;
      if (val !== 'off'){
        this.state.modal.snapLastNonOff = val;
      }
      if (!opts || !opts.silent){
        $('#editorStatus').textContent = `Snap = ${val === 'off' ? 'Off' : ('1/' + val)}  (Q toggle, [ ] grid, Alt bypass)`;
      }
      this.modalRequestDraw();
    },

    modalToggleSnap(){
      const cur = this.modalGetSnapValue();
      if (cur !== 'off'){
        this.state.modal.snapLastNonOff = cur;
        this.modalSetSnapValue('off');
      }else{
        const restore = this.state.modal.snapLastNonOff || '16';
        this.modalSetSnapValue(restore);
      }
    },

    modalAdjustSnap(dir){
      // dir: +1 -> finer (bigger denom), -1 -> coarser (smaller denom)
      const order = [4, 8, 16, 32, 64];
      let cur = this.modalGetSnapValue();
      if (cur === 'off'){
        cur = this.state.modal.snapLastNonOff || '16';
      }
      let denom = Number(cur);
      if (!Number.isFinite(denom) || denom <= 0){
        denom = 16;
      }
      let i = order.indexOf(denom);
      if (i === -1) i = 2; // default 16
      i = Math.max(0, Math.min(order.length - 1, i + dir));
      this.modalSetSnapValue(String(order[i]));
    },

    modalSnapSec(){
      const v = this.modalGetSnapValue();
      const bpm = (this.project && this.project.bpm) ? this.project.bpm : 120;
      if (v === 'off') return 0;
      const denom = Number(v);
      if (!Number.isFinite(denom) || denom <= 0) return 0;
      // denom=16 -> 1/16 note = (4/16) beats (since 1 beat = quarter note)
      const beatStep = 4 / denom;
      return H2SProject.beatToSec(beatStep, bpm);
    },

    modalQuantize(x, ev){
      if (ev && ev.altKey) return x;
      const g = this.modalSnapSec();
      if (!g || g <= 0) return x;
      return Math.round(x / g) * g;
    },

    modalResizeCanvasToContent(){
      const wrap = $('#canvasWrap');
      const canvas = $('#canvas');
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const span = Math.max(4, st.spanSec);
      const w = Math.max(1200, Math.ceil(span * this.state.modal.pxPerSec) + 140);
      const h = Math.max(420, wrap.clientHeight - 2);
      canvas.width = w;
      canvas.height = h;
    },

    modalUpdateRightPanel(){
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      $('#kvClipNotes').textContent = String(st.count);
      $('#kvClipPitch').textContent = `${H2SProject.midiToName(st.minPitch)}..${H2SProject.midiToName(st.maxPitch)}`;
      $('#kvClipSpan').textContent = fmtSec(st.spanSec);
      $('#pillCursor').textContent = `Cursor: ${fmtSec(this.state.modal.cursorSec)}`;
      $('#pillSnap').textContent = $('#selSnap').value === 'off' ? 'Snap off' : ('Snap 1/' + $('#selSnap').value);
    },

// Right-side vertical scrollbar for pitch view (so users can reach outlier notes).
// Created dynamically inside #canvasWrap to avoid touching HTML/CSS files.
modalEnsurePitchScrollbar(){
  if (!this.__isBrowser) return;
  try{
    const wrap = $('#canvasWrap');
    if (!wrap || typeof document === 'undefined') return;

    // Ensure positioning context.
    try{
      const cs = window.getComputedStyle(wrap);
      if (cs && cs.position === 'static') wrap.style.position = 'relative';
    }catch(e){}

    let bar = wrap.querySelector('.h2sPitchScroll');
    if (!bar){
      bar = document.createElement('div');
      bar.className = 'h2sPitchScroll';
      bar.style.position = 'absolute';
      bar.style.right = '2px';
      bar.style.top = '2px';
      bar.style.bottom = '2px';
      bar.style.width = '10px';
      bar.style.background = 'rgba(255,255,255,.06)';
      bar.style.border = '1px solid rgba(255,255,255,.10)';
      bar.style.borderRadius = '8px';
      bar.style.zIndex = '5';
      bar.style.cursor = 'pointer';
      bar.style.userSelect = 'none';

      const thumb = document.createElement('div');
      thumb.className = 'h2sPitchThumb';
      thumb.style.position = 'absolute';
      thumb.style.left = '1px';
      thumb.style.right = '1px';
      thumb.style.top = '0px';
      thumb.style.height = '28px';
      thumb.style.background = 'rgba(120,180,255,.45)';
      thumb.style.border = '1px solid rgba(120,180,255,.80)';
      thumb.style.borderRadius = '7px';
      thumb.style.cursor = 'grab';
      thumb.style.userSelect = 'none';

      bar.appendChild(thumb);
      wrap.appendChild(bar);
    }

    const thumb = bar.querySelector('.h2sPitchThumb');
    this.state.modal.pitchScroll = { bar, thumb };
    this._bindPitchScrollHandlers();
  }catch(e){}
},

_applyPitchMin(pitchMin){
  try{
    const rows = this.state.modal.pitchViewRows;
    const maxMin = Math.max(0, 127 - rows);
    const pm = H2SProject.clamp(Math.round(pitchMin), 0, maxMin);
    const half = Math.floor(rows / 2);
    const center = pm + half;
    this.state.modal.pitchCenter = H2SProject.clamp(center, 0, 127);
    const rng = $('#rngPitchCenter');
    if (rng) rng.value = this.state.modal.pitchCenter;
    this.modalRequestDraw();
  }catch(e){}
},

_bindPitchScrollHandlers(){
  if (!this.__isBrowser) return;
  try{
    const g = (typeof window !== 'undefined') ? window : global;
    if (!g) return;
    g.__h2s_pitchscroll_handlers = g.__h2s_pitchscroll_handlers || {};
    const H = g.__h2s_pitchscroll_handlers;

    const getRt = () => (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
    const ps = (getRt().state && getRt().state.modal) ? getRt().state.modal.pitchScroll : null;
    if (!ps || !ps.bar || !ps.thumb) return;

    const bar = ps.bar;
    const thumb = ps.thumb;

    const computePitchMinFromClientY = (clientY, centerThumb) => {
      const rt = getRt();
      const rows = rt.state.modal.pitchViewRows;
      const maxMin = Math.max(0, 127 - rows);
      const rect = bar.getBoundingClientRect();
      const barH = Math.max(1, rect.height || bar.clientHeight || 1);
      const thumbH = Math.max(18, Math.round(barH * (rows / 128)));
      const maxTop = Math.max(0, barH - thumbH);
      const y = clientY - rect.top;
      const t = centerThumb ? (y - thumbH / 2) : y;
      const top = Math.max(0, Math.min(maxTop, t));
      const frac = maxTop > 0 ? (top / maxTop) : 0;
      return Math.round(frac * maxMin);
    };

    if (!H.onPitchBarDown){
      H.onPitchBarDown = (ev) => {
        try{
          const rt = getRt();
          if (!rt || !rt.state.modal.show) return;
          // Ignore clicks that start on the thumb; thumb has its own drag handler.
          if (ev.target && ev.target.classList && ev.target.classList.contains('h2sPitchThumb')) return;
          ev.preventDefault();
          ev.stopPropagation();
          const pm = computePitchMinFromClientY(ev.clientY, true);
          rt._applyPitchMin(pm);
        }catch(e){}
      };
    }
    bar.removeEventListener('pointerdown', H.onPitchBarDown, true);
    bar.addEventListener('pointerdown', H.onPitchBarDown, true);

    if (!H.onPitchThumbDown){
      H.onPitchThumbDown = (ev) => {
        try{
          const rt = getRt();
          if (!rt || !rt.state.modal.show) return;
          ev.preventDefault();
          ev.stopPropagation();
          thumb.setPointerCapture && thumb.setPointerCapture(ev.pointerId);
          thumb.style.cursor = 'grabbing';
          H._dragActive = true;
          H._dragPointerId = ev.pointerId;
        }catch(e){}
      };
    }
    thumb.removeEventListener('pointerdown', H.onPitchThumbDown, true);
    thumb.addEventListener('pointerdown', H.onPitchThumbDown, true);

    if (!H.onPitchMove){
      H.onPitchMove = (ev) => {
        try{
          if (!H._dragActive) return;
          const rt = getRt();
          if (!rt || !rt.state.modal.show) return;
          const pm = computePitchMinFromClientY(ev.clientY, true);
          rt._applyPitchMin(pm);
        }catch(e){}
      };
    }
    if (!H.onPitchUp){
      H.onPitchUp = (ev) => {
        try{
          if (!H._dragActive) return;
          if (H._dragPointerId != null && ev.pointerId !== H._dragPointerId) return;
          H._dragActive = false;
          H._dragPointerId = null;
          try{ thumb.style.cursor = 'grab'; }catch(e){}
        }catch(e){}
      };
    }
    g.removeEventListener('pointermove', H.onPitchMove, true);
    g.addEventListener('pointermove', H.onPitchMove, true);
    g.removeEventListener('pointerup', H.onPitchUp, true);
    g.addEventListener('pointerup', H.onPitchUp, true);
    g.removeEventListener('pointercancel', H.onPitchUp, true);
    g.addEventListener('pointercancel', H.onPitchUp, true);
  }catch(e){}
},

modalUpdatePitchScrollbar(pitchMin, range){
  if (!this.__isBrowser) return;
  try{
    const ps = this.state.modal.pitchScroll;
    if (!ps || !ps.bar || !ps.thumb) return;
    const bar = ps.bar;
    const thumb = ps.thumb;

    const rows = this.state.modal.pitchViewRows;
    const maxMin = Math.max(0, 127 - rows);
    if (range <= rows || maxMin <= 0){
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'block';

    const barH = Math.max(1, bar.clientHeight || 1);
    const thumbH = Math.max(18, Math.round(barH * (rows / 128)));
    const maxTop = Math.max(0, barH - thumbH);
    const frac = maxMin > 0 ? (H2SProject.clamp(pitchMin, 0, maxMin) / maxMin) : 0;
    const top = Math.round(maxTop * frac);

    thumb.style.height = `${thumbH}px`;
    thumb.style.top = `${top}px`;
  }catch(e){}
},

    modalRequestDraw(){
      // coalesce draws
      if (this.state.modal.raf) return;
      this.state.modal.raf = requestAnimationFrame(() => {
        this.state.modal.raf = 0;
        this.modalDraw();
      });
    },

    modalDraw(){
      if (!this.state.modal.show) return;
      const canvas = $('#canvas');
      const ctx = canvas.getContext('2d');
      const st = H2SProject.scoreStats(this.state.modal.draftScore);

      // Determine pitch window
      const rows = this.state.modal.pitchViewRows;
      let pitchMin, pitchMax;
      const range = st.maxPitch - st.minPitch + 1;
      if (range <= rows){
        // auto-fit with small padding
        const pad = 2;
        pitchMin = Math.max(0, st.minPitch - pad);
        pitchMax = Math.min(127, st.maxPitch + pad);
      } else {
        const half = Math.floor(rows / 2);
        const c = this.state.modal.pitchCenter;
        pitchMin = H2SProject.clamp(c - half, 0, 127 - rows);
        pitchMax = pitchMin + rows;
      }


            // Update right-side pitch scrollbar (only visible when range exceeds window)
      this.modalUpdatePitchScrollbar(pitchMin, range);

      const padL = this.state.modal.padL;
      const padT = this.state.modal.padT;

      // row height
      const usableH = canvas.height - padT - 10;
      const totalRows = (pitchMax - pitchMin + 1);
      const rowH = Math.max(12, Math.min(22, Math.floor(usableH / totalRows)));
      this.state.modal.rowH = rowH;

      // background
      ctx.clearRect(0,0,canvas.width,canvas.height);
      // fill gradient
      const g = ctx.createLinearGradient(0,0,0,canvas.height);
      g.addColorStop(0,'rgba(255,255,255,.02)');
      g.addColorStop(1,'rgba(0,0,0,.20)');
      ctx.fillStyle = g;
      ctx.fillRect(0,0,canvas.width,canvas.height);

      // grid
      const pxPerSec = this.state.modal.pxPerSec;
      const bpm = (this.project && this.project.bpm) ? this.project.bpm : 120;
      const gridSec = this.modalSnapSec() || H2SProject.beatToSec(0.25, bpm); // fallback 1/16
      const gridPx = gridSec * pxPerSec;

      // vertical rows
      for (let i=0; i<=totalRows; i++){
        const y = padT + i * rowH + 0.5;
        ctx.strokeStyle = (i % 12 === 0) ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.06)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // time grid
      const startX = padL;
      const endX = canvas.width;
      let k = 0;
      for (let x = startX; x <= endX; x += gridPx){
        const strong = (k % 4 === 0);
        ctx.strokeStyle = strong ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.06)';
        ctx.beginPath();
        ctx.moveTo(Math.floor(x)+0.5, 0);
        ctx.lineTo(Math.floor(x)+0.5, canvas.height);
        ctx.stroke();
        k += 1;
      }

      // labels (left)
      ctx.fillStyle = 'rgba(255,255,255,.65)';
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      for (let p = pitchMax; p >= pitchMin; p--){
        const y = padT + (pitchMax - p) * rowH;
        if (p % 12 === 0){
          ctx.fillText(H2SProject.midiToName(p), 10, y + rowH - 4);
        }
      }

      // selected cell highlight
      if (this.state.modal.selectedCell){
        const cell = this.state.modal.selectedCell;
        if (cell.pitch >= pitchMin && cell.pitch <= pitchMax){
          const x = padL + cell.startSec * pxPerSec;
          const y = padT + (pitchMax - cell.pitch) * rowH;
          ctx.fillStyle = 'rgba(59,130,246,.10)';
          ctx.fillRect(x, y, gridPx, rowH);
          ctx.strokeStyle = 'rgba(96,165,250,.35)';
          ctx.strokeRect(x+0.5, y+0.5, gridPx-1, rowH-1);
        }
      }

      // notes
      // ghost overlay (stroke-only, non-interactive)
      if (this.state.modal.ghostScore){
        const gnotes = [];
        const gscore = this.state.modal.ghostScore;
        if (gscore && gscore.tracks){
          for (const gt of gscore.tracks){
            for (const gn of (gt.notes || [])) gnotes.push(gn);
          }
        }
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        for (const n of gnotes){
          if (n.pitch < pitchMin || n.pitch > pitchMax) continue;
          const x = padL + n.start * pxPerSec;
          const y = padT + (pitchMax - n.pitch) * rowH + 1;
          const w = Math.max(6, n.duration * pxPerSec);
          const h = rowH - 2;
          ctx.strokeRect(Math.floor(x)+0.5, Math.floor(y)+0.5, Math.floor(w), Math.floor(h));
        }
        ctx.restore();
      }

      const notes = this.modalAllNotes();
      for (const n of notes){
        if (n.pitch < pitchMin || n.pitch > pitchMax) continue;
        const x = padL + n.start * pxPerSec;
        const y = padT + (pitchMax - n.pitch) * rowH + 1;
        const w = Math.max(6, n.duration * pxPerSec);
        const h = rowH - 2;
        const selected = (this.state.modal.selectedNoteId === n.id);

        // body
        ctx.fillStyle = selected ? 'rgba(96,165,250,.95)' : 'rgba(59,130,246,.85)';
        ctx.strokeStyle = selected ? 'rgba(255,255,255,.80)' : 'rgba(29,78,216,.90)';
        roundRect(ctx, x, y, w, h, 6);
        ctx.fill();
        ctx.stroke();

        // resize handle (right 10px)
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(x + w - 10, y, 10, h);
      }

      // playhead (cursor)
      const cx = padL + this.state.modal.cursorSec * pxPerSec;
      ctx.strokeStyle = 'rgba(239,68,68,.95)';
      ctx.beginPath();
      ctx.moveTo(Math.floor(cx)+0.5, 0);
      ctx.lineTo(Math.floor(cx)+0.5, canvas.height);
      ctx.stroke();

      // top text
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`Cursor: ${fmtSec(this.state.modal.cursorSec)} (click empty grid to move; click note to select)`, 10, 14);

      this.modalUpdateRightPanel();
    },

    modalAllNotes(){
      const score = this.state.modal.draftScore;
      const out = [];
      if (!score || !score.tracks) return out;
      for (const t of score.tracks){
        for (const n of (t.notes || [])){
          out.push(n);
        }
      }
      return out;
    },

    modalFindNoteById(id){
      const score = this.state.modal.draftScore;
      if (!score || !score.tracks) return null;
      for (const t of score.tracks){
        const idx = (t.notes || []).findIndex(n => n.id === id);
        if (idx >= 0) return { track:t, note:t.notes[idx], index: idx };
      }
      return null;
    },


    // ---- Insert/Delete note controls (buttons + keyboard) ----
    modalBindControls(){
      if (!this.__isBrowser) return;

      // Use a global guard because EditorRuntime instances can be recreated on re-render.
      const g = (typeof window !== 'undefined') ? window : global;
      if (g && g.__h2s_editor_controls_bound) return;
      if (g) g.__h2s_editor_controls_bound = true;

      // Store handler refs on global so we can de-dup even if runtime is recreated.
      g.__h2s_editor_handlers = g.__h2s_editor_handlers || {};
      const H = g.__h2s_editor_handlers;

      const getBtn = (ids) => {
        for (const id of ids){
          const el = (typeof document !== 'undefined') ? document.getElementById(id) : null;
          if (el) return el;
        }
        return null;
      };

      const btnInsert = getBtn(['btnInsertNote','insertNoteBtn','btnInsertNoteBtn']);
      const btnDelete = getBtn(['btnDeleteNote','btnDeleteNoteBtn','deleteNoteBtn']);

      // Click: insert
      if (btnInsert){
        if (!H.onInsertClick){
          H.onInsertClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              // Guard against duplicate click events in the same tick.
              const now = Date.now();
              if (H._lastInsertAt && (now - H._lastInsertAt) < 30) return;
              H._lastInsertAt = now;
              // Use the latest runtime instance (H2SApp.editorRt) if available.
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              rt.modalInsertNote();
            }catch(e){}
          };
        }
        btnInsert.removeEventListener('click', H.onInsertClick, true);
        btnInsert.addEventListener('click', H.onInsertClick, true);
      }

      // Click: delete
      if (btnDelete){
        if (!H.onDeleteClick){
          H.onDeleteClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              rt.modalDeleteSelectedNote();
            }catch(e){}
          };
        }
        btnDelete.removeEventListener('click', H.onDeleteClick, true);
        btnDelete.addEventListener('click', H.onDeleteClick, true);
      }

      // Keyboard: Delete/Backspace remove selected note; Insert adds note.
      if (typeof document !== 'undefined'){
        if (!H.onKeyDown){
          H.onKeyDown = (ev) => {
            try{
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
              if (!rt || !rt.state || !rt.state.modal || !rt.state.modal.show) return;
              const k = String(ev.key || '');
              if (k === 'Delete' || k === 'Backspace'){
                ev.preventDefault();
                rt.modalDeleteSelectedNote();
                return;
              }
              if (k === 'Insert'){
                ev.preventDefault();
                rt.modalInsertNote();
                return;
              }
            }catch(e){}
          };
        }
        document.removeEventListener('keydown', H.onKeyDown, true);
        document.addEventListener('keydown', H.onKeyDown, true);
      }
    },

    modalInsertNote(){
      if (!this.state.modal.show) return;
      const score = this.state.modal.draftScore;
      if (!score || !Array.isArray(score.tracks) || score.tracks.length === 0){
        try { $('#editorStatus').textContent = 'Cannot insert: no track.'; } catch(e){}
        return;
      }
      const t = score.tracks[0];
      t.notes = Array.isArray(t.notes) ? t.notes : [];

      const bpm = (this.project && this.project.bpm) ? this.project.bpm : 120;
      const cell = this.state.modal.selectedCell;
      const startSec = cell ? Number(cell.startSec) : Number(this.state.modal.cursorSec || 0);
      const pitch = cell ? Number(cell.pitch) : Number(this.state.modal.pitchCenter || 60);

      const durSec = Math.max(0.05, (this.modalSnapSec() || H2SProject.beatToSec(0.25, bpm))); // default ~1/16
      const startQ = Math.max(0, this.modalQuantize(Math.max(0, startSec), null));

      const makeId = () => {
        if (H2SProject && typeof H2SProject.makeId === 'function') return H2SProject.makeId('note');
        return 'note_' + Math.random().toString(16).slice(2, 10);
      };

      const note = {
        id: makeId(),
        pitch: H2SProject ? H2SProject.clamp(Math.round(pitch), 0, 127) : Math.max(0, Math.min(127, Math.round(pitch))),
        velocity: 90,
        start: startQ,
        duration: durSec
      };

      t.notes.push(note);
      // Keep notes in time order for predictable hit-test / rendering.
      t.notes.sort((a,b) => (Number(a.start)||0) - (Number(b.start)||0));

      this.state.modal.selectedNoteId = note.id;
      this.state.modal.selectedCell = null;
      this.state.modal.dirty = true;
      try { $('#editorStatus').textContent = `Inserted note ${note.id} @ ${fmtSec(note.start)}.`; } catch(e){}
      this.modalRequestDraw();
    },

    modalDeleteSelectedNote(){
      if (!this.state.modal.show) return;
      const id = this.state.modal.selectedNoteId;
      if (!id){
        try { $('#editorStatus').textContent = 'No note selected.'; } catch(e){}
        return;
      }
      const found = this.modalFindNoteById(id);
      if (!found) {
        this.state.modal.selectedNoteId = null;
        try { $('#editorStatus').textContent = 'Selected note not found.'; } catch(e){}
        return;
      }
      try{
        found.track.notes.splice(found.index, 1);
      }catch(e){}
      this.state.modal.selectedNoteId = null;
      this.state.modal.dirty = true;
      try { $('#editorStatus').textContent = 'Deleted note.'; } catch(e){}
      this.modalRequestDraw();
    },

    modalHitTest(px, py){
      // Return {type:'resize'|'note', noteId} or null
      const canvas = $('#canvas');
      const padL = this.state.modal.padL;
      const padT = this.state.modal.padT;
      const pxPerSec = this.state.modal.pxPerSec;
      const rowH = this.state.modal.rowH;

      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const rows = this.state.modal.pitchViewRows;
      let pitchMin, pitchMax;
      const range = st.maxPitch - st.minPitch + 1;
      if (range <= rows){
        const pad = 2;
        pitchMin = Math.max(0, st.minPitch - pad);
        pitchMax = Math.min(127, st.maxPitch + pad);
      } else {
        const half = Math.floor(rows / 2);
        const c = this.state.modal.pitchCenter;
        pitchMin = H2SProject.clamp(c - half, 0, 127 - rows);
        pitchMax = pitchMin + rows;
      }


      const notes = this.modalAllNotes();
      // search from topmost (later notes last)
      for (let i=notes.length-1; i>=0; i--){
        const n = notes[i];
        if (n.pitch < pitchMin || n.pitch > pitchMax) continue;
        const x = padL + n.start * pxPerSec;
        const y = padT + (pitchMax - n.pitch) * rowH + 1;
        const w = Math.max(6, n.duration * pxPerSec);
        const h = rowH - 2;
        if (px >= x && px <= x+w && py >= y && py <= y+h){
          // resize area: last 10px
          if (px >= x + w - 10) return { type:'resize', noteId:n.id };
          return { type:'note', noteId:n.id };
        }
      }
      return null;
    },


// ---- Playback inside modal (Clip Editor) ----
modalTogglePlay(){
  if (!this.state.modal.show) return;
  if (this.state.modal.isPlaying) return this.modalStop();
  return this.modalPlay();
},

async modalPlay(){

  if (!this.state.modal.show) return;
  if (this.state.modal.isPlaying){ this.modalStop(); return; }

  const ok = await this.ensureTone();
  if (!ok){ alert('Tone.js not available.'); return; }

  // IMPORTANT: Tone.start() must be called from a user gesture (button click).
  // modalPlay() is invoked by the Play button handler, so we can await safely here.
  try { await Tone.start(); } catch(e){}

  const score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
  const startAt = this.state.modal.cursorSec || 0;

  const synth = new Tone.PolySynth(Tone.Synth).toDestination();
  this.state.modal.synth = synth;

  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Transport.seconds = 0;
  Tone.Transport.bpm.value = this.project.bpm || 120;

  let maxT = 0;
  for (const tr of (score.tracks || [])){
    for (const n of (tr.notes || [])){
      const end = (Number(n.start)||0) + (Number(n.duration)||0);
      if (end < startAt) continue;
      const rel = Math.max(0, (Number(n.start)||0) - startAt);
      const dur = Math.max(0, Number(n.duration)||0);
      maxT = Math.max(maxT, rel + dur);
	      Tone.Transport.schedule((time) => {
	        const pitch = H2SProject.clamp(Math.round((n.pitch || 60)), 0, 127);
	        // Accept either MIDI velocity (1..127) or normalized (0..1)
	        let vel = Number(n.velocity);
	        if (!isFinite(vel)) vel = 0.8;
	        if (vel > 1.01) vel = H2SProject.clamp(vel, 1, 127) / 127;
	        else vel = H2SProject.clamp(vel, 0.05, 1.0);
	        synth.triggerAttackRelease(Tone.Frequency(pitch, "midi"), dur, time, vel);
	      }, rel);
    }
  }

  // If no notes after cursor, treat as a no-op but still reset cursor to 0 for UX.
  if (!(maxT > 0)){
    this.state.modal.cursorSec = 0;
    this.modalRequestDraw();
    return;
  }

  Tone.Transport.start("+0.05");
  this.state.modal.isPlaying = true;
  try{ $('#editorStatus').textContent = 'Playing...'; }catch(e){}

  // progress ticker (uses closure vars; do NOT reference them elsewhere)
  const tick = () => {
    if (!this.state.modal.isPlaying) return;
    const sec = startAt + (Tone.Transport.seconds || 0);
    this.state.modal.cursorSec = sec;
    try{ $('#pillCursor').textContent = `Cursor: ${fmtSec(sec)}`; }catch(e){}
    this.modalRequestDraw();

    // Auto-stop when finished, and reset to start.
    if ((Tone.Transport.seconds || 0) >= maxT){
      this.modalStop();
      this.state.modal.cursorSec = 0;
      this.modalRequestDraw();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
},
    modalPointerDown(ev){
      if (!this.state.modal.show) return;
      const wrap = $('#canvasWrap');
      const canvas = $('#canvas');
      const rect = canvas.getBoundingClientRect();
      // account for scroll
      const px = (ev.clientX - rect.left) + wrap.scrollLeft;
      const py = (ev.clientY - rect.top) + wrap.scrollTop;

      // HIT TEST FIRST (fix: note operations have priority)
      const hit = this.modalHitTest(px, py);
      if (hit){
        this.state.modal.selectedNoteId = hit.noteId;
        this.state.modal.selectedCell = null;

        const found = this.modalFindNoteById(hit.noteId);
        if (!found) return;

        const n = found.note;
        this.state.modal.drag.noteId = hit.noteId;
        this.state.modal.drag.startX = px;
        this.state.modal.drag.startY = py;
        this.state.modal.drag.origStart = n.start;
        this.state.modal.drag.origPitch = n.pitch;
        this.state.modal.drag.origDur = n.duration;

        this.state.modal.mode = (hit.type === 'resize') ? 'resize_note' : 'drag_note';
        $('#editorStatus').textContent = (hit.type === 'resize') ? 'Resize note...' : 'Drag note...';
        this.modalRequestDraw();
        return;
      }

      // Click empty -> move cursor + set selected cell
      const padL = this.state.modal.padL;
      const padT = this.state.modal.padT;
      const pxPerSec = this.state.modal.pxPerSec;

      // time
      let tSec = (px - padL) / pxPerSec;
      tSec = Math.max(0, tSec);
      tSec = this.modalQuantize(tSec, ev);
      this.state.modal.cursorSec = tSec;

      // pitch from y
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const rows = this.state.modal.pitchViewRows;
      let pitchMin, pitchMax;
      const range = st.maxPitch - st.minPitch + 1;
      if (range <= rows){
        const pad = 2;
        pitchMin = Math.max(0, st.minPitch - pad);
        pitchMax = Math.min(127, st.maxPitch + pad);
      } else {
        const half = Math.floor(rows / 2);
        const c = this.state.modal.pitchCenter;
        pitchMin = H2SProject.clamp(c - half, 0, 127 - rows);
        pitchMax = pitchMin + rows;
      }

      const rowH = this.state.modal.rowH;
      const row = Math.floor((py - padT) / rowH);
      const pitch = H2SProject.clamp(pitchMax - row, 0, 127);

      this.state.modal.selectedNoteId = null;
      this.state.modal.selectedCell = { startSec: tSec, pitch };

      $('#editorStatus').textContent = `Cursor moved to ${fmtSec(tSec)}; selected cell pitch ${H2SProject.midiToName(pitch)}.`;
      this.modalRequestDraw();
    },

    modalPointerMove(ev){
      if (!this.state.modal.show) return;
      const m = this.state.modal;
      if (m.mode !== 'drag_note' && m.mode !== 'resize_note') return;

      const wrap = $('#canvasWrap');
      const canvas = $('#canvas');
      const rect = canvas.getBoundingClientRect();
      const px = (ev.clientX - rect.left) + wrap.scrollLeft;
      const py = (ev.clientY - rect.top) + wrap.scrollTop;

      const found = this.modalFindNoteById(m.drag.noteId);
      if (!found) return;

      // derive pitch window for mapping y->pitch
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const rows = m.pitchViewRows;
      let pitchMin, pitchMax;
      const range = st.maxPitch - st.minPitch + 1;
      if (range <= rows){
        const pad = 2;
        pitchMin = Math.max(0, st.minPitch - pad);
        pitchMax = Math.min(127, st.maxPitch + pad);
      } else {
        const half = Math.floor(rows / 2);
        const c = m.pitchCenter;
        pitchMin = H2SProject.clamp(c - half, 0, 127 - rows);
        pitchMax = pitchMin + rows;
      }

      const dx = px - m.drag.startX;
      const dy = py - m.drag.startY;

      const secDelta = dx / m.pxPerSec;
      const pitchDelta = -Math.round(dy / m.rowH);

      if (m.mode === 'drag_note'){
        let ns = m.drag.origStart + secDelta;
        ns = Math.max(0, ns);
        ns = this.modalQuantize(ns, ev);
        let np = m.drag.origPitch + pitchDelta;
        np = H2SProject.clamp(np, 0, 127);
        found.note.start = ns;
        found.note.pitch = np;
        m.dirty = true;
        $('#editorStatus').textContent = `Drag: start ${fmtSec(ns)} pitch ${H2SProject.midiToName(np)}`;
      } else {
        let nd = m.drag.origDur + secDelta;
        nd = Math.max(0.05, nd);
        // quantize duration (optional) - hold Alt to bypass snap
        const g = (ev && ev.altKey) ? 0 : this.modalSnapSec();
        if (g && g > 0) nd = Math.max(g, Math.round(nd / g) * g);
        found.note.duration = nd;
        m.dirty = true;
        $('#editorStatus').textContent = `Resize: duration ${fmtSec(nd)}`;
      }

      this.modalRequestDraw();
    },

    modalPointerUp(ev){
      if (!this.state.modal.show) return;
      const m = this.state.modal;
      // finalize note drag/resize
      if (m.mode === 'drag_note' || m.mode === 'resize_note'){
        m.mode = 'none';
        try { $('#editorStatus').textContent = 'Ready.'; } catch(e){}
        this.modalRequestDraw();
      }
    },

    modalStop(){
  if (!this.state.modal.show) return;

  // Cancel UI tick
  if (this._modalRAF){
    try{ cancelAnimationFrame(this._modalRAF); }catch(_){}
    this._modalRAF = null;
  }

  // Stop scheduled notes
  if (this._modalPart){
    try{ this._modalPart.dispose(); }catch(_){}
    this._modalPart = null;
  }

  if (window.Tone){
    try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(_){}
  }

  this.state.modal.isPlaying = false;
  $('#editorStatus').textContent = 'Stopped.';
  this.modalRequestDraw();
},

      };

      // Sanity: in Node, we don't have document; avoid accidental usage.
      impl.__isBrowser = (typeof document !== 'undefined');

      // Expose injected helpers for debugging (optional)
      impl.__deps = { H2SProject, persist, log, render, $, $$, fmtSec, escapeHtml };

      // Rebind free function identifiers used by copied code via closure:
      // - H2SProject, persist, log, $, $$, fmtSec, escapeHtml are in closure scope.
      return impl;
    }

    return { create };
  }

  const api = factory();
  // attach
  if(typeof module !== 'undefined' && module.exports){
    module.exports = api;
  } else {
    global.H2SEditorRuntime = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));