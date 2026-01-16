/* Hum2Song Studio - core/project_core.js
   Pure project/score utilities and constructors.
   Depends on H2S.MathCore.
*/
(function(root){
  'use strict';

  const H2S = root.H2S = root.H2S || {};
  const MathCore = H2S.MathCore;
  if (!MathCore){
    throw new Error('H2S.MathCore not loaded. Ensure core/math.js is loaded before core/project_core.js');
  }

  const ProjectCore = H2S.ProjectCore = H2S.ProjectCore || {};
  const { uid, deepClone, clamp, midiToName } = MathCore;

  function ensureScoreIds(score){
    if (!score) return score;
    if (!score.tracks) score.tracks = [];
    for (const t of score.tracks){
      if (!t.id) t.id = uid('trk_');
      if (typeof t.name !== 'string') t.name = String(t.name ?? '');
      if (!Array.isArray(t.notes)) t.notes = [];
      for (const n of t.notes){
        if (!n.id) n.id = uid('nt_');
        if (typeof n.pitch !== 'number') n.pitch = Number(n.pitch ?? 60);
        if (typeof n.start !== 'number') n.start = Number(n.start ?? 0);
        if (typeof n.duration !== 'number') n.duration = Number(n.duration ?? 0.2);
        if (typeof n.velocity !== 'number') n.velocity = Number(n.velocity ?? 100);
        n.pitch = clamp(Math.round(n.pitch), 0, 127);
        n.velocity = clamp(Math.round(n.velocity), 1, 127);
        n.start = Math.max(0, n.start);
        n.duration = Math.max(0.01, n.duration);
      }
      // Stable sort for determinism
      t.notes.sort((a,b)=> (a.start-b.start) || (a.pitch-b.pitch) || String(a.id).localeCompare(String(b.id)));
    }
    if (typeof score.bpm !== 'number') score.bpm = Number(score.bpm ?? 120);
    score.bpm = clamp(score.bpm, 30, 260);
    return score;
  }

  function scoreStats(score){
    score = ensureScoreIds(deepClone(score || {bpm:120, tracks:[]}));
    let notes = 0;
    let minPitch = 127, maxPitch = 0;
    let end = 0;
    for (const t of score.tracks){
      notes += (t.notes?.length || 0);
      for (const n of (t.notes || [])){
        minPitch = Math.min(minPitch, n.pitch);
        maxPitch = Math.max(maxPitch, n.pitch);
        end = Math.max(end, n.start + n.duration);
      }
    }
    if (!isFinite(minPitch)) minPitch = 60;
    if (!isFinite(maxPitch)) maxPitch = 72;
    return { notes, minPitch, maxPitch, durationSec: end };
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
      score: s,
      stats: st,
    };
  }

  function createInstance(clipId, startSec, trackIndex){
    return {
      id: uid('inst_'),
      clipId,
      startSec: Math.max(0, Number(startSec ?? 0)),
      trackIndex: Number(trackIndex ?? 0),
      transpose: 0,
      gain: 1.0,
    };
  }

  ProjectCore.ensureScoreIds = ensureScoreIds;
  ProjectCore.scoreStats = scoreStats;
  ProjectCore.defaultProject = defaultProject;
  ProjectCore.createClipFromScore = createClipFromScore;
  ProjectCore.createInstance = createInstance;

  // Re-export some math helpers to keep call sites simple
  ProjectCore.uid = uid;
  ProjectCore.deepClone = deepClone;
  ProjectCore.clamp = clamp;
  ProjectCore.midiToName = midiToName;

  if (typeof module !== 'undefined' && module.exports){
    module.exports = ProjectCore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
