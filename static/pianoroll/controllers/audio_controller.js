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

  /**
   * Slice E: map clip.audio.assetRef to a URL Tone.Player accepts (http(s), blob:, or localidb: -> blob).
   * @returns {Promise<{ url: string, revoke: (function()|null) }|null>}
   */
  async function resolveAssetRefForTone(assetRef){
    const s = String(assetRef || '').trim();
    if (!s) return null;
    const LAS = G.H2SLocalAudioAssets;
    if (LAS && typeof LAS.resolveAssetRefToPlaybackUrl === 'function'){
      try{
        return await LAS.resolveAssetRefToPlaybackUrl(s);
      } catch (e){
        return null;
      }
    }
    if (s.indexOf('localidb:') === 0) return null;
    return { url: s, revoke: null };
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
   * Pure helper: flatten v2 output + per-track mute/gain meta -> schedule rows for audio playback.
   * Does not depend on Tone (Node-testable). Skips muted tracks and empty assetRef.
   * @returns {{ items: Array<{ trackId: string, t: number, dur: number, assetRef: string, gainDb: number, instanceGainDb: number }>, skipped: Array<{ reason: string, trackId?: string }> }}
   */
  function computeAudioPlaybackSchedule(flat2, startAtSec, metaByTrackId){
    const items = [];
    const skipped = [];
    const segs = (flat2 && Array.isArray(flat2.audioSegments)) ? flat2.audioSegments : [];
    const startAt = Number(startAtSec || 0);
    for (let i = 0; i < segs.length; i++){
      const seg = segs[i];
      if (!seg) continue;
      const tid = seg.trackId;
      const meta = (metaByTrackId && typeof metaByTrackId.get === 'function')
        ? (metaByTrackId.get(tid) || { muted: false, gainDb: 0 })
        : { muted: false, gainDb: 0 };
      if (meta.muted){
        skipped.push({ reason: 'muted', trackId: tid });
        continue;
      }
      const assetRef = String(seg.assetRef || '').trim();
      if (!assetRef){
        skipped.push({ reason: 'empty_assetRef', trackId: tid });
        continue;
      }
      const absStart = Number(seg.startSec || 0);
      const dur = Math.max(0.01, Number(seg.durationSec || 0));
      const t = Math.max(0, absStart - startAt);
      const trackGainDb = Number.isFinite(Number(meta.gainDb)) ? Number(meta.gainDb) : 0;
      const instanceGainDb = Number.isFinite(Number(seg.instanceGainDb)) ? Number(seg.instanceGainDb) : 0;
      const gainDb = clamp(trackGainDb + instanceGainDb, -96, 24);
      items.push({ trackId: tid, t, dur, assetRef, gainDb, instanceGainDb });
    }
    return { items, skipped };
  }

  const AUDIO_PLAYER_LOAD_TIMEOUT_MS = 8000;

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
    // Instrument nodes are intentionally retained across stop/replay. Audio clip
    // players and one-off preview synths stay transient and are disposed on stop.
    let _trackSynths = [];
    let _transientPlaybackNodes = [];
    /** @type {Array<function():void>} Slice E: revoke blob URLs created for localidb: playback */
    let _audioRevokeList = [];
    const synthByTrackId = new Map();
    const lastInstrumentKeyByTid = new Map();
    const instrumentLastUsedByTid = new Map();
    const instrumentLoadGenerationByTid = new Map();
    const pendingInstrumentByTid = new Map();
    const retiredInstrumentNodes = new Set();
    const decodedSamplerPackCache = new Map();
    const liveMutedByTrackId = new Map();
    const runtimeNodesByTrackId = new Map();
    const MAX_CACHED_TRACK_INSTRUMENTS = 8;
    const MAX_DECODED_SAMPLER_PACKS = 4;

    function _trackKey(trackId){
      const s = String(trackId || '').trim();
      return s || null;
    }

    function _readTrackRuntimeMeta(trackId){
      const tid = _trackKey(trackId);
      const out = {
        muted: tid ? !!liveMutedByTrackId.get(tid) : false,
        gainDb: 0,
      };
      let foundMuted = false;
      try{
        const p2 = (typeof getProjectV2 === 'function' && getProjectV2()) ? getProjectV2()
          : ((typeof getProjectDoc === 'function' && getProjectDoc()) ? getProjectDoc() : null);
        const tracks = (p2 && Array.isArray(p2.tracks)) ? p2.tracks : [];
        for (const t of tracks){
          if (!t) continue;
          const id = _trackKey(t.trackId || t.id);
          if (!id || id !== tid) continue;
          if (typeof t.muted === 'boolean'){
            out.muted = !!t.muted;
            foundMuted = true;
          }
          if (Number.isFinite(Number(t.gainDb))) out.gainDb = Number(t.gainDb);
          break;
        }
      }catch(e){}
      if (tid && !foundMuted && liveMutedByTrackId.has(tid)) out.muted = !!liveMutedByTrackId.get(tid);
      return out;
    }

    function _applyNodeRuntimeState(trackId, node){
      if (!node) return;
      const meta = _readTrackRuntimeMeta(trackId);
      try{
        if ('mute' in node) node.mute = !!meta.muted;
      }catch(e){}
      try{
        if (node.volume && Number.isFinite(meta.gainDb)){
          const instanceGainDb = Number.isFinite(Number(node.__h2sInstanceGainDb)) ? Number(node.__h2sInstanceGainDb) : 0;
          node.volume.value = meta.muted ? -96 : clamp(meta.gainDb + instanceGainDb, -96, 24);
        }
      }catch(e){}
    }

    function _rememberRuntimeNode(trackId, node, instanceGainDb){
      const tid = _trackKey(trackId);
      if (!tid || !node) return;
      node.__h2sInstanceGainDb = Number.isFinite(Number(instanceGainDb)) ? Number(instanceGainDb) : 0;
      let set = runtimeNodesByTrackId.get(tid);
      if (!set){
        set = new Set();
        runtimeNodesByTrackId.set(tid, set);
      }
      set.add(node);
      _applyNodeRuntimeState(tid, node);
    }

    function _forgetRuntimeNode(trackId, node){
      const tid = _trackKey(trackId);
      if (!tid || !node) return;
      const set = runtimeNodesByTrackId.get(tid);
      if (!set) return;
      set.delete(node);
      if (!set.size) runtimeNodesByTrackId.delete(tid);
    }

    function _applyTrackRuntimeState(trackId){
      const tid = _trackKey(trackId);
      if (!tid) return;
      const set = runtimeNodesByTrackId.get(tid);
      if (!set) return;
      for (const node of Array.from(set)){
        _applyNodeRuntimeState(tid, node);
      }
    }

    function _isTrackMutedNow(trackId){
      return !!_readTrackRuntimeMeta(trackId).muted;
    }

    function setTrackMuted(trackId, muted){
      const tid = _trackKey(trackId);
      if (!tid) return false;
      liveMutedByTrackId.set(tid, !!muted);
      _applyTrackRuntimeState(tid);
      return true;
    }

    function refreshTrackRuntimeState(projectV2){
      try{
        const p2 = projectV2 || ((typeof getProjectV2 === 'function' && getProjectV2()) ? getProjectV2() : null);
        for (const t of ((p2 && Array.isArray(p2.tracks)) ? p2.tracks : [])){
          if (!t) continue;
          const tid = _trackKey(t.trackId || t.id);
          if (!tid) continue;
          if (typeof t.muted === 'boolean') liveMutedByTrackId.set(tid, !!t.muted);
          _applyTrackRuntimeState(tid);
        }
      }catch(e){}
    }


    async function ensureTone(){
      for (let i = 0; i < 40; i++){
        if (G.Tone) return true;
        await sleep(50);
      }
      return !!G.Tone;
    }

function _disposeTransientPlaybackNodes(){
  const transientSet = new Set(_transientPlaybackNodes);
  for (const [tid, nodes] of runtimeNodesByTrackId.entries()){
    for (const node of transientSet) nodes.delete(node);
    if (!nodes.size) runtimeNodesByTrackId.delete(tid);
  }
  for (const node of _transientPlaybackNodes){
    try{ if (node && node.dispose) node.dispose(); }catch(e){}
  }
  _transientPlaybackNodes = [];
  for (const rev of _audioRevokeList){
    try{ rev(); }catch(e){}
  }
  _audioRevokeList = [];
}

function _disposeRetiredInstrumentNodes(){
  for (const node of retiredInstrumentNodes){
    try{ if (node && node.dispose) node.dispose(); }catch(e){}
  }
  retiredInstrumentNodes.clear();
}

function _disposeTrackInstrument(trackId){
  const tid = _trackKey(trackId);
  if (!tid) return;
  const node = synthByTrackId.get(tid);
  if (node){
    _forgetRuntimeNode(tid, node);
    try{ if (node.dispose) node.dispose(); }catch(e){}
    const idx = _trackSynths.indexOf(node);
    if (idx >= 0) _trackSynths.splice(idx, 1);
  }
  synthByTrackId.delete(tid);
  lastInstrumentKeyByTid.delete(tid);
  instrumentLastUsedByTid.delete(tid);
}

function _trimTrackInstrumentCache(protectedTrackIds){
  if (_trackSynths.length <= MAX_CACHED_TRACK_INSTRUMENTS) return;
  const protectedSet = protectedTrackIds instanceof Set ? protectedTrackIds : new Set();
  const candidates = Array.from(synthByTrackId.keys())
    .filter(function(tid){ return !protectedSet.has(tid); })
    .sort(function(a, b){ return (instrumentLastUsedByTid.get(a) || 0) - (instrumentLastUsedByTid.get(b) || 0); });
  while (_trackSynths.length > MAX_CACHED_TRACK_INSTRUMENTS && candidates.length){
    _disposeTrackInstrument(candidates.shift());
  }
}

function _disposeTrackSynths(){
  _disposeTransientPlaybackNodes();
  _disposeRetiredInstrumentNodes();
  for (const tid of Array.from(synthByTrackId.keys())) _disposeTrackInstrument(tid);
  _trackSynths = [];
  pendingInstrumentByTid.clear();
  instrumentLoadGenerationByTid.clear();
  runtimeNodesByTrackId.clear();
  decodedSamplerPackCache.clear();
}

  function _makeSynthByInstrument(instr){
    const desc = (G.H2SProject && typeof G.H2SProject.normalizeInstrument === 'function')
      ? G.H2SProject.normalizeInstrument(instr)
      : { kind: 'tone_synth', presetId: (typeof instr === 'string' && instr) ? instr : 'default', params: {} };
    const presetId = (desc.kind === 'tone_synth' && desc.presetId) ? desc.presetId : 'default';
    if (G.H2SGmDrumKit && G.H2SGmDrumKit.isDrumPresetId(presetId)){
      return G.H2SGmDrumKit.createToneDrumKit(G.Tone, presetId);
    }
    switch (String(presetId)){
      case 'bass': return new G.Tone.MonoSynth();
      case 'lead': return new G.Tone.Synth();
      case 'pad': return new G.Tone.FMSynth();
      case 'pluck': return new G.Tone.PluckSynth();
      default: return new G.Tone.PolySynth(G.Tone.Synth);
    }
  }

  const SAMPLER_LOAD_TIMEOUT_MS = 4000;

  function _samplerPackCacheKey(packId, urls){
    const parts = Object.keys(urls || {}).sort().map(function(key){ return key + '=' + String(urls[key]); });
    return String(packId || 'sampler') + '|' + parts.join('|');
  }

  function _trimDecodedSamplerPackCache(){
    if (decodedSamplerPackCache.size <= MAX_DECODED_SAMPLER_PACKS) return;
    const entries = Array.from(decodedSamplerPackCache.entries())
      .filter(function(row){ return row[1] && row[1].ready; })
      .sort(function(a, b){ return (a[1].lastUsed || 0) - (b[1].lastUsed || 0); });
    while (decodedSamplerPackCache.size > MAX_DECODED_SAMPLER_PACKS && entries.length){
      decodedSamplerPackCache.delete(entries.shift()[0]);
    }
  }

  function _decodeSamplerUrls(packId, urls){
    const loader = G.Tone && G.Tone.ToneAudioBuffer && G.Tone.ToneAudioBuffer.load;
    if (typeof loader !== 'function') return null;
    const cacheKey = _samplerPackCacheKey(packId, urls);
    const cached = decodedSamplerPackCache.get(cacheKey);
    if (cached){
      cached.lastUsed = Date.now();
      return cached.promise;
    }
    const entry = { ready: false, lastUsed: Date.now(), promise: null };
    entry.promise = Promise.all(Object.keys(urls || {}).map(function(note){
      return Promise.resolve(loader.call(G.Tone.ToneAudioBuffer, urls[note]))
        .then(function(buffer){ return buffer ? { note: note, buffer: buffer } : null; })
        .catch(function(){ return null; });
    })).then(function(rows){
      const buffers = {};
      for (const row of rows){
        if (row && row.buffer) buffers[row.note] = row.buffer;
      }
      entry.ready = true;
      entry.lastUsed = Date.now();
      _trimDecodedSamplerPackCache();
      return buffers;
    }).catch(function(err){
      decodedSamplerPackCache.delete(cacheKey);
      throw err;
    });
    decodedSamplerPackCache.set(cacheKey, entry);
    _trimDecodedSamplerPackCache();
    return entry.promise;
  }

  function _awaitWithSamplerTimeout(promise){
    return new Promise(function(resolve){
      let settled = false;
      const timer = setTimeout(function(){
        if (settled) return;
        settled = true;
        resolve(null);
      }, SAMPLER_LOAD_TIMEOUT_MS);
      Promise.resolve(promise).then(function(value){
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }).catch(function(){
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  function _makeInstrumentLoadFallback(){
    const fallback = _makeSynthByInstrument('default');
    try{ fallback.__h2sInstrumentLoadFallback = true; }catch(e){}
    return fallback;
  }

  async function _createSamplerFromUrls(packId, urls, fallbackReason){
    const decodePromise = _decodeSamplerUrls(packId, urls);
    if (decodePromise){
      const decoded = await _awaitWithSamplerTimeout(decodePromise);
      if (!decoded || Object.keys(decoded).length < 2){
        onLog(fallbackReason || 'Sampler pack could not be decoded in time. Using default synth.');
        return _makeInstrumentLoadFallback();
      }
      try{
        // Tone accepts native AudioBuffer values. Each track gets its own Sampler
        // node while the expensive decoded PCM is shared by the bounded pack cache.
        return new G.Tone.Sampler({ urls: decoded, baseUrl: '' });
      }catch(e){
        onLog(fallbackReason || 'Sampler pack could not be created. Using default synth.');
        return _makeInstrumentLoadFallback();
      }
    }

    // Test/legacy Tone runtimes without ToneAudioBuffer.load keep the old loader.
    return new Promise(function(resolve){
      let settled = false;
      function settle(sampler){
        if (settled) return;
        settled = true;
        resolve(sampler);
      }
      const timeout = setTimeout(function(){
        settle(_makeInstrumentLoadFallback());
        onLog(fallbackReason || 'Sampler pack could not be loaded in time. Using default synth.');
        try{ if (sampler && sampler.dispose) sampler.dispose(); }catch(e){}
      }, SAMPLER_LOAD_TIMEOUT_MS);
      let sampler;
      try{
        sampler = new G.Tone.Sampler({
          urls: urls,
          baseUrl: '',
          onload: function(){ clearTimeout(timeout); settle(sampler); },
        });
      }catch(e){
        clearTimeout(timeout);
        settle(_makeInstrumentLoadFallback());
      }
    });
  }

  /** PR-INS2a/INS2e/INS2e.2: Async instrument creation. Handles tone_synth, sampler (built-in + custom), oneshot. */
  async function _makeSynthByInstrumentAsync(instr){
    const desc = (G.H2SProject && typeof G.H2SProject.normalizeInstrument === 'function')
      ? G.H2SProject.normalizeInstrument(instr)
      : { kind: 'tone_synth', presetId: (typeof instr === 'string' && instr) ? instr : 'default', params: {} };

    if (desc.kind === 'oneshot' && desc.packId){
      const resolveOneshot = (G.H2SProject && G.H2SProject.resolveCustomOneshotUrl) ? G.H2SProject.resolveCustomOneshotUrl : null;
      if (!resolveOneshot) return _makeInstrumentLoadFallback();
      const res = await resolveOneshot(desc.packId).catch(function(){ return null; });
      if (!res || !res.url){ onLog('Custom oneshot missing sample.'); return _makeInstrumentLoadFallback(); }
      return new Promise(function(resolve){
        var player = new G.Tone.Player({
          url: res.url,
          onload: function(){ resolve(player); }
        });
        player.toDestination();
        setTimeout(function(){ resolve(player); }, 2500);
      }).then(function(p){
        if (!p) return _makeInstrumentLoadFallback();
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
        return _makeInstrumentLoadFallback();
      }
      let resolved;
      try{ resolved = await resolveCustom(packId); }catch(e){ resolved = { urls: {}, objectUrls: [], fallbackReason: null }; }
      const urls = resolved.urls;
      const keyCount = urls ? Object.keys(urls).length : 0;
      if (!urls || keyCount < 2){
        onLog(resolved.fallbackReason || 'Custom sampler needs >=2 samples.');
        return _makeInstrumentLoadFallback();
      }
      if (typeof window !== 'undefined' && window.H2S_DEBUG_INSTRUMENT){
        var urlKeys = Object.keys(urls);
        var firstUrl = urlKeys[0] ? urls[urlKeys[0]] : '';
        console.log('[Audio] customSampler urlsCount:' + urlKeys.length + ' firstUrlPrefix:' + (firstUrl ? String(firstUrl).substring(0, 40) : ''));
      }
      return _createSamplerFromUrls(packId, urls, resolved.fallbackReason);
    }

    const packs = (G.H2SProject && G.H2SProject.SAMPLER_PACKS) ? G.H2SProject.SAMPLER_PACKS : {};
    const pack = packs[packId];
    const resolveUrls = (G.H2SProject && G.H2SProject.resolveSamplerUrlsForPack) ? G.H2SProject.resolveSamplerUrlsForPack : null;
    if (!pack || !pack.urls || !resolveUrls){
      onLog('Sampler pack missing. See docs to install samples. Using default synth.');
      return _makeInstrumentLoadFallback();
    }

    let resolved;
    try{ resolved = await resolveUrls(pack, packId); }catch(e){ resolved = { urls: {}, objectUrls: [], fallbackReason: null }; }
    const urls = resolved.urls;
    const keyCount = urls ? Object.keys(urls).length : 0;
    if (!urls || keyCount < 2){
      const msg = resolved.fallbackReason || 'Sampler pack missing. See docs to install samples. Using default synth.';
      onLog(msg);
      return _makeInstrumentLoadFallback();
    }

    return _createSamplerFromUrls(packId, urls, resolved.fallbackReason);
  }

  async function prepareTrackInstrument(trackId, instrumentKey){
    const tid = _trackKey(trackId);
    if (!tid) return null;
    const key = instrumentKey || 'default';
    const existing = synthByTrackId.get(tid);
    const existingKey = lastInstrumentKeyByTid.get(tid);
    const pending = pendingInstrumentByTid.get(tid);

    if (existing && existingKey === key && !existing.__h2sInstrumentLoadFallback){
      // A rapid A -> B -> A selection invalidates the still-loading B request.
      if (pending && pending.key !== key){
        instrumentLoadGenerationByTid.set(tid, (instrumentLoadGenerationByTid.get(tid) || 0) + 1);
        pendingInstrumentByTid.delete(tid);
      }
      instrumentLastUsedByTid.set(tid, Date.now());
      _applyNodeRuntimeState(tid, existing);
      return existing;
    }
    if (pending && pending.key === key) return pending.promise;

    const generation = (instrumentLoadGenerationByTid.get(tid) || 0) + 1;
    instrumentLoadGenerationByTid.set(tid, generation);
    const promise = (async function(){
      const synth = await _makeSynthByInstrumentAsync(key);
      if (!synth) return null;
      const dest = (synth.toDestination && synth.toDestination.call) ? synth.toDestination() : synth;
      if (instrumentLoadGenerationByTid.get(tid) !== generation){
        try{ if (dest && dest.dispose) dest.dispose(); }catch(e){}
        return synthByTrackId.get(tid) || null;
      }

      const old = synthByTrackId.get(tid);
      if (old && old !== dest){
        _forgetRuntimeNode(tid, old);
        const oldIndex = _trackSynths.indexOf(old);
        if (oldIndex >= 0) _trackSynths.splice(oldIndex, 1);
        // Scheduled callbacks close over the previous node. Let it finish the
        // current transport session, then dispose it in stop().
        if (playing) retiredInstrumentNodes.add(old);
        else try{ if (old.dispose) old.dispose(); }catch(e){}
      }

      synthByTrackId.set(tid, dest);
      lastInstrumentKeyByTid.set(tid, key);
      instrumentLastUsedByTid.set(tid, Date.now());
      _rememberRuntimeNode(tid, dest);
      if (_trackSynths.indexOf(dest) < 0) _trackSynths.push(dest);
      if (!playing) _trimTrackInstrumentCache(new Set([tid]));
      return dest;
    })();

    const pendingEntry = { key: key, generation: generation, promise: promise };
    pendingInstrumentByTid.set(tid, pendingEntry);
    const clearPending = function(){
      if (pendingInstrumentByTid.get(tid) === pendingEntry) pendingInstrumentByTid.delete(tid);
    };
    promise.then(clearPending, clearPending);
    return promise;
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
      _disposeTransientPlaybackNodes();
      _disposeRetiredInstrumentNodes();
      _trimTrackInstrumentCache();
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

_disposeTransientPlaybackNodes();
_disposeRetiredInstrumentNodes();

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

  refreshTrackRuntimeState(p2);

  const projectTrackIds = new Set();
  for (const track of (p2.tracks || [])){
    const projectTid = track && (track.trackId || track.id);
    if (projectTid) projectTrackIds.add(String(projectTid));
  }
  for (const cachedTid of Array.from(synthByTrackId.keys())){
    if (!projectTrackIds.has(String(cachedTid))) _disposeTrackInstrument(cachedTid);
  }

  const getSynth = async (trackId, instrumentKey) => {
    const meta = metaByTrackId.get(trackId) || { muted: false, gainDb: 0 };
    if (meta.muted) return null;
    const key = instrumentKey || 'default';
    const dest = await prepareTrackInstrument(trackId, key);
    if (!dest) return null;
    try{ if (dest && dest.volume && Number.isFinite(meta.gainDb)) dest.volume.value = meta.gainDb; }catch(e){};
    if (typeof window !== 'undefined' && window.H2S_DEBUG_INSTRUMENT){
      try{
        var cname = dest && dest.constructor ? dest.constructor.name : '?';
        var isSampler = cname.indexOf('Sampler') >= 0 || (G.Tone.Sampler && dest instanceof G.Tone.Sampler);
        var dbg = '[Audio] tid:' + trackId + ' instrumentKey:' + key + ' constructor:' + cname + ' isSampler:' + isSampler;
        if (isSampler && dest){
          var bufs = dest._buffers || (dest._sampler && dest._sampler._buffers);
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
          if (_isTrackMutedNow(tid)) return;
          _applyTrackRuntimeState(tid);
          var pitch = n.pitch;
          var isSampler = (s.constructor && s.constructor.name && s.constructor.name.indexOf('Sampler') >= 0) || (G.Tone.Sampler && s instanceof G.Tone.Sampler);
          var trigArg = isSampler ? G.Tone.Frequency(pitch, 'midi').toNote() : G.Tone.Frequency(pitch, 'midi');
          s.triggerAttackRelease(trigArg, dur, time, vel);
        }catch(e){}
      }, t);
    }
  }

  // Slice B: audio clip instances (flatten audioSegments) — same transport timeline as notes.
  const audioSched = computeAudioPlaybackSchedule(flat2, startAt, metaByTrackId);
  async function loadTonePlayer(assetRef){
    const resolved = await resolveAssetRefForTone(assetRef);
    if (!resolved || !resolved.url){
      try{ onLog('Audio segment skipped (unresolved asset): ' + String(assetRef).slice(0, 64)); }catch(e){}
      return null;
    }
    const playUrl = resolved.url;
    const revoke = resolved.revoke;
    return new Promise(function(resolve){
      let settled = false;
      function done(pl){
        if (settled) return;
        settled = true;
        resolve(pl);
      }
      const timeout = setTimeout(function(){ done(null); }, AUDIO_PLAYER_LOAD_TIMEOUT_MS);
      try{
        const pl = new G.Tone.Player({
          url: playUrl,
          onload: function(){
            clearTimeout(timeout);
            if (typeof revoke === 'function') _audioRevokeList.push(revoke);
            done(pl);
          },
        });
      }catch(e){
        clearTimeout(timeout);
        try{ if (typeof revoke === 'function') revoke(); }catch(e2){}
        done(null);
      }
    });
  }
  for (let ai = 0; ai < audioSched.items.length; ai++){
    const item = audioSched.items[ai];
    const player = await loadTonePlayer(item.assetRef);
    if (!player){
      try{ onLog('Audio segment skipped (load failed): ' + String(item.assetRef).slice(0, 80)); }catch(e){}
      continue;
    }
    try{
      const dest = (player.toDestination && player.toDestination.call) ? player.toDestination() : player;
      if (dest && dest.volume && Number.isFinite(item.gainDb)) dest.volume.value = item.gainDb;
    }catch(e){}
    _rememberRuntimeNode(item.trackId, player, item.instanceGainDb);
    _transientPlaybackNodes.push(player);
    if (item.t + item.dur > maxT) maxT = item.t + item.dur;
    (function(pl, dur, t, trackId){
      G.Tone.Transport.schedule(function(time){
        try{
          if (_isTrackMutedNow(trackId)) return;
          _applyTrackRuntimeState(trackId);
          if (pl && typeof pl.start === 'function') pl.start(time, 0, dur);
        }catch(e){}
      }, t);
    })(player, item.dur, item.t, item.trackId);
  }
} else {
  // Legacy fallback: v1 seconds-only schedule, single synth.
  const synth = new G.Tone.PolySynth(G.Tone.Synth).toDestination();
  _transientPlaybackNodes.push(synth);

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

      const p2 = (typeof getProjectV2 === 'function' && getProjectV2()) ? getProjectV2() : null;
      const c2 = p2 && p2.clips && p2.clips[clipId];
      const isAudioResolved = (G.H2SProject && typeof G.H2SProject.clipKind === 'function' && c2)
        ? (G.H2SProject.clipKind(c2) === 'audio')
        : (clip.kind === 'audio');

      if (isAudioResolved){
        const assetRef = String((c2 && c2.audio && c2.audio.assetRef) || (clip.audio && clip.audio.assetRef) || '').trim();
        const durSec = Math.max(0.01, Number((c2 && c2.audio && c2.audio.durationSec) || (clip.audio && clip.audio.durationSec) || (clip.meta && clip.meta.spanSec) || 1));
        if (!assetRef){
          try{ onLog('Audio clip play: empty assetRef'); }catch(e){}
          return false;
        }
        const ok = await ensureTone();
        if (!ok){ onAlert('Tone.js not available.'); return false; }
        await G.Tone.start();
        _disposeTransientPlaybackNodes();
        G.Tone.Transport.stop();
        G.Tone.Transport.cancel();
        G.Tone.Transport.seconds = 0;
        G.Tone.Transport.bpm.value = (project && project.bpm) ? project.bpm : 120;

        const resolved = await resolveAssetRefForTone(assetRef);
        if (!resolved || !resolved.url){
          try{ onLog('Audio clip play: missing or unresolved local asset'); }catch(e){}
          return false;
        }
        const playUrl = resolved.url;
        const revokeAfterLoad = resolved.revoke;

        const player = await new Promise(function(resolve){
          let settled = false;
          function done(pl){
            if (settled) return;
            settled = true;
            resolve(pl);
          }
          const timeout = setTimeout(function(){
            try{ if (typeof revokeAfterLoad === 'function') revokeAfterLoad(); }catch(e){}
            done(null);
          }, AUDIO_PLAYER_LOAD_TIMEOUT_MS);
          try{
            const pl = new G.Tone.Player({
              url: playUrl,
              onload: function(){
                clearTimeout(timeout);
                if (typeof revokeAfterLoad === 'function') _audioRevokeList.push(revokeAfterLoad);
                done(pl);
              },
            });
          }catch(e){
            clearTimeout(timeout);
            try{ if (typeof revokeAfterLoad === 'function') revokeAfterLoad(); }catch(e2){}
            done(null);
          }
        });
        if (!player){
          try{ onLog('Audio clip play: load failed'); }catch(e){}
          return false;
        }
        try{
          const dest = (player.toDestination && player.toDestination.call) ? player.toDestination() : player;
          _transientPlaybackNodes.push(dest);
        }catch(e){
          try{ if (player.dispose) player.dispose(); }catch(e2){}
          return false;
        }
        const maxT = durSec;
        G.Tone.Transport.schedule(function(time){
          try{
            if (player && typeof player.start === 'function') player.start(time, 0, maxT);
          }catch(e){}
        }, 0);
        G.Tone.Transport.start('+0.05');
        onLog('Clip play (audio): ' + (clip.name || clipId));
        setTimeout(function(){
          try{ G.Tone.Transport.stop(); G.Tone.Transport.cancel(); }catch(e){}
          try{ _disposeTransientPlaybackNodes(); }catch(e2){}
        }, Math.ceil((maxT + 0.2) * 1000));
        return true;
      }

      const ok = await ensureTone();
      if (!ok){ onAlert('Tone.js not available.'); return false; }
      await G.Tone.start();

      const synth = new G.Tone.PolySynth(G.Tone.Synth).toDestination();
      _transientPlaybackNodes.push(synth);

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
        try{ _disposeTransientPlaybackNodes(); }catch(e2){}
      }, Math.ceil((maxT + 0.2) * 1000));

      return true;
    }

    function dispose(){
      _cancelTimers();
      try{
        if (G.Tone && G.Tone.Transport){
          G.Tone.Transport.stop();
          G.Tone.Transport.cancel();
        }
      }catch(e){}
      playing = false;
      _disposeTrackSynths();
      if (typeof G.removeEventListener === 'function'){
        try{ G.removeEventListener('pagehide', dispose); }catch(e){}
      }
    }

    if (typeof G.addEventListener === 'function'){
      try{ G.addEventListener('pagehide', dispose); }catch(e){}
    }

    return {
      ensureTone,
      playProject,
      stop,
      playClip,
      prepareTrackInstrument,
      dispose,
      setTrackMuted,
      refreshTrackRuntimeState,
      flattenProjectToEvents,
    };
  }

  return {
    create,
    flattenProjectToEvents,
    computeAudioPlaybackSchedule,
    resolveAssetRefForTone,
  };
});
