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

  async function prepareSource(options) {
    options = options || {};
    var base = baseClient();
    if (!isEnabled() || !base || typeof base._requestHost !== 'function') return { ok: false, reason: 'worker_unavailable' };
    var audioBuffer = options.audioBuffer instanceof ArrayBuffer ? options.audioBuffer : null;
    var sourceKey = String(options.sourceKey || '').trim();
    var durationSec = Number(options.sourceDurationSec);
    if (!audioBuffer || !sourceKey || !isFinite(durationSec) || durationSec <= 0 || durationSec > MAX_DURATION_SEC + 0.001) {
      return { ok: false, reason: 'bad_args' };
    }
    var prepared = await base._requestHost('H2S_CLOUD_ADVANCED_STEM_SOURCE_PREPARE', {
      filename: options.filename || 'advanced-source.wav',
      mimeType: options.mimeType || 'audio/wav',
      sourceKey: sourceKey,
      sourceDurationSec: durationSec,
      sourceMetadata: options.sourceMetadata || {},
      audioBuffer: audioBuffer,
    }, [audioBuffer], { timeoutMs: CREATE_TIMEOUT_MS, stage: 'advanced_stem_source_prepare' });
    var sourceAssetId = prepared && typeof prepared.sourceAssetId === 'string' ? prepared.sourceAssetId.trim() : '';
    if (!sourceAssetId) throw new Error('source_prepare_failed');
    return {
      ok: true,
      sourceAssetId: sourceAssetId,
      sourceDurationSec: Number(prepared.sourceDurationSec) > 0 ? Number(prepared.sourceDurationSec) : durationSec,
      reused: prepared.reused === true,
    };
  }

  async function separate(options) {
    options = options || {};
    var base = baseClient();
    if (!isEnabled() || !base || typeof base._requestHost !== 'function') return { ok: false, reason: 'worker_unavailable' };
    var sourceAssetId = String(options.sourceAssetId || '').trim();
    var durationSec = Number(options.durationSec);
    if (!sourceAssetId || !isFinite(durationSec) || durationSec <= 0 || durationSec > MAX_DURATION_SEC + 0.001) return { ok: false, reason: 'bad_args' };
    emit(options, { phase: 'preparing' });
    var created = await base._requestHost('H2S_CLOUD_ADVANCED_STEM_JOB_CREATE', {
      sourceAssetId: sourceAssetId,
      sourceRange: { startSec: Math.max(0, Number(options.startSec) || 0), durationSec: durationSec },
      sourceDurationSec: Number(options.sourceDurationSec) > 0 ? Number(options.sourceDurationSec) : durationSec,
      metadata: options.metadata || {},
    }, null, { timeoutMs: CREATE_TIMEOUT_MS, stage: 'advanced_stem_create' });
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

  var api = { isEnabled: isEnabled, checkAvailability: checkAvailability, prepareSource: prepareSource, separate: separate, downloadArtifact: downloadArtifact, maxDurationSec: MAX_DURATION_SEC };
  if (typeof window !== 'undefined') window.H2SAudioWorkerAdvancedStemClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
