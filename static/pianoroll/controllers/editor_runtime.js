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
      const center = Math.round((st.minPitch + st.maxPitch) / 2);
      this.state.modal.pitchCenter = H2SProject.clamp(center, 0, 127);
      $('#rngPitchCenter').value = this.state.modal.pitchCenter;

      $('#modalTitle').textContent = `Editing: ${clip.name}`;
      $('#modalSub').textContent = `notes ${st.count} | pitch ${H2SProject.midiToName(st.minPitch)}..${H2SProject.midiToName(st.maxPitch)} | span ${fmtSec(st.spanSec)}`;
      $('#modal').classList.add('show');
      $('#modal').setAttribute('aria-hidden', 'false');

      $('#editorStatus').textContent = 'Tip: Q toggle Snap, [ ] change grid, hold Alt to bypass Snap while dragging.';

      this.modalUpdateRightPanel();
      this.modalResizeCanvasToContent();
      this.modalRequestDraw();
      log(`Open editor: ${clip.name}`);
    },

    closeModal(save){
      if (!this.state.modal.show) return;
      this.modalStop();

      const clipId = this.state.modal.clipId;
      const clip = _findClip(this.project, clipId);

      const bpm = this.project && this.project.bpm ? this.project.bpm : 120;
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
                // keep pitch/vel in range
                n.pitch = H2SProject.clamp(Number(n.pitch) || 0, 0, 127);
                n.velocity = H2SProject.clamp(Number(n.velocity) || 80, 1, 127);
              }
            }
          }

          clip.score = scoreBeat;
          _recomputeClipMetaFromBeatScore(clip, scoreBeat);
          persist();
          this.render();
          log('Saved clip changes (beats).');
        } else {
          // Legacy seconds storage (v1)
          clip.score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
          const st = H2SProject.scoreStats(clip.score);
          clip.meta = { notes: st.count, pitchMin: st.minPitch, pitchMax: st.maxPitch, spanSec: st.spanSec };
          persist();
          this.render();
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
      const bpm = this.project.bpm || 120;
      const beat = 60 / bpm; // quarter note
      if (v === 'off') return 0;
      const denom = Number(v);
      // denom=16 -> 1/16 note = beat*(4/16)=beat/4
      return beat * (4 / denom);
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
      const gridSec = this.modalSnapSec() || (60/(this.project.bpm||120))/4; // fallback 1/16
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
      if (m.mode === 'drag_note' || m.mode === 'resize_note'){
        m.mode = 'none';
        $('#editorStatus').textContent = 'Ready.';
        this.modalRequestDraw();
      }

      // instance dragging on timeline
      if (this.state.draggingInstance){
        const instId = this.state.draggingInstance;
        const inst = this.project.instances.find(x => x.id === instId);
        if (inst){
          const tracksEl = $('#tracks');
          const rect = tracksEl.getBoundingClientRect();
          const pxPerSec = this.project.ui.pxPerSec || 160;
          const x = ev.clientX - rect.left - 120 - this.state.dragOffsetX;
          inst.startSec = Math.max(0, x / pxPerSec);
          persist();
          this.render();
        }
        this.state.draggingInstance = null;
      }
    },

    modalInsertNote(){
      if (!this.state.modal.show) return;
      const score = this.state.modal.draftScore;
      if (!score.tracks || score.tracks.length === 0){
        score.tracks = [{ id:H2SProject.uid('trk_'), name:'Track 1', notes:[] }];
      }
      const tr = score.tracks[0];

      let cell = this.state.modal.selectedCell;
      if (!cell){
        // if no cell selected, use cursor and middle pitch
        cell = { startSec: this.state.modal.cursorSec || 0, pitch: this.state.modal.pitchCenter || 60 };
      }

      const g = this.modalSnapSec();
      const dur = (g && g > 0) ? g : 0.25;
      const note = {
        id: H2SProject.uid('n_'),
        pitch: cell.pitch,
        start: cell.startSec,
        duration: dur,
        velocity: 100
      };
      tr.notes.push(note);
      this.state.modal.selectedNoteId = note.id;
      this.state.modal.dirty = true;

      // move cursor to the end of inserted note (nice for step input)
      this.state.modal.cursorSec = this.modalQuantize(note.start + note.duration);
      this.state.modal.selectedCell = { startSec: this.state.modal.cursorSec, pitch: cell.pitch };

      this.modalResizeCanvasToContent();
      this.modalRequestDraw();
      $('#editorStatus').textContent = `Inserted note at ${fmtSec(note.start)} pitch ${H2SProject.midiToName(note.pitch)}.`;
    },

    modalDeleteSelectedNote(){
      if (!this.state.modal.show) return;
      const id = this.state.modal.selectedNoteId;
      if (!id) return;
      const found = this.modalFindNoteById(id);
      if (!found) return;
      found.track.notes.splice(found.index, 1);
      this.state.modal.selectedNoteId = null;
      this.state.modal.dirty = true;
      this.modalResizeCanvasToContent();
      this.modalRequestDraw();
      $('#editorStatus').textContent = 'Deleted note.';
    },

    async modalPlay(){
      if (!this.state.modal.show) return;
      if (this.state.modal.isPlaying){ this.modalStop(); return; }
      const ok = await this.ensureTone();
      if (!ok){ alert('Tone.js not available.'); return; }
      await Tone.start();

      const score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
      const startAt = this.state.modal.cursorSec || 0;
      const synth = new Tone.PolySynth(Tone.Synth).toDestination();
      this.state.modal.synth = synth;

      Tone.Transport.stop();
      Tone.Transport.cancel();
      Tone.Transport.seconds = 0;
      Tone.Transport.bpm.value = this.project.bpm || 120;

      let maxT = 0;
      for (const tr of score.tracks || []){
        for (const n of tr.notes || []){
          const end = n.start + n.duration;
          if (end < startAt) continue;
          const rel = Math.max(0, n.start - startAt);
          maxT = Math.max(maxT, rel + n.duration);
          Tone.Transport.schedule((time) => {
            const pitch = H2SProject.clamp(Math.round(n.pitch || 60), 0, 127);
            const vel = H2SProject.clamp(Math.round(n.velocity || 100), 1, 127)/127;
            synth.triggerAttackRelease(Tone.Frequency(pitch, "midi"), n.duration, time, vel);
          }, rel);
        }
      }

      Tone.Transport.start("+0.05");
      this.state.modal.isPlaying = true;
      $('#editorStatus').textContent = 'Playing...';

      const tick = () => {
        if (!this.state.modal.isPlaying) return;
        const sec = startAt + (Tone.Transport.seconds || 0);
        this.state.modal.cursorSec = sec;
        $('#pillCursor').textContent = `Cursor: ${fmtSec(sec)}`;
        this.modalRequestDraw();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      setTimeout(()=>{ if (this.state.modal.isPlaying) this.modalStop(); }, Math.ceil((maxT + 0.2) * 1000));
    },

    modalStop(){
      if (!this.state.modal.show) return;
      if (window.Tone){
        try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){}
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
