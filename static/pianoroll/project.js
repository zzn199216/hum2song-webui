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
      tracks: [{ id: uid('trk_'), name: 'Track 1' }],
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
      tracks: [{ id: uid('trk_'), name: 'Track 1' }],
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
    if (!clip.meta) clip.meta = {};
    // FROZEN: these are derived fields and must be consistent with score.
    clip.meta.notes = st.count;
    clip.meta.pitchMin = st.pitchMin;
    clip.meta.pitchMax = st.pitchMax;
    clip.meta.spanBeat = st.spanBeat;
    return clip;
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
    if (!project) return project;
    project.version = 2;
    project.timebase = 'beat';
    project.bpm = coerceBpm(project.bpm);

    if (!Array.isArray(project.tracks) || project.tracks.length === 0){
      project.tracks = [{ id: uid('trk_'), name: 'Track 1' }];
    } else {
      for (const t of project.tracks){
        if (!t.id) t.id = uid('trk_');
        if (typeof t.name !== 'string') t.name = String(t.name ?? '');
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
      // remove v1 fields if they exist
      if (clip.meta && 'spanSec' in clip.meta) delete clip.meta.spanSec;
    }
    repairClipOrderV2(project);

    // instances
    if (!Array.isArray(project.instances)) project.instances = [];
    const defaultTrackId = project.tracks[0] ? project.tracks[0].id : uid('trk_');
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

    return project;
  }

  function checkProjectV2Invariants(project){
    const errors = [];
    if (!project || !isProjectV2(project)) errors.push('not_v2');
    if (project && project.ui){
      if ('pxPerSec' in project.ui) errors.push('ui.pxPerSec_present');
      if ('playheadSec' in project.ui) errors.push('ui.playheadSec_present');
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
      name: (typeof t.name === 'string') ? t.name : String(t.name ?? '')
    })) : [{ id: uid('trk_'), name: 'Track 1' }];
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

    // flatten (T1-2)
    flatten,

    // migration (T1-3)
    scoreSecToBeat,
    scoreBeatToSec,
    migrateProjectV1toV2,
  };
})();
