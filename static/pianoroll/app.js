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
        snapLastNonOff: '16',
        synth: null,
        raf: 0,
      },
    },

    init(){
      const restored = restore();
      this.project = restored || H2SProject.defaultProject();

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
        if (ev.key === 'q' || ev.key === 'Q'){ this.modalToggleSnap(); ev.preventDefault(); }
        if (ev.key === '['){ this.modalAdjustSnap(-1); ev.preventDefault(); }
        if (ev.key === ']'){ this.modalAdjustSnap(+1); ev.preventDefault(); }
      });

      // Clip Library controller (render + event binding)
      // IMPORTANT: keep library logic out of app.js so UI tweaks won't break timeline/editor.
      try{
        if (window.H2SLibraryController && window.H2SLibraryController.create){
          this.libraryCtrl = window.H2SLibraryController.create({
            rootEl: $('#clipList'),
            getProject: () => this.project,
            fmtSec,
            escapeHtml,
            onPlay: (clipId) => this.playClip(clipId),
            onAdd: (clipId) => this.addClipToTimeline(clipId),
            onEdit: (clipId) => this.openClipEditor(clipId),
            onRemove: (clipId) => this.deleteClip(clipId),
          });
        }
      }catch(e){
        console.warn('LibraryController init failed', e);
      }

      // Selection / Inspector controller (render + shortcuts)
      // IMPORTANT: must NOT rebuild timeline DOM; only touches #selectionBox.
      try{
        if (window.H2SSelectionController && window.H2SSelectionController.create){
          this.selectionCtrl = window.H2SSelectionController.create({
            rootEl: $('#selectionBox'),
            getProject: () => this.project,
            getState: () => this.state,
            fmtSec,
            escapeHtml,
            onEditClip: (clipId) => this.openClipEditor(clipId),
            onDuplicateInstance: (instId) => this.duplicateInstance(instId),
            onRemoveInstance: (instId) => this.deleteInstance(instId),
            onLog: log,
          });
        }
      }catch(e){
        console.warn('SelectionController init failed', e);
      }

      // Audio controller (project playback + clip preview)
      // Editor runtime: modal editing logic is modularized into controllers/editor_runtime.js
      try{
        if(window.H2SEditorRuntime && window.H2SEditorRuntime.create){
          this.editorRt = window.H2SEditorRuntime.create({
            getProject: () => this.project,
            getState: () => this.state,
            persist,
            render: () => this.render(),
            log,
            $,
            $$,
            fmtSec,
            escapeHtml,
          });
          log('EditorRuntime ready.');
        } else {
          console.warn('[EditorRuntime] Not available (script missing).');
        }
      } catch(e){
        console.warn('[EditorRuntime] init failed', e);
      }
      try{
        if (window.H2SAudioController && window.H2SAudioController.create){
          this.audioCtrl = window.H2SAudioController.create({
            getProject: () => this.project,
            getState: () => this.state,
            setTransportPlaying: (v) => { this.state.transportPlaying = !!v; },
            onUpdatePlayhead: (sec) => {
              this.project.ui.playheadSec = sec;
              $('#lblPlayhead').textContent = `Playhead: ${fmtSec(sec)}`;
              this.renderTimeline();
            },
            onLog: log,
            onAlert: (msg) => alert(msg),
            onRenderTick: () => { persist(); this.render(); },
          });
        }
      }catch(e){
        console.warn('AudioController init failed', e);
      }



// Timeline controller (stable drag + dblclick; avoids DOM rebuild between clicks)
try{
  this.timelineCtrl = window.H2STimeline && window.H2STimeline.create ? window.H2STimeline.create({
    tracksEl: $('#tracks'),
    getProject: () => this.project,
    getState: () => this.state,
    onSelectInstance: (instId, el) => {
      // Soft-select: update state + DOM class + inspector, WITHOUT full re-render.
      const prev = this.state.selectedInstanceId;
      this.state.selectedInstanceId = instId;

      // Toggle selected class in-place
      if (this._selectedInstEl && this._selectedInstEl !== el){
        try{ this._selectedInstEl.classList.remove('selected'); }catch(e){}
      }
      if (el){
        el.classList.add('selected');
        this._selectedInstEl = el;
      }
      this.renderSelection();
    },
    onOpenClipEditor: (clipId) => this.openClipEditor(clipId),
    onAddClipToTimeline: (clipId, startSec, trackIndex) => this.addClipToTimeline(clipId, startSec, trackIndex),
    onPersistAndRender: () => { persist(); this.render(); },
    onRemoveInstance: (instId) => this.deleteInstance(instId),
    escapeHtml,
    fmtSec,
    // Optional: label width and drag threshold
    labelWidthPx: 120,
    dragThresholdPx: 4,
  }) : null;
}catch(e){
  console.warn('Timeline controller init failed:', e);
  this.timelineCtrl = null;
}

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
      // Prefer controller-rendered library to keep app.js smaller and reduce regressions.
      if (this.libraryCtrl && this.libraryCtrl.render){
        this.libraryCtrl.render();
        return;
      }

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
            <button class="btn mini danger" data-act="remove">Remove</button>
          </div>
        `;

        el.querySelector('[data-act="play"]').addEventListener('click', (e) => { e.stopPropagation(); this.playClip(clip.id); });
        el.querySelector('[data-act="add"]').addEventListener('click', (e) => { e.stopPropagation(); this.addClipToTimeline(clip.id); });
        el.querySelector('[data-act="edit"]').addEventListener('click', (e) => { e.stopPropagation(); this.openClipEditor(clip.id); });
        el.querySelector('[data-act="remove"]').addEventListener('click', (e) => { e.stopPropagation(); this.deleteClip(clip.id); });

        root.appendChild(el);
      }
    },

    
renderTimeline(){
  // Render via timeline_controller to keep DOM stable for dblclick/drag.
  if (this.timelineCtrl && this.timelineCtrl.render){
    // Clear any stale selected element ref if DOM was rebuilt
    this._selectedInstEl = null;
    this.timelineCtrl.render();
    return;
  }
  // Fallback: if controller missing, show a hint rather than a broken timeline.
  const tracks = $('#tracks');
  tracks.innerHTML = '<div class="muted" style="padding:12px;">Timeline controller not loaded.</div>';
},

    renderSelection(){
      if (this.selectionCtrl && this.selectionCtrl.render){
        this.selectionCtrl.render();
        return;
      }

      // Fallback (should not happen in normal builds)
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

    selectInstance(instId){
      this.state.selectedInstanceId = instId;
      this.render();
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
    deleteClip(clipId){
      const clip = this.project.clips.find(c => c.id === clipId);
      if (!clip) return;

      const instCount = (this.project.instances || []).filter(x => x.clipId === clipId).length;
      const msg = instCount > 0
        ? `Remove clip "${clip.name}" and ${instCount} instance(s) from timeline?`
        : `Remove clip "${clip.name}"?`;

      if (!confirm(msg)) return;

      // If currently editing this clip, close modal (Cancel).
      if (this.state.modal && this.state.modal.show && this.state.modal.clipId === clipId){
        this.closeModal(false);
      }

      // Remove instances referencing the clip
      this.project.instances = (this.project.instances || []).filter(x => x.clipId !== clipId);
      // Remove the clip itself
      this.project.clips = (this.project.clips || []).filter(c => c.id !== clipId);

      // Clear selection if needed
      if (this.state.selectedInstanceId){
        const ok = (this.project.instances || []).some(x => x.id === this.state.selectedInstanceId);
        if (!ok) this.state.selectedInstanceId = null;
      }

      persist();
      log('Removed clip.');
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
      ev.preventDefault();
      ev.stopPropagation();
      const el = ev.currentTarget;
      this.selectInstance(instId);
      const rect = el.getBoundingClientRect();
      this.state.draggingInstance = instId;
      this.state.dragOffsetX = ev.clientX - rect.left;
      el.setPointerCapture(ev.pointerId);
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
      if (this.audioCtrl && this.audioCtrl.playProject){
        // Delegate to AudioController (centralized Tone.Transport scheduling)
        return await this.audioCtrl.playProject();
      }
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
      if (this.audioCtrl && this.audioCtrl.stop){
        // Delegate to AudioController
        this.audioCtrl.stop();
        return;
      }
      if (window.Tone){
        try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){}
      }
      this.state.transportPlaying = false;
      log('Project stop.');
      persist();
      this.render();
    },

    async playClip(clipId){
      if (this.audioCtrl && this.audioCtrl.playClip){
        // Delegate to AudioController
        return await this.audioCtrl.playClip(clipId);
      }
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

        /* ---------------- Modal editor (delegated to EditorRuntime) ---------------- */
    openClipEditor(clipId){ return this.editorRt && this.editorRt.openClipEditor ? this.editorRt.openClipEditor(clipId) : undefined; },
    closeModal(save){ return this.editorRt && this.editorRt.closeModal ? this.editorRt.closeModal(save) : undefined; },
    modalAdjustSnap(...args){ return this.editorRt && this.editorRt.modalAdjustSnap ? this.editorRt.modalAdjustSnap(...args) : undefined; },
    modalAllNotes(...args){ return this.editorRt && this.editorRt.modalAllNotes ? this.editorRt.modalAllNotes(...args) : undefined; },
    modalDeleteSelectedNote(...args){ return this.editorRt && this.editorRt.modalDeleteSelectedNote ? this.editorRt.modalDeleteSelectedNote(...args) : undefined; },
    modalDraw(...args){ return this.editorRt && this.editorRt.modalDraw ? this.editorRt.modalDraw(...args) : undefined; },
    modalFindNoteById(...args){ return this.editorRt && this.editorRt.modalFindNoteById ? this.editorRt.modalFindNoteById(...args) : undefined; },
    modalGetSnapValue(...args){ return this.editorRt && this.editorRt.modalGetSnapValue ? this.editorRt.modalGetSnapValue(...args) : undefined; },
    modalHitTest(...args){ return this.editorRt && this.editorRt.modalHitTest ? this.editorRt.modalHitTest(...args) : undefined; },
    modalInsertNote(...args){ return this.editorRt && this.editorRt.modalInsertNote ? this.editorRt.modalInsertNote(...args) : undefined; },
    modalPlay(...args){ return this.editorRt && this.editorRt.modalPlay ? this.editorRt.modalPlay(...args) : undefined; },
    modalPointerDown(...args){ return this.editorRt && this.editorRt.modalPointerDown ? this.editorRt.modalPointerDown(...args) : undefined; },
    modalPointerMove(...args){ return this.editorRt && this.editorRt.modalPointerMove ? this.editorRt.modalPointerMove(...args) : undefined; },
    modalPointerUp(...args){ return this.editorRt && this.editorRt.modalPointerUp ? this.editorRt.modalPointerUp(...args) : undefined; },
    modalQuantize(...args){ return this.editorRt && this.editorRt.modalQuantize ? this.editorRt.modalQuantize(...args) : undefined; },
    modalRequestDraw(...args){ return this.editorRt && this.editorRt.modalRequestDraw ? this.editorRt.modalRequestDraw(...args) : undefined; },
    modalResizeCanvasToContent(...args){ return this.editorRt && this.editorRt.modalResizeCanvasToContent ? this.editorRt.modalResizeCanvasToContent(...args) : undefined; },
    modalSetSnapValue(...args){ return this.editorRt && this.editorRt.modalSetSnapValue ? this.editorRt.modalSetSnapValue(...args) : undefined; },
    modalSnapSec(...args){ return this.editorRt && this.editorRt.modalSnapSec ? this.editorRt.modalSnapSec(...args) : undefined; },
    modalStop(...args){ return this.editorRt && this.editorRt.modalStop ? this.editorRt.modalStop(...args) : undefined; },
    modalTogglePlay(...args){ return this.editorRt && this.editorRt.modalTogglePlay ? this.editorRt.modalTogglePlay(...args) : undefined; },
    modalToggleSnap(...args){ return this.editorRt && this.editorRt.modalToggleSnap ? this.editorRt.modalToggleSnap(...args) : undefined; },
    modalUpdateRightPanel(...args){ return this.editorRt && this.editorRt.modalUpdateRightPanel ? this.editorRt.modalUpdateRightPanel(...args) : undefined; },
  };

  // Global pointer handlers (timeline drag)
  window.addEventListener('pointermove', (ev) => {
    if (!app.state.draggingInstance) return;
    // update instance start live for smoother UX
    const inst = app.project.instances.find(x => x.id === app.state.draggingInstance);
    if (!inst) return;
    const tracksEl = $('#tracks');
    const rect = tracksEl.getBoundingClientRect();
    const pxPerSec = app.project.ui.pxPerSec || 160;
    const x = ev.clientX - rect.left - 120 - app.state.dragOffsetX;
    inst.startSec = Math.max(0, x / pxPerSec);
    app.renderTimeline();
    persist();
  });

  window.addEventListener('pointerup', (ev) => {
    // modal pointer up already attached
    // finalize timeline drag
    if (app.state.draggingInstance){
      app.state.draggingInstance = null;
      persist();
      app.render();
    }
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
  window.addEventListener('load', () => app.init());
})();
