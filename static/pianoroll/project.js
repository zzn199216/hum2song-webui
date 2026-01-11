/* Hum2Song Studio MVP - project.js (v9)
   Plain script (no import/export). Exposes window.H2SProject.

   v9 changes:
   - Accept backend score schema: { tempo_bpm } and map to { bpm } for frontend use.
   - Add migrateProject() to harden localStorage/project JSON compatibility.
   - Add fromBackendScore()/toBackendScore() helpers for future backend integration.
*/
(function(){
  'use strict';

  function uid(prefix){
    const s = Math.random().toString(16).slice(2) + Date.now().toString(16);
    return (prefix || 'id_') + s.slice(0, 12);
  }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function midiToName(m){
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const n = ((m % 12) + 12) % 12;
    const o = Math.floor(m / 12) - 1;
    return names[n] + String(o);
  }

  // Convert score from backend schema to frontend schema (best-effort).
  // Backend: version, tempo_bpm, time_signature, tracks[].notes[] ...
  // Frontend: bpm, tracks[].notes[] ...
  function fromBackendScore(raw){
    const s = deepClone(raw || {});
    if (typeof s.bpm !== 'number' && typeof s.tempo_bpm === 'number'){
      s.bpm = Number(s.tempo_bpm);
    }
    return ensureScoreIds(s);
  }

  // Convert score from frontend schema to backend schema (best-effort).
  function toBackendScore(score){
    const s = deepClone(score || {});
    // Prefer tempo_bpm for backend.
    if (typeof s.tempo_bpm !== 'number' && typeof s.bpm === 'number'){
      s.tempo_bpm = Number(s.bpm);
    }
    // Some backend normalizers might ignore unknown fields, but we keep it tidy.
    delete s.bpm;
    return s;
  }

  function ensureScoreIds(score){
    if (!score) return score;

    // Accept both bpm and tempo_bpm.
    const bpm = (typeof score.bpm === 'number') ? score.bpm
      : (typeof score.tempo_bpm === 'number') ? score.tempo_bpm
      : Number(score.bpm ?? score.tempo_bpm ?? 120);

    score.bpm = Number(bpm);
    score.bpm = clamp(score.bpm, 30, 260);

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
        n.duration = Math.max(0.01, n.duration);
      }
    }

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
      bpm: 120,
      tracks: [{ id: uid('trk_'), name: 'Track 1' }],
      clips: [],
      instances: [],
      ui: { pxPerSec: 160, playheadSec: 0 }
    };
  }

  function createClipFromScore(score, opts){
    // Accept backend schema here as well (most clips come from /tasks/{id}/score).
    const s0 = fromBackendScore(score);
    const s = ensureScoreIds(deepClone(s0));
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

  function migrateProject(p){
    // Best-effort schema hardening for localStorage / imported JSON
    const out = deepClone(p || {});
    if (typeof out.version !== 'number') out.version = 1;
    if (typeof out.bpm !== 'number') out.bpm = Number(out.bpm ?? 120);
    out.bpm = clamp(out.bpm, 30, 260);

    if (!Array.isArray(out.tracks) || out.tracks.length === 0){
      out.tracks = [{ id: uid('trk_'), name: 'Track 1' }];
    } else {
      for (const t of out.tracks){
        if (!t.id) t.id = uid('trk_');
        if (typeof t.name !== 'string') t.name = String(t.name ?? '');
      }
    }

    if (!Array.isArray(out.clips)) out.clips = [];
    for (const c of out.clips){
      if (!c.id) c.id = uid('clip_');
      if (typeof c.name !== 'string') c.name = String(c.name ?? 'Untitled');
      c.score = ensureScoreIds(fromBackendScore(c.score || { bpm: out.bpm, tracks: [] }));
      // meta is optional; we recompute if missing
      if (!c.meta) {
        const st = scoreStats(c.score);
        c.meta = { notes: st.count, pitchMin: st.minPitch, pitchMax: st.maxPitch, spanSec: st.spanSec };
      }
      if (c.createdAt == null) c.createdAt = Date.now();
      if (c.sourceTaskId != null) c.sourceTaskId = String(c.sourceTaskId);
    }

    if (!Array.isArray(out.instances)) out.instances = [];
    for (const inst of out.instances){
      if (!inst.id) inst.id = uid('inst_');
      if (inst.clipId != null) inst.clipId = String(inst.clipId);
      inst.startSec = Math.max(0, Number(inst.startSec || 0));
      inst.trackIndex = Math.max(0, Number(inst.trackIndex || 0));
      inst.transpose = Number(inst.transpose || 0);
    }

    if (!out.ui) out.ui = {};
    if (typeof out.ui.pxPerSec !== 'number') out.ui.pxPerSec = 160;
    if (typeof out.ui.playheadSec !== 'number') out.ui.playheadSec = 0;

    return out;
  }

  // Export
  window.H2SProject = {
    uid,
    deepClone,
    clamp,
    midiToName,

    fromBackendScore,
    toBackendScore,

    ensureScoreIds,
    scoreStats,

    defaultProject,
    migrateProject,

    createClipFromScore,
    createInstance,
  };
})();
