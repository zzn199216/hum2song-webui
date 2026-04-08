/* Hum2Song Studio — Slice E: durable browser-local storage for imported audio clips.
 * - assetRef format: localidb:<id> where id is from H2SProject.uid('la_') when available.
 * - IndexedDB: hum2song_imported_audio_v1 / store "assets" keyPath id
 * - Playback: resolveAssetRefToPlaybackUrl -> blob: URL (revoke when audio controller disposes players)
 */
(function(root, factory){
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
  if (root){
    root.H2SLocalAudioAssets = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function(root){
  'use strict';

  var DB_NAME = 'hum2song_imported_audio_v1';
  var DB_VERSION = 1;
  var STORE = 'assets';

  /** @type {string} Stable prefix for ProjectDoc clip.audio.assetRef (IndexedDB-backed). */
  var LOCAL_AUDIO_ASSET_PREFIX = 'localidb:';

  function isLocalImportedAudioRef(ref){
    return typeof ref === 'string' && ref.indexOf(LOCAL_AUDIO_ASSET_PREFIX) === 0 && ref.length > LOCAL_AUDIO_ASSET_PREFIX.length;
  }

  function localAssetIdFromRef(ref){
    if (!isLocalImportedAudioRef(ref)) return null;
    return ref.slice(LOCAL_AUDIO_ASSET_PREFIX.length);
  }

  function _openDb(){
    if (typeof indexedDB === 'undefined'){
      return Promise.reject(new Error('indexedDB_unavailable'));
    }
    return new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e){
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)){
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error || new Error('idb_open_failed')); };
    });
  }

  function _putRecord(rec){
    return _openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error || new Error('idb_put_failed')); };
        tx.objectStore(STORE).put(rec);
      });
    });
  }

  function _getRecord(id){
    return _openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(String(id));
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ reject(req.error || new Error('idb_get_failed')); };
      });
    });
  }

  function _newAssetId(){
    var P = root.H2SProject;
    if (P && typeof P.uid === 'function') return P.uid('la_');
    return 'la_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Store a user-picked File/Blob and return a durable assetRef for ProjectDoc v2.
   * @returns {Promise<{ assetRef: string, id: string }>}
   */
  function storeImportedAudioFile(file){
    if (!file) return Promise.reject(new Error('no_file'));
    if (typeof indexedDB === 'undefined'){
      return Promise.reject(new Error('indexedDB_unavailable'));
    }
    var mime = (file.type && String(file.type).trim()) ? String(file.type) : 'application/octet-stream';
    var name = (file.name && String(file.name)) ? String(file.name) : 'audio';
    return Promise.resolve(file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer()).then(function(ab){
      var id = _newAssetId();
      var rec = {
        id: id,
        mimeType: mime,
        name: name,
        buffer: ab,
        createdAt: Date.now(),
      };
      return _putRecord(rec).then(function(){
        return { id: id, assetRef: LOCAL_AUDIO_ASSET_PREFIX + id };
      });
    }).catch(function(e){
      console.warn('[H2SLocalAudioAssets] store failed', e);
      return Promise.reject(e);
    });
  }

  /**
   * Resolve clip.audio.assetRef to something Tone.Player can load.
   * @returns {Promise<{ url: string, revoke: (function()|null) }|null>}
   *          null only when ref is localidb: but record is missing or IDB failed.
   */
  function resolveAssetRefToPlaybackUrl(assetRef){
    var s = String(assetRef || '').trim();
    if (!s) return Promise.resolve(null);
    if (!isLocalImportedAudioRef(s)){
      return Promise.resolve({ url: s, revoke: null });
    }
    if (typeof indexedDB === 'undefined'){
      return Promise.resolve(null);
    }
    var id = localAssetIdFromRef(s);
    if (!id) return Promise.resolve(null);
    return _getRecord(id).then(function(rec){
      if (!rec || !rec.buffer){
        return null;
      }
      var blob = new Blob([rec.buffer], { type: rec.mimeType || 'application/octet-stream' });
      var u = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
      if (!u) return null;
      return {
        url: u,
        revoke: function(){
          try{
            if (typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(u);
          } catch (e){}
        },
      };
    }).catch(function(e){
      console.warn('[H2SLocalAudioAssets] resolve failed', e);
      return null;
    });
  }

  return {
    LOCAL_AUDIO_ASSET_PREFIX: LOCAL_AUDIO_ASSET_PREFIX,
    isLocalImportedAudioRef: isLocalImportedAudioRef,
    localAssetIdFromRef: localAssetIdFromRef,
    storeImportedAudioFile: storeImportedAudioFile,
    resolveAssetRefToPlaybackUrl: resolveAssetRefToPlaybackUrl,
  };
});
