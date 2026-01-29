/* Hum2Song Studio - Audio Controller (UMD)
   - Centralizes Tone.Transport scheduling for:
       1) Project playback (flatten instances into a single schedule)
       2) Clip preview playback
   - IMPORTANT: Controller never rebuilds/updates timeline DOM.

   Node-friendly: can be required in tests (no Tone needed) because
   Tone is only referenced inside runtime methods.
*/

(function(root, factory){
  if (typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    // Browser global export
    root.H2SAudioController = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  const G = (typeof window !== 'undefined') ? window : globalThis;

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function clamp(v, lo, hi){
    v = Number(v);
    if (!isFinite(v)) v = lo;
    return Math.max(lo, Math.min(hi, v));
  }

  function deepClone(x){
    try{ return JSON.parse(JSON.stringify(x)); }
    catch(e){ return x; }
  }

  /**
   * Pure helper: flatten a project to absolute events (relative to startAtSec).
   * Returns { events, maxT }.
   *
   * Each event is: { t, dur, pitch, vel }
   */
  function flattenProjectToEvents(project, startAtSec){
    const startAt = Number(startAtSec || 0);
    const events = [];
    let maxT = 0;

    if (!project) return { events, maxT };

    const clips = Array.isArray(project.clips) ? project.clips : [];
    const instances = Array.isArray(project.instances) ? project.instances : [];

    const clipById = new Map();
    for (const c of clips){
      if (c && c.id) clipById.set(c.id, c);
    }

    for (const inst of instances){
      if (!inst || !inst.clipId) continue;
      const clip = clipById.get(inst.clipId);
      if (!clip || !clip.score) continue;

      // Keep behavior consistent with legacy app.js
      let score = deepClone(clip.score);
      if (G.H2SProject && G.H2SProject.ensureScoreIds){
        try{ score = G.H2SProject.ensureScoreIds(score); }catch(e){}
      }

      const trks = Array.isArray(score.tracks) ? score.tracks : [];
      const instStart = Number(inst.startSec || 0);
      const instTrans = Number(inst.transpose || 0);

      for (const tr of trks){
        const notes = Array.isArray(tr.notes) ? tr.notes : [];
        for (const n of notes){
          if (!n) continue;
          const nStart = Number(n.start || 0);
          const nDur = Math.max(0, Number(n.duration || 0));
          const tAbs = instStart + nStart;
          if (tAbs + nDur < startAt) continue;

          const tRel = tAbs - startAt;
          const pitch = clamp(Math.round((n.pitch || 60) + instTrans), 0, 127);
          const vel = clamp(Math.round(n.velocity || 100), 1, 127) / 127;

          events.push({ t: tRel, dur: nDur, pitch, vel });
          maxT = Math.max(maxT, tRel + nDur);
        }
      }
    }

    return { events, maxT };
  }

  /**
   * Controller factory
   *
   * opts:
   *  - getProject(): project
   *  - setTransportPlaying(boolean)
   *  - onUpdatePlayhead(sec)
   *  - onLog(msg)
   *  - onAlert(msg)
   *  - onStopped()  (optional)
   */
  function create(opts){
    opts = opts || {};
    const getProject = opts.getProject || (() => null);
    const getProjectV2 = opts.getProjectV2 || null;
    const getProjectDoc = opts.getProjectDoc || null;
    const setTransportPlaying = opts.setTransportPlaying || (() => {});
    const onUpdatePlayhead = opts.onUpdatePlayhead || (() => {});
    const onLog = opts.onLog || (() => {});
    const onAlert = opts.onAlert || (() => {});
    const onStopped = opts.onStopped || (() => {});

    let playing = false;
    let startAt = 0;
    let rafId = 0;
    let stopTimer = 0;
    let _trackSynths = [];


    async function ensureTone(){
      for (let i = 0; i < 40; i++){
        if (G.Tone) return true;
        await sleep(50);
      }
      return !!G.Tone;
    }

function _disposeTrackSynths(){
  for (const s of _trackSynths){
    try{ s.dispose(); }catch(e){}
  }
  _trackSynths = [];
}

function _makeSynthByInstrument(name){
  // Keep it simple: "clearly different" timbres, not high quality.
  switch(String(name||'default')){
    case 'bass': return new G.Tone.MonoSynth();
    case 'lead': return new G.Tone.Synth();
    case 'pad': return new G.Tone.FMSynth();
    case 'pluck': return new G.Tone.PluckSynth();
    case 'drum': return new G.Tone.MembraneSynth();
    default: return new G.Tone.PolySynth(G.Tone.Synth);
  }
}


    function _cancelTimers(){
      if (rafId){
        try{ cancelAnimationFrame(rafId); }catch(e){}
        rafId = 0;
      }
      if (stopTimer){
        try{ clearTimeout(stopTimer); }catch(e){}
        stopTimer = 0;
      }
    }

    function stop(){
      _disposeTrackSynths();
      _cancelTimers();
      if (G.Tone){
        try{ G.Tone.Transport.stop(); G.Tone.Transport.cancel(); }catch(e){}
      }
      playing = false;
      setTransportPlaying(false);
      onLog('Project stop.');
      try{ onStopped(); }catch(e){}
    }

    function _startRaf(){
      const tick = () => {
        if (!playing) return;
        let sec = startAt;
        try{ sec = startAt + (G.Tone.Transport.seconds || 0); }catch(e){}
        try{ onUpdatePlayhead(sec); }catch(e){}
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    async function playProject(){
      if (playing){
        stop();
        return true;
      }

      const ok = await ensureTone();
      if (!ok){
        onAlert('Tone.js not available.');
        return false;
      }

      await G.Tone.start();

      const project = getProject();
const bpm = (project && project.bpm) ? project.bpm : 120;
startAt = (project && project.ui && isFinite(project.ui.playheadSec)) ? project.ui.playheadSec : 0;

// Prefer beats-only v2 playback when available (trackId-aware).
const projectV2 = (typeof getProjectV2 === 'function' && getProjectV2()) ? getProjectV2()
  : ((typeof getProjectDoc === 'function' && getProjectDoc()) ? getProjectDoc() : null);

_disposeTrackSynths();

G.Tone.Transport.stop();
G.Tone.Transport.cancel();
G.Tone.Transport.seconds = 0;
G.Tone.Transport.bpm.value = bpm;

let maxT = 0;

if (projectV2 && G.H2SProject && typeof G.H2SProject.flatten === 'function'){
  const flat2 = G.H2SProject.flatten(projectV2);

  // Build synths per trackId using v2 instruments
  const instByTrackId = new Map();
  try{
    for (const t of (projectV2.tracks || [])){
      if (t && t.trackId) instByTrackId.set(t.trackId, t.instrument || 'default');
    }
  }catch(e){}

  const synthByTrackId = new Map();
  const getSynth = (trackId) => {
    if (synthByTrackId.has(trackId)) return synthByTrackId.get(trackId);
    const inst = instByTrackId.get(trackId) || 'default';
    const s = _makeSynthByInstrument(inst).toDestination();
    _trackSynths.push(s);
    synthByTrackId.set(trackId, s);
    return s;
  };

  for (const tr of (flat2.tracks || [])){
    const tid = tr && tr.trackId;
    if (!tid) continue;
    const s = getSynth(tid);
    for (const n of (tr.notes || [])){
      const absStart = Number(n.startSec || 0);
      if (absStart < startAt) continue;
      const t = absStart - startAt;
      const dur = Math.max(0.01, Number(n.durationSec || 0.1));
      const vel = (n.velocity == null) ? 0.8 : Number(n.velocity);
      if (t + dur > maxT) maxT = t + dur;
      G.Tone.Transport.schedule((time) => {
        try{
          s.triggerAttackRelease(G.Tone.Frequency(n.pitch, 'midi'), dur, time, vel);
        }catch(e){}
      }, t);
    }
  }
} else {
  // Legacy fallback: v1 seconds-only schedule, single synth.
  const synth = new G.Tone.PolySynth(G.Tone.Synth).toDestination();
  _trackSynths.push(synth);

  const flat = flattenProjectToEvents(project, startAt);
  const events = flat.events;
  maxT = flat.maxT;

  for (const ev of events){
    G.Tone.Transport.schedule((time) => {
      synth.triggerAttackRelease(G.Tone.Frequency(ev.pitch, 'midi'), ev.dur, time, ev.vel);
    }, ev.t);
  }
}
      G.Tone.Transport.start('+0.05');
      playing = true;
      setTransportPlaying(true);
      onLog('Project play.');
      _startRaf();

      stopTimer = setTimeout(() => {
        if (playing) stop();
      }, Math.ceil((maxT + 0.2) * 1000));

      return true;
    }

    async function playClip(clipId){
      const project = getProject();
      const clips = project && Array.isArray(project.clips) ? project.clips : [];
      const clip = clips.find(c => c && c.id === clipId);
      if (!clip) return false;

      const ok = await ensureTone();
      if (!ok){ onAlert('Tone.js not available.'); return false; }
      await G.Tone.start();

      const synth = new G.Tone.PolySynth(G.Tone.Synth).toDestination();

      G.Tone.Transport.stop();
      G.Tone.Transport.cancel();
      G.Tone.Transport.seconds = 0;
      G.Tone.Transport.bpm.value = (project && project.bpm) ? project.bpm : 120;

      let score = deepClone(clip.score);
      if (G.H2SProject && G.H2SProject.ensureScoreIds){
        try{ score = G.H2SProject.ensureScoreIds(score); }catch(e){}
      }

      let maxT = 0;
      const trks = Array.isArray(score.tracks) ? score.tracks : [];
      for (const tr of trks){
        const notes = Array.isArray(tr.notes) ? tr.notes : [];
        for (const n of notes){
          if (!n) continue;
          const nStart = Number(n.start || 0);
          const nDur = Math.max(0, Number(n.duration || 0));
          maxT = Math.max(maxT, nStart + nDur);
          G.Tone.Transport.schedule((time) => {
            const pitch = clamp(Math.round(n.pitch || 60), 0, 127);
            const vel = clamp(Math.round(n.velocity || 100), 1, 127) / 127;
            synth.triggerAttackRelease(G.Tone.Frequency(pitch, 'midi'), nDur, time, vel);
          }, nStart);
        }
      }

      G.Tone.Transport.start('+0.05');
      onLog(`Clip play: ${clip.name}`);

      setTimeout(() => {
        try{ G.Tone.Transport.stop(); G.Tone.Transport.cancel(); }catch(e){}
      }, Math.ceil((maxT + 0.2) * 1000));

      return true;
    }

    return {
      ensureTone,
      playProject,
      stop,
      playClip,
      flattenProjectToEvents,
    };
  }

  return {
    create,
    flattenProjectToEvents,
  };
});
