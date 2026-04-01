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
	          // Accept either MIDI velocity (1..127) or normalized velocity (0..1).
	          // If velocity looks like MIDI, convert; otherwise treat as normalized.
	          const rawV = (n.velocity == null ? 0.8 : Number(n.velocity));
	          const vel = (rawV > 1.01)
	            ? (clamp(Math.round(rawV), 1, 127) / 127)
	            : clamp(rawV, 0.0, 1.0);

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
    /** Dev-only (localStorage hum2song_studio_dev_perf_timing === '1'): RAF tick timing for project playback */
    let _projPlayRafSum = 0;
    let _projPlayRafCount = 0;
    let _projPlayRafMax = 0;

    function _perfPlaybackTimingEnabled(){
      try{
        return typeof localStorage !== 'undefined' && String(localStorage.getItem('hum2song_studio_dev_perf_timing') || '') === '1';
      }catch(e){ return false; }
    }

    function _logProjectPlaybackPerfIfNeeded(){
      if (!_perfPlaybackTimingEnabled()) return;
      if (!_projPlayRafCount) return;
      const n = _projPlayRafCount;
      const sum = _projPlayRafSum;
      const max = _projPlayRafMax;
      try{
        if (typeof G.performance !== 'undefined' && G.performance && typeof G.performance.now === 'function'){
          console.log('[H2S perf] project playback RAF session', {
            rafTicks: n,
            tickAvgMs: Number((sum / n).toFixed(4)),
            tickMaxMs: Number(max.toFixed(4)),
            tickTotalMs: Number(sum.toFixed(3)),
          });
        }
      }catch(e){}
      _projPlayRafSum = 0;
      _projPlayRafCount = 0;
      _projPlayRafMax = 0;
    }
    let _trackSynths = [];
    const synthByTrackId = new Map();
    const lastInstrumentKeyByTid = new Map();


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
  synthByTrackId.clear();
  lastInstrumentKeyByTid.clear();
}

  function _makeSynthByInstrument(instr){
    const desc = (G.H2SProject && typeof G.H2SProject.normalizeInstrument === 'function')
      ? G.H2SProject.normalizeInstrument(instr)
      : { kind: 'tone_synth', presetId: (typeof instr === 'string' && instr) ? instr : 'default', params: {} };
    const presetId = (desc.kind === 'tone_synth' && desc.presetId) ? desc.presetId : 'default';
    switch (String(presetId)){
      case 'bass': return new G.Tone.MonoSynth();
      case 'lead': return new G.Tone.Synth();
      case 'pad': return new G.Tone.FMSynth();
      case 'pluck': return new G.Tone.PluckSynth();
      case 'drum': return new G.Tone.MembraneSynth();
      default: return new G.Tone.PolySynth(G.Tone.Synth);
    }
  }

  const SAMPLER_LOAD_TIMEOUT_MS = 4000;

  /** PR-INS2a/INS2e/INS2e.2: Async instrument creation. Handles tone_synth, sampler (built-in + custom), oneshot. */
  async function _makeSynthByInstrumentAsync(instr){
    const desc = (G.H2SProject && typeof G.H2SProject.normalizeInstrument === 'function')
      ? G.H2SProject.normalizeInstrument(instr)
      : { kind: 'tone_synth', presetId: (typeof instr === 'string' && instr) ? instr : 'default', params: {} };

    if (desc.kind === 'oneshot' && desc.packId){
      const resolveOneshot = (G.H2SProject && G.H2SProject.resolveCustomOneshotUrl) ? G.H2SProject.resolveCustomOneshotUrl : null;
      if (!resolveOneshot) return _makeSynthByInstrument('default');
      const res = await resolveOneshot(desc.packId).catch(function(){ return null; });
      if (!res || !res.url){ onLog('Custom oneshot missing sample.'); return _makeSynthByInstrument('default'); }
      return new Promise(function(resolve){
        var player = new G.Tone.Player({
          url: res.url,
          onload: function(){ resolve(player); }
        });
        player.toDestination();
        setTimeout(function(){ resolve(player); }, 2500);
      }).then(function(p){
        if (!p) return _makeSynthByInstrument('default');
        return {
          triggerAttackRelease: function(freq, dur, time, vel){
            try{ p.start(time, 0, dur || 0.1); }catch(e){}
          },
          toDestination: function(){ return p; },
          dispose: function(){ try{ if (p.dispose) p.dispose(); }catch(e){} }
        };
      });
    }

    if (desc.kind !== 'sampler' || !desc.packId){
      return _makeSynthByInstrument(instr);
    }

    const packId = desc.packId;
    const isCustom = packId.indexOf('user:') === 0;

    if (isCustom){
      const resolveCustom = (G.H2SProject && G.H2SProject.resolveCustomSamplerUrls) ? G.H2SProject.resolveCustomSamplerUrls : null;
      if (!resolveCustom){
        onLog('Custom sampler not supported.');
        return _makeSynthByInstrument('default');
      }
      let resolved;
      try{ resolved = await resolveCustom(packId); }catch(e){ resolved = { urls: {}, objectUrls: [], fallbackReason: null }; }
      const urls = resolved.urls;
      const keyCount = urls ? Object.keys(urls).length : 0;
      if (!urls || keyCount < 2){
        onLog(resolved.fallbackReason || 'Custom sampler needs >=2 samples.');
        return _makeSynthByInstrument('default');
      }
      if (typeof window !== 'undefined' && window.H2S_DEBUG_INSTRUMENT){
        var urlKeys = Object.keys(urls);
        var firstUrl = urlKeys[0] ? urls[urlKeys[0]] : '';
        console.log('[Audio] customSampler urlsCount:' + urlKeys.length + ' firstUrlPrefix:' + (firstUrl ? String(firstUrl).substring(0, 40) : ''));
      }
      return new Promise(function(resolve){
        var settled = false;
        function settle(s){ if (settled) return; settled = true; resolve(s); }
        var t = setTimeout(function(){
          settle(_makeSynthByInstrument('default'));
          try{ if (sam && sam.dispose) sam.dispose(); }catch(e){}
        }, SAMPLER_LOAD_TIMEOUT_MS);
        var sam;
        try{
          sam = new G.Tone.Sampler({ urls: urls, baseUrl: '', onload: function(){ clearTimeout(t); settle(sam); } });
        }catch(e){ clearTimeout(t); settle(_makeSynthByInstrument('default')); return; }
      });
    }

    const packs = (G.H2SProject && G.H2SProject.SAMPLER_PACKS) ? G.H2SProject.SAMPLER_PACKS : {};
    const pack = packs[packId];
    const resolveUrls = (G.H2SProject && G.H2SProject.resolveSamplerUrlsForPack) ? G.H2SProject.resolveSamplerUrlsForPack : null;
    if (!pack || !pack.urls || !resolveUrls){
      onLog('Sampler pack missing. See docs to install samples. Using default synth.');
      return _makeSynthByInstrument('default');
    }

    let resolved;
    try{ resolved = await resolveUrls(pack, packId); }catch(e){ resolved = { urls: {}, objectUrls: [], fallbackReason: null }; }
    const urls = resolved.urls;
    const keyCount = urls ? Object.keys(urls).length : 0;
    if (!urls || keyCount < 2){
      const msg = resolved.fallbackReason || 'Sampler pack missing. See docs to install samples. Using default synth.';
      onLog(msg);
      return _makeSynthByInstrument('default');
    }

    return new Promise(function(resolve){
      let settled = false;
      const settle = function(synth){
        if (settled) return;
        settled = true;
        resolve(synth);
      };
      const timeout = setTimeout(function(){
        settle(_makeSynthByInstrument('default'));
        onLog(resolved.fallbackReason || 'Sampler pack missing. See docs to install samples. Using default synth.');
        try{ if (sampler && sampler.dispose) sampler.dispose(); }catch(e){}
      }, SAMPLER_LOAD_TIMEOUT_MS);

      var sampler;
      try{
        sampler = new G.Tone.Sampler({
          urls: urls,
          baseUrl: '',
          onload: function(){
            clearTimeout(timeout);
            if (!settled) settle(sampler);
          },
        });
      }catch(e){
        clearTimeout(timeout);
        onLog('Sampler pack missing. See docs to install samples. Using default synth.');
        settle(_makeSynthByInstrument('default'));
        return;
      }
    });
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

    // Stop playback. If resetToStart=true, also reset playhead to 0.
    function stop(resetToStart){
      _logProjectPlaybackPerfIfNeeded();
      _disposeTrackSynths();
      _cancelTimers();
      if (G.Tone){
        try{ G.Tone.Transport.stop(); G.Tone.Transport.cancel(); }catch(e){}
      }
      playing = false;
      setTransportPlaying(false);
      if (resetToStart){
        // Reset UI playhead to the start after the natural end of playback.
        try{
          const p = getProject();
          if (p && p.ui) p.ui.playheadSec = 0;
        }catch(e){}
        try{ onUpdatePlayhead(0); }catch(e){}
      }
      onLog('Project stop.');
      try{ onStopped(); }catch(e){}
    }

    function _startRaf(){
      const tick = () => {
        if (!playing) return;
        const perf = _perfPlaybackTimingEnabled() && typeof G.performance !== 'undefined' && G.performance && typeof G.performance.now === 'function';
        const t0 = perf ? G.performance.now() : 0;
        let sec = startAt;
        try{ sec = startAt + (G.Tone.Transport.seconds || 0); }catch(e){}
        try{ onUpdatePlayhead(sec); }catch(e){}
        if (perf){
          const dt = G.performance.now() - t0;
          _projPlayRafSum += dt;
          _projPlayRafCount += 1;
          if (dt > _projPlayRafMax) _projPlayRafMax = dt;
        }
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
  const p2 = projectV2;

  // PR-INS2e.2.2: instrument from project tracks (source of truth); meta for mute/vol only
  const instrByTid = new Map();
  try{
    for (const t of (p2.tracks || [])){
      if (!t) continue;
      const tid = t.trackId || t.id;
      if (!tid) continue;
      instrByTid.set(tid, String(t.instrument || 'default'));
    }
  }catch(e){}

  const metaByTrackId = new Map();
  try{
    for (const t of (p2.tracks || [])){
      if (!t) continue;
      const tid = t.trackId || t.id;
      if (!tid) continue;
      metaByTrackId.set(tid, { muted: !!t.muted, gainDb: (Number.isFinite(Number(t.gainDb)) ? Number(t.gainDb) : 0) });
    }
  }catch(e){}

  const getSynth = async (trackId, instrumentKey) => {
    const meta = metaByTrackId.get(trackId) || { muted: false, gainDb: 0 };
    if (meta.muted) return null;
    const key = instrumentKey || 'default';
    const lastKey = lastInstrumentKeyByTid.get(trackId);
    if (synthByTrackId.has(trackId) && lastKey !== key){
      const old = synthByTrackId.get(trackId);
      try{ if (old && old.dispose) old.dispose(); }catch(e){}
      const idx = _trackSynths.indexOf(old);
      if (idx >= 0) _trackSynths.splice(idx, 1);
      synthByTrackId.delete(trackId);
      lastInstrumentKeyByTid.delete(trackId);
    }
    if (synthByTrackId.has(trackId)) return synthByTrackId.get(trackId);
    const s = await _makeSynthByInstrumentAsync(key);
    if (!s) return null;
    const dest = (s.toDestination && s.toDestination.call) ? s.toDestination() : s;
    try{ if (dest && dest.volume && Number.isFinite(meta.gainDb)) dest.volume.value = meta.gainDb; }catch(e){};
    _trackSynths.push(dest);
    synthByTrackId.set(trackId, dest);
    lastInstrumentKeyByTid.set(trackId, key);
    if (typeof window !== 'undefined' && window.H2S_DEBUG_INSTRUMENT){
      try{
        var cname = s && s.constructor ? s.constructor.name : '?';
        var isSampler = cname.indexOf('Sampler') >= 0 || (G.Tone.Sampler && s instanceof G.Tone.Sampler);
        var dbg = '[Audio] tid:' + trackId + ' instrumentKey:' + key + ' constructor:' + cname + ' isSampler:' + isSampler;
        if (isSampler && s){
          var bufs = s._buffers || (s._sampler && s._sampler._buffers);
          if (bufs){ var keys = Object.keys(bufs); if (keys.length) dbg += ' loadedKeys:' + keys.slice(0, 2).join(','); }
        }
        console.log(dbg);
      }catch(e){}
    }
    return dest;
  };

  const trackIdsNeeded = [...new Set((flat2.tracks || []).map(tr => tr && (tr.trackId || tr.id)).filter(Boolean))];
  await Promise.all(trackIdsNeeded.map(tid => getSynth(tid, instrByTid.get(tid) || 'default')));

  for (const tr of (flat2.tracks || [])){
    const tid = tr && (tr.trackId || tr.id);
    if (!tid) continue;
    const s = synthByTrackId.get(tid);
    if (!s) continue;
    for (const n of (tr.notes || [])){
      const absStart = Number(n.startSec || 0);
      if (absStart < startAt) continue;
      const t = absStart - startAt;
      const dur = Math.max(0.01, Number(n.durationSec || 0.1));
      let vel = (n.velocity == null) ? 0.8 : Number(n.velocity);
// Normalize: some paths store velocity as MIDI 1..127, others as 0..1.
// If it looks like MIDI, scale down.
if (Number.isFinite(vel) && vel > 1.01) vel = vel / 127;
vel = clamp(vel, 0.01, 1);
      if (t + dur > maxT) maxT = t + dur;
      G.Tone.Transport.schedule((time) => {
        try{
          var pitch = n.pitch;
          var isSampler = (s.constructor && s.constructor.name && s.constructor.name.indexOf('Sampler') >= 0) || (G.Tone.Sampler && s instanceof G.Tone.Sampler);
          var trigArg = isSampler ? G.Tone.Frequency(pitch, 'midi').toNote() : G.Tone.Frequency(pitch, 'midi');
          s.triggerAttackRelease(trigArg, dur, time, vel);
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
      _projPlayRafSum = 0;
      _projPlayRafCount = 0;
      _projPlayRafMax = 0;
      _startRaf();

      stopTimer = setTimeout(() => {
        // Natural end: stop and reset playhead to start for better UX.
        if (playing) stop(true);
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
            // Accept either MIDI velocity (1..127) or normalized velocity (0..1).
            const vRaw = (n.velocity == null) ? 100 : Number(n.velocity);
            let vel;
            if (!isFinite(vRaw)) vel = 0.8;
            else if (vRaw <= 1.01) vel = clamp(vRaw, 0.0, 1.0);
            else vel = clamp(Math.round(vRaw), 1, 127) / 127;
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
