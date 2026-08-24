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

  var AUDIO_DOWNLOAD_EXTENSION_RE = /\.(wav|mp3|m4a|mp4|aac|ogg|oga|flac|webm|opus)$/i;

  function _audioExtensionFromMime(mimeType){
    var mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
    if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave' || mime === 'audio/vnd.wave') return '.wav';
    if (mime === 'audio/mpeg' || mime === 'audio/mp3') return '.mp3';
    if (mime === 'audio/mp4' || mime === 'audio/m4a' || mime === 'audio/x-m4a') return '.m4a';
    if (mime === 'audio/aac') return '.aac';
    if (mime === 'audio/ogg' || mime === 'application/ogg') return '.ogg';
    if (mime === 'audio/flac' || mime === 'audio/x-flac') return '.flac';
    if (mime === 'audio/webm') return '.webm';
    if (mime === 'audio/opus') return '.opus';
    return '';
  }

  function _audioExtensionFromHeader(headBytes){
    var bytes = null;
    try{
      if (headBytes instanceof Uint8Array) bytes = headBytes;
      else if (headBytes instanceof ArrayBuffer) bytes = new Uint8Array(headBytes);
      else if (headBytes && headBytes.buffer instanceof ArrayBuffer) bytes = new Uint8Array(headBytes.buffer, headBytes.byteOffset || 0, headBytes.byteLength || 0);
    }catch(_bytesErr){}
    if (!bytes || !bytes.length) return '';
    var ascii = function(offset, text){
      if (bytes.length < offset + text.length) return false;
      for (var i = 0; i < text.length; i += 1){
        if (bytes[offset + i] !== text.charCodeAt(i)) return false;
      }
      return true;
    };
    if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return '.wav';
    if (ascii(0, 'ID3') || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return '.mp3';
    if (ascii(0, 'OggS')) return '.ogg';
    if (ascii(0, 'fLaC')) return '.flac';
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return '.webm';
    if (ascii(4, 'ftyp')) return '.m4a';
    return '';
  }

  function _safeDownloadBase(value){
    var base = String(value || '').split(/[\\/]/).pop().trim();
    base = base.replace(/\.[a-z0-9]+$/i, '');
    base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
    return base || 'audio';
  }

  /** Keep real audio names, but repair generic .bin names using MIME or file signatures. */
  function normalizeAudioDownloadFilename(filename, mimeType, headBytes, fallbackBase){
    var name = String(filename || '').split(/[\\/]/).pop().trim();
    if (AUDIO_DOWNLOAD_EXTENSION_RE.test(name)) return name;
    var ext = _audioExtensionFromMime(mimeType) || _audioExtensionFromHeader(headBytes) || '.wav';
    return _safeDownloadBase(fallbackBase || name || 'audio') + ext;
  }

  /** Name a single-clip download after the current clip while preserving the source audio format. */
  function audioDownloadFilenameForClip(clipName, sourceFilename, mimeType, headBytes){
    var sourceName = String(sourceFilename || '').split(/[\\/]/).pop().trim();
    var sourceExtMatch = sourceName.match(AUDIO_DOWNLOAD_EXTENSION_RE);
    var ext = sourceExtMatch
      ? sourceExtMatch[0].toLowerCase()
      : (_audioExtensionFromHeader(headBytes) || _audioExtensionFromMime(mimeType) || '.wav');
    var base = String(clipName || 'audio').split(/[\\/]/).pop().trim();
    base = base.replace(AUDIO_DOWNLOAD_EXTENSION_RE, '').replace(/\.bin$/i, '');
    base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
    return (base || 'audio') + ext;
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

  function _normalizeSourceMetadata(value){
    var raw = value && typeof value === 'object' ? value : {};
    var cloudSourceAssetId = typeof raw.cloudSourceAssetId === 'string' ? raw.cloudSourceAssetId.trim() : '';
    return cloudSourceAssetId ? { cloudSourceAssetId: cloudSourceAssetId } : null;
  }

  /**
   * Store a user-picked File/Blob and return a durable assetRef for ProjectDoc v2.
   * @returns {Promise<{ assetRef: string, id: string }>}
   */
  function storeImportedAudioFile(file, options){
    options = options || {};
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
      if (options.waveform) rec.waveform = options.waveform;
      var sourceMetadata = _normalizeSourceMetadata(options.sourceMetadata);
      if (sourceMetadata) rec.sourceMetadata = sourceMetadata;
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

  /**
   * Build a File from IndexedDB for re-upload (e.g. transcribe original audio clip).
   * @returns {Promise<File|null>}
   */
  function getFileForLocalAssetRef(assetRef){
    if (!isLocalImportedAudioRef(assetRef)){
      return Promise.resolve(null);
    }
    if (typeof indexedDB === 'undefined'){
      return Promise.resolve(null);
    }
    var id = localAssetIdFromRef(assetRef);
    if (!id) return Promise.resolve(null);
    if (typeof File === 'undefined'){
      return Promise.resolve(null);
    }
    return _getRecord(id).then(function(rec){
      if (!rec || !rec.buffer) return null;
      var mime = (rec.mimeType && String(rec.mimeType).trim()) ? String(rec.mimeType) : 'application/octet-stream';
      var base = (rec.name && String(rec.name).trim()) ? String(rec.name).trim() : 'audio';
      if (!/\.[a-z0-9]+$/i.test(base)){
        var ext = '.wav';
        if (mime.indexOf('webm') >= 0) ext = '.webm';
        else if (mime.indexOf('mpeg') >= 0 || mime.indexOf('mp3') >= 0) ext = '.mp3';
        else if (mime.indexOf('mp4') >= 0 || mime.indexOf('m4a') >= 0 || mime.indexOf('x-m4a') >= 0) ext = '.m4a';
        else if (mime.indexOf('ogg') >= 0) ext = '.ogg';
        else if (mime.indexOf('flac') >= 0) ext = '.flac';
        base = base + ext;
      }
      try{
        return new File([rec.buffer], base, { type: mime });
      } catch (e){
        console.warn('[H2SLocalAudioAssets] File construct failed', e);
        return null;
      }
    }).catch(function(e){
      console.warn('[H2SLocalAudioAssets] getFile failed', e);
      return null;
    });
  }

  /** Read the allowlisted Cloud source identity associated with a local playback copy. */
  function getSourceMetadataForLocalAssetRef(assetRef){
    if (!isLocalImportedAudioRef(assetRef) || typeof indexedDB === 'undefined'){
      return Promise.resolve(null);
    }
    var id = localAssetIdFromRef(assetRef);
    if (!id) return Promise.resolve(null);
    return _getRecord(id).then(function(rec){
      return rec ? _normalizeSourceMetadata(rec.sourceMetadata) : null;
    }).catch(function(e){
      console.warn('[H2SLocalAudioAssets] source metadata read failed', e);
      return null;
    });
  }

  /** Read cached, versioned waveform peak data for a local audio asset. */
  function getWaveformForLocalAssetRef(assetRef){
    if (!isLocalImportedAudioRef(assetRef) || typeof indexedDB === 'undefined'){
      return Promise.resolve(null);
    }
    var id = localAssetIdFromRef(assetRef);
    if (!id) return Promise.resolve(null);
    return _getRecord(id).then(function(rec){
      return rec && rec.waveform ? rec.waveform : null;
    }).catch(function(e){
      console.warn('[H2SLocalAudioAssets] waveform read failed', e);
      return null;
    });
  }

  /** Persist generated waveform peaks without changing the original audio bytes. */
  function putWaveformForLocalAssetRef(assetRef, waveform){
    if (!isLocalImportedAudioRef(assetRef) || !waveform || typeof indexedDB === 'undefined'){
      return Promise.resolve(false);
    }
    var id = localAssetIdFromRef(assetRef);
    if (!id) return Promise.resolve(false);
    return _getRecord(id).then(function(rec){
      if (!rec || !rec.buffer) return false;
      rec.waveform = waveform;
      rec.waveformUpdatedAt = Date.now();
      return _putRecord(rec).then(function(){ return true; });
    }).catch(function(e){
      console.warn('[H2SLocalAudioAssets] waveform write failed', e);
      return false;
    });
  }

  return {
    LOCAL_AUDIO_ASSET_PREFIX: LOCAL_AUDIO_ASSET_PREFIX,
    isLocalImportedAudioRef: isLocalImportedAudioRef,
    localAssetIdFromRef: localAssetIdFromRef,
    normalizeAudioDownloadFilename: normalizeAudioDownloadFilename,
    audioDownloadFilenameForClip: audioDownloadFilenameForClip,
    storeImportedAudioFile: storeImportedAudioFile,
    resolveAssetRefToPlaybackUrl: resolveAssetRefToPlaybackUrl,
    getFileForLocalAssetRef: getFileForLocalAssetRef,
    getSourceMetadataForLocalAssetRef: getSourceMetadataForLocalAssetRef,
    getWaveformForLocalAssetRef: getWaveformForLocalAssetRef,
    putWaveformForLocalAssetRef: putWaveformForLocalAssetRef,
  };
});
