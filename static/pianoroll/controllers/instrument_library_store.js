/* Hum2Song Studio - Instrument Library Store (PR-INS2e)
   IndexedDB persistence for user-uploaded sampler samples.
   - DB: hum2song_studio_instrument_library
   - Store: sampler_samples
   - Key: packId:noteKey (e.g. "tonejs:piano:A1")
   - Value: { blob, filename, mime, updatedAt }
*/
(function(root){
  'use strict';

  const DB_NAME = 'hum2song_studio_instrument_library';
  const STORE_NAME = 'sampler_samples';
  const VALID_NOTE_KEYS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
  var _objectUrlsByPack = {};

  /** Parse note key from filename (A1.mp3, a2.wav -> A1, A2). Returns null if invalid. */
  function parseNoteKeyFromFilename(filename){
    if (!filename || typeof filename !== 'string') return null;
    var base = filename.replace(/\.[^/.]+$/, '').toUpperCase();
    return VALID_NOTE_KEYS.indexOf(base) >= 0 ? base : null;
  }

  function openDb(){
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise(function(resolve, reject){
      try{
        var req = indexedDB.open(DB_NAME, 1);
        req.onerror = function(){ reject(req.error); };
        req.onsuccess = function(){ resolve(req.result); };
        req.onupgradeneeded = function(ev){
          var db = ev.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)){
            db.createObjectStore(STORE_NAME);
          }
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

  var api = {
    parseNoteKeyFromFilename: parseNoteKeyFromFilename,
    VALID_NOTE_KEYS: VALID_NOTE_KEYS,
    putSample: putSample,
    getSample: getSample,
    listSamples: listSamples,
    clearPack: clearPack,
    registerObjectUrls: registerObjectUrls,
  };

  if (typeof module === 'object' && module.exports){
    module.exports = api;
  } else {
    root.H2SInstrumentLibraryStore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
