/* Hum2Song Studio - Instrument Library Store (PR-INS2e, PR-INS2e.2)
   IndexedDB persistence for user-uploaded sampler samples + custom instruments registry.
   - DB: hum2song_studio_instrument_library
   - Store: sampler_samples (packId:noteKey -> { blob, filename, mime, updatedAt })
   - Store: custom_instruments (PR-INS2e.2) packId -> { packId, displayName, kind, createdAt, updatedAt }
*/
(function(root){
  'use strict';

  const DB_NAME = 'hum2song_studio_instrument_library';
  const DB_VERSION = 2;
  const STORE_NAME = 'sampler_samples';
  const CUSTOM_INSTRUMENTS_STORE = 'custom_instruments';
  const CUSTOM_PREFIX = '\u81ea\u5b9a\u4e49\uff1a'; // 自定义：
  const VALID_NOTE_KEYS_LEGACY = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
  var _objectUrlsByPack = {};

  /** PR-INS2g: Parse scientific pitch note key from filename.
   *  Accepts: A1..A6 (legacy), C3, Ds4, F#2, Bb3, Cs5, Gs2 (s=sharp, b=flat, #=sharp).
   *  Returns canonical key (e.g. Ds4 -> D#4 for Tone) or null if invalid. */
  function parseNoteKeyFromFilename(filename){
    if (!filename || typeof filename !== 'string') return null;
    var base = filename.replace(/\.[^/.]+$/, '').trim();
    if (!base) return null;

    var m = base.match(/^([A-Ga-g])([#bs]?)(-?\d+)$/);
    if (!m) {
      var up = base.toUpperCase();
      return VALID_NOTE_KEYS_LEGACY.indexOf(up) >= 0 ? up : null;
    }
    var note = m[1].toUpperCase();
    var acc = (m[2] || '').toLowerCase();
    var oct = m[3];
    var accidental = '';
    if (acc === '#' || acc === 's') accidental = '#';
    else if (acc === 'b') accidental = 'b';
    return note + accidental + oct;
  }

  var VALID_NOTE_KEYS = VALID_NOTE_KEYS_LEGACY;

  /** PR-INS2f: Parse packId + noteKey from webkitRelativePath (e.g. "piano/A1.mp3").
   *  subdirToPackId: { 'piano': 'tonejs:piano', 'strings': 'tonejs:strings', ... }
   *  Returns { packId, noteKey } or null if unknown subdir or invalid filename. */
  function parsePackAndNoteFromRelativePath(relativePath, subdirToPackId){
    if (!relativePath || typeof relativePath !== 'string' || !subdirToPackId || typeof subdirToPackId !== 'object') return null;
    var parts = relativePath.replace(/\\/g, '/').split('/');
    var subdir = (parts[0] || '').toLowerCase();
    var basename = parts[parts.length - 1] || '';
    var packId = subdirToPackId[subdir];
    if (!packId) return null;
    var noteKey = parseNoteKeyFromFilename(basename);
    return noteKey ? { packId: packId, noteKey: noteKey } : null;
  }

  function openDb(){
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise(function(resolve, reject){
      try{
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = function(){ reject(req.error); };
        req.onsuccess = function(){ resolve(req.result); };
        req.onupgradeneeded = function(ev){
          var db = ev.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
          if (!db.objectStoreNames.contains(CUSTOM_INSTRUMENTS_STORE)) db.createObjectStore(CUSTOM_INSTRUMENTS_STORE);
        };
      }catch(e){ resolve(null); }
    });
  }

  function putSample(packId, noteKey, blob, filename){
    if (!packId || !noteKey || !blob) return Promise.resolve();
    return openDb().then(function(db){
      if (!db) return;
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var key = packId + ':' + noteKey;
        var val = { blob: blob, filename: filename || noteKey + '.mp3', mime: blob.type || 'audio/mpeg', updatedAt: Date.now() };
        var req = store.put(val, key);
        req.onsuccess = function(){ resolve(); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }

  function getSample(packId, noteKey){
    if (!packId || !noteKey) return Promise.resolve(null);
    return openDb().then(function(db){
      if (!db) return null;
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var key = packId + ':' + noteKey;
        var req = store.get(key);
        req.onsuccess = function(){
          var row = req.result;
          resolve(row && row.blob ? row.blob : null);
        };
        req.onerror = function(){ resolve(null); };
      });
    });
  }

  function listSamples(packId){
    if (!packId) return Promise.resolve([]);
    return openDb().then(function(db){
      if (!db) return [];
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var prefix = packId + ':';
        var req = store.openCursor();
        var keys = [];
        req.onsuccess = function(){
          var cur = req.result;
          if (!cur){ resolve(keys); return; }
          if (String(cur.key).indexOf(prefix) === 0){
            var k = String(cur.key).split(':')[1];
            if (k) keys.push(k);
          }
          cur.continue();
        };
        req.onerror = function(){ resolve([]); };
      });
    });
  }

  function clearPack(packId){
    if (!packId) return Promise.resolve();
    if (_objectUrlsByPack[packId]){
      for (var i = 0; i < _objectUrlsByPack[packId].length; i++){
        try{ URL.revokeObjectURL(_objectUrlsByPack[packId][i]); }catch(e){}
      }
      _objectUrlsByPack[packId] = [];
    }
    return openDb().then(function(db){
      if (!db) return;
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var prefix = packId + ':';
        var range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
        var req = store.delete(range);
        req.onsuccess = function(){ resolve(); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }

  function registerObjectUrls(packId, urls){
    if (!packId || !Array.isArray(urls)) return;
    if (!_objectUrlsByPack[packId]) _objectUrlsByPack[packId] = [];
    for (var i = 0; i < urls.length; i++){
      if (urls[i]) _objectUrlsByPack[packId].push(urls[i]);
    }
  }

  /** PR-INS2e.2: Create custom instrument. Returns { packId, displayName }. Collision: suffix " (2)", " (3)"... */
  function createCustomInstrument(displayNameBase, kind){
    var base = (displayNameBase && String(displayNameBase).trim()) ? String(displayNameBase).trim() : 'Imported';
    var safe = base.replace(/[\s\u200b-\u200f\ufffe\uffff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64) || 'Imported';
    var packId = 'user:' + safe.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32) + '_' + Date.now().toString(36);
    return openDb().then(function(db){
      if (!db) return Promise.reject(new Error('IndexedDB unavailable'));
      return listCustomInstruments().then(function(existing){
        var displayName = CUSTOM_PREFIX + safe;
        var n = 1;
        while (existing.some(function(e){ return e.displayName === displayName; })){
          n++;
          displayName = CUSTOM_PREFIX + safe + ' (' + n + ')';
        }
        var rec = { packId: packId, displayName: displayName, kind: (kind === 'oneshot') ? 'oneshot' : 'sampler', createdAt: Date.now(), updatedAt: Date.now() };
        return new Promise(function(resolve, reject){
          var tx = db.transaction(CUSTOM_INSTRUMENTS_STORE, 'readwrite');
          var store = tx.objectStore(CUSTOM_INSTRUMENTS_STORE);
          var req = store.put(rec, packId);
          req.onsuccess = function(){ resolve({ packId: packId, displayName: displayName }); };
          req.onerror = function(){ reject(req.error); };
        });
      });
    });
  }

  /** PR-INS2e.2: List custom instruments. */
  function listCustomInstruments(){
    return openDb().then(function(db){
      if (!db) return [];
      return new Promise(function(resolve, reject){
        var tx = db.transaction(CUSTOM_INSTRUMENTS_STORE, 'readonly');
        var store = tx.objectStore(CUSTOM_INSTRUMENTS_STORE);
        var req = store.getAll();
        req.onsuccess = function(){ resolve(req.result || []); };
        req.onerror = function(){ resolve([]); };
      });
    });
  }

  /** PR-INS2e.2: Delete custom instrument (registry + samples). */
  function deleteCustomInstrument(packId){
    if (!packId) return Promise.resolve();
    return clearPack(packId).then(function(){
      return openDb().then(function(db){
        if (!db) return;
        return new Promise(function(resolve, reject){
          var tx = db.transaction(CUSTOM_INSTRUMENTS_STORE, 'readwrite');
          var store = tx.objectStore(CUSTOM_INSTRUMENTS_STORE);
          var req = store.delete(packId);
          req.onsuccess = function(){ resolve(); };
          req.onerror = function(){ resolve(); };
        });
      });
    });
  }

  var api = {
    parseNoteKeyFromFilename: parseNoteKeyFromFilename,
    parsePackAndNoteFromRelativePath: parsePackAndNoteFromRelativePath,
    VALID_NOTE_KEYS: VALID_NOTE_KEYS,
    putSample: putSample,
    getSample: getSample,
    listSamples: listSamples,
    clearPack: clearPack,
    registerObjectUrls: registerObjectUrls,
    createCustomInstrument: createCustomInstrument,
    listCustomInstruments: listCustomInstruments,
    deleteCustomInstrument: deleteCustomInstrument,
    CUSTOM_PREFIX: CUSTOM_PREFIX,
  };

  if (typeof module === 'object' && module.exports){
    module.exports = api;
  } else {
    root.H2SInstrumentLibraryStore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
