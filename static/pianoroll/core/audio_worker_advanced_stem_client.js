/* Cloud bridge client for the opt-in Kie/Suno advanced split_stem job. */
(function () {
  'use strict';
  var POLL_MS = 3000;
  var MAX_WAIT_MS = 60 * 60 * 1000;
  var CREATE_TIMEOUT_MS = 10 * 60 * 1000;
  var STATUS_TIMEOUT_MS = 60000;
  var RESULT_TIMEOUT_MS = 120000;
  var MAX_DURATION_SEC = 600;

  function baseClient() { return (typeof window !== 'undefined') ? window.H2SAudioWorkerConversionClient : null; }
  function isEnabled() {
    var base = baseClient();
    return !!(base && base.isEnabled && base.isEnabled() && base.isCloudMode && base.isCloudMode());
  }
  function emit(options, status) { if (options && typeof options.onStatus === 'function') { try { options.onStatus(status || {}); } catch (_e) {} } }
  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function checkAvailability() {
    var base = baseClient();
    if (!isEnabled() || !base || typeof base._requestHost !== 'function') return { ok: false, reason: 'worker_unavailable' };
    return base._requestHost('H2S_CLOUD_ADVANCED_STEM_AVAILABILITY', {}, null, { timeoutMs: STATUS_TIMEOUT_MS, stage: 'advanced_stem_availability' });
  }

  async function separate(options) {
    options = options || {};
    var base = baseClient();
    if (!isEnabled() || !base || typeof base._requestHost !== 'function' || typeof base._segmentToWavArrayBuffer !== 'function') return { ok: false, reason: 'worker_unavailable' };
    var file = options.file;
    var durationSec = Number(options.durationSec);
    if (!file || !isFinite(durationSec) || durationSec <= 0 || durationSec > MAX_DURATION_SEC + 0.001) return { ok: false, reason: 'bad_args' };
    emit(options, { phase: 'encoding' });
    var audioBuffer = await base._segmentToWavArrayBuffer(file, { startSec: Math.max(0, Number(options.startSec) || 0), durationSec: durationSec });
    emit(options, { phase: 'uploading' });
    var created = await base._requestHost('H2S_CLOUD_ADVANCED_STEM_JOB_CREATE', {
      filename: 'studio-advanced-stem.wav',
      mimeType: 'audio/wav',
      metadata: options.metadata || {},
      audioBuffer: audioBuffer,
    }, [audioBuffer], { timeoutMs: CREATE_TIMEOUT_MS, stage: 'advanced_stem_create' });
    var job = created && created.job ? created.job : {};
    var jobId = typeof job.id === 'string' ? job.id : '';
    if (!jobId) throw new Error('worker_failed');
    emit(options, { phase: 'processing', jobId: jobId, status: job.status || 'queued' });
    var started = Date.now();
    for (;;) {
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('worker_timeout');
      var response = await base._requestHost('H2S_CLOUD_AUDIO_SEPARATION_JOB_STATUS', { jobId: jobId }, null, { timeoutMs: STATUS_TIMEOUT_MS, stage: 'advanced_stem_status' });
      var statusJob = response && response.job ? response.job : {};
      emit(options, { phase: 'processing', jobId: jobId, status: statusJob.status || '' });
      if (statusJob.status === 'failed' || statusJob.status === 'cancelled') throw new Error(statusJob.error && statusJob.error.message ? String(statusJob.error.message) : 'task_failed');
      if (statusJob.status === 'succeeded') break;
      await delay(POLL_MS);
    }
    var result = await base._requestHost('H2S_CLOUD_AUDIO_SEPARATION_JOB_RESULT', { jobId: jobId }, null, { timeoutMs: RESULT_TIMEOUT_MS, stage: 'advanced_stem_result' });
    if (!result || !result.manifest || !Array.isArray(result.artifacts)) throw new Error('result_unavailable');
    return { ok: true, workerJobId: jobId, costUnits: created.costUnits || 30, reused: created.reused === true, manifest: result.manifest, artifacts: result.artifacts };
  }

  async function downloadArtifact(jobId, artifactId) {
    var base = baseClient();
    if (!base || typeof base._requestHost !== 'function') throw new Error('worker_unavailable');
    var response = await base._requestHost('H2S_CLOUD_AUDIO_SEPARATION_ARTIFACT', { jobId: String(jobId || ''), artifactId: String(artifactId || '') }, null, { timeoutMs: 10 * 60 * 1000, stage: 'advanced_stem_artifact' });
    if (!(response.artifactBuffer instanceof ArrayBuffer)) throw new Error('result_unavailable');
    return { buffer: response.artifactBuffer, filename: response.filename || 'stem.mp3', mimeType: response.mimeType || 'audio/mpeg' };
  }

  var api = { isEnabled: isEnabled, checkAvailability: checkAvailability, separate: separate, downloadArtifact: downloadArtifact, maxDurationSec: MAX_DURATION_SEC };
  if (typeof window !== 'undefined') window.H2SAudioWorkerAdvancedStemClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
