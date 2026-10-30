/* Worker-backed audio segment conversion client for Cloud-embedded Studio. */
(function () {
  'use strict';

  var FLAG = 'H2S_STUDIO_WORKER_CONVERSION_ENABLED';
  var POLL_MS = 2750;
  var MAX_WAIT_MS = 600000;
  var CREATE_UPLOAD_RPC_TIMEOUT_MS = 120000;
  var STATUS_RPC_TIMEOUT_MS = 45000;
  var RESULT_RPC_TIMEOUT_MS = 90000;
  var ALLOWED_HOSTS = {
    'https://hum2song.cn': true,
    'https://www.hum2song.cn': true,
    'https://hum2song.com': true,
    'https://www.hum2song.com': true,
    'http://localhost:3000': true,
    'http://127.0.0.1:3000': true,
    'http://localhost:3010': true,
    'http://127.0.0.1:3010': true,
    'http://localhost:3012': true,
    'http://127.0.0.1:3012': true,
  };

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function isEnabled() {
    try {
      if (window.location && window.location.search) {
        var params = new URLSearchParams(window.location.search);
        var q = params.get(FLAG) || params.get('workerConversion');
        if (q === '0' || q === 'false') return false;
        if (q === '1' || q === 'true') return true;
      }
      var g = window[FLAG];
      if (g === false || g === '0' || g === 0 || g === 'false') return false;
      if (g === true || g === '1' || g === 1 || g === 'true') return true;
      if (typeof localStorage !== 'undefined') {
        var v = localStorage.getItem(FLAG);
        if (v === '0' || v === 'false') return false;
        if (v === '1' || v === 'true') return true;
      }
    } catch (_e) {}
    return true;
  }

  function isCloudMode() {
    try {
      return window.H2S_CLOUD_MODE === true && window.parent && window.parent !== window;
    } catch (_e) {
      return false;
    }
  }

  function reqId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function diag(stage, data) {
    if (typeof console === 'undefined' || !console || typeof console.info !== 'function') return;
    var out = { stage: stage };
    var src = data && typeof data === 'object' ? data : {};
    ['durationMs', 'elapsedMs', 'timeoutMs', 'jobId', 'status', 'attempt'].forEach(function (k) {
      if (src[k] != null) out[k] = src[k];
    });
    console.info('[H2S worker_convert_diag]', out);
  }

  function requestHost(type, payload, transfer, opts) {
    return new Promise(function (resolve, reject) {
      if (!isCloudMode()) {
        reject(new Error('worker_unavailable'));
        return;
      }
      var id = reqId('audio-midi');
      var responseType = type + '_RESPONSE';
      var timeoutMs = opts && typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : STATUS_RPC_TIMEOUT_MS;
      var timeout = setTimeout(function () {
        window.removeEventListener('message', onMsg);
        var err = new Error('worker_timeout');
        err.h2sStage = opts && opts.stage ? String(opts.stage) : type;
        reject(err);
      }, timeoutMs);
      function onMsg(ev) {
        if (!ALLOWED_HOSTS[String(ev.origin || '')]) return;
        var data = ev && ev.data;
        if (!data || typeof data !== 'object') return;
        if (data.type !== responseType || data.requestId !== id) return;
        clearTimeout(timeout);
        window.removeEventListener('message', onMsg);
        if (data.ok === true) resolve(data);
        else reject(new Error(typeof data.error === 'string' ? data.error : 'worker_failed'));
      }
      window.addEventListener('message', onMsg);
      var msg = Object.assign({ type: type, requestId: id }, payload || {});
      try {
        if (transfer && transfer.length) window.parent.postMessage(msg, '*', transfer);
        else window.parent.postMessage(msg, '*');
      } catch (err) {
        clearTimeout(timeout);
        window.removeEventListener('message', onMsg);
        reject(err);
      }
    });
  }

  function encodeWav(buffer, startSec, durationSec) {
    if (!buffer) return null;
    var sampleRate = buffer.sampleRate || 44100;
    var startSample = Math.max(0, Math.floor(Number(startSec || 0) * sampleRate));
    var endSample = Math.min(buffer.length, Math.ceil((Number(startSec || 0) + Number(durationSec || 0)) * sampleRate));
    if (endSample <= startSample) return null;
    var channels = Math.max(1, buffer.numberOfChannels || 1);
    var frames = endSample - startSample;
    var bytesPerSample = 2;
    var blockAlign = channels * bytesPerSample;
    var dataSize = frames * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);
    function str(off, s) {
      for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    }
    str(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, dataSize, true);
    var off = 44;
    for (var f = 0; f < frames; f++) {
      for (var c = 0; c < channels; c++) {
        var channel = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        var sample = Math.max(-1, Math.min(1, channel[startSample + f] || 0));
        view.setInt16(off, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        off += 2;
      }
    }
    return ab;
  }

  async function compressAudioFileForUpload(file, options) {
    options = options || {};
    var CompressionStreamCtor = window.CompressionStream;
    if (typeof CompressionStreamCtor !== 'function') return null;
    var input = options.inputBuffer instanceof ArrayBuffer ? options.inputBuffer : await file.arrayBuffer();
    if (!(input instanceof ArrayBuffer) || !input.byteLength) return null;
    try {
      var source = new Blob([input]).stream();
      var compressed = await new Response(source.pipeThrough(new CompressionStreamCtor('gzip'))).arrayBuffer();
      if (!(compressed instanceof ArrayBuffer) || !compressed.byteLength) return null;
      return {
        audioBuffer: compressed,
        transportEncoding: 'gzip',
        originalBytes: input.byteLength,
      };
    } catch (_e) {
      return null;
    }
  }

  async function segmentToWavArrayBuffer(file, segment) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('worker_unavailable');
    var ac = new AC();
    try {
      var input = await file.arrayBuffer();
      var decoded = await ac.decodeAudioData(input.slice(0));
      var wav = encodeWav(decoded, segment.startSec, segment.durationSec);
      if (!wav) throw new Error('segment_extract_failed');
      return wav;
    } finally {
      try { await ac.close(); } catch (_e) {}
    }
  }

  function isWorkerTimeout(err) {
    return !!(err && err.message && String(err.message) === 'worker_timeout');
  }

  function emitStatus(options, status) {
    if (!options || typeof options.onStatus !== 'function') return;
    try { options.onStatus(status || {}); } catch (_e) {}
  }

  function normalizeTranscriptionControls(options) {
    options = options || {};
    var allowed = {
      auto: true,
      ai_full_mix: true,
      melody: true,
      chords: true,
      vocal_humming: true,
      piano_guitar: true,
      electronic_melody: true,
      pad_chords: true,
    };
    var target = String(options.transcriptionTarget || 'auto').trim().toLowerCase();
    if (!allowed[target]) target = 'auto';
    var strength = Number(options.cleanupStrength);
    if (!isFinite(strength)) strength = 50;
    strength = Math.max(0, Math.min(100, Math.round(strength)));
    return {
      transcriptionTarget: target,
      cleanupStrength: strength,
      preserveRawCandidates: options.preserveRawCandidates === true,
    };
  }

  async function fetchResult(jobId, finalAttempt) {
    var t0 = nowMs();
    diag(finalAttempt ? 'result_final_start' : 'result_start', { jobId: jobId, timeoutMs: RESULT_RPC_TIMEOUT_MS });
    var result = await requestHost('H2S_CLOUD_AUDIO_TO_MIDI_JOB_RESULT', { jobId: jobId }, null, {
      timeoutMs: RESULT_RPC_TIMEOUT_MS,
      stage: finalAttempt ? 'result_final' : 'result',
    });
    diag(finalAttempt ? 'result_final_end' : 'result_end', { jobId: jobId, durationMs: Math.round(nowMs() - t0) });
    if (!result.scoreDoc) throw new Error('score_fetch_failed');
    return result;
  }

  async function finalCheckAfterTimeout(jobId, reason) {
    if (!jobId) throw new Error(reason || 'worker_timeout');
    diag('final_check_start', { jobId: jobId });
    var st = null;
    try {
      st = await requestHost('H2S_CLOUD_AUDIO_TO_MIDI_JOB_STATUS', { jobId: jobId }, null, {
        timeoutMs: STATUS_RPC_TIMEOUT_MS,
        stage: 'status_final',
      });
    } catch (err) {
      diag('final_status_failed', { jobId: jobId });
      throw new Error(reason || 'worker_timeout');
    }
    var sj = st && st.job ? st.job : {};
    diag('final_status_end', { jobId: jobId, status: sj.status || '' });
    if (sj.status === 'succeeded') {
      return fetchResult(jobId, true);
    }
    if (sj.status === 'failed' || sj.status === 'cancelled') throw new Error('task_failed');
    throw new Error(reason || 'worker_timeout');
  }

  async function convert(options) {
    options = options || {};
    if (!isEnabled() || !isCloudMode()) return { ok: false, reason: 'worker_unavailable' };
    var file = options.file;
    var segment = options.segment;
    var controls = normalizeTranscriptionControls(options);
    if (!file || !segment) return { ok: false, reason: 'bad_args' };
    var encodeStart = nowMs();
    diag('encode_start', {
      durationMs: 0,
    });
    var audioBuffer = options.sourceStem ? null : await segmentToWavArrayBuffer(file, segment);
    diag('encode_end', { durationMs: Math.round(nowMs() - encodeStart) });
    var createStart = nowMs();
    diag('job_create_upload_start', { timeoutMs: CREATE_UPLOAD_RPC_TIMEOUT_MS });
    var created = options.sourceStem ? await requestHost('H2S_CLOUD_STEM_TRANSCRIPTION_CREATE', {
      jobId: options.sourceStem.jobId, stemId: options.sourceStem.stemId, retryOfJobId: options.sourceStem.retryOfJobId,
    }, null, { timeoutMs: CREATE_UPLOAD_RPC_TIMEOUT_MS, stage: 'stem_create' }) : await requestHost('H2S_CLOUD_AUDIO_TO_MIDI_JOB_CREATE', {
      filename: 'studio-selected-segment.wav',
      mimeType: 'audio/wav',
      segmentStartSec: Number(segment.startSec || 0),
      segmentDurationSec: Number(segment.durationSec || 0),
      transcriptionTarget: controls.transcriptionTarget,
      cleanupStrength: controls.cleanupStrength,
      preserveRawCandidates: controls.preserveRawCandidates,
      separationStem: options.separationStem || undefined,
      audioBuffer: audioBuffer,
    }, [audioBuffer], { timeoutMs: CREATE_UPLOAD_RPC_TIMEOUT_MS, stage: 'job_create_upload' });
    var job = created.job || {};
    var jobId = typeof job.id === 'string' ? job.id : '';
    if (!jobId) throw new Error('worker_failed');
    diag('job_create_upload_end', { jobId: jobId, status: job.status || '', durationMs: Math.round(nowMs() - createStart) });
    emitStatus(options, { phase: 'processing', jobId: jobId, status: job.status || 'queued' });
    var started = nowMs();
    try {
      var lastStatus = '';
      var pollCount = 0;
      for (;;) {
        var elapsed = nowMs() - started;
        if (elapsed > MAX_WAIT_MS) {
          var finalResult = await finalCheckAfterTimeout(jobId, 'worker_timeout');
          return { ok: true, workerJobId: jobId, scoreDoc: finalResult.scoreDoc };
        }
        pollCount += 1;
        if (pollCount === 1) diag('first_status_poll', { jobId: jobId, elapsedMs: Math.round(elapsed), timeoutMs: STATUS_RPC_TIMEOUT_MS });
        var st;
        try {
          st = await requestHost('H2S_CLOUD_AUDIO_TO_MIDI_JOB_STATUS', { jobId: jobId }, null, {
            timeoutMs: STATUS_RPC_TIMEOUT_MS,
            stage: 'status',
          });
        } catch (err) {
          if (isWorkerTimeout(err) && nowMs() - started <= MAX_WAIT_MS) {
            diag('status_rpc_timeout_keep_polling', { jobId: jobId, elapsedMs: Math.round(nowMs() - started), timeoutMs: STATUS_RPC_TIMEOUT_MS });
            await new Promise(function (r) { setTimeout(r, POLL_MS); });
            continue;
          }
          throw err;
        }
        var sj = st.job || {};
        if (sj.status && sj.status !== lastStatus) {
          lastStatus = sj.status;
          diag('status_transition', { jobId: jobId, status: sj.status, elapsedMs: Math.round(nowMs() - started), attempt: sj.attempt });
          emitStatus(options, { phase: 'processing', jobId: jobId, status: sj.status, attempt: sj.attempt });
        }
        if (sj.status === 'failed' || sj.status === 'cancelled') throw new Error('task_failed');
        if (sj.status === 'succeeded') break;
        await new Promise(function (r) { setTimeout(r, POLL_MS); });
      }
      var result;
      try {
        diag('materialization_start', { jobId: jobId });
        result = await fetchResult(jobId, false);
      } catch (err) {
        if (isWorkerTimeout(err)) {
          result = await finalCheckAfterTimeout(jobId, 'worker_timeout');
        } else {
          throw err;
        }
      }
      diag('materialization_end', { jobId: jobId, durationMs: Math.round(nowMs() - started) });
      return { ok: true, workerJobId: jobId, scoreDoc: result.scoreDoc };
    } catch (err) {
      if (err && err.message && String(err.message) === 'task_failed') throw err;
      try {
        var recovered = await finalCheckAfterTimeout(jobId, (err && err.message) ? String(err.message) : 'worker_failed');
        return { ok: true, workerJobId: jobId, scoreDoc: recovered.scoreDoc };
      } catch (_finalErr) {
        throw err;
      }
    }
  }

  var api = {
    isEnabled: isEnabled,
    isCloudMode: isCloudMode,
    convert: convert,
    _encodeWav: encodeWav,
    _compressAudioFileForUpload: compressAudioFileForUpload,
    _segmentToWavArrayBuffer: segmentToWavArrayBuffer,
    _requestHost: requestHost,
    _normalizeTranscriptionControls: normalizeTranscriptionControls,
    _timeouts: {
      createUploadMs: CREATE_UPLOAD_RPC_TIMEOUT_MS,
      statusMs: STATUS_RPC_TIMEOUT_MS,
      resultMs: RESULT_RPC_TIMEOUT_MS,
      maxWaitMs: MAX_WAIT_MS,
    },
  };

  if (typeof window !== 'undefined') {
    window.H2SAudioWorkerConversionClient = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
