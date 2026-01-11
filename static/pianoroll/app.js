/* Hum2Song Studio MVP - app.js (v8)
   - Fix hit-testing: note interactions have priority over cursor click
   - Add "Insert Note" workflow based on selected grid cell
   - Keep Cancel semantics (draft score)
*/
(function(){
  'use strict';

  const API = {
    generate: (fmt) => `/generate?output_format=${encodeURIComponent(fmt || 'mp3')}`,
    task: (id) => `/tasks/${encodeURIComponent(id)}`,
    score: (id) => `/tasks/${encodeURIComponent(id)}/score`,
  };

  const LS_KEY = 'hum2song_studio_project_v1';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function fmtSec(x){
    if (!isFinite(x)) return '-';
    return (Math.round(x*100)/100).toFixed(2) + 's';
  }

  function log(msg){
    const el = $('#log');
    const t = new Date();
    const line = `[${t.toLocaleTimeString()}] ${msg}\n`;
    el.textContent = line + el.textContent;
    // also console
    console.log(msg);
  }

  function downloadText(filename, text){
    const blob = new Blob([text], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }

  async function fetchJson(url, opts){
    const res = await fetch(url, opts || {});
    const ct = res.headers.get('content-type') || '';
    const txt = await res.text();
    if (!res.ok){
      throw new Error(`${res.status} ${txt}`);
    }
    if (ct.includes('application/json')){
      return JSON.parse(txt);
    }
    // some endpoints may return json without header
    try { return JSON.parse(txt); } catch(e){ return { raw: txt }; }
  }

  function persist(){
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(app.project));
    } catch(e){
      console.warn('persist failed', e);
    }
  }

  function restore(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    }catch(e){
      return null;
    }
  }

  const app = {
    project: null,

    state: {
      selectedInstanceId: null,
      draggingInstance: null,
      dragCandidate: null,
      dragOffsetX: 0,
      transportPlaying: false,
      transportStartPerf: 0,
      lastUploadTaskId: null,
      modal: {
        show: false,
        clipId: null,
        draftScore: null,
        savedScore: null,
        dirty: false,
        cursorSec: 0,
        selectedNoteId: null,
        selectedCell: null, // {startSec, pitch}
        pxPerSec: 180,
        pitchCenter: 60,
        pitchViewRows: 36,
        rowH: 16,
        padL: 60,
        padT: 20,
        mode: 'none', // drag_note | resize_note
        drag: {
          noteId: null,
          startX: 0,
          startY: 0,
          origStart: 0,
          origPitch: 60,
          origDur: 0.3,
        },
        isPlaying: false,
        synth: null,
        raf: 0,
      },
    },

    init(){
      const restored = restore();
      this.project = restored ? (H2SProject.migrateProject ? H2SProject.migrateProject(restored) : restored) : H2SProject.defaultProject();

      // Ensure minimal structure
      if (!this.project.tracks || this.project.tracks.length === 0){
        this.project.tracks = [{id:H2SProject.uid('trk_'), name:'Track 1'}];
      }
      if (!Array.isArray(this.project.clips)) this.project.clips = [];
      if (!Array.isArray(this.project.instances)) this.project.instances = [];

      // Bind UI
      $('#btnUpload').addEventListener('click', () => this.pickWavAndGenerate());
      $('#btnClear').addEventListener('click', () => this.clearProject());
      $('#btnClearLog').addEventListener('click', () => $('#log').textContent = '');

      $('#inpBpm').addEventListener('change', () => {
        const v = Number($('#inpBpm').value || 120);
        this.project.bpm = H2SProject.clamp(v, 30, 260);
        $('#inpBpm').value = this.project.bpm;
        persist();
        this.render();
      });

      $('#btnExportProject').addEventListener('click', () => {
        downloadText(`hum2song_project_${Date.now()}.json`, JSON.stringify(this.project, null, 2));
      });

      $('#btnImportProject').addEventListener('click', async () => {
        const f = await this.pickFile('.json');
        if (!f) return;
        const txt = await f.text();
        try{
          const obj = JSON.parse(txt);
          this.project = obj;
          persist();
          this.render();
          log('Imported project json.');
        }catch(e){
          alert('Invalid JSON.');
        }
      });

      // Transport buttons
      $('#btnPlayProject').addEventListener('click', () => this.playProject());
      $('#btnStop').addEventListener('click', () => this.stopProject());
      $('#btnPlayheadToStart').addEventListener('click', () => { this.project.ui.playheadSec = 0; persist(); this.render(); });

      // Modal
      $('#btnModalClose').addEventListener('click', () => this.closeModal(false));
      $('#btnModalCancel').addEventListener('click', () => this.closeModal(false));
      $('#btnModalSave').addEventListener('click', () => this.closeModal(true));

      $('#btnClipPlay').addEventListener('click', () => this.modalPlay());
      $('#btnClipStop').addEventListener('click', () => this.modalStop());
      $('#btnInsertNote').addEventListener('click', () => this.modalInsertNote());
      $('#btnDeleteNote').addEventListener('click', () => this.modalDeleteSelectedNote());
      $('#selSnap').addEventListener('change', () => this.modalRequestDraw());
      $('#rngPitchCenter').addEventListener('input', () => {
        const v = Number($('#rngPitchCenter').value || 60);
        this.state.modal.pitchCenter = H2SProject.clamp(v, 0, 127);
        this.modalRequestDraw();
      });

      // Canvas interactions
      const canvas = $('#canvas');
      canvas.addEventListener('pointerdown', (ev) => this.modalPointerDown(ev));
      window.addEventListener('pointermove', (ev) => this.modalPointerMove(ev));
      window.addEventListener('pointerup', (ev) => this.modalPointerUp(ev));

      window.addEventListener('keydown', (ev) => {
        if (!this.state.modal.show) return;
        if (ev.key === 'Escape'){ this.closeModal(false); ev.preventDefault(); }
        if (ev.key === 'Delete' || ev.key === 'Backspace'){ this.modalDeleteSelectedNote(); ev.preventDefault(); }
        if (ev.key === ' '){ this.modalTogglePlay(); ev.preventDefault(); }
      });

      this.render();
      log('UI ready.');
    },

    render(){
      // Inspector stats
      $('#kvTracks').textContent = String(this.project.tracks.length);
      $('#kvClips').textContent = String(this.project.clips.length);
      $('#kvInst').textContent = String(this.project.instances.length);
      $('#inpBpm').value = this.project.bpm;

      this.renderClipList();
      this.renderTimeline();
      this.renderSelection();
    },

    renderClipList(){
      const root = $('#clipList');
      root.innerHTML = '';
      if (this.project.clips.length === 0){
        const d = document.createElement('div');
        d.className = 'muted';
        d.textContent = 'No clips yet. Upload WAV to generate one.';
        root.appendChild(d);
        return;
      }

      for (const clip of this.project.clips){
        const st = H2SProject.scoreStats(clip.score);
        const el = document.createElement('div');
        el.className = 'clipCard';
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', clip.id);
        });

        el.innerHTML = `
          <div class="clipTitle">${escapeHtml(clip.name)}</div>
          <div class="clipMeta"><span>${st.count} notes</span><span>${fmtSec(st.spanSec)}</span></div>
          <div class="miniBtns">
            <button class="btn mini" data-act="play">Play</button>
            <button class="btn mini" data-act="add">Add</button>
            <button class="btn mini" data-act="edit">Edit</button>
          </div>
        `;

        el.querySelector('[data-act="play"]').addEventListener('click', (e) => { e.stopPropagation(); this.playClip(clip.id); });
        el.querySelector('[data-act="add"]').addEventListener('click', (e) => { e.stopPropagation(); this.addClipToTimeline(clip.id); });
        el.querySelector('[data-act="edit"]').addEventListener('click', (e) => { e.stopPropagation(); this.openClipEditor(clip.id); });

        root.appendChild(el);
      }
    },

    renderTimeline(){
      const tracks = $('#tracks');
      tracks.innerHTML = '';

      const pxPerSec = this.project.ui && this.project.ui.pxPerSec ? this.project.ui.pxPerSec : 160;

      for (let ti=0; ti<this.project.tracks.length; ti++){
        const lane = document.createElement('div');
        lane.className = 'trackLane';

        const label = document.createElement('div');
        label.className = 'trackLabel';
        label.textContent = this.project.tracks[ti].name || ('Track ' + (ti+1));
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
          // IMPORTANT: the tracks container is scrollable. Convert clientX to timeline content X.
          const tracksEl = document.querySelector('#tracks');
          const rect = tracksEl.getBoundingClientRect();
          const contentX = (e.clientX - rect.left) + (tracksEl.scrollLeft || 0);
          const x = contentX - 120; // after label
          const startSec = Math.max(0, x / pxPerSec);
          this.addClipToTimeline(clipId, startSec, ti);
        });

        // instances
        for (const inst of this.project.instances.filter(x => x.trackIndex === ti)){
          const clip = this.project.clips.find(c => c.id === inst.clipId);
          if (!clip) continue;
          const st = H2SProject.scoreStats(clip.score);
          const w = Math.max(80, st.spanSec * pxPerSec);
          const x = 120 + inst.startSec * pxPerSec;

          const el = document.createElement('div');
          el.className = 'instance';
          if (this.state.selectedInstanceId === inst.id) el.classList.add('selected');
          el.style.left = x + 'px';
          el.style.width = w + 'px';
          el.dataset.instId = inst.id;
          el.innerHTML = `
            <div class="instTitle">${escapeHtml(clip.name)}</div>
            <div class="instSub"><span>${fmtSec(inst.startSec)}</span><span>${st.count} notes</span></div>
          `;

          el.addEventListener('pointerdown', (e) => this.instancePointerDown(e, inst.id));
          // Stop bubbling so the timeline background handler won't move the playhead.
          // (Selection is already handled in pointerdown.)
          el.addEventListener('click', (e)=>{ e.stopPropagation(); });
          // Selection is handled in pointerdown (to keep DOM stable for drag/dblclick).
          el.addEventListener('dblclick', (e)=>{ e.stopPropagation(); this.openClipEditor(inst.clipId); });

          lane.appendChild(el);
        }

        tracks.appendChild(lane);
      }

      // playhead line
      const playhead = document.createElement('div');
      playhead.className = 'playhead';
      const x = 120 + (this.project.ui.playheadSec || 0) * pxPerSec;
      playhead.style.left = x + 'px';
      tracks.appendChild(playhead);

      tracks.onclick = (e) => {
        // Click empty timeline -> move playhead.
        // If click originates from an instance, ignore.
        if (e.target && e.target.closest && e.target.closest('.instance')) return;
        const rect = tracks.getBoundingClientRect();
        const contentX = (e.clientX - rect.left) + (tracks.scrollLeft || 0);
        const sec = Math.max(0, (contentX - 120) / pxPerSec);
        this.project.ui.playheadSec = sec;
        persist();
        this.render();
      };
    },

    renderSelection(){
      const box = $('#selectionBox');
      const id = this.state.selectedInstanceId;
      if (!id){
        box.className = 'muted';
        box.textContent = 'Select a clip instance on timeline.';
        return;
      }
      const inst = this.project.instances.find(x => x.id === id);
      if (!inst){
        box.className = 'muted';
        box.textContent = 'Select a clip instance on timeline.';
        return;
      }
      const clip = this.project.clips.find(c => c.id === inst.clipId);
      box.className = '';
      box.innerHTML = `
        <div class="kv"><b>Clip</b><span>${escapeHtml(clip ? clip.name : inst.clipId)}</span></div>
        <div class="kv"><b>Start</b><span>${fmtSec(inst.startSec)}</span></div>
        <div class="kv"><b>Transpose</b><span>${inst.transpose || 0}</span></div>
        <div class="row" style="margin-top:10px;">
          <button id="btnSelEdit" class="btn mini">Edit</button>
          <button id="btnSelDup" class="btn mini">Duplicate</button>
          <button id="btnSelDel" class="btn mini danger">Remove</button>
        </div>
      `;
      box.querySelector('#btnSelEdit').addEventListener('click', () => this.openClipEditor(inst.clipId));
      box.querySelector('#btnSelDup').addEventListener('click', () => this.duplicateInstance(inst.id));
      box.querySelector('#btnSelDel').addEventListener('click', () => this.deleteInstance(inst.id));
    },

    // IMPORTANT: Selecting an instance MUST NOT re-render the whole timeline on pointerdown.
    // Re-rendering during pointerdown destroys the DOM node currently receiving events,
    // which breaks drag and native dblclick.
    selectInstance(instId, elOpt){
      const prev = this.state.selectedInstanceId;
      this.state.selectedInstanceId = instId;

      // Update selected styles without re-render.
      if (prev && prev !== instId){
        const prevEl = document.querySelector(`.instance[data-inst-id="${cssEsc(prev)}"]`);
        if (prevEl) prevEl.classList.remove('selected');
      }
      const el = elOpt || document.querySelector(`.instance[data-inst-id="${cssEsc(instId)}"]`);
      if (el) el.classList.add('selected');

      // Only update inspector (selection panel). Timeline stays stable.
      this.renderSelection();
    },

    duplicateInstance(instId){
      const inst = this.project.instances.find(x => x.id === instId);
      if (!inst) return;
      const copy = H2SProject.deepClone(inst);
      copy.id = H2SProject.uid('inst_');
      copy.startSec = inst.startSec + 0.2; // small offset to see it
      this.project.instances.push(copy);
      persist();
      log('Duplicated instance.');
      this.render();
    },

    deleteInstance(instId){
      const idx = this.project.instances.findIndex(x => x.id === instId);
      if (idx < 0) return;
      this.project.instances.splice(idx, 1);
      if (this.state.selectedInstanceId === instId) this.state.selectedInstanceId = null;
      persist();
      log('Removed instance.');
      this.render();
    },

    addClipToTimeline(clipId, startSec, trackIndex){
      const inst = H2SProject.createInstance(clipId, startSec || (this.project.ui.playheadSec || 0), trackIndex || 0);
      this.project.instances.push(inst);
      this.state.selectedInstanceId = inst.id;
      persist();
      log('Added clip to timeline.');
      this.render();
    },

    instancePointerDown(ev, instId){
      // Do NOT preventDefault for mouse; it can break native dblclick.
      // For touch/pen, preventDefault reduces accidental page scroll.
      if (ev.pointerType && ev.pointerType !== 'mouse') ev.preventDefault();
      ev.stopPropagation();

      const el = ev.currentTarget;
      this.selectInstance(instId, el);

      const rect = el.getBoundingClientRect();
      this.state.dragCandidate = {
        instId,
        el,
        pointerId: ev.pointerId,
        startClientX: ev.clientX,
        offsetX: ev.clientX - rect.left,
        started: false
      };
    },


    timelinePointerMove(ev){
      if (!this.state.draggingInstance) return;
      // handled in pointermove on window
    },

    timelinePointerUp(ev){
      // handled in pointerup on window
    },

    async pickWavAndGenerate(){
      const f = await this.pickFile('.wav,.mp3,.m4a,.flac,.ogg');
      if (!f) return;

      // Auto-generate on selection
      log(`Uploading ${f.name} ...`);
      try{
        const fd = new FormData();
        fd.append('file', f, f.name);
        const res = await fetchJson(API.generate('mp3'), { method:'POST', body:fd });
        const tid = res.task_id || res.id || res.taskId || res.task || null;
        if (!tid) throw new Error('generate returned no task_id');
        this.state.lastUploadTaskId = tid;
        log(`Generate queued: ${tid}`);
        await this.pollTaskUntilDone(tid);
        // Load score and add to library
        const score = await fetchJson(API.score(tid));
        const clip = H2SProject.createClipFromScore(score, { name: f.name.replace(/\.[^/.]+$/, ''), sourceTaskId: tid });
        this.project.clips.unshift(clip);
        // Also add instance to timeline at playhead
        this.addClipToTimeline(clip.id, this.project.ui.playheadSec || 0, 0);
        persist();
        this.render();
        log(`Clip added: ${clip.name}`);
      }catch(e){
        log(`Error: ${String(e && e.message ? e.message : e)}`);
        alert('Generate failed. Check log.');
      }
    },

    async pollTaskUntilDone(taskId){
      // backend seems to expose GET /tasks/{id} with status
      const maxWaitMs = 180000;
      const start = performance.now();
      while (true){
        const data = await fetchJson(API.task(taskId));
        const status = String((data.status || data.state || data.task_status || data.taskStatus || '')).toLowerCase();
        if (status.includes('completed') || status.includes('done') || status === 'success'){
          log(`Task completed: ${taskId}`);
          return;
        }
        if (status.includes('failed') || status.includes('error')){
          throw new Error(`Task failed: ${JSON.stringify(data)}`);
        }
        if (performance.now() - start > maxWaitMs){
          throw new Error('Task timeout');
        }
        await sleep(800);
      }
    },

    clearProject(){
      if (!confirm('Clear local project (clips + timeline)?')) return;
      this.project = H2SProject.defaultProject();
      persist();
      this.render();
      log('Cleared project.');
    },

    pickFile(accept){
      return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept || '';
        inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
        inp.click();
      });
    },

    /* ---------------- Project playback (simple) ---------------- */
    async ensureTone(){
      // Tone may load async (fallback)
      for (let i=0;i<40;i++){
        if (window.Tone) return true;
        await sleep(50);
      }
      return !!window.Tone;
    },

    async playProject(){
      if (this.state.transportPlaying){
        this.stopProject();
        return;
      }
      const ok = await this.ensureTone();
      if (!ok){
        alert('Tone.js not available.'); return;
      }
      await Tone.start();

      // Flatten instances into a quick schedule on a single synth (MVP)
      const synth = new Tone.PolySynth(Tone.Synth).toDestination();
      const bpm = this.project.bpm || 120;
      const startAt = this.project.ui.playheadSec || 0;

      Tone.Transport.stop();
      Tone.Transport.cancel();
      Tone.Transport.seconds = 0;
      Tone.Transport.bpm.value = bpm;

      let maxT = 0;
      for (const inst of this.project.instances){
        const clip = this.project.clips.find(c => c.id === inst.clipId);
        if (!clip) continue;
        const score = H2SProject.ensureScoreIds(H2SProject.deepClone(clip.score));
        for (const tr of (score.tracks || [])){
          for (const n of (tr.notes || [])){
            const tAbs = inst.startSec + n.start;
            if (tAbs + n.duration < startAt) continue;
            const tRel = (tAbs - startAt);
            maxT = Math.max(maxT, tRel + n.duration);
            Tone.Transport.schedule((time) => {
              const pitch = H2SProject.clamp(Math.round((n.pitch || 60) + (inst.transpose || 0)), 0, 127);
              const vel = H2SProject.clamp(Math.round(n.velocity || 100), 1, 127) / 127;
              synth.triggerAttackRelease(Tone.Frequency(pitch, "midi"), n.duration, time, vel);
            }, tRel);
          }
        }
      }

      Tone.Transport.start("+0.05");
      this.state.transportPlaying = true;
      this.state.transportStartPerf = performance.now();
      log('Project play.');

      const raf = () => {
        if (!this.state.transportPlaying) return;
        const sec = startAt + (Tone.Transport.seconds || 0);
        this.project.ui.playheadSec = sec;
        $('#lblPlayhead').textContent = `Playhead: ${fmtSec(sec)}`;
        this.renderTimeline(); // light redraw
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);

      // auto stop
      setTimeout(()=>{ if (this.state.transportPlaying) this.stopProject(); }, Math.ceil((maxT + 0.2) * 1000));
    },

    stopProject(){
      if (window.Tone){
        try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){}
      }
      this.state.transportPlaying = false;
      log('Project stop.');
      persist();
      this.render();
    },

    async playClip(clipId){
      const clip = this.project.clips.find(c => c.id === clipId);
      if (!clip) return;
      const ok = await this.ensureTone();
      if (!ok){ alert('Tone.js not available.'); return; }
      await Tone.start();
      const synth = new Tone.PolySynth(Tone.Synth).toDestination();

      Tone.Transport.stop();
      Tone.Transport.cancel();
      Tone.Transport.seconds = 0;
      Tone.Transport.bpm.value = this.project.bpm || 120;

      const score = H2SProject.ensureScoreIds(H2SProject.deepClone(clip.score));
      let maxT = 0;
      for (const tr of score.tracks || []){
        for (const n of tr.notes || []){
          maxT = Math.max(maxT, n.start + n.duration);
          Tone.Transport.schedule((time) => {
            const pitch = H2SProject.clamp(Math.round(n.pitch || 60), 0, 127);
            const vel = H2SProject.clamp(Math.round(n.velocity || 100), 1, 127)/127;
            synth.triggerAttackRelease(Tone.Frequency(pitch, "midi"), n.duration, time, vel);
          }, n.start);
        }
      }
      Tone.Transport.start("+0.05");
      log(`Clip play: ${clip.name}`);
      setTimeout(()=>{ try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){} }, Math.ceil((maxT + 0.2) * 1000));
    },

    /* ---------------- Modal editor ---------------- */
    openClipEditor(clipId){
      // Safety: if user was mid-drag, clear timeline drag state.
      this.state.dragCandidate = null;
      this.state.draggingInstance = null;
      const clip = this.project.clips.find(c => c.id === clipId);
      if (!clip) return;
      this.state.modal.show = true;
      this.state.modal.clipId = clipId;
      this.state.modal.savedScore = H2SProject.deepClone(clip.score);
      this.state.modal.draftScore = H2SProject.deepClone(clip.score);
      this.state.modal.dirty = false;
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

      this.modalUpdateRightPanel();
      this.modalResizeCanvasToContent();
      this.modalRequestDraw();
      log(`Open editor: ${clip.name}`);
    },

    closeModal(save){
      if (!this.state.modal.show) return;
      this.modalStop();

      const clipId = this.state.modal.clipId;
      const clip = this.project.clips.find(c => c.id === clipId);

      if (save && clip){
        // Apply draft score back
        clip.score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
        const st = H2SProject.scoreStats(clip.score);
        clip.meta = { notes: st.count, pitchMin: st.minPitch, pitchMax: st.maxPitch, spanSec: st.spanSec };
        persist();
        this.render();
        log('Saved clip changes.');
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

      $('#modal').classList.remove('show');
      $('#modal').setAttribute('aria-hidden', 'true');
    },

    modalTogglePlay(){
      if (this.state.modal.isPlaying) this.modalStop();
      else this.modalPlay();
    },

    modalSnapSec(){
      const v = $('#selSnap').value;
      const bpm = this.project.bpm || 120;
      const beat = 60 / bpm; // quarter note
      if (v === 'off') return 0;
      const denom = Number(v);
      // denom=16 -> 1/16 note = beat*(4/16)=beat/4
      return beat * (4 / denom);
    },

    modalQuantize(x){
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
      tSec = this.modalQuantize(tSec);
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
        ns = this.modalQuantize(ns);
        let np = m.drag.origPitch + pitchDelta;
        np = H2SProject.clamp(np, 0, 127);
        found.note.start = ns;
        found.note.pitch = np;
        m.dirty = true;
        $('#editorStatus').textContent = `Drag: start ${fmtSec(ns)} pitch ${H2SProject.midiToName(np)}`;
      } else {
        let nd = m.drag.origDur + secDelta;
        nd = Math.max(0.05, nd);
        // quantize duration (optional)
        const g = this.modalSnapSec();
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

  // Global pointer handlers (timeline drag)
  // Design goals:
  // - Drag should NOT spam persist() on every pointermove (performance).
  // - Native dblclick should still work (no preventDefault / no pointerCapture until drag starts).
  // - If user never moves beyond threshold, it is a click (selection only).

  const TIMELINE_DRAG_THRESHOLD_PX = 4;
  // While dragging, NEVER rebuild the whole timeline (it destroys the DOM element
  // that holds pointer capture and breaks drag / dblclick). Instead, update the
  // dragged element's style in place. We commit to project state on pointerup.

  window.addEventListener('pointermove', (ev) => {
    const cand = app.state.dragCandidate;
    if (!cand) return;
    if (cand.pointerId !== ev.pointerId) return;

    const dx = ev.clientX - cand.startClientX;

    if (!cand.started){
      if (Math.abs(dx) < TIMELINE_DRAG_THRESHOLD_PX) return;

      // Start dragging only after threshold.
      cand.started = true;
      app.state.draggingInstance = cand.instId;

      // Capture pointer now so drag remains stable even if cursor leaves element.
      try{ cand.el.setPointerCapture(cand.pointerId); }catch(e){}
    }

    const instId = cand.instId;
    const inst = app.project.instances.find(x => x.id === instId);
    if (!inst) return;

    const pxPerSec = app.project.ui && app.project.ui.pxPerSec ? app.project.ui.pxPerSec : 160;

    // Offset left includes label width 120. The tracks container is scrollable.
    const tracks = document.querySelector('#tracks');
    const rect = tracks.getBoundingClientRect();
    const contentX = (ev.clientX - rect.left) + (tracks.scrollLeft || 0);
    const x = contentX - 120 - cand.offsetX;
    const startSec = Math.max(0, x / pxPerSec);

    // Update state
    inst.startSec = startSec;

    // Update DOM in-place
    const leftPx = 120 + startSec * pxPerSec;
    cand.el.style.left = leftPx + 'px';
    const span = cand.el.querySelector('.instSub span');
    if (span) span.textContent = fmtSec(startSec);
  });

  window.addEventListener('pointerup', (ev) => {
    const cand = app.state.dragCandidate;
    if (!cand) return;
    if (cand.pointerId !== ev.pointerId) return;

    if (cand.started){
      // Commit
      try{ cand.el.releasePointerCapture(cand.pointerId); }catch(e){}
      app.state.draggingInstance = null;
      app.state.dragCandidate = null;

      persist();
      app.render();
    } else {
      // Click without drag: just clear candidate. Selection already happened on pointerdown.
      app.state.dragCandidate = null;
    }
  });

  window.addEventListener('pointercancel', (ev) => {
    const cand = app.state.dragCandidate;
    if (!cand) return;
    if (cand.pointerId !== ev.pointerId) return;
    try{ cand.el.releasePointerCapture(cand.pointerId); }catch(e){}
    app.state.draggingInstance = null;
    app.state.dragCandidate = null;
    app.renderTimeline();
  });


  // Helpers
  function escapeHtml(s){
    return String(s || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  // CSS.escape polyfill (good enough for our UUID/id use cases)
  function cssEsc(s){
    const str = String(s || '');
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(str);
    // Escape characters that can break attribute selectors.
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function roundRect(ctx, x, y, w, h, r){
    r = Math.max(0, Math.min(r, Math.min(w,h)/2));
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  // Expose for debug
  window.H2SApp = app;

  // Boot
  window.addEventListener('load', () => {
    try{ app.init(); }
    catch(e){
      console.error(e);
      alert('Hum2Song Studio init failed. Please open DevTools Console for details.');
    }
  });
})();
