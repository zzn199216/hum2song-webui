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
  const LS_KEY_V1 = 'hum2song_studio_project_v1';
  const LS_KEY_V2 = 'hum2song_studio_project_v2';
  const LS_KEY_OPT_OPTIONS = 'hum2song_studio_opt_options_by_clip'; // PR-5f: persist per-clip optimize preset across refresh

  // --- debug gate (localStorage.h2s_debug === '1') ---
  function _dbgEnabled(){
    try{
      return (typeof localStorage !== 'undefined') && (localStorage.h2s_debug === '1');
    }catch(e){
      return false;
    }
  }

  function dbg(){
    if (!_dbgEnabled()) return;
    try{ console.log.apply(console, arguments); }catch(_){ }
  }


  // --- storage is beats-only (ProjectDoc v2). UI remains v1 seconds until controllers are migrated. ---
  function _readLS(key){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e){
      console.warn('[app] Failed to parse localStorage', key, e);
      return null;
    }
  }

  function _writeLS(key, obj){
    try{
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (e){
      console.warn('[app] Failed to write localStorage', key, e);
    }
  }

  function _beatToSec(beat, bpm){
    const P = window.H2SProject;
    if (P && typeof P.beatToSec === 'function') return P.beatToSec(beat, bpm);
    return (beat * 60) / (bpm || 120);
  }

  function _scoreBeatToSec(scoreBeat, bpm){
    const P = window.H2SProject;
    if (P && typeof P.scoreBeatToSec === 'function') return P.scoreBeatToSec(scoreBeat, bpm);

    // Fallback: convert minimal beat score -> sec score (single tempo).
    const out = { version: 1, tempo_bpm: bpm || 120, time_signature: scoreBeat && scoreBeat.time_signature ? scoreBeat.time_signature : null, tracks: [] };
    if (!scoreBeat || !Array.isArray(scoreBeat.tracks)) return out;

    for (const tr of scoreBeat.tracks){
      const notes = [];
      for (const n of (tr.notes || [])){
        notes.push({
          id: n.id,
          pitch: n.pitch,
          velocity: n.velocity,
          start: _beatToSec(n.startBeat || 0, bpm || 120),
          duration: _beatToSec(n.durationBeat || 0, bpm || 120)
        });
      }
      out.tracks.push({ id: tr.id, name: tr.name, notes });
    }
    return out;
  }

  function _projectV1ToV2(p1){
    const P = window.H2SProject;
    if (P && typeof P.migrateProjectV1toV2 === 'function') return P.migrateProjectV1toV2(p1);
    return null;
  }

  function _isProjectV2(obj){
    const P = window.H2SProject;
    if (P && typeof P.isProjectV2 === 'function') return P.isProjectV2(obj);
    return !!(obj && obj.version === 2 && obj.timebase === 'beat');
  }

  function _projectV2ToV1View(p2){
    const bpm = (p2 && typeof p2.bpm === 'number') ? p2.bpm : 120;

    const tracks = Array.isArray(p2 && p2.tracks)
      ? p2.tracks.map((t, i) => {
          const tid = (t && (t.trackId || t.id)) ? String(t.trackId || t.id) : ('track-' + (i+1));
          return {
            // legacy compat: some UI reads `id`
            id: tid,
            name: (t && typeof t.name === 'string' && t.name) ? t.name : ('Track ' + (i+1)),
            // view-only fields:
            trackId: tid,
            instrument: (t && typeof t.instrument === 'string' && t.instrument) ? t.instrument : 'default',
            gainDb: (t && typeof t.gainDb === 'number' && isFinite(t.gainDb)) ? t.gainDb : 0,
            muted: (t && typeof t.muted === 'boolean') ? t.muted : false,
          };
        })
      : [{ id: 'track-1', name: 'Track 1', trackId: 'track-1', instrument: 'default' }];

    const trackIndexById = {};
    // IMPORTANT: instances carry inst.trackId; key by `trackId`
    tracks.forEach((t, i) => { trackIndexById[t.trackId] = i; });

    const pxPerBeat = (p2 && p2.ui && typeof p2.ui.pxPerBeat === 'number') ? p2.ui.pxPerBeat : 240;
    const pxPerSec = (window.H2SProject && typeof window.H2SProject.pxPerBeatToPxPerSec === 'function')
      ? window.H2SProject.pxPerBeatToPxPerSec(pxPerBeat, bpm)
      : (pxPerBeat * bpm / 60);

    const playheadBeat = (p2 && p2.ui && typeof p2.ui.playheadBeat === 'number') ? p2.ui.playheadBeat : 0;
    const playheadSec = _beatToSec(playheadBeat, bpm);

    const clipsMap = (p2 && p2.clips) ? p2.clips : {};
    const order = (p2 && Array.isArray(p2.clipOrder)) ? p2.clipOrder : Object.keys(clipsMap);

    const clips = [];
    for (const cid of order){
      const c = clipsMap[cid];
      if (!c) continue;

      const scoreSec = _scoreBeatToSec(c.score, bpm);
      const meta = c.meta || {};
      const spanBeat = (typeof meta.spanBeat === 'number') ? meta.spanBeat : 0;

      clips.push({
        id: c.id || cid,
        name: c.name || 'Clip',
        createdAt: c.createdAt || Date.now(),
        sourceTaskId: (c.sourceTaskId !== undefined) ? c.sourceTaskId : null,
        score: scoreSec,
        revisionId: (c.revisionId != null) ? String(c.revisionId) : null,
        parentRevisionId: (c.parentRevisionId != null) ? String(c.parentRevisionId) : null,
        updatedAt: (typeof c.updatedAt === 'number') ? c.updatedAt : null,
        _abARevisionId: (c._abARevisionId != null) ? String(c._abARevisionId) : null,
        _abBRevisionId: (c._abBRevisionId != null) ? String(c._abBRevisionId) : null,
        revisions: Array.isArray(c.revisions) ? c.revisions.map(r => ({
          revisionId: (r && r.revisionId != null) ? String(r.revisionId) : null,
          parentRevisionId: (r && r.parentRevisionId != null) ? String(r.parentRevisionId) : null,
          createdAt: (r && typeof r.createdAt === 'number') ? r.createdAt : null,
          name: (r && typeof r.name === 'string') ? r.name : null,
          score: (r && r.score) ? _scoreBeatToSec(r.score, bpm) : null,
          meta: (r && r.meta) ? r.meta : null,
        })) : [],
        meta: {
          agent: (meta && meta.agent) ? meta.agent : null,
          notes: (typeof meta.notes === 'number') ? meta.notes : 0,
          pitchMin: (typeof meta.pitchMin === 'number') ? meta.pitchMin : null,
          pitchMax: (typeof meta.pitchMax === 'number') ? meta.pitchMax : null,
          spanSec: _beatToSec(spanBeat, bpm),
          sourceTempoBpm: (typeof meta.sourceTempoBpm === 'number') ? meta.sourceTempoBpm : null
        }
      });
    }

    const instances = [];
    for (const inst of (p2 && Array.isArray(p2.instances) ? p2.instances : [])){
      const trackIndex = (inst && inst.trackId && (inst.trackId in trackIndexById)) ? trackIndexById[inst.trackId] : 0;
      instances.push({
        id: inst.id,
        clipId: inst.clipId,
        trackIndex,
        startSec: _beatToSec(inst.startBeat || 0, bpm),
        transpose: inst.transpose || 0
      });
    }

    return { version: 1, bpm, tracks, clips, instances, ui: { pxPerSec, playheadSec } };
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  
  // --- Audio unlock (Chrome autoplay) ---
  // Tone.js may initialize its AudioContext in 'suspended' state until a real user gesture.
  // IMPORTANT: call without awaiting to preserve user-activation.
  function _unlockAudioFromGesture(){
    try{
      const Tone = (typeof window !== 'undefined') ? window.Tone : null;
      if (!Tone) return;
      if (Tone.start){
        // Do NOT await: awaiting can lose user-activation in Chrome.
        Tone.start();
      } else if (Tone.context && Tone.context.resume){
        Tone.context.resume();
      }
    }catch(e){}
  }

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
    // also console (debug-gated)
    dbg(msg);
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
    // Persist ProjectDoc v2 (beats). UI keeps a v1 (seconds) view until controllers are migrated.
    // IMPORTANT: persist() must NOT clobber v2-only fields (e.g., track.instrument) by migrating from v1.
    const prevV2 = app._projectV2 || _readLS(LS_KEY_V2);

    const p2 = _projectV1ToV2(app.project);
    if (!p2) return;

    
// Preserve v2-only track fields (currently: instrument, gainDb).
try{
  if (prevV2 && Array.isArray(prevV2.tracks) && Array.isArray(p2.tracks)){
    const instByTid = new Map();
    const gainByTid = new Map();
    const mutedByTid = new Map();
    for (const t of prevV2.tracks){
      const tid = (t && (t.trackId || t.id)) ? String(t.trackId || t.id) : null;
      if (!tid) continue;
      if (typeof t.instrument === 'string' && t.instrument) instByTid.set(tid, t.instrument);
      if (typeof t.gainDb === 'number' && isFinite(t.gainDb)) gainByTid.set(tid, t.gainDb);
      if (typeof t.muted === 'boolean') mutedByTid.set(tid, t.muted);
    }

    for (const t of p2.tracks){
      const tid = (t && (t.trackId || t.id)) ? String(t.trackId || t.id) : null;
      if (!tid) continue;

      // Keep id/trackId consistent (compat).
      if (!t.id) t.id = tid;
      if (!t.trackId) t.trackId = tid;

      const inst = instByTid.get(tid);
      if (typeof inst === 'string' && inst) t.instrument = inst;

      const g = gainByTid.get(tid);
      if (typeof g === 'number' && isFinite(g)) t.gainDb = g;

      const m = mutedByTid.get(tid);
      if (typeof m === 'boolean') t.muted = m;

      // Ensure defaults for v2-only fields when missing from v1 migration.
      if (typeof t.instrument !== 'string' || !t.instrument) t.instrument = 'default';
      if (typeof t.gainDb !== 'number' || !isFinite(t.gainDb)) t.gainDb = 0;
      if (typeof t.muted !== 'boolean') t.muted = false;
    }
  }
  // Preserve clip revision chain (revisionId, parentRevisionId, revisions) so Undo Optimize works.
  if (prevV2 && prevV2.clips && typeof prevV2.clips === 'object' && p2.clips && typeof p2.clips === 'object'){
    for (const cid of Object.keys(p2.clips)){
      const prevClip = prevV2.clips[cid];
      if (!prevClip) continue;
      const dst = p2.clips[cid];
      if (dst && prevClip.revisionId != null) dst.revisionId = prevClip.revisionId;
      if (dst && prevClip.parentRevisionId !== undefined) dst.parentRevisionId = prevClip.parentRevisionId;
      if (dst && prevClip.revisions != null) dst.revisions = prevClip.revisions;
      if (dst && prevClip.updatedAt != null) dst.updatedAt = prevClip.updatedAt;
    }
  }
  if (typeof window !== 'undefined' && window.H2SProject && typeof window.H2SProject.normalizeProjectRevisionChains === 'function'){
    window.H2SProject.normalizeProjectRevisionChains(p2);
  }
} catch(e){
      console.warn('[persist] v2 merge failed', e);
    }

    _writeLS(LS_KEY_V2, p2);

    // IMPORTANT: sync in-memory v2 cache; otherwise later writes (e.g. setTrackInstrument)
    // may read a stale cached project and overwrite newer instances.
    app._projectV2 = p2;

    // Ensure beats-only storage after migration.
    try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
  }

  function restore(){
    const p2 = _readLS(LS_KEY_V2);
    if (p2) return p2;

    const legacy = _readLS(LS_KEY_V1);
    if (!legacy) return null;

    const migrated = _projectV1ToV2(legacy);
    if (migrated){
      _writeLS(LS_KEY_V2, migrated);
      try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
      return migrated;
    }

    // Fallback: still return legacy if migration is unavailable.
    return legacy;
  }

  const app = {
    project: null,
    _projectV2: null,
    _lastOptimizeOptions: null,  // PR-3: app-level state for optimize options
    _optPresetByClipId: {},      // PR-3: per-clip last selected preset for dropdown persistence
    _optOptionsByClipId: {},     // PR-5c: per-clip full options so getOptimizeOptions(clipId) returns correct preset
    // debug helper (gated by localStorage.h2s_debug === '1')
    dbg: function(){ return dbg.apply(null, arguments); },

    // v2-only commit path: write v2 truth to storage and refresh UI view
    commitV2: function(projectV2, reason){
      if (reason) this.dbg('[commitV2]', reason);
      return this.setProjectFromV2(projectV2);
    },

    // v1->v2 migration commit path (legacy seconds UI -> beats truth)
    persistFromV1: function(reason){
      if (reason) this.dbg('[persistFromV1]', reason);
      persist();
      const p2 = this.getProjectV2();
      if (p2 && _isProjectV2(p2)) this.project = _projectV2ToV1View(p2);
      this.render();
    },

// Controllers (optional)
agentCtrl: null,

// --- v2 hooks: Library/Agent expect these (beats-only truth) ---
getProjectV2(){
  // v2 beats-only doc is the only source of truth.
  if (this._projectV2) return this._projectV2;

  const raw = _readLS(LS_KEY_V2);
  if (!raw) return null;

  // Normalize / migrate using project.js helpers if available.
  try{
    const P = window.H2SProject;
    if (P && typeof P.loadProjectDocV2 === 'function'){
      const p2 = P.loadProjectDocV2(raw);
      // Normalize legacy track schema: some old saves used `id` instead of `trackId`.
      if (p2 && Array.isArray(p2.tracks)) {
        for (const t of p2.tracks) {
          if (t && !t.trackId && t.id) t.trackId = t.id;
          if (t && typeof t.instrument !== 'string') t.instrument = 'default';
          if (t && (typeof t.gainDb !== 'number' || !isFinite(t.gainDb))) t.gainDb = 0;
      if (t && typeof t.muted !== 'boolean') t.muted = false;
        }
      }
      this._projectV2 = p2;
      return p2;
    }
  } catch(e){
    console.warn('[App] getProjectV2 normalize failed', e);
  }
  // Fallback: return raw (best effort)
  this._projectV2 = raw;
  return raw;
},

setProjectFromV2(projectV2){
  // Persist v2 beats-only doc, then refresh derived v1 view for UI/controllers.
  if (!projectV2) return {ok:false, error:'no_project_v2'};
  if (typeof window !== 'undefined' && window.H2SProject && typeof window.H2SProject.normalizeProjectRevisionChains === 'function'){
    window.H2SProject.normalizeProjectRevisionChains(projectV2);
  }
  // Normalize legacy track schema on write.
  if (Array.isArray(projectV2.tracks)) {
    for (const t of projectV2.tracks) {
      if (t && !t.trackId && t.id) t.trackId = t.id;
      if (t && typeof t.instrument !== 'string') t.instrument = 'default';
      if (t && (typeof t.gainDb !== 'number' || !isFinite(t.gainDb))) t.gainDb = 0;
      if (t && typeof t.muted !== 'boolean') t.muted = false;
    }
  }
  this._projectV2 = projectV2;
  _writeLS(LS_KEY_V2, projectV2);
  this.project = _projectV2ToV1View(projectV2);
  this.render();
  return {ok:true};
},

// --- T4-1.F: single write entry for per-track instrument (v2 truth) ---
setTrackInstrument(trackId, instrument){
  const p2 = this.getProjectV2();
  if (!p2 || !Array.isArray(p2.tracks)){
    console.error('[App] setTrackInstrument: project v2 missing');
    return;
  }
  const t = p2.tracks.find(x => x && ((x.trackId === trackId) || (x.id === trackId)));
  if (!t){
    console.error('[App] setTrackInstrument: trackId not found', trackId);
    return;
  }
  // Repair legacy data that used `id` instead of `trackId`
  if (!t.trackId && t.id === trackId) t.trackId = trackId;
  t.instrument = instrument;
  this.setProjectFromV2(p2); // persist + rebuild v1 view + render
},
setTrackGainDb(trackId, gainDb){
  const p2 = this.getProjectV2();
  if (!p2 || !Array.isArray(p2.tracks)){
    console.error('[App] setTrackGainDb: project v2 missing');
    return;
  }
  const t = p2.tracks.find(x => x && ((x.trackId === trackId) || (x.id === trackId)));
  if (!t){
    console.error('[App] setTrackGainDb: trackId not found', trackId);
    return;
  }
  if (!t.trackId && t.id === trackId) t.trackId = trackId;
  const v = Number(gainDb);
  t.gainDb = (Number.isFinite(v) ? Math.max(-30, Math.min(6, v)) : 0);
  this.setProjectFromV2(p2);
},


setTrackMuted(trackId, muted){
  const p2 = this.getProjectV2();
  if (!p2 || !Array.isArray(p2.tracks)){
    console.error('[App] setTrackMuted: project v2 missing');
    return;
  }
  const t = p2.tracks.find(x => x && ((x.trackId === trackId) || (x.id === trackId)));
  if (!t){
    console.error('[App] setTrackMuted: trackId not found', trackId);
    return;
  }
  if (!t.trackId && t.id === trackId) t.trackId = trackId;
  t.muted = Boolean(muted);
  this.setProjectFromV2(p2);
},



// PR-5c: order-agnostic (cid, options) or (options, cid); normalize requestedPresetId / presetId / preset
setOptimizeOptions(arg0, arg1){
  let cid = null;
  let opts = null;
  if (typeof arg0 === 'string') {
    cid = arg0;
    opts = (arg1 && typeof arg1 === 'object') ? arg1 : null;
  } else if (typeof arg1 === 'string') {
    cid = arg1;
    opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
  } else {
    opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
  }
  const preset = opts && (opts.requestedPresetId != null ? opts.requestedPresetId : opts.presetId != null ? opts.presetId : opts.preset);
  const defaultIntent = { fixPitch: false, tightenRhythm: false, reduceOutliers: false };
  const existingOpts = cid ? this.getOptimizeOptions(cid) : null;
  const intent = (opts && opts.intent && typeof opts.intent === 'object')
    ? { fixPitch: !!opts.intent.fixPitch, tightenRhythm: !!opts.intent.tightenRhythm, reduceOutliers: !!opts.intent.reduceOutliers }
    : (existingOpts && existingOpts.intent && typeof existingOpts.intent === 'object')
      ? { fixPitch: !!existingOpts.intent.fixPitch, tightenRhythm: !!existingOpts.intent.tightenRhythm, reduceOutliers: !!existingOpts.intent.reduceOutliers }
      : defaultIntent;
  const normalizedOpts = opts ? {
    requestedPresetId: (preset != null && preset !== '') ? String(preset) : null,
    userPrompt: opts.userPrompt != null ? opts.userPrompt : null,
    intent
  } : null;
  this._lastOptimizeOptions = normalizedOpts;
  if (cid) {
    this._optPresetByClipId[cid] = normalizedOpts ? normalizedOpts.requestedPresetId : null;
    this._optOptionsByClipId[cid] = normalizedOpts;
    if (typeof localStorage !== 'undefined') {
      try {
        const map = _readLS(LS_KEY_OPT_OPTIONS) || {};
        map[cid] = normalizedOpts;
        _writeLS(LS_KEY_OPT_OPTIONS, map);
      } catch (e) { console.warn('[App] persist opt options failed', e); }
    }
  }
},
getOptimizePresetForClip(clipId){
  const opts = this.getOptimizeOptions(clipId);
  return (opts && opts.requestedPresetId != null) ? opts.requestedPresetId : null;
},
getOptimizeOptions(clipId){
  if (clipId && this._optOptionsByClipId && this._optOptionsByClipId[clipId] != null) return this._optOptionsByClipId[clipId];
  if (clipId && typeof localStorage !== 'undefined') {
    try {
      const map = _readLS(LS_KEY_OPT_OPTIONS);
      if (map && typeof map === 'object' && map[clipId] != null) {
        this._optOptionsByClipId[clipId] = map[clipId];
        this._optPresetByClipId[clipId] = (map[clipId].requestedPresetId != null) ? map[clipId].requestedPresetId : null;
        return map[clipId];
      }
    } catch (e) { console.warn('[App] read opt options failed', e); }
  }
  return this._lastOptimizeOptions || null;
},

// PR-5e: optOverride = one-shot options for this call only; does NOT modify stored per-clip options.
async optimizeClip(clipId, optOverride){
  if (!this.agentCtrl || typeof this.agentCtrl.optimizeClip !== 'function'){
    console.warn('[App] optimizeClip called but agent controller is not available');
    try{ alert('Optimize unavailable: agent controller not initialized. Check console for details.'); }catch(_){}
    return {ok:false, error:'no_agent_controller'};
  }
  let options = optOverride;
  if (options && typeof options === 'object') {
    const preset = options.requestedPresetId != null ? options.requestedPresetId : options.presetId != null ? options.presetId : options.preset;
    const intent = options.intent && typeof options.intent === 'object'
      ? { fixPitch: !!options.intent.fixPitch, tightenRhythm: !!options.intent.tightenRhythm, reduceOutliers: !!options.intent.reduceOutliers }
      : { fixPitch: false, tightenRhythm: false, reduceOutliers: false };
    options = {
      requestedPresetId: (preset != null && preset !== '') ? String(preset) : null,
      userPrompt: options.userPrompt != null ? options.userPrompt : null,
      intent
    };
  }
  return await this.agentCtrl.optimizeClip(clipId, options);
},

// PR-5: Undo Optimize — rollback clip to parent revision (atomic: setProjectFromV2 + commitV2).
rollbackClipRevision(clipId){
  const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
  if (!P || typeof P.rollbackClipRevision !== 'function') return { ok: false, reason: 'no_rollback' };
  const p2 = this.getProjectV2();
  if (!p2 || !p2.clips || !p2.clips[clipId]) return { ok: false, reason: 'clip_not_found' };
  const res = P.rollbackClipRevision(p2, clipId);
  if (res && res.ok && res.changed) this.setProjectFromV2(p2);
  return res || { ok: false, reason: 'rollback_failed' };
},

    state: {
      selectedInstanceId: null,
      activeTrackIndex: 0,
      activeTrackId: null,
      draggingInstance: null,
      dragCandidate: null,
      dragOffsetX: 0,
      transportPlaying: false,
      transportStartPerf: 0,
      lastUploadTaskId: null,
      recordingActive: false,
      lastRecordedFile: null,
      importCancelled: false,
      autoOpenAfterImport: true,
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

      // Storage is beats-only (v2). Convert to a v1 (seconds) view for current UI/controllers.
      if (restored && _isProjectV2(restored)){
        this.project = _projectV2ToV1View(restored);
      } else {
        this.project = restored || H2SProject.defaultProject();
      }

      
// Wire AgentController (Optimize) if available
try{
  const ROOT = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : {});
  if (ROOT.H2SAgentController && typeof ROOT.H2SAgentController.create === 'function'){
    // AgentController expects v2 hooks + persist/render callbacks
    // PR-3/PR-5c: Pass getOptimizeOptions(clipId) so agent controller gets per-clip preset
    this.agentCtrl = ROOT.H2SAgentController.create({
      app: this,
      getProjectV2: () => this.getProjectV2(),
      setProjectFromV2: (p2) => this.setProjectFromV2(p2),
      persist: () => persist(),
      render: () => this.render(),
      getOptimizeOptions: (clipId) => this.getOptimizeOptions(clipId),
    });
  }
}catch(e){
  console.warn('AgentController init failed', e);
}

// PR-5f: hydrate per-clip optimize options from localStorage (survives hard refresh)
if (typeof localStorage !== 'undefined') {
  try {
    const stored = _readLS(LS_KEY_OPT_OPTIONS);
    if (stored && typeof stored === 'object') {
      this._optOptionsByClipId = Object.assign({}, this._optOptionsByClipId, stored);
      for (const cid of Object.keys(stored)) {
        const o = stored[cid];
        this._optPresetByClipId[cid] = (o && o.requestedPresetId != null) ? o.requestedPresetId : null;
      }
    }
  } catch (e) { console.warn('[App] hydrate opt options failed', e); }
}

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
        // Safety: changing BPM while the clip editor is open can corrupt
        // the sec<->beat boundary (draft seconds would be reinterpreted).
        if (this.state && this.state.modal && this.state.modal.show){
          alert('Please close the Clip Editor before changing BPM.');
          $('#inpBpm').value = this.project.bpm;
          return;
        }
        const raw = Number($('#inpBpm').value || 120);
        const nextBpm = H2SProject.clamp(raw, 30, 260);
        this.setProjectBpm(nextBpm);
      });

      $('#btnExportProject').addEventListener('click', () => {
        const p2 = _projectV1ToV2(this.project);
        const payload = p2 || this.project;
        const fname = p2 ? `hum2song_project_v2_${Date.now()}.json` : `hum2song_project_${Date.now()}.json`;
        downloadText(fname, JSON.stringify(payload, null, 2));
      });

      $('#btnImportProject').addEventListener('click', async () => {
        const f = await this.pickFile('.json');
        if (!f) return;
        const txt = await f.text();
        try{
          const obj = JSON.parse(txt);
          if (_isProjectV2(obj)){
            _writeLS(LS_KEY_V2, obj);
            try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
            this.project = _projectV2ToV1View(obj);
          } else {
            this.project = obj;
          }
          this.project = H2SProject.ensureProjectIds(this.project);
          persist();
          this.render();
          log('Imported project json.');
        }catch(e){
          alert('Invalid JSON.');
        }
      });

      // Transport buttons
      $('#btnPlayProject').addEventListener('click', (ev) => { try{ _unlockAudioFromGesture(); }catch(e){} return this.playProject(); });
      $('#btnStop').addEventListener('click', () => { this.stopProjectReset(); });
      $('#btnRecord').addEventListener('click', () => {
        try{ _unlockAudioFromGesture(); }catch(e){}
        if (this.state.recordingActive) this.stopRecording();
        else this.startRecording();
      });
      $('#btnUseLast').addEventListener('click', () => this.useLastRecording());
      const chkAutoOpen = $('#chkAutoOpenAfterImport');
      if (chkAutoOpen) {
        chkAutoOpen.checked = !!this.state.autoOpenAfterImport;
        chkAutoOpen.addEventListener('change', () => { this.state.autoOpenAfterImport = chkAutoOpen.checked; });
      }
      const btnCancelImport = $('#btnCancelImport');
      if (btnCancelImport) btnCancelImport.addEventListener('click', () => { this.state.importCancelled = true; });
      this._initMasterVolumeUI();
      $('#btnPlayheadToStart').addEventListener('click', () => { this.project.ui.playheadSec = 0; persist(); this.render(); });

      // Modal
      $('#btnModalClose').addEventListener('click', () => this.closeModal(false));
      $('#btnModalCancel').addEventListener('click', () => this.closeModal(false));
      $('#btnModalSave').addEventListener('click', () => this.closeModal(true));

      $('#btnClipPlay').addEventListener('click', (ev) => { try{ _unlockAudioFromGesture(); }catch(e){} return this.modalPlay(); });
      $('#btnClipStop').addEventListener('click', () => this.modalStop());
      $('#btnInsertNote').addEventListener('click', () => this.modalInsertNote());
      $('#btnDeleteNote').addEventListener('click', () => this.modalDeleteSelectedNote());
      $('#selSnap').addEventListener('change', () => {
        // Clip editor snap only (timeline snap has its own dropdown: #selTimelineSnap)
        this.modalRequestDraw();
      });
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
        const path = (ev.composedPath && ev.composedPath()) || (ev.target ? [ev.target] : []);
        const inInput = path.some((el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
        if (inInput) return;
        if (!this.state.modal.show){
          if (ev.key === 'r' || ev.key === 'R'){ try{ _unlockAudioFromGesture(); }catch(e){} if (this.state.recordingActive) this.stopRecording(); else this.startRecording(); ev.preventDefault(); }
          if (ev.key === 's' || ev.key === 'S'){ if (!this.state.recordingActive) this.stopProjectReset(); ev.preventDefault(); }
          return;
        }
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
            app: this,
            getProjectV2: () => this.getProjectV2(),
            rootEl: $('#clipList'),
            getProject: () => this.project,
            fmtSec,
            escapeHtml,
            onPlay: (clipId) => this.playClip(clipId),
            onAdd: (clipId) => this.addClipToTimeline(clipId),
            onEdit: (clipId) => this.openClipEditor(clipId),
            onRemove: (clipId) => this.deleteClip(clipId),
            onOptimize: (clipId) => this.optimizeClip(clipId),
          });
        }
      }catch(e){
        console.warn('LibraryController init failed', e);
      }


      // Fallback: ensure Optimize button always triggers, even if a controller binding is missing.
      // We only intercept data-act="optimize" and leave other actions to the existing controller.
      try{
        const clipList = $('#clipList');
        if (clipList && !clipList.__h2sOptFallbackBound){
          clipList.__h2sOptFallbackBound = true;
          clipList.addEventListener('click', (e)=>{
            const btn = e.target && e.target.closest ? e.target.closest('[data-act="optimize"]') : null;
            if (!btn) return;
            const clipId = btn.getAttribute('data-id') || btn.getAttribute('data-clip-id');
            if (!clipId) return;
            // Prevent double-handling if another listener exists.
            e.preventDefault();
            e.stopPropagation();
            Promise.resolve(this.optimizeClip(clipId)).catch(err=>console.warn('[App] optimizeClip failed', err));
          }, true); // capture
        }
      }catch(_){}

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
          
// v2 boundary helpers (do NOT let runtime touch localStorage)
getProjectV2: () => this.getProjectV2(),
commitV2: (p2, reason) => this.commitV2(p2, reason),
persistFromV1: (reason) => this.persistFromV1(reason),
H2SProject: (typeof window !== 'undefined') ? window.H2SProject : null,
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
            // Beats-based document for project playback scheduling (T2 uses flatten(ProjectDocV2)).
            getProjectV2: () => this.getProjectV2(),
            // legacy compat (some audio builds read getProjectDoc)
            getProjectDoc: () => this.getProjectV2(),
            getState: () => this.state,
            setTransportPlaying: (v) => { this.state.transportPlaying = !!v; },
            onUpdatePlayhead: (sec) => {
              this.project.ui.playheadSec = sec;
              const bpm = (this.project && typeof this.project.bpm === 'number') ? this.project.bpm : 120;
              const beat = (sec * bpm) / 60;
              $('#lblPlayhead').textContent = `Playhead: ${fmtSec(sec)} (${beat.toFixed(2)}b)`;
              if (this.timelineCtrl && typeof this.timelineCtrl.setPlayheadSec === 'function'){
                this.timelineCtrl.setPlayheadSec(sec);
              } else {
                this.renderTimeline();
              }
            },
            onLog: log,
            onAlert: (msg) => alert(msg),
            // Persist/render only on discrete stop events (NOT per-frame).
            onStopped: () => { persist(); this.render(); },
          });
        }
      }catch(e){
        console.warn('AudioController init failed', e);
      }


      // Ensure timeline snap dropdown exists before TimelineController binds.
      this._ensureTimelineSnapSelect();



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
      // If we can resolve the instance, update active track highlight.
      try{
        const inst = (this.project.instances||[]).find(x => x && x.id === instId);
        if (inst && Number.isFinite(inst.trackIndex)) this.setActiveTrackIndex(inst.trackIndex);
      }catch(e){}

      // Toggle selected class in-place
      if (this._selectedInstEl && this._selectedInstEl !== el){
        try{ this._selectedInstEl.classList.remove('selected'); }catch(e){}
      }
      if (el){
        el.classList.add('selected');
        this._selectedInstEl = el;
      }
      this.renderSelection();
    
      // Keep dynamic master volume UI alive across renders.
      this._initMasterVolumeUI();
    },
    onOpenClipEditor: (clipId) => this.openClipEditor(clipId),
    onAddClipToTimeline: (clipId, startSec, trackIndex) => this.addClipToTimeline(clipId, startSec, trackIndex),
    onSetActiveTrackIndex: (ti) => this.setActiveTrackIndex(ti),
    onSetTrackInstrument: (trackId, instrument) => this.setTrackInstrument(trackId, instrument),
    onSetTrackGainDb: (trackId, gainDb) => this.setTrackGainDb(trackId, gainDb),
    onPersistAndRender: () => { persist(); this.render(); },
    onRemoveInstance: (instId) => this.deleteInstance(instId),
    escapeHtml,
    fmtSec,
    // Click empty timeline -> move playhead (seek if playing, persist if stopped)
    onMovePlayheadSec: (sec) => {
      this.project.ui.playheadSec = sec;
      const bpm = (this.project && typeof this.project.bpm === 'number') ? this.project.bpm : 120;
      const beat = (sec * bpm) / 60;
      $('#lblPlayhead').textContent = `Playhead: ${fmtSec(sec)} (${beat.toFixed(2)}b)`;

      if (this.timelineCtrl && typeof this.timelineCtrl.setPlayheadSec === 'function'){
        this.timelineCtrl.setPlayheadSec(sec);
      }

      if (this.state.transportPlaying && this.audioCtrl && typeof this.audioCtrl.seekSec === 'function'){
        // Avoid persisting/rebuilding during playback; stop+reschedule inside seekSec().
        this.audioCtrl.seekSec(sec);
        return;
      }
      // Not playing: persist and re-render so the new playhead is saved.
      persist();
      this.render();
    },
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

    // Ensure the Timeline Snap dropdown exists in the DOM.
    // TimelineController will bind to #selTimelineSnap if present.
    _ensureTimelineSnapSelect(){
      try {
        if (typeof document === 'undefined') return;
        if (document.getElementById('selTimelineSnap')) return;

        const bpmInp = document.getElementById('inpBpm');
        if (!bpmInp) return;

        const label = document.createElement('span');
        label.textContent = 'Snap:';
        label.className = 'miniLabel';

        const sel = document.createElement('select');
        sel.id = 'selTimelineSnap';
        sel.className = 'mini';
        const opts = [
          {v:'off', t:'Off'},
          {v:'4', t:'1/4'},
          {v:'8', t:'1/8'},
          {v:'16', t:'1/16'},
          {v:'32', t:'1/32'},
        ];
        for (const o of opts){
          const op = document.createElement('option');
          op.value = o.v;
          op.textContent = o.t;
          sel.appendChild(op);
        }
        sel.value = '16';

        // Insert right after the BPM input so it's always visible.
        bpmInp.insertAdjacentElement('afterend', sel);
        sel.insertAdjacentElement('beforebegin', label);
      } catch (e) {
        // Never break UI init for a convenience widget.
        console.warn('[app] _ensureTimelineSnapSelect failed', e);
      }
    },


    /**
     * Change BPM while preserving beat-positions (no visual drift).
     *
     * Rule:
     * - Beats are the source-of-truth (ProjectDoc v2).
     * - UI stays in a v1 seconds-view, but it must keep pxPerBeat constant;
     *   therefore pxPerSec/startSec/playheadSec are re-derived from beats.
     * - If currently playing, we stop+reschedule from the same beat.
     */
    setProjectBpm(nextBpm){
      const oldBpm = (this.project && typeof this.project.bpm === 'number') ? this.project.bpm : 120;
      const bpm = H2SProject.clamp(Number(nextBpm || oldBpm), 30, 260);
      if (bpm === oldBpm){
        $('#inpBpm').value = bpm;
        return;
      }

      const curSec = (this.project && this.project.ui && typeof this.project.ui.playheadSec === 'number') ? this.project.ui.playheadSec : 0;
      const curBeat = (curSec * oldBpm) / 60;
      const wasPlaying = !!(this.state && this.state.transportPlaying && this.audioCtrl && this.audioCtrl.isPlaying && this.audioCtrl.isPlaying());

      // Preferred path: roundtrip through ProjectDoc v2 so ALL derived seconds fields
      // (instances, scores, meta.spanSec, etc.) stay consistent.
      const p2 = _projectV1ToV2(this.project);
      if (p2 && _isProjectV2(p2)){
        p2.bpm = bpm;
        p2.ui = p2.ui || {};
        // Preserve beat position for playhead.
        p2.ui.playheadBeat = Math.max(0, curBeat);
        _writeLS(LS_KEY_V2, p2);
        try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
        this.project = _projectV2ToV1View(p2);
      } else {
        // Fallback path (should be rare): scale all seconds by oldBpm/bpm.
        const scale = oldBpm / bpm;
        this.project.bpm = bpm;
        this.project.ui = this.project.ui || {};
        if (typeof this.project.ui.playheadSec === 'number') this.project.ui.playheadSec *= scale;
        if (typeof this.project.ui.pxPerSec === 'number') this.project.ui.pxPerSec /= scale; // keep pxPerBeat constant
        if (Array.isArray(this.project.instances)){
          for (const inst of this.project.instances){
            if (typeof inst.startSec === 'number') inst.startSec *= scale;
          }
        }
        if (Array.isArray(this.project.clips)){
          for (const clip of this.project.clips){
            if (clip && clip.score && Array.isArray(clip.score.notes)){
              for (const n of clip.score.notes){
                if (typeof n.start === 'number') n.start *= scale;
                if (typeof n.dur === 'number') n.dur *= scale;
              }
            }
            if (clip && clip.meta && typeof clip.meta.spanSec === 'number') clip.meta.spanSec *= scale;
          }
        }
      }

      $('#inpBpm').value = this.project.bpm;
      persist();
      this.render();
      log('BPM set: ' + this.project.bpm);

      // If playing: stop+reschedule from the same beat.
      if (wasPlaying && this.audioCtrl && typeof this.audioCtrl.seekBeat === 'function'){
        this.audioCtrl.seekBeat(curBeat);
      }
    },

addTrack(){
  // v2-only mutation: add a new track and persist via setProjectFromV2
  const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
  const p2 = this.getProjectV2 && this.getProjectV2();
  if (!p2 || !P) { console.error('[App] addTrack: missing project v2 or H2SProject'); return; }
  if (!Array.isArray(p2.tracks)) p2.tracks = [];
  const id = (P && typeof P.uid === 'function') ? P.uid('trk_') : ('trk_' + Math.random().toString(16).slice(2,10));
  const name = 'Track ' + (p2.tracks.length + 1);
  p2.tracks.push({ id, name, instrument: 'default', gainDb: 0, muted: false });
  // Make the new track active
  this.state.activeTrackIndex = Math.max(0, p2.tracks.length - 1);
  this.state.activeTrackId = id;
  if (typeof this.setProjectFromV2 === 'function') this.setProjectFromV2(p2);
  else { this.project = p2; if (typeof this.persist === 'function') this.persist(); if (typeof this.render === 'function') this.render(); }
},

removeActiveTrack(){
  const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
  const p2 = this.getProjectV2 && this.getProjectV2();
  if (!p2 || !P) { console.error('[App] removeActiveTrack: missing project v2 or H2SProject'); return; }
  if (!Array.isArray(p2.tracks) || p2.tracks.length <= 1){
    console.warn('[App] removeActiveTrack: cannot remove last track');
    return;
  }
  const idx = Math.max(0, Math.min(p2.tracks.length - 1, Number(this.state.activeTrackIndex||0)));
  const tid = p2.tracks[idx] && p2.tracks[idx].id;
  if (!tid){ console.error('[App] removeActiveTrack: active track id missing'); return; }

  // Remove instances on that track (v2 instances is an array)
  if (Array.isArray(p2.instances)){
    p2.instances = p2.instances.filter(inst => inst && inst.trackId !== tid);
  }
  p2.tracks.splice(idx, 1);

  // Clamp active
  const nextIdx = Math.max(0, Math.min(p2.tracks.length - 1, idx));
  const nextId = p2.tracks[nextIdx] && p2.tracks[nextIdx].id;
  this.state.activeTrackIndex = nextIdx;
  this.state.activeTrackId = nextId || null;

  if (typeof this.setProjectFromV2 === 'function') this.setProjectFromV2(p2);
  else { this.project = p2; if (typeof this.persist === 'function') this.persist(); if (typeof this.render === 'function') this.render(); }
},

ensureTrackButtons(){
  if (typeof document === 'undefined') return;
  const kv = document.getElementById('kvTracks');
  if (!kv) return;
  const row = kv.parentElement;
  if (!row) return;
  if (row.querySelector('[data-act="addTrack"]')) return;

  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.gap = '6px';
  wrap.style.marginLeft = '8px';

  const btnAdd = document.createElement('button');
  btnAdd.className = 'btn';
  btnAdd.textContent = '+';
  btnAdd.title = 'Add track';
  btnAdd.setAttribute('data-act','addTrack');

  const btnDel = document.createElement('button');
  btnDel.className = 'btn';
  btnDel.textContent = '−';
  btnDel.title = 'Remove active track';
  btnDel.setAttribute('data-act','removeTrack');

  wrap.appendChild(btnAdd);
  wrap.appendChild(btnDel);
  row.appendChild(wrap);

  btnAdd.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); this.addTrack(); });
  btnDel.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); this.removeActiveTrack(); });
},



    render(){
      try{ this.ensureTrackButtons(); }catch(e){}
      // Inspector stats
      $('#kvTracks').textContent = String(this.project.tracks.length);
      $('#kvClips').textContent = String(this.project.clips.length);
      $('#kvInst').textContent = String(this.project.instances.length);
      $('#inpBpm').value = this.project.bpm;

      this.renderClipList();
      this.renderTimeline();
      this.renderSelection();
      try{ this.updateRecordButtonStates(); }catch(e){}
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




    setActiveTrackIndex(trackIndex){
      const n = Number(trackIndex);
      if (!Number.isFinite(n)) return {ok:false, error:'bad_track_index'};
      const max = Math.max(0, (this.project.tracks||[]).length - 1);
      const ti = Math.max(0, Math.min(max, Math.round(n)));
      this.state.activeTrackIndex = ti;
      this.state.activeTrackId = (this.project.tracks && this.project.tracks[ti]) ? this.project.tracks[ti].id : null;
      // Soft update: timeline highlight only (no persist)
      try{
        if (this.timelineCtrl && typeof this.timelineCtrl.setActiveTrackIndex === 'function'){
          this.timelineCtrl.setActiveTrackIndex(ti);
        }else{
          this.renderTimeline();
        }
      }catch(e){}
      return {ok:true, trackIndex: ti, trackId: this.state.activeTrackId};
    },

    addClipToTimeline(clipId, startSec, trackIndex){
      const ti = (trackIndex == null) ? (Number.isFinite(this.state.activeTrackIndex) ? this.state.activeTrackIndex : 0) : trackIndex;
      const inst = H2SProject.createInstance(clipId, startSec || (this.project.ui.playheadSec || 0), ti);
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
      await this.uploadFileAndGenerate(f);
    },

    /** PR-C2: Set import status (upload/generate progress). showCancel: only during active import. */
    setImportStatus(text, showCancel){
      if (typeof document === 'undefined') return;
      const el = $('#studioImportStatus');
      if (el) el.textContent = text || '';
      const btn = $('#btnCancelImport');
      if (btn) btn.style.display = (text && showCancel) ? 'inline-block' : 'none';
    },

    /** PR-C1: Shared upload/generate pipeline — used by Upload WAV and Use last recording. */
    async uploadFileAndGenerate(f){
      if (!f || !(f instanceof Blob)) return;
      const file = f instanceof File ? f : new File([f], (f.name || 'recording.webm'), { type: (f.type || 'audio/webm') });
      this.state.importCancelled = false;
      this.setImportStatus('Uploading audio...', true);
      log(`Uploading ${file.name} ...`);
      try{
        const fd = new FormData();
        fd.append('file', file, file.name);
        const res = await fetchJson(API.generate('mp3'), { method:'POST', body:fd });
        const tid = res.task_id || res.id || res.taskId || res.task || null;
        if (!tid){
          this.setImportStatus('Failed: Server did not return task ID.', false);
          log('generate returned no task_id');
          alert('Upload failed: server did not return a task ID. Check backend logs.');
          return;
        }
        this.state.lastUploadTaskId = tid;
        log(`Generate queued: ${tid}`);
        this.setImportStatus('Processing... (task: ' + String(tid).slice(0, 8) + '...)', true);
        await this.pollTaskUntilDone(tid);
        if (this.state.importCancelled){
          this.setImportStatus('Cancelled.', false);
          log('Import cancelled by user');
          return;
        }
        this.setImportStatus('Fetching result...', true);
        const score = await fetchJson(API.score(tid));
        if (this.state.importCancelled){
          this.setImportStatus('Cancelled.', false);
          return;
        }
        this.setImportStatus('Creating clip...', true);

        if ((this.project.clips || []).length === 0){
          const srcBpm = (typeof score.tempo_bpm === 'number') ? score.tempo_bpm : ((typeof score.bpm === 'number') ? score.bpm : null);
          if (typeof srcBpm === 'number' && isFinite(srcBpm) && srcBpm >= 30 && srcBpm <= 300){
            this.project.bpm = srcBpm;
            const el = $('#bpm');
            if (el) el.value = String(Math.round(srcBpm));
          }
        }

        const clip = H2SProject.createClipFromScore(score, { name: file.name.replace(/\.[^/.]+$/, ''), sourceTaskId: tid });
        if (!clip.meta) clip.meta = {};
        if (typeof score.tempo_bpm === 'number') clip.meta.sourceTempoBpm = score.tempo_bpm;
        else if (typeof score.bpm === 'number') clip.meta.sourceTempoBpm = score.bpm;
        this.project.clips.unshift(clip);
        this.addClipToTimeline(clip.id, this.project.ui.playheadSec || 0, 0);
        persist();
        this.render();
        this.setImportStatus('Done', false);
        log(`Clip added: ${clip.name}`);
        const cidNew = clip.id;
        if (this.state.autoOpenAfterImport && typeof this.openClipEditor === 'function'){
          setTimeout(() => this.openClipEditor(cidNew), 0);
        }
        setTimeout(() => this.setImportStatus('', false), 2000);
      }catch(e){
        if (this.state.importCancelled){
          this.setImportStatus('Cancelled.', false);
          log('Import cancelled by user');
        }else{
          const msg = (e && e.message) ? String(e.message) : String(e);
          const short = msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
          this.setImportStatus('Failed: ' + short, false);
          log('Upload/generate error: ' + msg);
          console.error('[Studio] uploadFileAndGenerate error', e);
          let userMsg = 'Generate failed. ';
          if (/timeout/i.test(msg)) userMsg += 'Processing timed out. Try a shorter clip.';
          else if (/task failed/i.test(msg)) userMsg += 'Backend task failed. Check server logs.';
          else if (/fetch|network/i.test(msg)) userMsg += 'Network error. Check connection and server.';
          else userMsg += 'See status bar and console for details.';
          alert(userMsg);
        }
      }
    },

    /** PR-C5.3b: Reliable isPlaying for S button visibility. */
    _isPlaying(){
      if (this.audioCtrl && typeof this.audioCtrl.playing === 'boolean') return this.audioCtrl.playing;
      if (this.state && this.state.transportPlaying) return true;
      try{
        if (typeof window !== 'undefined' && window.Tone && window.Tone.Transport) return String(window.Tone.Transport.state) === 'started';
      }catch(e){}
      return false;
    },

    /** PR-C1/PR-C5: Recording state machine + Recording panel UI. */
    updateRecordButtonStates(){
      if (typeof document === 'undefined') return;
      const rec = $('#btnRecord');
      const stp = document.getElementById('btnStop');
      const useLast = $('#btnUseLast');
      const timerEl = $('#studioRecordTimer');
      const waveEl = $('#studioRecordWaveform');
      const statusEl = $('#studioRecordStatus');
      const active = !!this.state.recordingActive;
      if (rec) {
        rec.textContent = active ? '\u23F9 Stop' : '\u{1F534} Record';
        rec.title = active ? 'Stop recording' : 'Record mic (R)';
        rec.disabled = false;
      }
      if (stp) {
        const playing = this._isPlaying();
        stp.style.visibility = playing ? 'visible' : 'hidden';
        stp.style.pointerEvents = playing ? '' : 'none';
        stp.title = 'Stop + Reset (S)';
      }
      if (useLast) {
        useLast.disabled = !this.state.lastRecordedFile;
        useLast.style.opacity = this.state.lastRecordedFile ? '1' : '.6';
      }
      if (timerEl) timerEl.style.display = active ? '' : 'none';
      if (waveEl) waveEl.style.display = active ? '' : 'none';
    },

    async startRecording(){
      if (this.state.recordingActive) return;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function'){
        log('Microphone not available in this environment.');
        return;
      }
      const statusEl = typeof document !== 'undefined' ? $('#studioRecordStatus') : null;
      const timerEl = typeof document !== 'undefined' ? $('#studioRecordTimer') : null;
      const waveEl = typeof document !== 'undefined' ? $('#studioRecordWaveform') : null;
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: mime });
          const ext = mime.indexOf('webm') >= 0 ? 'webm' : 'ogg';
          this.state.lastRecordedFile = new File([blob], `recording.${ext}`, { type: blob.type || 'audio/webm' });
          this.state.recordingActive = false;
          this._stopRecordingUI();
          const durSec = this._recordingStartMs ? (Date.now() - this._recordingStartMs) / 1000 : 0;
          const mm = Math.floor(durSec / 60);
          const ss = Math.floor(durSec % 60);
          const durStr = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
          if (statusEl) { statusEl.dataset.recordingStatus = '1'; statusEl.textContent = `Recording stopped (${durStr})`; }
          setTimeout(() => { if (statusEl) { statusEl.textContent = ''; delete statusEl.dataset.recordingStatus; } }, 2000);
          this.updateRecordButtonStates();
          log('Recording stopped.');
        };
        recorder.onerror = (e) => {
          this.state.recordingActive = false;
          this._stopRecordingUI();
          this.updateRecordButtonStates();
          log(`Recording error: ${e.error || 'unknown'}`);
        };
        this._mediaRecorder = recorder;
        this._recordedChunks = chunks;
        recorder.start(200);
        this.state.recordingActive = true;
        this._recordingStartMs = Date.now();
        this._startRecordingUI(stream, waveEl, timerEl);
        this.updateRecordButtonStates();
        log('Recording started.');
      }catch(e){
        this.state.recordingActive = false;
        if (statusEl) statusEl.textContent = 'Microphone permission denied.';
        this.updateRecordButtonStates();
        this.setImportStatus('Microphone permission denied.', false);
        log(`Microphone access denied or unavailable: ${String(e && e.message ? e.message : e)}`);
        alert('Cannot access microphone. Please allow mic permission and try again.');
        setTimeout(() => { this.setImportStatus('', false); if (statusEl) statusEl.textContent = ''; }, 5000);
      }
    },

    _startRecordingUI(stream, waveEl, timerEl){
      if (typeof document === 'undefined') return;
      const self = this;
      const statusEl = $('#studioRecordStatus');
      this._recordingTimerInterval = setInterval(() => {
        if (!self.state.recordingActive || !timerEl) return;
        const elapsed = (Date.now() - (self._recordingStartMs || 0)) / 1000;
        const mm = Math.floor(elapsed / 60);
        const ss = Math.floor(elapsed % 60);
        timerEl.textContent = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
      }, 200);
      if (waveEl && stream){
        const CtxClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || (typeof AudioContext !== 'undefined' ? AudioContext : null);
        if (!CtxClass){
          if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
          return;
        }
        (async () => {
          try{
            const audioCtx = new CtxClass();
            await audioCtx.resume().catch(() => {});
            this._recAudioCtx = audioCtx;
            const src = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;
            src.connect(analyser);
            const z = audioCtx.createGain();
            z.gain.value = 0;
            analyser.connect(z);
            z.connect(audioCtx.destination);
            this._recAnalyser = analyser;
            this._recZeroGain = z;
            this._recStreamSrc = src;
            const data = new Uint8Array(analyser.fftSize);
            const canvas = waveEl;
            const w = canvas.width;
            const h = canvas.height;
            const sliceWidth = w / data.length;
            const draw = () => {
              try{
                if (!self.state.recordingActive || !analyser) return;
                const ctx2d = canvas.getContext('2d');
                if (!ctx2d){
                  if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
                  return;
                }
                analyser.getByteTimeDomainData(data);
                ctx2d.clearRect(0, 0, w, h);
                ctx2d.strokeStyle = 'rgba(239,68,68,.7)';
                ctx2d.lineWidth = 2;
                ctx2d.beginPath();
                let x = 0;
                for (let i = 0; i < data.length; i++){
                  const v = data[i] / 128.0;
                  const y = v * (h / 2);
                  if (i === 0) ctx2d.moveTo(x, y);
                  else ctx2d.lineTo(x, y);
                  x += sliceWidth;
                }
                ctx2d.stroke();
                ctx2d.strokeStyle = 'rgba(255,255,255,.15)';
                ctx2d.lineWidth = 1;
                ctx2d.beginPath();
                ctx2d.moveTo(0, h / 2);
                ctx2d.lineTo(w, h / 2);
                ctx2d.stroke();
              }catch(err){
                if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
                log('Waveform draw error: ' + err);
                return;
              }
              self._recordingWaveformRaf = requestAnimationFrame(draw);
            };
            draw();
          }catch(err){
            log('Waveform init failed: ' + err);
            if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
          }
        })();
      }
    },

    _stopRecordingUI(){
      if (typeof document === 'undefined') return;
      if (this._recordingTimerInterval){ clearInterval(this._recordingTimerInterval); this._recordingTimerInterval = null; }
      if (this._recordingWaveformRaf){ cancelAnimationFrame(this._recordingWaveformRaf); this._recordingWaveformRaf = null; }
      if (this._recStreamSrc){ try{ this._recStreamSrc.disconnect(); }catch(e){} this._recStreamSrc = null; }
      if (this._recAnalyser){ try{ this._recAnalyser.disconnect(); }catch(e){} this._recAnalyser = null; }
      if (this._recZeroGain){ try{ this._recZeroGain.disconnect(); }catch(e){} this._recZeroGain = null; }
      if (this._recAudioCtx){ this._recAudioCtx.close().catch(() => {}); this._recAudioCtx = null; }
      const timerEl = $('#studioRecordTimer');
      const waveEl = $('#studioRecordWaveform');
      if (timerEl){ timerEl.textContent = '00:00'; timerEl.style.display = 'none'; }
      if (waveEl){
        waveEl.style.display = 'none';
        const g = waveEl.getContext('2d');
        if (g) g.clearRect(0, 0, waveEl.width, waveEl.height);
      }
    },

    stopRecording(){
      if (!this.state.recordingActive || !this._mediaRecorder) return;
      try{
        if (this._mediaRecorder.state !== 'inactive') this._mediaRecorder.stop();
      }catch(e){ log(`Stop recording: ${e}`); }
      this._stopRecordingUI();
      this._mediaRecorder = null;
      this._recordedChunks = null;
    },

    useLastRecording(){
      if (!this.state.lastRecordedFile) return;
      this.uploadFileAndGenerate(this.state.lastRecordedFile);
    },

    async pollTaskUntilDone(taskId){
      const maxWaitMs = 180000;
      const start = performance.now();
      while (true){
        if (this.state.importCancelled) throw new Error('Cancelled by user');
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

    async _getMasterGainDb(){
      try{
        const raw = localStorage.getItem('h2s_master_gain_db');
        const v = Number(raw);
        if (Number.isFinite(v)) return Math.max(-40, Math.min(0, v));
      }catch(e){}
      return -24;
    },
    _setMasterGainDb(db){
      const v = Math.max(-40, Math.min(0, Number(db)));
      try{ localStorage.setItem('h2s_master_gain_db', String(v)); }catch(e){}
      this._masterGainDb = v;
      this._applyMasterGain();
    },
    _applyMasterGain(){
      try{
        if (window.Tone && Tone.Destination && Tone.Destination.volume){
          const v = (typeof this._masterGainDb === 'number') ? this._masterGainDb : this._getMasterGainDb();
          Tone.Destination.volume.value = v;
        }
      }catch(e){}
    },
    _initMasterVolumeUI(){
      // Browser-only, safe if called multiple times.
      try{
        if (typeof document === 'undefined') return;
        if (document.getElementById('h2sMasterVol')) return;

        const row = document.querySelector('.topbar .row');
        if (!row) return;

        this._masterGainDb = this._getMasterGainDb();

        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';
        wrap.style.marginLeft = '10px';

        const lab = document.createElement('span');
        lab.textContent = 'Vol';
        lab.style.fontSize = '12px';
        lab.style.opacity = '0.85';

        const input = document.createElement('input');
        input.id = 'h2sMasterVol';
        input.type = 'range';
        input.min = '-40';
        input.max = '0';
        input.step = '1';
        input.value = String(this._masterGainDb);
        input.title = 'Master volume (dB)';
        input.style.width = '120px';
        const val = document.createElement('span');
        val.id = 'h2sMasterVolVal';
        val.style.fontSize = '12px';
        val.style.opacity = '0.85';
        val.style.minWidth = '28px';
        val.style.textAlign = 'right';

        const dbToPct = (db) => {
          const x = Math.max(-40, Math.min(0, Number(db)));
          return Math.round(((x + 40) / 40) * 100);
        };
        const updateVal = () => { val.textContent = String(dbToPct(input.value)); };
        updateVal();

        const stop = (e)=>e.stopPropagation();
        input.addEventListener('pointerdown', stop);
        input.addEventListener('mousedown', stop);
        input.addEventListener('click', stop);

        input.addEventListener('input', () => {
          this._setMasterGainDb(Number(input.value));
          updateVal();
        });

        wrap.appendChild(lab);
        wrap.appendChild(input);
        wrap.appendChild(val);
        row.appendChild(wrap);
      }catch(e){}
    },
	async playProject(){
      // Single source of truth: AudioController schedules project playback (v2 flatten).
      // app.js must NOT maintain a parallel legacy scheduling path, to avoid "wrong entry" regressions.
      this._applyMasterGain();
      if (!(this.audioCtrl && typeof this.audioCtrl.playProject === 'function')){
        console.error('[App] playProject: AudioController not available (refusing legacy path).');
        alert('Audio engine not ready (AudioController missing).');
        return false;
      }
      const result = await this.audioCtrl.playProject();
      this.updateRecordButtonStates();
      return result;
    },

    stopProject(){
      if (this.audioCtrl && this.audioCtrl.stop){
        // Delegate to AudioController
        this.audioCtrl.stop();
        this.updateRecordButtonStates();
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

    /** PR-C5.3: Stop playback and reset playhead to start. S key / S button. */
    stopProjectReset(){
      if (this.audioCtrl && this.audioCtrl.stop){
        this.audioCtrl.stop(true);
        this.updateRecordButtonStates();
        return;
      }
      if (window.Tone){
        try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){}
      }
      this.state.transportPlaying = false;
      if (this.project && this.project.ui) this.project.ui.playheadSec = 0;
      log('Project stop (reset).');
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
      Tone.start(); // no await (keep user-gesture)
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

  
  // One-time unlock on first user gesture anywhere.
  try{
    if (typeof document !== 'undefined'){
      document.addEventListener('pointerdown', () => { _unlockAudioFromGesture(); }, { once:true, capture:true });
      document.addEventListener('keydown', () => { _unlockAudioFromGesture(); }, { once:true, capture:true });
    }
  }catch(e){}
// Boot
  window.addEventListener('load', () => app.init());
})();
