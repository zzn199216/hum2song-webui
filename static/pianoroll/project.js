/* Hum2Song Studio MVP - project.js (v9)
   Plain script (no import/export). Exposes window.H2SProject.

   Goals (business mainline):
   - Storage in beats (ProjectDoc v2)
   - Playback/export in seconds via flatten(projectV2) -> sec events
   - Keep current v1 UI/interaction working (no behavior change yet)

   v9 provides the building blocks for T1-0 ~ T1-3:
   - T1-0: timebase API (beat<->sec, px conversions, Free vs Snapped setters)
   - T1-1: ProjectDoc v2 schema helpers + clipOrder invariants
   - T1-2: flatten(projectV2) pure function -> sec events
   - T1-3: migration (scoreSec->Beat, project v1->v2) WITHOUT rhythm quantization

   IMPORTANT: This file is intentionally "single bundle" and attaches to window.
*/
(function(){
  'use strict';

  /* -------------------- small utils -------------------- */

  function uid(prefix){
    const s = Math.random().toString(16).slice(2) + Date.now().toString(16);
    return (prefix || 'id_') + s.slice(0, 12);
  }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function isFiniteNumber(x){ return typeof x === 'number' && isFinite(x); }

  function roundToDecimals(x, decimals){
    const n = Number(x);
    if (!isFinite(n)) return 0;
    const p = Math.pow(10, decimals);
    return Math.round(n * p) / p;
  }

  function midiToName(m){
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const n = ((m % 12) + 12) % 12;
    const o = Math.floor(m / 12) - 1;
    return names[n] + String(o);
  }

  /* -------------------- constants (frozen defaults) -------------------- */

  const TIMEBASE = {
    // beat is QUARTER-NOTE. time_signature does NOT affect beat length.
    BPM_MIN: 30,
    BPM_MAX: 260,
    BPM_INIT_MIN: 40,
    BPM_INIT_MAX: 240,
    BPM_DEFAULT: 120,

    // Storage layer de-noise: float-round only (NOT grid snap)
    BEAT_ROUND_DECIMALS: 6,      // roundBeat(x)=round(x,1e-6)
    SEC_ROUND_DECIMALS: 6,       // for UI/log/tests ONLY
    EPS_BEAT_TINY: 1e-6,
    EPS_BEAT_LOOSE: 1e-4,

    // transpose normalization
    TRANSPOSE_MIN: -48,
    TRANSPOSE_MAX: 48,
  };

  // Schema defaults / versioning guard (T3-0b)
  const SCHEMA_V2 = {
    DEFAULT_TRACK_ID: 'trk_0',
    DEFAULT_INSTRUMENT: 'default',
  };

  function defaultTrackV2(){
    return { id: SCHEMA_V2.DEFAULT_TRACK_ID, name: 'Track 1', instrument: SCHEMA_V2.DEFAULT_INSTRUMENT, gainDb: 0, muted: false };
  }

  function ensureTrackV2(track, idx){
    const t = (track && typeof track === 'object') ? track : {};
    if (!t.id || typeof t.id !== 'string' || !t.id.trim()){
      t.id = (idx == 0) ? SCHEMA_V2.DEFAULT_TRACK_ID : uid('trk_');
    }
    if (typeof t.name !== 'string'){
      t.name = String(t.name ?? ('Track ' + String((idx ?? 0) + 1)));
    }
    if (typeof t.instrument !== 'string' || !t.instrument.trim()){
      t.instrument = SCHEMA_V2.DEFAULT_INSTRUMENT;
    }
    if (!isFiniteNumber(t.gainDb)) t.gainDb = 0;
    t.gainDb = Math.max(-30, Math.min(6, Number(t.gainDb)));
    if (typeof t.muted !== 'boolean') t.muted = false;
    return t;
  }

  function upgradeProjectV2LegacyInPlace(project){
    // Accept slightly-older v2 saves where some fields are missing or in v1-ish shape.
    // This MUST be safe & idempotent.
    if (!project || typeof project !== 'object') return project;

    // tracks[] guard
    if (!Array.isArray(project.tracks) || project.tracks.length === 0){
      project.tracks = [ defaultTrackV2() ];
    } else {
      for (let i = 0; i < project.tracks.length; i++){
        project.tracks[i] = ensureTrackV2(project.tracks[i], i);
      }
    }

    // ui legacy conversion: pxPerSec/playheadSec -> pxPerBeat/playheadBeat
    if (!project.ui) project.ui = {};
    const bpm = coerceBpm(project.bpm);
    if ((!isFiniteNumber(project.ui.pxPerBeat) || project.ui.pxPerBeat <= 0) && isFiniteNumber(project.ui.pxPerSec)) {
      project.ui.pxPerBeat = pxPerSecToPxPerBeat(project.ui.pxPerSec, bpm);
    }
    if ((!isFiniteNumber(project.ui.playheadBeat) || project.ui.playheadBeat < 0) && isFiniteNumber(project.ui.playheadSec)) {
      project.ui.playheadBeat = Math.max(0, normalizeBeat(secToBeat(project.ui.playheadSec, bpm)));
    }

    // clips: array -> map (preserve order)
    if (Array.isArray(project.clips)) {
      const arr = project.clips;
      const map = {};
      const order = [];
      for (const c of arr){
        if (!c || typeof c !== 'object') continue;
        const id = (c.id != null) ? String(c.id) : uid('clip_');
        c.id = id;
        if (typeof c.name !== 'string') c.name = String(c.name ?? '');
        if (!isFiniteNumber(c.createdAt)) c.createdAt = Date.now();
        if (!c.meta || typeof c.meta !== 'object') c.meta = {};
        const srcTempo = (c.meta && isFiniteNumber(c.meta.sourceTempoBpm)) ? Number(c.meta.sourceTempoBpm) : null;
        c.score = ensureScoreBeatIds(c.score);
        recomputeClipMetaFromScoreBeat(c);
        if (c.meta) c.meta.sourceTempoBpm = srcTempo;
        if (c.meta && 'spanSec' in c.meta) delete c.meta.spanSec;
        map[id] = c;
        order.push(id);
      }
      project.clips = map;
      if (!Array.isArray(project.clipOrder) || project.clipOrder.length === 0) {
        project.clipOrder = order;
      }
    }

    // clipOrder missing for map
    if (project.clips && typeof project.clips === 'object' && !Array.isArray(project.clipOrder)) {
      project.clipOrder = Object.keys(project.clips);
    }

    // instances legacy: trackIndex -> trackId
    if (!Array.isArray(project.instances)) project.instances = [];
    const defaultTrackId = (project.tracks && project.tracks[0]) ? project.tracks[0].id : SCHEMA_V2.DEFAULT_TRACK_ID;
    for (const inst of project.instances){
      if (!inst || typeof inst !== 'object') continue;
      if (!inst.trackId || typeof inst.trackId !== 'string'){
        const tiRaw = ('trackIndex' in inst) ? Number(inst.trackIndex) : 0;
        const ti = (isFiniteNumber(tiRaw) && tiRaw >= 0) ? Math.floor(tiRaw) : 0;
        const tid = (project.tracks && project.tracks[ti] && project.tracks[ti].id) ? project.tracks[ti].id : defaultTrackId;
        inst.trackId = tid;
      }
      if ('trackIndex' in inst) delete inst.trackIndex;
      if ('startSec' in inst) delete inst.startSec;
    }

    return project;
  }


  function coerceBpm(bpm){
    const n = Number(bpm);
    if (!isFinite(n) || n <= 0) return TIMEBASE.BPM_DEFAULT;
    return clamp(n, TIMEBASE.BPM_MIN, TIMEBASE.BPM_MAX);
  }

  function coerceTranspose(x){
    // FROZEN: transpose is integer. Non-int -> Math.round.
    const n = Number(x);
    if (!isFinite(n)) return 0;
    return clamp(Math.round(n), TIMEBASE.TRANSPOSE_MIN, TIMEBASE.TRANSPOSE_MAX);
  }

  // Storage-layer de-noise (NOT grid snap).
  function roundBeat(x){
    return roundToDecimals(x, TIMEBASE.BEAT_ROUND_DECIMALS);
  }

  function roundSec(x){
    // FROZEN: roundSec is ONLY for UI/log/tests (never for Tone scheduling)
    return roundToDecimals(x, TIMEBASE.SEC_ROUND_DECIMALS);
  }

  function normalizeBeat(x){
    // FROZEN: normalize-on-write uses normalizeBeat + clamp at write sites.
    return roundBeat(x);
  }

  /* -------------------- T1-0 timebase API (beat <-> sec <-> px) -------------------- */

  function beatToSec(beat, bpm){
    const b = Number(beat);
    const t = coerceBpm(bpm);
    if (!isFinite(b)) return 0;
    return (b * 60) / t;
  }

  function secToBeat(sec, bpm){
    const s = Number(sec);
    const t = coerceBpm(bpm);
    if (!isFinite(s)) return 0;
    return (s * t) / 60;
  }

  function pxPerSecToPxPerBeat(pxPerSec, bpm){
    const p = Number(pxPerSec);
    const t = coerceBpm(bpm);
    if (!isFinite(p) || p <= 0) return 80;
    return (p * 60) / t;
  }

  function pxPerBeatToPxPerSec(pxPerBeat, bpm){
    const p = Number(pxPerBeat);
    const t = coerceBpm(bpm);
    if (!isFinite(p) || p <= 0) return 160;
    return (p * t) / 60;
  }

  function snapToGridBeat(beat, gridBeat){
    const b = Number(beat);
    const g = Number(gridBeat);
    if (!isFinite(b) || !isFinite(g) || g <= 0) return b;
    return Math.round(b / g) * g;
  }

  function snapIfCloseBeat(beat, gridBeat, epsBeat){
    const b = Number(beat);
    const g = Number(gridBeat);
    const eps = Number(epsBeat);
    if (!isFinite(b) || !isFinite(g) || g <= 0 || !isFinite(eps) || eps <= 0) return normalizeBeat(b);
    const snapped = snapToGridBeat(b, g);
    if (Math.abs(b - snapped) < eps) return normalizeBeat(snapped);
    return normalizeBeat(b);
  }

  function isProjectV2(project){
    return !!(project && (project.version === 2 || project.timebase === 'beat'));
  }

  function getProjectBpm(project){
    return coerceBpm(project && project.bpm);
  }

  // Derived read-only seconds, regardless of v1/v2 storage.
  function getPlayheadSec(project){
    const bpm = getProjectBpm(project);
    if (isProjectV2(project)){
      const b = project.ui && isFiniteNumber(project.ui.playheadBeat) ? project.ui.playheadBeat : 0;
      return beatToSec(b, bpm);
    }
    const s = project && project.ui && isFiniteNumber(project.ui.playheadSec) ? project.ui.playheadSec : 0;
    return s;
  }

  function getInstanceStartSec(project, inst){
    const bpm = getProjectBpm(project);
    if (isProjectV2(project)){
      const b = inst && isFiniteNumber(inst.startBeat) ? inst.startBeat : 0;
      return beatToSec(b, bpm);
    }
    return inst && isFiniteNumber(inst.startSec) ? inst.startSec : 0;
  }

  // FROZEN: setters must be Free vs Snapped.
  function setPlayheadFromSec_Free(project, sec){
    const bpm = getProjectBpm(project);
    const s = Math.max(0, Number(sec) || 0);
    if (!project.ui) project.ui = {};
    if (isProjectV2(project)){
      project.ui.playheadBeat = Math.max(0, normalizeBeat(secToBeat(s, bpm)));
    } else {
      project.ui.playheadSec = s;
    }
  }

  function setPlayheadFromSec_Snapped(project, sec, gridBeat){
    const bpm = getProjectBpm(project);
    const s = Math.max(0, Number(sec) || 0);
    if (!project.ui) project.ui = {};
    if (isProjectV2(project)){
      let b = secToBeat(s, bpm);
      b = snapToGridBeat(b, gridBeat);
      project.ui.playheadBeat = Math.max(0, normalizeBeat(b));
    } else {
      // v1: snap is on seconds grid derived from beat grid
      const gb = Number(gridBeat);
      if (isFinite(gb) && gb > 0){
        const gridSec = beatToSec(gb, bpm);
        project.ui.playheadSec = Math.max(0, Math.round(s / gridSec) * gridSec);
      } else {
        project.ui.playheadSec = s;
      }
    }
  }

  function setInstanceStartFromSec_Free(project, inst, sec){
    const bpm = getProjectBpm(project);
    const s = Math.max(0, Number(sec) || 0);
    if (!inst) return;
    if (isProjectV2(project)){
      inst.startBeat = Math.max(0, normalizeBeat(secToBeat(s, bpm)));
      // ensure no startSec on v2 instances
      if ('startSec' in inst) delete inst.startSec;
      if ('trackIndex' in inst) delete inst.trackIndex;
    } else {
      inst.startSec = s;
    }
  }

  function setInstanceStartFromSec_Snapped(project, inst, sec, gridBeat){
    const bpm = getProjectBpm(project);
    const s = Math.max(0, Number(sec) || 0);
    if (!inst) return;
    if (isProjectV2(project)){
      let b = secToBeat(s, bpm);
      b = snapToGridBeat(b, gridBeat);
      inst.startBeat = Math.max(0, normalizeBeat(b));
      if ('startSec' in inst) delete inst.startSec;
      if ('trackIndex' in inst) delete inst.trackIndex;
    } else {
      const gb = Number(gridBeat);
      if (isFinite(gb) && gb > 0){
        const gridSec = beatToSec(gb, bpm);
        inst.startSec = Math.max(0, Math.round(s / gridSec) * gridSec);
      } else {
        inst.startSec = s;
      }
    }
  }

  /* -------------------- v1 score helpers (existing behavior) -------------------- */

  function ensureScoreIds(score){
    if (!score) return score;
    if (!score.tracks) score.tracks = [];
    for (const t of score.tracks){
      if (!t.id) t.id = uid('trk_');
      if (typeof t.name !== 'string') t.name = String(t.name ?? '');
      if (!Array.isArray(t.notes)) t.notes = [];
      for (const n of t.notes){
        if (!n.id) n.id = uid('n_');
        if (typeof n.pitch !== 'number') n.pitch = Number(n.pitch ?? 60);
        if (typeof n.start !== 'number') n.start = Number(n.start ?? 0);
        if (typeof n.duration !== 'number') n.duration = Number(n.duration ?? 0.2);
        if (typeof n.velocity !== 'number') n.velocity = Number(n.velocity ?? 100);
        n.pitch = clamp(Math.round(n.pitch), 0, 127);
        n.velocity = clamp(Math.round(n.velocity), 1, 127);
        n.start = Math.max(0, n.start);
        // Keep legacy min duration to avoid 0-length notes.
        n.duration = Math.max(0.01, n.duration);
      }
    }
    // Prefer tempo_bpm if bpm is absent.
    const tempo = (typeof score.tempo_bpm === 'number') ? score.tempo_bpm : undefined;
    if (typeof score.bpm !== 'number') score.bpm = Number((tempo !== undefined) ? tempo : (score.bpm ?? 120));
    score.bpm = clamp(Number(score.bpm || 120), TIMEBASE.BPM_MIN, TIMEBASE.BPM_MAX);
    return score;
  }

  function scoreStats(score){
    score = ensureScoreIds(deepClone(score || {bpm:120, tracks:[]}));
    let minP = 127, maxP = 0, maxEnd = 0, count = 0;
    for (const t of score.tracks){
      for (const n of t.notes){
        count += 1;
        minP = Math.min(minP, n.pitch);
        maxP = Math.max(maxP, n.pitch);
        maxEnd = Math.max(maxEnd, n.start + n.duration);
      }
    }
    if (count === 0){ minP = 60; maxP = 60; maxEnd = 0; }
    return { count, minPitch:minP, maxPitch:maxP, spanSec: maxEnd };
  }

  function defaultProject(){
    return {
      version: 1,
      bpm: TIMEBASE.BPM_DEFAULT,
      tracks: [ defaultTrackV2() ],
      clips: [],
      instances: [],
      ui: { pxPerSec: 160, playheadSec: 0 }
    };
  }

  function createClipFromScore(score, opts){
    const s = ensureScoreIds(deepClone(score));
    const st = scoreStats(s);
    const name = (opts && opts.name) ? String(opts.name) : ('Clip ' + uid('').slice(0,5));
    return {
      id: uid('clip_'),
      name,
      createdAt: Date.now(),
      sourceTaskId: (opts && opts.sourceTaskId) ? String(opts.sourceTaskId) : null,
      score: s,
      meta: {
        notes: st.count,
        pitchMin: st.minPitch,
        pitchMax: st.maxPitch,
        spanSec: st.spanSec
      }
    };
  }

  function createInstance(clipId, startSec, trackIndex){
    return {
      id: uid('inst_'),
      clipId,
      startSec: Math.max(0, Number(startSec || 0)),
      trackIndex: Math.max(0, Number(trackIndex || 0)),
      transpose: 0
    };
  }

  /* -------------------- T1-1 ProjectDoc v2 helpers (beats) -------------------- */

  function defaultProjectV2(){
    const p = {
      version: 2,
      timebase: 'beat',
      bpm: TIMEBASE.BPM_DEFAULT,
      tracks: [ defaultTrackV2() ],
      clips: {},
      clipOrder: [],
      instances: [],
      ui: { pxPerBeat: 80, playheadBeat: 0 }
    };
    p.clipOrder = [];
    return p;
  }

  function ensureScoreBeatIds(scoreBeat){
    if (!scoreBeat) scoreBeat = { version: 2, tempo_bpm: null, time_signature: null, tracks: [] };
    if (!Array.isArray(scoreBeat.tracks)) scoreBeat.tracks = [];
    for (const t of scoreBeat.tracks){
      if (!t.id) t.id = uid('trk_');
      if (typeof t.name !== 'string') t.name = String(t.name ?? '');
      if (!Array.isArray(t.notes)) t.notes = [];
      for (const n of t.notes){
        if (!n.id) n.id = uid('n_');
        n.pitch = clamp(Math.round(Number(n.pitch ?? 60)), 0, 127);
        n.velocity = clamp(Math.round(Number(n.velocity ?? 100)), 1, 127);
        // Accept both startBeat/durationBeat and legacy start/duration (assumed beats here).
        const sb = (n.startBeat !== undefined) ? Number(n.startBeat) : Number(n.start ?? 0);
        const db = (n.durationBeat !== undefined) ? Number(n.durationBeat) : Number(n.duration ?? 0.5);
        n.startBeat = Math.max(0, normalizeBeat(sb));
        n.durationBeat = Math.max(0, normalizeBeat(db));
        // If someone wrote 0, enforce >0 at write layer; keep tiny minimum.
        if (!(n.durationBeat > 0)) n.durationBeat = normalizeBeat(1e-6);
        // Remove legacy keys if present.
        if ('start' in n) delete n.start;
        if ('duration' in n) delete n.duration;
      }
    }
    if (typeof scoreBeat.version !== 'number') scoreBeat.version = 2;
    return scoreBeat;
  }

  function recomputeScoreBeatStats(scoreBeat){
    scoreBeat = ensureScoreBeatIds(deepClone(scoreBeat));
    let count = 0;
    let minP = 127;
    let maxP = 0;
    let spanBeat = 0;
    for (const t of scoreBeat.tracks){
      for (const n of t.notes){
        count += 1;
        minP = Math.min(minP, n.pitch);
        maxP = Math.max(maxP, n.pitch);
        spanBeat = Math.max(spanBeat, (n.startBeat || 0) + (n.durationBeat || 0));
      }
    }
    if (count === 0){
      return { count: 0, pitchMin: null, pitchMax: null, spanBeat: 0 };
    }
    return { count, pitchMin: minP, pitchMax: maxP, spanBeat: normalizeBeat(spanBeat) };
  }

  function recomputeClipMetaFromScoreBeat(clip){
    if (!clip) return clip;
    const st = recomputeScoreBeatStats(clip.score);
    const oldMeta = clip.meta;
    if (!clip.meta) clip.meta = {};
    // FROZEN: these are derived fields and must be consistent with score.
    clip.meta.notes = st.count;
    clip.meta.pitchMin = st.pitchMin;
    clip.meta.pitchMax = st.pitchMax;
    clip.meta.spanBeat = st.spanBeat;
    // Preserve meta.agent (e.g. patchSummary) so optimize results persist.
    if (oldMeta && oldMeta.agent) clip.meta.agent = oldMeta.agent;
    return clip;
  }

/* -------------------- T3-1 clip revisions (version chain) -------------------- */

// Store previous clip heads inside clip.revisions[] so clip.id remains stable for instances.
// Each revision stores score+meta snapshot and can be activated (rollback) safely.
const CLIP_REVISIONS_MAX = 40;

function _iso(ts){
  try{
    const d = new Date(ts);
    if (isFiniteNumber(ts) && !isNaN(d.getTime())) return d.toISOString().slice(0,19).replace('T',' ');
  }catch(e){}
  return '';
}

  function getTimelineSnapBeat(project){
    if (!project || !project.ui) return 0.25;
    return isFiniteNumber(project.ui.timelineSnapBeat) ? project.ui.timelineSnapBeat : 0.25;
  }

  function setTimelineSnapBeat(project, beat){
    if (!project || !project.ui) return;
    let b = Number(beat);
    if (!isFiniteNumber(b) || b < 0) b = 0;
    // 0 means Off
    project.ui.timelineSnapBeat = b === 0 ? 0 : normalizeBeat(b);
  }


function ensureClipRevisionChain(clip){
  if (!clip) return clip;
  if (!Array.isArray(clip.revisions)) clip.revisions = [];

  const out = [];
  const seen = new Set();
  for (const r of clip.revisions){
    if (!r || typeof r !== 'object') continue;
    const rid = String(r.revisionId || '');
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);
        out.push({
      revisionId: rid,
      parentRevisionId: (r.parentRevisionId !== undefined && r.parentRevisionId !== null) ? String(r.parentRevisionId) : null,
      createdAt: isFiniteNumber(r.createdAt) ? Number(r.createdAt) : Date.now(),
      name: (typeof r.name === 'string') ? r.name : String(r.name ?? (clip.name || '')),
      score: ensureScoreBeatIds(r.score),
      meta: (r.meta && typeof r.meta === 'object') ? r.meta : null,
    });
  }

  // Keep oldest->newest in storage; UI can sort differently.
  out.sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));

  // Trim with a "pinned original" policy: if we have an original/root snapshot
  // (parentRevisionId === null), keep it even when exceeding max.
  if (out.length > CLIP_REVISIONS_MAX){
    let rootIdx = -1;
    for (let i=0; i<out.length; i++){
      if (out[i] && out[i].parentRevisionId === null){
        rootIdx = i;
        break; // oldest-first, first null-parent is the earliest root
      }
    }
    if (rootIdx >= 0){
      const root = out[rootIdx];
      out.splice(rootIdx, 1);
      // keep newest (max-1) from remaining, then re-add root
      const keepN = Math.max(0, CLIP_REVISIONS_MAX - 1);
      const tail = keepN ? out.slice(Math.max(0, out.length - keepN)) : [];
      out.length = 0;
      out.push(root, ...tail);
      out.sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));
    } else {
      out.splice(0, out.length - CLIP_REVISIONS_MAX);
    }
  }

  clip.revisions = out;

  if (!clip.revisionId) clip.revisionId = uid('rev_');
  if (clip.parentRevisionId === undefined) clip.parentRevisionId = null;
  clip.parentRevisionId = (clip.parentRevisionId !== null) ? String(clip.parentRevisionId) : null;

  if (!isFiniteNumber(clip.updatedAt)) clip.updatedAt = isFiniteNumber(clip.createdAt) ? clip.createdAt : Date.now();

  return clip;
}

function snapshotClipHead(clip){
  if (!clip) return null;
  ensureClipRevisionChain(clip);
  return {
    revisionId: String(clip.revisionId || uid('rev_')),
    parentRevisionId: (clip.parentRevisionId !== undefined && clip.parentRevisionId !== null) ? String(clip.parentRevisionId) : null,
    createdAt: isFiniteNumber(clip.updatedAt) ? Number(clip.updatedAt) : Date.now(),
    name: (typeof clip.name === 'string') ? clip.name : String(clip.name ?? ''),
    score: ensureScoreBeatIds(deepClone(clip.score || { version:2, tracks:[] })),
    meta: deepClone(clip.meta || {}),
  };
}

function applySnapshotToClipHead(clip, snap){
  if (!clip || !snap) return clip;
  const keepSourceTempo = (clip.meta && isFiniteNumber(clip.meta.sourceTempoBpm)) ? Number(clip.meta.sourceTempoBpm) : null;

  clip.revisionId = String(snap.revisionId || uid('rev_'));
  clip.parentRevisionId = (snap.parentRevisionId !== undefined && snap.parentRevisionId !== null) ? String(snap.parentRevisionId) : null;
  clip.updatedAt = isFiniteNumber(snap.createdAt) ? Number(snap.createdAt) : Date.now();
  if (typeof snap.name === 'string') clip.name = snap.name;

  clip.score = ensureScoreBeatIds(deepClone(snap.score || { version:2, tracks:[] }));
  clip.meta = deepClone((snap.meta && typeof snap.meta === 'object') ? snap.meta : (clip.meta || {}));

  // Recompute derived meta, but preserve sourceTempoBpm if present.
  const src = (clip.meta && isFiniteNumber(clip.meta.sourceTempoBpm)) ? Number(clip.meta.sourceTempoBpm) : keepSourceTempo;
  recomputeClipMetaFromScoreBeat(clip);
  if (clip.meta) clip.meta.sourceTempoBpm = isFiniteNumber(src) ? Number(src) : null;

  ensureClipRevisionChain(clip);
  return clip;
}

function listClipRevisions(clip){
  if (!clip) return { activeRevisionId: '', items: [] };
  ensureClipRevisionChain(clip);

  const items = [];
  const head = snapshotClipHead(clip);
  if (head) items.push({ ...head, kind: 'head' });
  for (const r of (clip.revisions || [])) items.push({ ...r, kind: 'history' });

  // UI uses newest-first.
  items.sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  const out = items.map(r => ({
    revisionId: String(r.revisionId || ''),
    parentRevisionId: (r.parentRevisionId !== undefined && r.parentRevisionId !== null) ? String(r.parentRevisionId) : null,
    createdAt: isFiniteNumber(r.createdAt) ? Number(r.createdAt) : Date.now(),
    kind: r.kind,
    label: ((r.kind === 'head') ? 'Current' : (r.parentRevisionId === null ? 'Original' : 'Rev')) + ' · ' + (_iso(r.createdAt) || String(r.createdAt || '')),
  }));

  return { activeRevisionId: String(clip.revisionId || ''), items: out };
}

// Activate a previous revision by swapping it with the current head.
// This keeps both versions (so A/B switching is stable).
function setClipActiveRevision(project, clipId, revisionId){
  const p = project;
  if (!p || !isProjectV2(p)) return { ok:false, error:'not_v2' };
  const cid = String(clipId || '');
  const rid = String(revisionId || '');
  if (!cid || !rid) return { ok:false, error:'bad_args' };
  if (!p.clips || !p.clips[cid]) return { ok:false, error:'clip_not_found' };

  const clip = p.clips[cid];
  ensureClipRevisionChain(clip);
  if (String(clip.revisionId || '') === rid) return { ok:true, changed:false };

  const idx = (clip.revisions || []).findIndex(r => String(r.revisionId || '') === rid);
  if (idx < 0) return { ok:false, error:'revision_not_found' };

  const cur = snapshotClipHead(clip);
  const target = clip.revisions[idx];
  clip.revisions.splice(idx, 1);
  if (cur) clip.revisions.push(cur);

  applySnapshotToClipHead(clip, target);
  ensureClipRevisionChain(clip);

  return { ok:true, changed:true };
}

// Start a new revision: snapshot current head into history, then update revisionId.
// Callers may then mutate clip.score and clip.meta, and finally recompute meta.
function beginNewClipRevision(project, clipId, opts){
  const p = project;
  if (!p || !isProjectV2(p)) return { ok:false, error:'not_v2' };
  const cid = String(clipId || '');
  if (!cid) return { ok:false, error:'bad_args' };
  if (!p.clips || !p.clips[cid]) return { ok:false, error:'clip_not_found' };

  const clip = p.clips[cid];
  ensureClipRevisionChain(clip);

  const snap = snapshotClipHead(clip);
  if (snap) clip.revisions.push(snap);

  clip.parentRevisionId = String(clip.revisionId || (snap && snap.revisionId) || uid('rev_'));
  clip.revisionId = uid('rev_');
  clip.updatedAt = Date.now();

  // Reset A/B pair (ephemeral UI helper). Safe if persisted.
  clip._abARevisionId = null;
  clip._abBRevisionId = null;

  if (opts && typeof opts.name === 'string') clip.name = opts.name;

  ensureClipRevisionChain(clip);
  return { ok:true, revisionId: clip.revisionId };
}


  function createClipFromScoreBeat(scoreBeat, opts){
    const s = ensureScoreBeatIds(deepClone(scoreBeat));
    const st = recomputeScoreBeatStats(s);
    const name = (opts && opts.name) ? String(opts.name) : ('Clip ' + uid('').slice(0,5));
    const clipId = (opts && opts.id) ? String(opts.id) : uid('clip_');
    const sourceTempoBpm = (opts && isFiniteNumber(opts.sourceTempoBpm)) ? Number(opts.sourceTempoBpm) : (isFiniteNumber(s.tempo_bpm) ? Number(s.tempo_bpm) : null);
    return {
      id: clipId,
      name,
      createdAt: (opts && isFiniteNumber(opts.createdAt)) ? Number(opts.createdAt) : Date.now(),
      updatedAt: (opts && isFiniteNumber(opts.updatedAt)) ? Number(opts.updatedAt) : ((opts && isFiniteNumber(opts.createdAt)) ? Number(opts.createdAt) : Date.now()),
      revisionId: (opts && opts.revisionId) ? String(opts.revisionId) : uid('rev_'),
      parentRevisionId: (opts && opts.parentRevisionId !== undefined && opts.parentRevisionId !== null) ? String(opts.parentRevisionId) : null,
      revisions: (opts && Array.isArray(opts.revisions)) ? opts.revisions : [],
      sourceTaskId: (opts && opts.sourceTaskId) ? String(opts.sourceTaskId) : null,
      score: s,
      meta: {
        notes: st.count,
        pitchMin: st.pitchMin,
        pitchMax: st.pitchMax,
        spanBeat: st.spanBeat,
        sourceTempoBpm: isFiniteNumber(sourceTempoBpm) ? Number(sourceTempoBpm) : null,
      }
    };
  }

  function createInstanceV2(clipId, startBeat, trackId){
    return {
      id: uid('inst_'),
      clipId: String(clipId),
      trackId: String(trackId),
      startBeat: Math.max(0, normalizeBeat(Number(startBeat || 0))),
      transpose: 0
    };
  }

  function repairClipOrderV2(project){
    if (!project) return project;
    if (!project.clips || typeof project.clips !== 'object' || Array.isArray(project.clips)){
      project.clips = {};
    }
    if (!Array.isArray(project.clipOrder)) project.clipOrder = [];

    const seen = new Set();
    const out = [];
    for (const id of project.clipOrder){
      const cid = String(id);
      if (seen.has(cid)) continue;
      if (!project.clips[cid]) continue;
      seen.add(cid);
      out.push(cid);
    }

    // Append missing clips deterministically.
    const missing = [];
    for (const cid of Object.keys(project.clips)){
      if (!seen.has(cid)) missing.push(cid);
    }
    missing.sort((a,b)=>{
      const ca = project.clips[a];
      const cb = project.clips[b];
      const ta = ca && isFiniteNumber(ca.createdAt) ? ca.createdAt : 0;
      const tb = cb && isFiniteNumber(cb.createdAt) ? cb.createdAt : 0;
      if (ta !== tb) return ta - tb;
      return String(a).localeCompare(String(b));
    });
    for (const cid of missing) out.push(cid);

    project.clipOrder = out;
    return project;
  }

  function normalizeProjectV2(project){
    // T3-0b: schema versioning guard (accept legacy v2 shapes)
    upgradeProjectV2LegacyInPlace(project);

    if (!project) return project;
    project.version = 2;
    project.timebase = 'beat';
    project.bpm = coerceBpm(project.bpm);

    if (!Array.isArray(project.tracks) || project.tracks.length === 0){
      project.tracks = [ defaultTrackV2() ];
    } else {
      for (let i = 0; i < project.tracks.length; i++){
        project.tracks[i] = ensureTrackV2(project.tracks[i], i);
      }
    }

    if (!project.ui) project.ui = {};
    if (!isFiniteNumber(project.ui.pxPerBeat) || project.ui.pxPerBeat <= 0){
      // default based on legacy 160 px/sec for bpm=120
      project.ui.pxPerBeat = 80;
    }
    project.ui.playheadBeat = Math.max(0, normalizeBeat(Number(project.ui.playheadBeat || 0)));

    // clips map + clipOrder invariants
    if (!project.clips || typeof project.clips !== 'object' || Array.isArray(project.clips)) project.clips = {};
    if (!Array.isArray(project.clipOrder)) project.clipOrder = [];
    for (const cid of Object.keys(project.clips)){
      const clip = project.clips[cid];
      if (!clip) continue;
      if (!clip.id) clip.id = cid;
      if (!clip.name) clip.name = String(clip.name ?? '');
      if (!isFiniteNumber(clip.createdAt)) clip.createdAt = Date.now();
      if (!clip.meta) clip.meta = { notes:0, pitchMin:null, pitchMax:null, spanBeat:0, sourceTempoBpm:null };
      clip.score = ensureScoreBeatIds(clip.score);
      // keep meta.sourceTempoBpm if exists
      const srcTempo = clip.meta && isFiniteNumber(clip.meta.sourceTempoBpm) ? Number(clip.meta.sourceTempoBpm) : null;
      recomputeClipMetaFromScoreBeat(clip);
      if (clip.meta) clip.meta.sourceTempoBpm = srcTempo;
      ensureClipRevisionChain(clip);
      // remove v1 fields if they exist
      if (clip.meta && 'spanSec' in clip.meta) delete clip.meta.spanSec;
    }
    repairClipOrderV2(project);

    // instances
    if (!Array.isArray(project.instances)) project.instances = [];
    const defaultTrackId = project.tracks[0] ? project.tracks[0].id : SCHEMA_V2.DEFAULT_TRACK_ID;
    for (const inst of project.instances){
      if (!inst.id) inst.id = uid('inst_');
      if (!inst.clipId) inst.clipId = '';
      if (!inst.trackId || !project.tracks.some(t => t.id === inst.trackId)) inst.trackId = defaultTrackId;
      inst.startBeat = Math.max(0, normalizeBeat(Number(inst.startBeat || 0)));
      inst.transpose = coerceTranspose(inst.transpose);
      // strip v1 fields
      if ('startSec' in inst) delete inst.startSec;
      if ('trackIndex' in inst) delete inst.trackIndex;
    }

    // strip v1 ui fields
    if ('pxPerSec' in project.ui) delete project.ui.pxPerSec;
    if ('playheadSec' in project.ui) delete project.ui.playheadSec;
    delete project.ui.timelineSnapSec;

    return project;
  }

  function checkProjectV2Invariants(project){
    const errors = [];
    if (!project || !isProjectV2(project)) errors.push('not_v2');
    if (project && project.ui){
      if ('pxPerSec' in project.ui) errors.push('ui.pxPerSec_present');
      if ('playheadSec' in project.ui) errors.push('ui.playheadSec_present');
    }
    if (project && Array.isArray(project.tracks)){
      for (const t of project.tracks){
        if (!t || typeof t !== 'object'){ errors.push('track_not_object'); continue; }
        if (typeof t.id !== 'string' || !t.id) errors.push('track.id_missing');
        if (typeof t.instrument !== 'string' || !t.instrument) errors.push('track.instrument_missing:' + String(t.id));
      }
    }
    if (project){
      if (Array.isArray(project.clips)) errors.push('clips_is_array');
      if (!Array.isArray(project.clipOrder)) errors.push('clipOrder_missing');
      if (project.clips && typeof project.clips === 'object' && project.clipOrder){
        const keys = Object.keys(project.clips);
        const set = new Set(project.clipOrder);
        // clipOrder unique
        if (set.size !== project.clipOrder.length) errors.push('clipOrder_has_duplicates');
        for (const id of project.clipOrder){
          if (!project.clips[id]) errors.push('clipOrder_has_missing_clip:' + id);
        }
        for (const id of keys){
          if (!set.has(id)) errors.push('clips_key_missing_in_clipOrder:' + id);
        }
      }
      if (Array.isArray(project.instances)){
        for (const inst of project.instances){
          if ('startSec' in inst) errors.push('instance.startSec_present');
          if ('trackIndex' in inst) errors.push('instance.trackIndex_present');
        }
      }
      if (project.clips && typeof project.clips === 'object'){
        for (const cid of Object.keys(project.clips)){
          const clip = project.clips[cid];
          if (clip && clip.meta && 'spanSec' in clip.meta) errors.push('clip.meta.spanSec_present:' + cid);
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  /* -------------------- T1-2 flatten(projectV2) -> seconds events -------------------- */

  function flatten(projectV2, opts){
    const p = projectV2;
    const bpm = getProjectBpm(p);
    const out = { bpm, tracks: [] };
    if (!p || !isProjectV2(p)) return out;

    const drop = (opts && typeof opts.onDrop === 'function') ? opts.onDrop : null;

    // Prepare track buckets in project.tracks order.
    const trackBuckets = {};
    const trackOrder = Array.isArray(p.tracks) ? p.tracks.map(t => t.id) : [];
    for (const tid of trackOrder) trackBuckets[tid] = [];

    for (const inst of (p.instances || [])){
      const clip = p.clips ? p.clips[inst.clipId] : null;
      if (!clip || !clip.score || !Array.isArray(clip.score.tracks)) continue;

      const trackId = inst.trackId;
      if (!trackBuckets[trackId]) trackBuckets[trackId] = [];

      const instStartBeat = Number(inst.startBeat || 0);
      const instTranspose = coerceTranspose(inst.transpose);

      for (const trk of clip.score.tracks){
        const notes = Array.isArray(trk.notes) ? trk.notes : [];
        for (const n of notes){
          const durBeat = Number(n.durationBeat);
          if (!(durBeat > 0)){
            if (drop) drop({ reason: 'duration<=0', clipId: clip.id, instanceId: inst.id, noteId: n.id });
            continue;
          }
          const absBeat = Number(instStartBeat) + Number(n.startBeat || 0);
          const startSec = beatToSec(absBeat, bpm);
          const durationSec = beatToSec(durBeat, bpm);

          // legality / clamps (this is NOT music optimization; it's validity enforcement)
          const pitch = clamp(Math.round(Number(n.pitch) + instTranspose), 0, 127);
          const velocity = clamp(Math.round(Number(n.velocity)), 1, 127);

          // Avoid NaN
          if (!isFinite(startSec) || !isFinite(durationSec)){
            if (drop) drop({ reason: 'nan', clipId: clip.id, instanceId: inst.id, noteId: n.id });
            continue;
          }

          trackBuckets[trackId].push({
            startSec,
            durationSec,
            pitch,
            velocity,
            clipId: clip.id,
            instanceId: inst.id,
            noteId: n.id,
          });
        }
      }
    }

    function cmp(a,b){
      if (a.startSec !== b.startSec) return a.startSec - b.startSec;
      if (a.pitch !== b.pitch) return a.pitch - b.pitch;
      const na = String(a.noteId || '');
      const nb = String(b.noteId || '');
      if (na !== nb) return na.localeCompare(nb);
      return 0;
    }

    // Emit tracks in project order.
    for (const tid of trackOrder){
      const arr = trackBuckets[tid] || [];
      arr.sort(cmp);
      out.tracks.push({ trackId: tid, notes: arr });
    }

    // Emit any buckets not in project order (shouldn't happen, but be safe).
    for (const tid of Object.keys(trackBuckets)){
      if (trackOrder.indexOf(tid) >= 0) continue;
      const arr = trackBuckets[tid] || [];
      arr.sort(cmp);
      out.tracks.push({ trackId: tid, notes: arr });
    }

    return out;
  }

  /* -------------------- T1-3 migration (sec -> beat), NO quantization -------------------- */

  // Convert a v1 seconds score to v2 beats score, using project bpm as the ONLY timebase.
  // FROZEN: default behavior is float-round only (no grid snap).
  function scoreSecToBeat(scoreSec, bpm){
    const bpmUsed = coerceBpm(bpm);
    const s = ensureScoreIds(deepClone(scoreSec || { tracks: [] }));
    const out = {
      version: 2,
      tempo_bpm: isFiniteNumber(s.tempo_bpm) ? Number(s.tempo_bpm) : (isFiniteNumber(s.bpm) ? Number(s.bpm) : null),
      time_signature: (typeof s.time_signature === 'string') ? s.time_signature : null,
      tracks: []
    };

    for (const t of (s.tracks || [])){
      const trk = {
        id: t.id || uid('trk_'),
        name: (typeof t.name === 'string') ? t.name : String(t.name ?? ''),
        notes: []
      };
      // Preserve optional MIDI fields for future export, but not required by schema.
      if (t.program !== undefined) trk.program = t.program;
      if (t.channel !== undefined) trk.channel = t.channel;

      for (const n of (t.notes || [])){
        const startBeat = Math.max(0, normalizeBeat(secToBeat(n.start || 0, bpmUsed)));
        const durationBeat = Math.max(0, normalizeBeat(secToBeat(n.duration || 0.01, bpmUsed)));
        trk.notes.push({
          id: n.id || uid('n_'),
          pitch: clamp(Math.round(Number(n.pitch ?? 60)), 0, 127),
          velocity: clamp(Math.round(Number(n.velocity ?? 100)), 1, 127),
          startBeat,
          durationBeat: (durationBeat > 0) ? durationBeat : normalizeBeat(1e-6),
        });
      }
      out.tracks.push(trk);
    }

    return ensureScoreBeatIds(out);
  }

  // Convert a v2 beats score back to seconds (for tests / debug only).
  function scoreBeatToSec(scoreBeat, bpm){
    const bpmUsed = coerceBpm(bpm);
    const s = ensureScoreBeatIds(deepClone(scoreBeat || { tracks: [] }));
    const out = {
      version: 1,
      tempo_bpm: isFiniteNumber(s.tempo_bpm) ? Number(s.tempo_bpm) : null,
      time_signature: (typeof s.time_signature === 'string') ? s.time_signature : null,
      tracks: []
    };
    for (const t of (s.tracks || [])){
      const trk = {
        id: t.id || uid('trk_'),
        name: (typeof t.name === 'string') ? t.name : String(t.name ?? ''),
        notes: []
      };
      if (t.program !== undefined) trk.program = t.program;
      if (t.channel !== undefined) trk.channel = t.channel;
      for (const n of (t.notes || [])){
        trk.notes.push({
          id: n.id || uid('n_'),
          pitch: clamp(Math.round(Number(n.pitch ?? 60)), 0, 127),
          velocity: clamp(Math.round(Number(n.velocity ?? 100)), 1, 127),
          start: beatToSec(n.startBeat || 0, bpmUsed),
          duration: beatToSec(n.durationBeat || 0, bpmUsed),
        });
      }
      out.tracks.push(trk);
    }
    return ensureScoreIds(out);
  }

  // Project v1 -> v2 migration. This is a pure-ish helper: it returns a NEW object.
  // FROZEN: no implicit rhythm quantization; only float-round (normalizeBeat).
  function migrateProjectV1toV2(projectV1){
    const p1 = deepClone(projectV1 || defaultProject());
    const bpm = coerceBpm(p1.bpm);

    // tracks
    const tracks = Array.isArray(p1.tracks) && p1.tracks.length ? p1.tracks.map(t => ({
      id: t.id || uid('trk_'),
      name: (typeof t.name === 'string') ? t.name : String(t.name ?? ''),
      instrument: (typeof t.instrument === 'string' && t.instrument.trim()) ? t.instrument : SCHEMA_V2.DEFAULT_INSTRUMENT,
    })) : [{ id: uid('trk_'), name: 'Track 1', instrument: SCHEMA_V2.DEFAULT_INSTRUMENT }];
    const defaultTrackId = tracks[0].id;

    // ui
    const pxPerSec = (p1.ui && isFiniteNumber(p1.ui.pxPerSec)) ? p1.ui.pxPerSec : 160;
    const playheadSec = (p1.ui && isFiniteNumber(p1.ui.playheadSec)) ? p1.ui.playheadSec : 0;
    const ui = {
      pxPerBeat: pxPerSecToPxPerBeat(pxPerSec, bpm),
      playheadBeat: Math.max(0, normalizeBeat(secToBeat(playheadSec, bpm)))
    };

    // clips array -> clips map + clipOrder
    const clipsArr = Array.isArray(p1.clips) ? p1.clips : [];
    const clips = {};
    const clipOrder = [];
    for (const c of clipsArr){
      if (!c || !c.id) continue;
      const scoreSec = c.score || { tracks: [] };
      const scoreBeat = scoreSecToBeat(scoreSec, bpm);

      const sourceTempoBpm = (scoreSec && isFiniteNumber(scoreSec.tempo_bpm)) ? Number(scoreSec.tempo_bpm)
        : (scoreSec && isFiniteNumber(scoreSec.bpm) ? Number(scoreSec.bpm) : null);

      const clip2 = {
        id: String(c.id),
        name: (typeof c.name === 'string') ? c.name : String(c.name ?? ''),
        createdAt: isFiniteNumber(c.createdAt) ? Number(c.createdAt) : Date.now(),
        sourceTaskId: (c.sourceTaskId !== undefined && c.sourceTaskId !== null) ? String(c.sourceTaskId) : null,
        score: scoreBeat,
        meta: {
          notes: 0,
          pitchMin: null,
          pitchMax: null,
          spanBeat: 0,
          sourceTempoBpm: sourceTempoBpm,
        }
      };
      recomputeClipMetaFromScoreBeat(clip2);
      // restore non-derived meta field
      clip2.meta.sourceTempoBpm = sourceTempoBpm;
      // Preserve meta.agent (e.g. patchSummary) when re-building v2 from v1 view (persist path).
      if (c.meta && c.meta.agent) clip2.meta.agent = c.meta.agent;

      clips[clip2.id] = clip2;
      clipOrder.push(clip2.id);
    }

    // instances
    const instArr = Array.isArray(p1.instances) ? p1.instances : [];
    const instances = [];
    for (const inst of instArr){
      if (!inst || !inst.id) continue;
      const ti = Math.max(0, Number(inst.trackIndex || 0));
      const trackId = (tracks[ti] && tracks[ti].id) ? tracks[ti].id : defaultTrackId;
      const startBeat = Math.max(0, normalizeBeat(secToBeat(inst.startSec || 0, bpm)));
      instances.push({
        id: String(inst.id),
        clipId: String(inst.clipId || ''),
        trackId,
        startBeat,
        transpose: coerceTranspose(inst.transpose)
      });
    }

    const p2 = {
      version: 2,
      timebase: 'beat',
      bpm,
      tracks,
      clips,
      clipOrder,
      instances,
      ui,
    };

    normalizeProjectV2(p2);
    repairClipOrderV2(p2);
    return p2;
  }

  
  /* -------------------- T3-0b load() + migration guard -------------------- */

  // Load any project-like JSON (object or JSON string) and return a normalized ProjectDoc v2.
  // FROZEN: storage remains beats-only; seconds are derived.
  function loadProjectDoc(raw){
    let obj = raw;
    if (typeof raw === 'string'){
      try { obj = JSON.parse(raw); } catch(e){ obj = null; }
    }
    if (!obj || typeof obj !== 'object'){
      const p = defaultProjectV2();
      normalizeProjectV2(p);
      return { project: p, changed: true, from: 'invalid' };
    }

    // v1 -> v2
    if (!isProjectV2(obj) && (obj.version === 1 || Array.isArray(obj.clips) || (obj.ui && 'pxPerSec' in obj.ui))){
      const p2 = migrateProjectV1toV2(obj);
      // ensure latest schema fields (e.g., track.instrument)
      normalizeProjectV2(p2);
      return { project: p2, changed: true, from: 'v1' };
    }

    // v2 (or near-v2)
    if (isProjectV2(obj) || obj.version === 2){
      const p = deepClone(obj);
      upgradeProjectV2LegacyInPlace(p);
      normalizeProjectV2(p);
      return { project: p, changed: true, from: 'v2' };
    }

    // Unknown shape -> default
    const p = defaultProjectV2();
    normalizeProjectV2(p);
    return { project: p, changed: true, from: 'unknown' };
  }


/* -------------------- T3-0b load / schema versioning -------------------- */

  // Load any project-like JSON and return a normalized ProjectDoc v2.
  // raw can be an object or a JSON string.
  function loadProjectDoc(raw, opts){
    const options = opts || {};
    const info = { from: null, to: 2, changed: false, warnings: [] };

    let obj = raw;
    if (typeof obj === 'string'){
      try { obj = JSON.parse(obj); }
      catch (e){ obj = null; info.warnings.push('json_parse_failed'); }
    }

    if (!obj || typeof obj !== 'object'){
      info.from = null;
      info.changed = true;
      const p2 = defaultProjectV2();
      normalizeProjectV2(p2);
      return { project: p2, info };
    }

    // v2 (or near-v2)
    if (isProjectV2(obj) || obj.version === 2 || obj.timebase === 'beat'){
      info.from = 2;
      const p2 = deepClone(obj);
      const sig0 = JSON.stringify({
        v: p2.version, tb: p2.timebase,
        tracks: Array.isArray(p2.tracks) ? p2.tracks.length : null,
        clipsArray: Array.isArray(p2.clips),
        clipsKeys: (p2.clips && typeof p2.clips === 'object' && !Array.isArray(p2.clips)) ? Object.keys(p2.clips).length : null,
        clipOrder: Array.isArray(p2.clipOrder) ? p2.clipOrder.length : null,
      });

      upgradeProjectV2LegacyInPlace(p2);
      normalizeProjectV2(p2);

      const sig1 = JSON.stringify({
        v: p2.version, tb: p2.timebase,
        tracks: Array.isArray(p2.tracks) ? p2.tracks.length : null,
        clipsArray: Array.isArray(p2.clips),
        clipsKeys: (p2.clips && typeof p2.clips === 'object' && !Array.isArray(p2.clips)) ? Object.keys(p2.clips).length : null,
        clipOrder: Array.isArray(p2.clipOrder) ? p2.clipOrder.length : null,
      });
      info.changed = (sig0 !== sig1);

      const inv = checkProjectV2Invariants(p2);
      if (!inv.ok){
        // Last resort: keep as much user data as possible.
        repairClipOrderV2(p2);
      }
      return { project: p2, info };
    }

    // v1 or unknown -> attempt v1->v2 migration
    info.from = (typeof obj.version === 'number') ? obj.version : 1;
    info.changed = true;
    const p2 = migrateProjectV1toV2(obj);
    // v1->v2 already normalizes; keep one more normalization pass to apply any new fields.
    normalizeProjectV2(p2);
    return { project: p2, info };
  }

  function loadProjectDocV2(raw, opts){
    return loadProjectDoc(raw, opts).project;
  }

function rollbackClipRevision(projectV2, clipId){
  const p = projectV2;
  if (!p || !isProjectV2(p)) return { ok:false, reason:'not_v2' };
  const cid = String(clipId || '');
  if (!cid) return { ok:false, reason:'bad_args' };
  if (!p.clips || !p.clips[cid]) return { ok:false, reason:'clip_not_found' };
  const clip = p.clips[cid];
  ensureClipRevisionChain(clip);
  const parent = clip.parentRevisionId ? String(clip.parentRevisionId) : '';
  if (!parent) return { ok:false, reason:'no_parent' };
  return setClipActiveRevision(p, cid, parent);
}

function toggleClipAB(projectV2, clipId){
  const p = projectV2;
  if (!p || !isProjectV2(p)) return { ok:false, reason:'not_v2' };
  const cid = String(clipId || '');
  if (!cid) return { ok:false, reason:'bad_args' };
  if (!p.clips || !p.clips[cid]) return { ok:false, reason:'clip_not_found' };

  const clip = p.clips[cid];
  ensureClipRevisionChain(clip);

  const cur = String(clip.revisionId || '');
  const pickDefaultAlt = () => {
    if (clip.parentRevisionId) return String(clip.parentRevisionId);
    if (Array.isArray(clip.revisions) && clip.revisions.length){
      return String(clip.revisions[0].revisionId || '');
    }
    return '';
  };

  let a = clip._abARevisionId ? String(clip._abARevisionId) : '';
  let b = clip._abBRevisionId ? String(clip._abBRevisionId) : '';

  // Initialize (or repair) the A/B pair when needed.
  if (!a || !b || (cur !== a && cur !== b)){
    a = cur;
    b = pickDefaultAlt();
    if (!b || b === a) return { ok:false, reason:'no_alt_revision' };
    clip._abARevisionId = a;
    clip._abBRevisionId = b;
  }

  const target = (cur === a) ? b : a;
  const res = setClipActiveRevision(p, cid, target);
  if (!res || !res.ok) return res || { ok:false, reason:'swap_failed' };
  return { ok:true, activeRevisionId: String(target), pair:[a,b] };
}


  /* -------------------- Agent Patch (T3-2) -------------------- */

  function _getAgentPatchApi(){
    if (typeof window !== 'undefined' && window.H2SAgentPatch) return window.H2SAgentPatch;
    if (typeof globalThis !== 'undefined' && globalThis.H2SAgentPatch) return globalThis.H2SAgentPatch;
    return null;
  }

  function validateAgentPatch(patch, clip){
    const AP = _getAgentPatchApi();
    if (!AP || typeof AP.validatePatch !== 'function'){
      return { ok:false, errors:['agent_patch_missing'], warnings:[] };
    }
    return AP.validatePatch(patch, clip);
  }

  function applyAgentPatchToClip(clip, patch){
    const AP = _getAgentPatchApi();
    if (!AP || typeof AP.applyPatchToClip !== 'function'){
      return { ok:false, errors:['agent_patch_missing'], warnings:[] };
    }
    return AP.applyPatchToClip(clip, patch);
  }

  // Convenience: create a NEW clip revision, apply patch on the head (active) clip,
  // and keep audit info on the head revision. Rolls back if patch fails.
  function applyAgentPatchAsNewRevision(projectV2, clipId, patch, opts){
    if (!projectV2 || !projectV2.clips) return { ok:false, errors:['project_missing'] };
    const clip = projectV2.clips[clipId];
    if (!clip) return { ok:false, errors:['clip_not_found:' + String(clipId)] };

    const label = (opts && opts.label) ? String(opts.label) : 'Patched';
    ensureClipRevisionChain(clip);

    // Start a new revision (parent snapshot preserved in clip.revisions).
    beginNewClipRevision(clip, { label });

    const res = applyAgentPatchToClip(clip, patch);
    if (!res.ok){
      // revert to parent
      rollbackClipRevision(projectV2, clipId);
      return res;
    }

    // Adopt patched score/meta into head clip.
    clip.score = res.clip.score;
    clip.meta = res.clip.meta;
    clip.revisionLabel = label;
    clip.lastAppliedPatch = {
      at: Date.now(),
      patchId: patch && patch.id ? String(patch.id) : null,
      ops: Array.isArray(patch && patch.ops) ? patch.ops.length : 0
    };

    return { ok:true, clip, appliedPatch: res.appliedPatch, inversePatch: res.inversePatch };
  }

/* -------------------- Export -------------------- */

  window.H2SProject = {
    // existing v1 API
    uid,
    deepClone,
    clamp,
    midiToName,
    ensureScoreIds,
    scoreStats,
    defaultProject,
    createClipFromScore,
    createInstance,

    // constants
    TIMEBASE,
    SCHEMA_V2,

    // timebase API (T1-0)
    coerceBpm,
    coerceTranspose,
    roundBeat,
    roundSec,
    normalizeBeat,
    beatToSec,
    secToBeat,
    pxPerSecToPxPerBeat,
    pxPerBeatToPxPerSec,
    snapToGridBeat,
    snapIfCloseBeat,
    isProjectV2,
    getProjectBpm,
    getPlayheadSec,
    getInstanceStartSec,
    getTimelineSnapBeat,
    setTimelineSnapBeat,
    setPlayheadFromSec_Free,
    setPlayheadFromSec_Snapped,
    setInstanceStartFromSec_Free,
    setInstanceStartFromSec_Snapped,

    // v2 schema helpers (T1-1)
    defaultProjectV2,
    ensureScoreBeatIds,
    recomputeScoreBeatStats,
    recomputeClipMetaFromScoreBeat,
    createClipFromScoreBeat,
    createInstanceV2,
    repairClipOrderV2,
    normalizeProjectV2,
    checkProjectV2Invariants,



    // clip revisions (T3-1)
    ensureClipRevisionChain,
    snapshotClipHead,
    rollbackClipRevision,
    toggleClipAB,
    listClipRevisions,
    setClipActiveRevision,
    beginNewClipRevision,
    validateAgentPatch,
    applyAgentPatchToClip,
    applyAgentPatchAsNewRevision,
    // flatten (T1-2)
    flatten,

    // migration (T1-3)
    scoreSecToBeat,
    scoreBeatToSec,
    migrateProjectV1toV2,

    // load / schema versioning (T3-0b)
    loadProjectDoc,
    loadProjectDocV2,
  };
})();
