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

  /**
   * PR-INS1/INS2a/INS2e.2: Normalize instrument to descriptor shape.
   * Accepts legacy string (e.g. 'pad', 'sampler:tonejs:piano', 'sampler:user:xxx', 'oneshot:user:xxx') or structured descriptor.
   * Returns { kind: 'tone_synth'|'sampler'|'oneshot', presetId?: string, packId?: string, params: {} }
   */
  function normalizeInstrument(instr){
    if (typeof instr === 'string' && instr.trim()){
      const s = instr.trim();
      if (s.indexOf('sampler:') === 0){
        const packId = s.slice(8).trim() || 'tonejs:piano';
        return { kind: 'sampler', packId: packId, params: {} };
      }
      if (s.indexOf('oneshot:') === 0){
        const packId = s.slice(8).trim();
        return { kind: 'oneshot', packId: packId, params: {} };
      }
      return { kind: 'tone_synth', presetId: s, params: {} };
    }
    if (instr && typeof instr === 'object'){
      if (instr.kind === 'sampler' && typeof instr.packId === 'string'){
        return { kind: 'sampler', packId: instr.packId, params: instr.params || {} };
      }
      if (instr.kind === 'oneshot' && typeof instr.packId === 'string'){
        return { kind: 'oneshot', packId: instr.packId, params: instr.params || {} };
      }
      if (instr.kind === 'tone_synth' && typeof instr.presetId === 'string'){
        return { kind: 'tone_synth', presetId: instr.presetId, params: instr.params || {} };
      }
    }
    return { kind: 'tone_synth', presetId: SCHEMA_V2.DEFAULT_INSTRUMENT, params: {} };
  }

  /** PR-INS2a/INS2d/INS2g: Sampler pack registry. urls = Tone note key -> filename. requiredKeys = minimal set for completeness. */
  const SAMPLER_PACKS = {
    'tonejs:piano': {
      label: 'Piano (tonejs-instruments)',
      baseUrlDefault: '/static/pianoroll/vendor/tonejs-instruments/samples/piano/',
      instrumentSubdir: 'piano/',
      requiredKeys: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
      urls: { A1: 'A1.mp3', A2: 'A2.mp3', A3: 'A3.mp3', A4: 'A4.mp3', A5: 'A5.mp3', A6: 'A6.mp3' },
    },
    'tonejs:strings': {
      label: 'Strings (tonejs-instruments)',
      baseUrlDefault: '/static/pianoroll/vendor/tonejs-instruments/samples/violin/',
      instrumentSubdir: 'violin/',
      subdirAliases: ['strings'],
      requiredKeys: ['C4', 'E4', 'G3', 'G4', 'A3', 'A4'],
      urls: { C4: 'C4.mp3', E4: 'E4.mp3', G3: 'G3.mp3', G4: 'G4.mp3', A3: 'A3.mp3', A4: 'A4.mp3' },
    },
    'tonejs:bass': {
      label: 'Bass (tonejs-instruments)',
      baseUrlDefault: '/static/pianoroll/vendor/tonejs-instruments/samples/bass-electric/',
      instrumentSubdir: 'bass-electric/',
      subdirAliases: ['bass'],
      requiredKeys: ['E1', 'G1', 'C#2', 'E2', 'G2', 'C#3'],
      urls: { E1: 'E1.mp3', G1: 'G1.mp3', 'C#2': 'Cs2.mp3', E2: 'E2.mp3', G2: 'G2.mp3', 'C#3': 'Cs3.mp3' },
    },
    'tonejs:guitar-acoustic': {
      label: 'Guitar Acoustic (tonejs-instruments)',
      baseUrlDefault: '/static/pianoroll/vendor/tonejs-instruments/samples/guitar-acoustic/',
      instrumentSubdir: 'guitar-acoustic/',
      requiredKeys: ['C3', 'D3', 'E3', 'G3', 'A3', 'C4'],
      urls: { C3: 'C3.mp3', D3: 'D3.mp3', E3: 'E3.mp3', G3: 'G3.mp3', A3: 'A3.mp3', C4: 'C4.mp3' },
    },
    'tonejs:guitar-electric': {
      label: 'Guitar Electric (tonejs-instruments)',
      baseUrlDefault: '/static/pianoroll/vendor/tonejs-instruments/samples/guitar-electric/',
      instrumentSubdir: 'guitar-electric/',
      requiredKeys: ['C3', 'D3', 'E3', 'G3', 'A3', 'C4'],
      urls: { C3: 'C3.mp3', D3: 'D3.mp3', E3: 'E3.mp3', G3: 'G3.mp3', A3: 'A3.mp3', C4: 'C4.mp3' },
    },
  };

  const LS_SAMPLER_BASEURL = 'hum2song_studio_sampler_baseurl';

  /** PR-INS2c: Get user-configured sampler baseUrl from localStorage. Returns null if not set. */
  function getSamplerBaseUrl(){
    try{
      if (typeof localStorage === 'undefined') return null;
      var v = localStorage.getItem(LS_SAMPLER_BASEURL);
      return (v && typeof v === 'string' && v.trim()) ? v.trim() : null;
    }catch(e){ return null; }
  }

  /** PR-INS2c: Set user-configured sampler baseUrl. Empty string removes the key. */
  function setSamplerBaseUrl(url){
    try{
      if (typeof localStorage === 'undefined') return;
      var s = (url != null && typeof url === 'string') ? url.trim() : '';
      if (s) localStorage.setItem(LS_SAMPLER_BASEURL, s);
      else localStorage.removeItem(LS_SAMPLER_BASEURL);
    }catch(e){}
  }

  /** PR-INS2c: Resolve baseUrl for a pack. Uses user baseUrl + instrumentSubdir if set, else baseUrlDefault. */
  function getResolvedSamplerBaseUrl(pack){
    if (!pack) return null;
    var user = getSamplerBaseUrl();
    if (!user) return pack.baseUrlDefault || null;
    var subdir = pack.instrumentSubdir || 'piano/';
    var base = user.replace(/\/+$/, '');
    return base + '/' + subdir.replace(/^\//, '');
  }

  var PROBE_EXTENSIONS = ['mp3', 'ogg', 'wav'];
  var PROBE_TIMEOUT_MS = 800;
  var PROBE_CACHE = {};
  var PROBE_CACHE_TTL_MS = 120000;

  /** PR-INS2g.1: Probe which sample files exist at baseUrl. Returns { availableKeys, urlMap }.
   *  Tries .mp3, .ogg, .wav per key. Caches results by packId+baseUrl. */
  function probeSamplerFiles(baseUrl, keys, pack){
    if (!baseUrl || !keys || !keys.length || !pack || !pack.urls) return Promise.resolve({ availableKeys: [], urlMap: {} });
    var cacheKey = (typeof window !== 'undefined') ? (pack.instrumentSubdir + ':' + baseUrl) : null;
    if (cacheKey && PROBE_CACHE[cacheKey]){
      var cached = PROBE_CACHE[cacheKey];
      if (Date.now() - (cached.ts || 0) < PROBE_CACHE_TTL_MS) return Promise.resolve(cached);
    }
    var base = baseUrl.replace(/\/+$/, '') + '/';
    var concurrency = 3;
    var idx = 0;
    function next(){
      if (idx >= keys.length) return Promise.resolve();
      var k = keys[idx++];
      var def = pack.urls[k];
      var basename = (def && def.replace(/\.[^/.]+$/, '')) ? def.replace(/\.[^/.]+$/, '') : k.replace(/#/g, 's');
      function tryExt(j){
        if (j >= PROBE_EXTENSIONS.length) return Promise.resolve(null);
        var url = base + basename + '.' + PROBE_EXTENSIONS[j];
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var t = ctrl ? setTimeout(function(){ ctrl.abort(); }, PROBE_TIMEOUT_MS) : null;
        return fetch(url, { method: 'HEAD', signal: ctrl ? ctrl.signal : undefined }).then(function(r){
          if (t) clearTimeout(t);
          return r.ok ? { k: k, url: url } : tryExt(j + 1);
        }).catch(function(){ if (t) clearTimeout(t); return tryExt(j + 1); });
      }
      return tryExt(0).then(function(r){ return r; });
    }
    var results = [];
    function runBatch(){
      var batch = [];
      while (batch.length < concurrency && idx < keys.length){ batch.push(next()); }
      if (!batch.length) return Promise.resolve();
      return Promise.all(batch).then(function(arr){
        for (var i = 0; i < arr.length; i++) if (arr[i]) results.push(arr[i]);
        return runBatch();
      });
    }
    return runBatch().then(function(){
      var availableKeys = results.map(function(r){ return r.k; });
      var urlMap = {};
      for (var i = 0; i < results.length; i++) urlMap[results[i].k] = results[i].url;
      var out = { availableKeys: availableKeys, urlMap: urlMap };
      if (cacheKey) PROBE_CACHE[cacheKey] = { availableKeys: availableKeys, urlMap: urlMap, ts: Date.now() };
      return out;
    });
  }

  /** PR-INS2e/INS2g.1: Resolve sampler urls. Local IndexedDB first (no probe). Else probe baseUrl for available keys.
   *  Returns { urls, objectUrls, fallbackReason? }. If <2 keys available, fallbackReason is set. */
  function resolveSamplerUrlsForPack(pack, packId){
    var result = { urls: {}, objectUrls: [], fallbackReason: null };
    if (!pack || !pack.urls || !packId) return Promise.resolve(result);
    var baseUrl = getResolvedSamplerBaseUrl(pack) || pack.baseUrlDefault || '';
    var store = (typeof window !== 'undefined' && window.H2SInstrumentLibraryStore) ? window.H2SInstrumentLibraryStore : null;
    var keys = (pack.requiredKeys && pack.requiredKeys.length) ? pack.requiredKeys : Object.keys(pack.urls);

    return Promise.all(keys.map(function(k){
      if (!store || !store.getSample) return Promise.resolve(null);
      return store.getSample(packId, k).then(function(blob){
        if (blob && blob instanceof Blob){
          var url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
          if (url){ result.objectUrls.push(url); return { k: k, url: url }; }
        }
        return null;
      });
    })).then(function(localResults){
      var localKeys = [];
      for (var i = 0; i < keys.length; i++){
        var loc = localResults[i];
        if (loc && loc.url){ result.urls[loc.k] = loc.url; localKeys.push(loc.k); }
      }
      if (store && store.registerObjectUrls && result.objectUrls.length) store.registerObjectUrls(packId, result.objectUrls);

      if (localKeys.length > 0){
        result.availableKeys = localKeys;
        if (localKeys.length < 2) result.fallbackReason = 'Sampler pack incomplete (' + localKeys.length + ' sample(s) found).';
        return result;
      }

      if (!baseUrl){ result.fallbackReason = 'Sampler pack missing. See docs to install samples.'; return result; }
      return probeSamplerFiles(baseUrl, keys, pack).then(function(probed){
        result.availableKeys = probed.availableKeys || [];
        for (var k in (probed.urlMap || {})) result.urls[k] = probed.urlMap[k];
        if (result.availableKeys.length < 2) result.fallbackReason = 'Sampler pack incomplete (' + result.availableKeys.length + ' sample(s) found).';
        return result;
      });
    });
  }

  /** PR-INS2e.2.4e: Scan IDB sampler_samples by prefix packId: -> { keys, records }. No per-key get. */
  function scanPackRecords(packId){
    if (!packId || typeof indexedDB === 'undefined') return Promise.resolve({ keys: [], records: new Map() });
    var DB_NAME = 'hum2song_studio_instrument_library';
    var STORE_NAME = 'sampler_samples';
    var prefix = packId + ':';
    return new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME, 2);
      req.onerror = function(){ resolve({ keys: [], records: new Map() }); };
      req.onsuccess = function(){
        var db = req.result;
        if (!db || !db.objectStoreNames.contains(STORE_NAME)){ resolve({ keys: [], records: new Map() }); return; }
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var keys = [];
        var records = new Map();
        var cr = store.openCursor();
        cr.onsuccess = function(){
          var cur = cr.result;
          if (!cur){ resolve({ keys: keys, records: records }); return; }
          var k = String(cur.key);
          if (k.indexOf(prefix) === 0){
            var noteKey = k.slice(prefix.length);
            keys.push(noteKey);
            records.set(noteKey, cur.value);
          }
          cur.continue();
        };
        cr.onerror = function(){ resolve({ keys: keys, records: records }); };
      };
    });
  }

  function _extractBlob(rec){
    if (!rec) return null;
    var blob = (rec instanceof Blob) ? rec : (rec.blob || rec.file || rec.data);
    if (!blob) return null;
    if (blob instanceof Blob) return blob;
    if (typeof blob.slice === 'function' && 'size' in blob && 'type' in blob) return blob;
    return null;
  }

  /** PR-INS2e.2/INS2e.2.4/INS2e.2.4e: Resolve URLs for custom sampler (IDB prefix scan). Returns { urls, objectUrls, fallbackReason? }. */
  function resolveCustomSamplerUrls(packId){
    var result = { urls: {}, objectUrls: [], fallbackReason: null };
    if (!packId || packId.indexOf('user:') !== 0) return Promise.resolve(result);
    var store = (typeof window !== 'undefined' && window.H2SInstrumentLibraryStore) ? window.H2SInstrumentLibraryStore : null;
    var debug = (typeof window !== 'undefined' && window.H2S_DEBUG_INSTRUMENT);
    return scanPackRecords(packId).then(function(scanned){
      var keys = scanned.keys || [];
      var recMap = scanned.records || new Map();
      var firstRec = keys.length ? recMap.get(keys[0]) : null;
      var hasBlobField = !!(firstRec && typeof firstRec === 'object' && 'blob' in firstRec);
      for (var i = 0; i < keys.length; i++){
        var noteKey = keys[i];
        var rec = recMap.get(noteKey);
        var blob = _extractBlob(rec);
        if (blob){
          var url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
          if (url){ result.urls[noteKey] = url; result.objectUrls.push(url); }
        }
      }
      if (store && store.registerObjectUrls && result.objectUrls.length) store.registerObjectUrls(packId, result.objectUrls);
      var urlCount = Object.keys(result.urls).length;
      if (urlCount < 2) result.fallbackReason = 'Custom sampler needs >=2 samples.';
      if (debug){
        var urlKeys = Object.keys(result.urls);
        var firstUrl = urlKeys[0] ? result.urls[urlKeys[0]] : '';
        var urlPrefix = firstUrl ? String(firstUrl).substring(0, 30) : '';
        console.log('[resolveCustomSamplerUrls] packId:' + packId + ' keyCount:' + keys.length + ' urlCount:' + urlCount + ' recHasBlobField:' + hasBlobField + ' first2Keys:' + urlKeys.slice(0, 2).join(',') + ' urlPrefix:' + urlPrefix + ' isBlobUrl:' + (String(firstUrl).indexOf('blob:') === 0));
      }
      return result;
    });
  }

  /** PR-INS2e.2/INS2e.2.4e: Resolve single URL for custom oneshot (IDB prefix scan). Returns { url, objectUrls } or null. */
  function resolveCustomOneshotUrl(packId){
    if (!packId || packId.indexOf('user:') !== 0) return Promise.resolve(null);
    var store = (typeof window !== 'undefined' && window.H2SInstrumentLibraryStore) ? window.H2SInstrumentLibraryStore : null;
    return scanPackRecords(packId).then(function(scanned){
      var keys = scanned.keys || [];
      var recMap = scanned.records || new Map();
      for (var i = 0; i < keys.length; i++){
        var blob = _extractBlob(recMap.get(keys[i]));
        if (blob){
          var url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
          if (url){
            if (store && store.registerObjectUrls) store.registerObjectUrls(packId, [url]);
            return { url: url, objectUrls: [url] };
          }
        }
      }
      return null;
    });
  }

  /** PR-INS2g.1: Probe sampler availability for status display. Returns { availableKeys, missingKeys, source }. */
  function probeSamplerAvailability(packId){
    var packs = (typeof SAMPLER_PACKS !== 'undefined') ? SAMPLER_PACKS : {};
    var pack = packs[packId];
    if (!pack || !pack.urls) return Promise.resolve({ availableKeys: [], missingKeys: [], source: null });
    var keys = (pack.requiredKeys && pack.requiredKeys.length) ? pack.requiredKeys : Object.keys(pack.urls);
    var store = (typeof window !== 'undefined' && window.H2SInstrumentLibraryStore) ? window.H2SInstrumentLibraryStore : null;
    if (!store || !store.getSample) return Promise.resolve({ availableKeys: [], missingKeys: keys, source: null });
    return Promise.all(keys.map(function(k){ return store.getSample(packId, k); })).then(function(blobs){
      var availableKeys = [];
      for (var i = 0; i < keys.length; i++) if (blobs[i] && blobs[i] instanceof Blob) availableKeys.push(keys[i]);
      if (availableKeys.length > 0){
        var missingKeys = keys.filter(function(k){ return availableKeys.indexOf(k) < 0; });
        return { availableKeys: availableKeys, missingKeys: missingKeys, source: 'local' };
      }
      var baseUrl = getResolvedSamplerBaseUrl(pack) || pack.baseUrlDefault || '';
      if (!baseUrl) return { availableKeys: [], missingKeys: keys, source: null };
      return probeSamplerFiles(baseUrl, keys, pack).then(function(probed){
        var av = probed.availableKeys || [];
        var missing = keys.filter(function(k){ return av.indexOf(k) < 0; });
        return { availableKeys: av, missingKeys: missing, source: 'remote' };
      });
    });
  }

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
        if (clipKind(c) === 'audio'){
          if (!c.audio || typeof c.audio !== 'object') c.audio = {};
          c.audio.assetRef = (typeof c.audio.assetRef === 'string') ? c.audio.assetRef : '';
          let dur = Number(c.audio.durationSec);
          if (!isFiniteNumber(dur) || dur <= 0) dur = 1e-6;
          c.audio.durationSec = dur;
          if ('score' in c) delete c.score;
          recomputeClipMetaFromAudio(c, bpm);
          if (c.meta) c.meta.sourceTempoBpm = srcTempo;
        } else {
          c.score = ensureScoreBeatIds(c.score);
          recomputeClipMetaFromScoreBeat(c);
          if (c.meta) c.meta.sourceTempoBpm = srcTempo;
        }
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

  /**
   * Resolve placement for audio -> editable conversion in v1 view space.
   * When `sourceInstanceId` is set, align to that instance (must match `sourceClipId`).
   * Otherwise align only when there is exactly one timeline instance for the clip; else fallback.
   */
  function resolveAudioConvertPlacementV1(projectV1, sourceClipId, fallbackStartSec, fallbackTrackIndex, sourceInstanceId){
    const fallbackStart = (isFiniteNumber(fallbackStartSec) && Number(fallbackStartSec) >= 0) ? Number(fallbackStartSec) : 0;
    const fallbackTrack = (isFiniteNumber(fallbackTrackIndex) && Number(fallbackTrackIndex) >= 0) ? Math.floor(Number(fallbackTrackIndex)) : 0;
    if (!projectV1 || !sourceClipId){
      return { startSec: fallbackStart, trackIndex: fallbackTrack, aligned: false, reason: 'missing_input' };
    }
    const sid = (sourceInstanceId != null && String(sourceInstanceId).trim() !== '') ? String(sourceInstanceId).trim() : '';
    if (sid){
      const inst = Array.isArray(projectV1.instances)
        ? projectV1.instances.find(i => i && String(i.id) === sid)
        : null;
      if (!inst){
        return { startSec: fallbackStart, trackIndex: fallbackTrack, aligned: false, reason: 'source_instance_not_found' };
      }
      if (String(inst.clipId || '') !== String(sourceClipId)){
        return { startSec: fallbackStart, trackIndex: fallbackTrack, aligned: false, reason: 'source_instance_clip_mismatch' };
      }
      const startSec = (isFiniteNumber(inst.startSec) && Number(inst.startSec) >= 0) ? Number(inst.startSec) : fallbackStart;
      const trackIndex = (isFiniteNumber(inst.trackIndex) && Number(inst.trackIndex) >= 0) ? Math.floor(Number(inst.trackIndex)) : fallbackTrack;
      return { startSec, trackIndex, aligned: true, reason: 'explicit_source_instance' };
    }
    const matches = Array.isArray(projectV1.instances)
      ? projectV1.instances.filter(inst => inst && String(inst.clipId || '') === String(sourceClipId))
      : [];
    if (matches.length !== 1){
      return {
        startSec: fallbackStart,
        trackIndex: fallbackTrack,
        aligned: false,
        reason: (matches.length === 0) ? 'no_source_instance' : 'multiple_source_instances'
      };
    }
    const only = matches[0];
    const startSec = (isFiniteNumber(only.startSec) && Number(only.startSec) >= 0) ? Number(only.startSec) : fallbackStart;
    const trackIndex = (isFiniteNumber(only.trackIndex) && Number(only.trackIndex) >= 0) ? Math.floor(Number(only.trackIndex)) : fallbackTrack;
    return { startSec, trackIndex, aligned: true, reason: 'single_source_instance' };
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

  /** ProjectDoc v2: 'note' (default) or 'audio'. Missing/invalid kind => note clip. */
  function clipKind(clip){
    if (!clip || typeof clip !== 'object') return 'note';
    return (clip.kind === 'audio') ? 'audio' : 'note';
  }

  /**
   * Audio clips: derive meta.spanBeat from audio.durationSec and project BPM.
   * Does not require clip.score. Preserves meta.agent and meta.sourceTempoBpm when present.
   */
  function recomputeClipMetaFromAudio(clip, bpm){
    if (!clip) return clip;
    const bpmUsed = coerceBpm(bpm);
    const audio = clip.audio && typeof clip.audio === 'object' ? clip.audio : {};
    const durSec = Number(audio.durationSec);
    const spanBeat = (isFiniteNumber(durSec) && durSec > 0)
      ? normalizeBeat(secToBeat(durSec, bpmUsed))
      : 0;
    const oldMeta = clip.meta;
    if (!clip.meta) clip.meta = {};
    clip.meta.notes = 0;
    clip.meta.pitchMin = null;
    clip.meta.pitchMax = null;
    clip.meta.spanBeat = spanBeat;
    if (oldMeta && oldMeta.agent) clip.meta.agent = oldMeta.agent;
    if (oldMeta && isFiniteNumber(oldMeta.sourceTempoBpm)) clip.meta.sourceTempoBpm = Number(oldMeta.sourceTempoBpm);
    else clip.meta.sourceTempoBpm = null;
    return clip;
  }

/* -------------------- T3-1 clip revisions (version chain) -------------------- */

// clip.revisions is a plain object map: { [revisionId]: snapshot }. NOT an Array.
// Ensures revisions[clip.revisionId] and revisions[clip.parentRevisionId] exist (no dangling refs).
const CLIP_REVISIONS_MAX = 40;

function _iso(ts){
  try{
    const d = new Date(ts);
    if (isFiniteNumber(ts) && !isNaN(d.getTime())) return d.toISOString().slice(0,19).replace('T',' ');
  }catch(e){}
  return '';
}

// Convert array to map; ensure no dangling revisionId/parentRevisionId; ensure head entry exists.
function normalizeClipRevisionChain(clip){
  if (!clip) return clip;
  let revMap = clip.revisions;
  if (Array.isArray(revMap)){
    const next = {};
    for (const r of revMap){
      if (!r || typeof r !== 'object') continue;
      const rid = String(r.revisionId || r.id || '');
      if (!rid) continue;
      next[rid] = {
        revisionId: rid,
        parentRevisionId: (r.parentRevisionId !== undefined && r.parentRevisionId !== null) ? String(r.parentRevisionId) : null,
        createdAt: isFiniteNumber(r.createdAt) ? Number(r.createdAt) : Date.now(),
        name: (typeof r.name === 'string') ? r.name : String(r.name ?? (clip.name || '')),
        score: ensureScoreBeatIds(r.score),
        meta: (r.meta && typeof r.meta === 'object') ? r.meta : null,
      };
    }
    revMap = next;
  }
  if (!revMap || typeof revMap !== 'object' || Array.isArray(revMap)) revMap = {};
  clip.revisions = revMap;

  if (!clip.revisionId || String(clip.revisionId).trim() === '') clip.revisionId = uid('rev_');
  const rid = String(clip.revisionId);
  if (clip.parentRevisionId === undefined) clip.parentRevisionId = null;
  clip.parentRevisionId = (clip.parentRevisionId !== null && clip.parentRevisionId !== '') ? String(clip.parentRevisionId) : null;

  if (!clip.revisions[rid]){
    clip.revisions[rid] = {
      revisionId: rid,
      parentRevisionId: clip.parentRevisionId,
      createdAt: isFiniteNumber(clip.updatedAt) ? Number(clip.updatedAt) : Date.now(),
      name: (typeof clip.name === 'string') ? clip.name : String(clip.name ?? ''),
      score: ensureScoreBeatIds(deepClone(clip.score || { version:2, tracks:[] })),
      meta: deepClone(clip.meta || {}),
    };
  }
  if (clip.parentRevisionId != null && clip.parentRevisionId !== '' && !clip.revisions[clip.parentRevisionId])
    clip.parentRevisionId = null;

  return clip;
}

function normalizeProjectRevisionChains(p2){
  if (!p2 || !p2.clips || typeof p2.clips !== 'object' || Array.isArray(p2.clips)) return;
  for (const cid of Object.keys(p2.clips)){
    const clip = p2.clips[cid];
    if (clip) normalizeClipRevisionChain(clip);
  }
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
  normalizeClipRevisionChain(clip);

  const revMap = clip.revisions;
  let out = Object.keys(revMap).map(k => revMap[k]).filter(r => r && r.revisionId);
  out = out.filter((r, i, a) => a.findIndex(x => String(x.revisionId) === String(r.revisionId)) === i);
  out.sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));

  if (out.length > CLIP_REVISIONS_MAX){
    let rootIdx = out.findIndex(r => r && r.parentRevisionId === null);
    if (rootIdx >= 0){
      const root = out[rootIdx];
      out.splice(rootIdx, 1);
      const keepN = Math.max(0, CLIP_REVISIONS_MAX - 1);
      out = keepN ? out.slice(Math.max(0, out.length - keepN)) : [];
      out.push(root);
      out.sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));
    } else {
      out = out.slice(out.length - CLIP_REVISIONS_MAX);
    }
  }

  clip.revisions = {};
  for (const r of out) clip.revisions[String(r.revisionId)] = r;

  if (!clip.revisionId) clip.revisionId = uid('rev_');
  if (clip.parentRevisionId === undefined) clip.parentRevisionId = null;
  clip.parentRevisionId = (clip.parentRevisionId !== null && clip.parentRevisionId !== '') ? String(clip.parentRevisionId) : null;
  if (clip.parentRevisionId != null && !clip.revisions[clip.parentRevisionId]) clip.parentRevisionId = null;

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
  const revList = (clip.revisions && typeof clip.revisions === 'object' && !Array.isArray(clip.revisions))
    ? Object.values(clip.revisions) : [];
  for (const r of revList) items.push({ ...r, kind: 'history' });

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

  const target = (clip.revisions && clip.revisions[rid]) ? clip.revisions[rid] : null;
  if (!target) return { ok:false, error:'revision_not_found' };

  const cur = snapshotClipHead(clip);
  if (cur) clip.revisions[String(cur.revisionId)] = cur;
  delete clip.revisions[rid];

  applySnapshotToClipHead(clip, target);
  ensureClipRevisionChain(clip);

  return { ok:true, changed:true };
}

// Start a new revision: snapshot current head into history, then update revisionId.
// REQUIRED: new parentRevisionId MUST equal the previous active revisionId (so Undo works).
// Callers may then mutate clip.score and clip.meta, and finally recompute meta.
function beginNewClipRevision(project, clipId, opts){
  const p = project;
  if (!p || !isProjectV2(p)) return { ok:false, error:'not_v2' };
  const cid = String(clipId || '');
  if (!cid) return { ok:false, error:'bad_args' };
  if (!p.clips || !p.clips[cid]) return { ok:false, error:'clip_not_found' };

  const clip = p.clips[cid];
  // Capture previous revisionId BEFORE any mutation (semantic requirement for Undo).
  const prevRevId = (clip.revisionId != null && String(clip.revisionId).trim() !== '') ? String(clip.revisionId) : '';

  normalizeClipRevisionChain(clip);
  ensureClipRevisionChain(clip);

  const snap = snapshotClipHead(clip);
  const newRevId = uid('rev_');
  if (snap){
    if (!clip.revisions) clip.revisions = {};
    clip.revisions[String(snap.revisionId)] = snap;
  }

  clip.parentRevisionId = (prevRevId !== '') ? prevRevId : null;
  clip.revisionId = newRevId;
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
      revisions: (opts && opts.revisions && typeof opts.revisions === 'object' && !Array.isArray(opts.revisions)) ? opts.revisions : {},
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

  /**
   * Native audio clip (ProjectDoc v2). No score; meta.spanBeat derived via recomputeClipMetaFromAudio.
   * @param {{ assetRef: string, durationSec: number, name?: string, id?: string, bpm?: number, createdAt?: number }} opts
   */
  function createClipFromAudio(opts){
    opts = opts || {};
    const assetRef = (typeof opts.assetRef === 'string') ? opts.assetRef : '';
    let dur = Number(opts.durationSec);
    if (!isFiniteNumber(dur) || dur <= 0) dur = 1e-6;
    const name = (opts.name != null && String(opts.name).trim()) ? String(opts.name).trim() : ('Audio ' + uid('').slice(0, 5));
    const clipId = (opts.id != null && String(opts.id).trim()) ? String(opts.id) : uid('clip_');
    const now = isFiniteNumber(opts.createdAt) ? Number(opts.createdAt) : Date.now();
    const bpmForMeta = isFiniteNumber(opts.bpm) ? Number(opts.bpm) : TIMEBASE.BPM_DEFAULT;
    const clip = {
      id: clipId,
      kind: 'audio',
      name,
      createdAt: now,
      updatedAt: isFiniteNumber(opts.updatedAt) ? Number(opts.updatedAt) : now,
      revisionId: (opts.revisionId != null && String(opts.revisionId).trim()) ? String(opts.revisionId) : uid('rev_'),
      parentRevisionId: (opts.parentRevisionId !== undefined && opts.parentRevisionId !== null) ? String(opts.parentRevisionId) : null,
      revisions: (opts.revisions && typeof opts.revisions === 'object' && !Array.isArray(opts.revisions)) ? opts.revisions : {},
      sourceTaskId: (opts.sourceTaskId !== undefined && opts.sourceTaskId !== null) ? String(opts.sourceTaskId) : null,
      audio: { assetRef, durationSec: dur },
      meta: {
        notes: 0,
        pitchMin: null,
        pitchMax: null,
        spanBeat: 0,
        sourceTempoBpm: isFiniteNumber(opts.sourceTempoBpm) ? Number(opts.sourceTempoBpm) : null,
      },
    };
    recomputeClipMetaFromAudio(clip, bpmForMeta);
    return clip;
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

      if (clipKind(clip) === 'audio'){
        clip.kind = 'audio';
        if (!clip.audio || typeof clip.audio !== 'object') clip.audio = {};
        clip.audio.assetRef = (typeof clip.audio.assetRef === 'string') ? clip.audio.assetRef : '';
        let dur = Number(clip.audio.durationSec);
        if (!isFiniteNumber(dur) || dur <= 0) dur = 1e-6;
        clip.audio.durationSec = dur;
        if ('score' in clip) delete clip.score;
        const srcTempo = clip.meta && isFiniteNumber(clip.meta.sourceTempoBpm) ? Number(clip.meta.sourceTempoBpm) : null;
        recomputeClipMetaFromAudio(clip, project.bpm);
        if (clip.meta) clip.meta.sourceTempoBpm = srcTempo;
      } else {
        clip.score = ensureScoreBeatIds(clip.score);
        const srcTempo = clip.meta && isFiniteNumber(clip.meta.sourceTempoBpm) ? Number(clip.meta.sourceTempoBpm) : null;
        recomputeClipMetaFromScoreBeat(clip);
        if (clip.meta) clip.meta.sourceTempoBpm = srcTempo;
      }

      normalizeClipRevisionChain(clip);
      ensureClipRevisionChain(clip);
      // remove v1 fields if they exist
      if (clip.meta && 'spanSec' in clip.meta) delete clip.meta.spanSec;
    }
    normalizeProjectRevisionChains(project);
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
    const out = { bpm, tracks: [], audioSegments: [] };
    if (!p || !isProjectV2(p)) return out;

    const drop = (opts && typeof opts.onDrop === 'function') ? opts.onDrop : null;

    // Prepare track buckets in project.tracks order.
    const trackBuckets = {};
    const trackOrder = Array.isArray(p.tracks) ? p.tracks.map(t => t.id) : [];
    for (const tid of trackOrder) trackBuckets[tid] = [];

    const audioSegments = [];

    for (const inst of (p.instances || [])){
      const clip = p.clips ? p.clips[inst.clipId] : null;
      if (!clip) continue;

      const trackId = inst.trackId;
      if (!trackBuckets[trackId]) trackBuckets[trackId] = [];

      if (clipKind(clip) === 'audio'){
        const spanBeat = (clip.meta && isFiniteNumber(clip.meta.spanBeat)) ? Number(clip.meta.spanBeat) : 0;
        if (!(spanBeat > 0)) continue;
        const instStartBeat = Number(inst.startBeat || 0);
        const startSec = beatToSec(instStartBeat, bpm);
        const durationSec = beatToSec(spanBeat, bpm);
        const assetRef = (clip.audio && typeof clip.audio.assetRef === 'string') ? clip.audio.assetRef : '';
        if (!isFinite(startSec) || !isFinite(durationSec) || !(durationSec > 0)) continue;
        audioSegments.push({
          trackId,
          startSec,
          durationSec,
          clipId: clip.id,
          instanceId: inst.id,
          assetRef,
        });
        continue;
      }

      if (!clip.score || !Array.isArray(clip.score.tracks)) continue;

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

    // PR-F1.1: Build mute map (tracks[i].muted); skip muted tracks in export.
    const mutedByTid = new Map();
    for (const t of (p.tracks || [])){
      if (!t) continue;
      const tid = t.trackId || t.id;
      if (tid != null) mutedByTid.set(tid, !!t.muted);
    }

    // Emit tracks in project order (skip muted tracks).
    for (const tid of trackOrder){
      if (mutedByTid.get(tid)) continue;
      const arr = trackBuckets[tid] || [];
      arr.sort(cmp);
      out.tracks.push({ trackId: tid, notes: arr });
    }

    // Emit any buckets not in project order (skip muted; shouldn't happen, but be safe).
    for (const tid of Object.keys(trackBuckets)){
      if (trackOrder.indexOf(tid) >= 0) continue;
      if (mutedByTid.get(tid)) continue;
      const arr = trackBuckets[tid] || [];
      arr.sort(cmp);
      out.tracks.push({ trackId: tid, notes: arr });
    }

    function cmpAudio(a, b){
      if (a.startSec !== b.startSec) return a.startSec - b.startSec;
      const ca = String(a.clipId || '');
      const cb = String(b.clipId || '');
      if (ca !== cb) return ca.localeCompare(cb);
      return String(a.instanceId || '').localeCompare(String(b.instanceId || ''));
    }

    out.audioSegments = audioSegments.filter(function(seg){
      return seg && seg.trackId != null && !mutedByTid.get(seg.trackId);
    }).sort(cmpAudio);

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
      if (c.kind === 'audio'){
        const a = (c.audio && typeof c.audio === 'object') ? c.audio : {};
        let dur = Number(a.durationSec);
        if (!isFiniteNumber(dur) || dur <= 0) dur = 1e-6;
        const clip2 = {
          id: String(c.id),
          kind: 'audio',
          name: (typeof c.name === 'string') ? c.name : String(c.name ?? ''),
          createdAt: isFiniteNumber(c.createdAt) ? Number(c.createdAt) : Date.now(),
          updatedAt: isFiniteNumber(c.updatedAt) ? Number(c.updatedAt) : (isFiniteNumber(c.createdAt) ? Number(c.createdAt) : Date.now()),
          sourceTaskId: (c.sourceTaskId !== undefined && c.sourceTaskId !== null) ? String(c.sourceTaskId) : null,
          audio: {
            assetRef: (typeof a.assetRef === 'string') ? a.assetRef : '',
            durationSec: dur,
          },
          meta: {
            notes: 0,
            pitchMin: null,
            pitchMax: null,
            spanBeat: 0,
            sourceTempoBpm: null,
          },
        };
        if (c.meta && c.meta.agent) clip2.meta.agent = c.meta.agent;
        if (c.revisionId != null && String(c.revisionId).trim()) clip2.revisionId = String(c.revisionId);
        if (c.parentRevisionId !== undefined) clip2.parentRevisionId = c.parentRevisionId;
        if (c.revisions && typeof c.revisions === 'object' && !Array.isArray(c.revisions)) clip2.revisions = deepClone(c.revisions);
        recomputeClipMetaFromAudio(clip2, bpm);
        clips[clip2.id] = clip2;
        clipOrder.push(clip2.id);
        continue;
      }
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
    resolveAudioConvertPlacementV1,

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
    clipKind,
    recomputeClipMetaFromAudio,
    createClipFromScoreBeat,
    createClipFromAudio,
    createInstanceV2,
    repairClipOrderV2,
    normalizeProjectV2,
    checkProjectV2Invariants,



    // clip revisions (T3-1)
    normalizeClipRevisionChain,
    normalizeProjectRevisionChains,
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

    // instrument descriptor (PR-INS1, INS2a, INS2c)
    normalizeInstrument,
    SAMPLER_PACKS,
    getSamplerBaseUrl,
    setSamplerBaseUrl,
    getResolvedSamplerBaseUrl,
    resolveSamplerUrlsForPack,
    resolveCustomSamplerUrls,
    resolveCustomOneshotUrl,
    probeSamplerAvailability,
  };
})();
