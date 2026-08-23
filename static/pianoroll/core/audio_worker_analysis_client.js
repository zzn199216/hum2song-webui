/* Cloud Worker client for the on-demand AudioAnalysis panel. */
(function (root) {
  'use strict';
  var POLL_MS = 2750;
  var MAX_WAIT_MS = 20 * 60 * 1000;
  var RPC_TIMEOUT_MS = 120000;
  var HOSTS = {
    'https://hum2song.cn': true, 'https://www.hum2song.cn': true,
    'https://hum2song.com': true, 'https://www.hum2song.com': true,
    'http://localhost:3000': true, 'http://127.0.0.1:3000': true,
    'http://localhost:3010': true, 'http://127.0.0.1:3010': true,
    'http://localhost:3012': true, 'http://127.0.0.1:3012': true,
  };

  function cloudMode() { return root.H2S_CLOUD_MODE === true && root.parent && root.parent !== root; }
  function requestId() { return 'audio-analysis-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9); }
  function requestHost(type, payload, transfer, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!cloudMode()) { reject(new Error('worker_unavailable')); return; }
      var id = requestId();
      var timer = setTimeout(function () { root.removeEventListener('message', onMessage); reject(new Error('worker_timeout')); }, timeoutMs || RPC_TIMEOUT_MS);
      function onMessage(event) {
        if (!HOSTS[String(event.origin || '')]) return;
        var data = event.data || {};
        if (data.type !== type + '_RESPONSE' || data.requestId !== id) return;
        clearTimeout(timer); root.removeEventListener('message', onMessage);
        if (data.ok === true) resolve(data); else reject(new Error(String(data.error || 'worker_failed')));
      }
      root.addEventListener('message', onMessage);
      var message = Object.assign({ type: type, requestId: id }, payload || {});
      try { root.parent.postMessage(message, '*', transfer || []); } catch (error) {
        clearTimeout(timer); root.removeEventListener('message', onMessage); reject(error);
      }
    });
  }

  async function analyze(options) {
    options = options || {};
    var file = options.file;
    if (!file || typeof file.arrayBuffer !== 'function' || !cloudMode()) return { ok: false, reason: 'worker_unavailable' };
    var bytes = await file.arrayBuffer();
    var created = await requestHost('H2S_CLOUD_AUDIO_ANALYSIS_JOB_CREATE', {
      filename: file.name || 'studio-audio.wav',
      mimeType: file.type || 'audio/wav',
      audioBuffer: bytes,
    }, [bytes]);
    var jobId = created.job && typeof created.job.id === 'string' ? created.job.id : '';
    if (!jobId) throw new Error('worker_failed');
    if (typeof options.onStatus === 'function') options.onStatus({ status: 'queued', jobId: jobId });
    var started = Date.now();
    for (;;) {
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('worker_timeout');
      var status = await requestHost('H2S_CLOUD_AUDIO_ANALYSIS_JOB_STATUS', { jobId: jobId });
      var job = status.job || {};
      if (typeof options.onStatus === 'function') options.onStatus({ status: job.status, jobId: jobId, attempt: job.attempt });
      if (job.status === 'failed' || job.status === 'cancelled') throw new Error('task_failed');
      if (job.status === 'succeeded') break;
      await new Promise(function (resolve) { setTimeout(resolve, POLL_MS); });
    }
    var result = await requestHost('H2S_CLOUD_AUDIO_ANALYSIS_JOB_RESULT', { jobId: jobId });
    if (!result.analysis || typeof result.analysis !== 'object') throw new Error('result_unavailable');
    return { ok: true, workerJobId: jobId, result: result.analysis };
  }

  var api = { analyze: analyze, isCloudMode: cloudMode, _requestHost: requestHost, _timeouts: { rpcMs: RPC_TIMEOUT_MS, maxWaitMs: MAX_WAIT_MS } };
  root.H2SAudioWorkerAnalysisClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
