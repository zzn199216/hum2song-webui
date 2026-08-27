/* Worker-backed Demucs separation client for Cloud-embedded Studio. */
(function () {
  'use strict';

  var POLL_MS = 3000;
  var MAX_WAIT_MS = 60 * 60 * 1000;
  var CREATE_TIMEOUT_MS = 10 * 60 * 1000;
  var STATUS_TIMEOUT_MS = 60000;
  var RESULT_TIMEOUT_MS = 120000;
  var ARTIFACT_TIMEOUT_MS = 10 * 60 * 1000;
  var MAX_DURATION_SEC = 600;
  var MODES = { separate_only: true, separate_and_transcribe: true };
  var PRESETS = {
    vocals_instrumental: true,
    four_stem: true,
    instruments_only: true,
    vocals_bass_drums: true,
  };
  var SEPARATOR_OPTIONS = { demucs: true, uvr5_ensemble_vocal_full: true };

  function baseClient() {
    return (typeof window !== 'undefined') ? window.H2SAudioWorkerConversionClient : null;
  }

  function isEnabled() {
    var base = baseClient();
    return !!(base && base.isEnabled && base.isEnabled() && base.isCloudMode && base.isCloudMode());
  }

  function emit(options, status) {
    if (options && typeof options.onStatus === 'function') {
      try { options.onStatus(status || {}); } catch (_e) {}
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function directUploadInfo(file) {
    if (!file || typeof file.arrayBuffer !== 'function') return null;
    var type = String(file.type || '').split(';')[0].trim().toLowerCase();
    var name = String(file.name || '').trim().toLowerCase();
    var byType = {
      'audio/wav': { mimeType: 'audio/wav', extension: 'wav' },
      'audio/x-wav': { mimeType: 'audio/wav', extension: 'wav' },
      'audio/mpeg': { mimeType: 'audio/mpeg', extension: 'mp3' },
      'audio/mp3': { mimeType: 'audio/mpeg', extension: 'mp3' },
      'audio/mp4': { mimeType: 'audio/mp4', extension: 'm4a' },
      'audio/m4a': { mimeType: 'audio/mp4', extension: 'm4a' },
      'audio/x-m4a': { mimeType: 'audio/mp4', extension: 'm4a' },
    };
    if (byType[type]) return byType[type];
    if (type && type !== 'application/octet-stream') return null;
    if (/\.mp3$/i.test(name)) return byType['audio/mpeg'];
    if (/\.m4a$/i.test(name)) return byType['audio/mp4'];
    if (/\.wav$/i.test(name) || /\.wave$/i.test(name)) return byType['audio/wav'];
    return null;
  }

  async function prepareUploadAudio(base, file, durationSec) {
    var direct = directUploadInfo(file);
    if (direct) {
      var originalBuffer = await file.arrayBuffer();
      if (originalBuffer instanceof ArrayBuffer && originalBuffer.byteLength > 0) {
        return {
          audioBuffer: originalBuffer,
          filename: 'studio-audio-clip.' + direct.extension,
          mimeType: direct.mimeType,
          sourceEncoding: 'original',
        };
      }
    }
    var wavBuffer = await base._segmentToWavArrayBuffer(file, { startSec: 0, durationSec: durationSec });
    return {
      audioBuffer: wavBuffer,
      filename: 'studio-audio-clip.wav',
      mimeType: 'audio/wav',
      sourceEncoding: 'wav_fallback',
    };
  }

  async function separate(options) {
    options = options || {};
    var base = baseClient();
    if (!isEnabled() || !base || typeof base._requestHost !== 'function' || typeof base._segmentToWavArrayBuffer !== 'function') {
      return { ok: false, reason: 'worker_unavailable' };
    }
    var file = options.file;
    var durationSec = Number(options.durationSec);
    var mode = String(options.mode || 'separate_only');
    var preset = String(options.separationPreset || 'four_stem');
    var separatorOption = String(options.separatorOption || 'demucs');
    if (!file || !isFinite(durationSec) || durationSec <= 0 || !MODES[mode] || !PRESETS[preset] || !SEPARATOR_OPTIONS[separatorOption]) {
      return { ok: false, reason: 'bad_args' };
    }
    if (separatorOption === 'uvr5_ensemble_vocal_full' && (mode !== 'separate_only' || preset !== 'vocals_instrumental')) {
      return { ok: false, reason: 'uvr5_separate_only' };
    }
    if (durationSec > MAX_DURATION_SEC + 0.001) return { ok: false, reason: 'audio_too_long' };

    emit(options, { phase: 'encoding' });
    var preparedUpload = await prepareUploadAudio(base, file, durationSec);
    var audioBuffer = preparedUpload.audioBuffer;
    emit(options, { phase: 'uploading' });
    var created = await base._requestHost('H2S_CLOUD_AUDIO_SEPARATION_JOB_CREATE', {
      filename: preparedUpload.filename,
      mimeType: preparedUpload.mimeType,
      mode: mode,
      separationPreset: preset,
      separatorOption: separatorOption,
      metadata: Object.assign({}, options.metadata || {}, { sourceEncoding: preparedUpload.sourceEncoding }),
      transcriptionTarget: options.transcriptionTarget || 'auto',
      cleanupStrength: options.cleanupStrength == null ? 50 : options.cleanupStrength,
      preserveRawCandidates: options.preserveRawCandidates === true,
      audioBuffer: audioBuffer,
    }, [audioBuffer], { timeoutMs: CREATE_TIMEOUT_MS, stage: 'separation_create' });
    var job = created && created.job ? created.job : {};
    var jobId = typeof job.id === 'string' ? job.id : '';
    if (!jobId) throw new Error('worker_failed');
    emit(options, { phase: 'processing', jobId: jobId, status: job.status || 'queued' });

    var started = Date.now();
    for (;;) {
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('worker_timeout');
      var response = await base._requestHost('H2S_CLOUD_AUDIO_SEPARATION_JOB_STATUS', { jobId: jobId }, null, {
        timeoutMs: STATUS_TIMEOUT_MS,
        stage: 'separation_status',
      });
      var statusJob = response && response.job ? response.job : {};
      emit(options, { phase: 'processing', jobId: jobId, status: statusJob.status || '' });
      if (statusJob.status === 'failed' || statusJob.status === 'cancelled') {
        var code = statusJob.error && statusJob.error.code ? String(statusJob.error.code) : 'task_failed';
        var message = statusJob.error && statusJob.error.message ? String(statusJob.error.message) : code;
        var failure = new Error(message);
        failure.code = code;
        failure.refunded = statusJob.type === 'audio_separation_uvr5';
        throw failure;
      }
      if (statusJob.status === 'succeeded') break;
      await delay(POLL_MS);
    }

    var result = await base._requestHost('H2S_CLOUD_AUDIO_SEPARATION_JOB_RESULT', { jobId: jobId }, null, {
      timeoutMs: RESULT_TIMEOUT_MS,
      stage: 'separation_result',
    });
    if (!result || !result.manifest || !Array.isArray(result.artifacts)) throw new Error('result_unavailable');
    return {
      ok: true,
      workerJobId: jobId,
      costUnits: created.costUnits || (mode === 'separate_and_transcribe' ? 2 : 1),
      manifest: result.manifest,
      artifacts: result.artifacts,
    };
  }

  async function downloadArtifact(jobId, artifactId) {
    var base = baseClient();
    if (!base || typeof base._requestHost !== 'function') throw new Error('worker_unavailable');
    var response = await base._requestHost('H2S_CLOUD_AUDIO_SEPARATION_ARTIFACT', {
      jobId: String(jobId || ''),
      artifactId: String(artifactId || ''),
    }, null, { timeoutMs: ARTIFACT_TIMEOUT_MS, stage: 'separation_artifact' });
    if (!(response.artifactBuffer instanceof ArrayBuffer)) throw new Error('result_unavailable');
    return {
      buffer: response.artifactBuffer,
      filename: response.filename || 'stem.bin',
      mimeType: response.mimeType || 'application/octet-stream',
    };
  }

  var api = {
    isEnabled: isEnabled,
    separate: separate,
    downloadArtifact: downloadArtifact,
    presets: Object.keys(PRESETS),
    separatorOptions: Object.keys(SEPARATOR_OPTIONS),
    modes: Object.keys(MODES),
    maxDurationSec: MAX_DURATION_SEC,
    _timeouts: {
      createMs: CREATE_TIMEOUT_MS,
      statusMs: STATUS_TIMEOUT_MS,
      resultMs: RESULT_TIMEOUT_MS,
      artifactMs: ARTIFACT_TIMEOUT_MS,
      maxWaitMs: MAX_WAIT_MS,
    },
  };
  if (typeof window !== 'undefined') window.H2SAudioWorkerSeparationClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
