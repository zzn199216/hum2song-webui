/* Hum2Song Studio MVP - project.js (v8)
   Plain script (no import/export). Exposes window.H2SProject.
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
        n.duration = Math.max(0.01, n.duration);
      }
    }
    if (typeof score.bpm !== 'number') score.bpm = Number(score.bpm ?? 120);
    score.bpm = clamp(score.bpm, 30, 260);
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

  // Export
  window.H2SProject = {
    uid,
    deepClone,
    clamp,
    midiToName,
    ensureScoreIds,
    scoreStats,
    defaultProject,
    createClipFromScore,
    createInstance,
  };
})();
