#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');

(function testWorkerConversionClientSource(){
  const clientSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'core', 'audio_worker_conversion_client.js'), 'utf8');
  assert(clientSrc.includes('H2S_STUDIO_WORKER_CONVERSION_ENABLED'), 'feature flag is checked');
  assert(clientSrc.includes("params.get('workerConversion')"), 'worker conversion can be enabled by iframe query param');
  assert(clientSrc.includes('return true;'), 'worker conversion defaults on when no override is set');
  assert(clientSrc.includes("if (v === '1' || v === 'true') return true"), 'localStorage enable override is explicit');
  assert(clientSrc.includes("q === '0' || q === 'false'"), 'worker conversion can be explicitly disabled');
  assert(clientSrc.includes('H2S_CLOUD_AUDIO_TO_MIDI_JOB_CREATE'), 'create bridge request');
  assert(clientSrc.includes('H2S_CLOUD_AUDIO_TO_MIDI_JOB_STATUS'), 'status bridge request');
  assert(clientSrc.includes('H2S_CLOUD_AUDIO_TO_MIDI_JOB_RESULT'), 'result bridge request');
  assert(clientSrc.includes("'https://hum2song.com': true"), 'global Cloud parent responses are accepted');
  assert(clientSrc.includes("'https://www.hum2song.com': true"), 'www global Cloud parent responses are accepted');
  assert(clientSrc.includes('CREATE_UPLOAD_RPC_TIMEOUT_MS = 120000'), 'create/upload RPC timeout should exceed old 30s bridge limit');
  assert(clientSrc.includes('STATUS_RPC_TIMEOUT_MS = 45000'), 'status RPC has its own timeout budget');
  assert(clientSrc.includes('RESULT_RPC_TIMEOUT_MS = 90000'), 'result/materialization RPC has its own timeout budget');
  assert(clientSrc.includes('requestHost(type, payload, transfer, opts)'), 'requestHost accepts stage-specific timeout options');
  assert(clientSrc.includes('finalCheckAfterTimeout'), 'timeout path performs final status/result check when jobId exists');
  assert(clientSrc.includes('status_rpc_timeout_keep_polling'), 'status RPC timeout keeps polling while max wait remains');
  assert(clientSrc.includes('emitStatus(options'), 'client emits safe status updates while polling');
  assert(clientSrc.includes('worker_convert_diag'), 'safe conversion diagnostics are emitted');
  assert(clientSrc.includes('materialization_start'), 'materialization start diagnostic is emitted');
  assert(clientSrc.includes('materialization_end'), 'materialization end diagnostic is emitted');
  assert(clientSrc.includes('postMessage'), 'uses postMessage bridge');
  assert(!/Bearer|Authorization|accessToken|token/i.test(clientSrc), 'client must not mention raw auth tokens');
  console.log('PASS worker conversion client source');
})();

(function testAppWorkerFallbackWiring(){
  const appSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'app.js'), 'utf8');
  assert(appSrc.includes('_tryWorkerConvertAudioClipToEditable'), 'app has worker conversion attempt');
  assert(appSrc.includes('worker_unavailable'), 'app tracks worker unavailable fallback');
  assert(/await this\._tryWorkerConvertAudioClipToEditable\(\s*clipId,\s*file,\s*seg,/.test(appSrc), 'convert tries worker before local upload');
  assert(/await this\.uploadFileAndGenerate\(file, uploadOpts\)/.test(appSrc), 'local fallback path remains');
  assert(appSrc.includes('workerJobId'), 'worker job id is preserved in status/meta');
  assert(appSrc.includes('onStatus: (status)'), 'app updates UI state while worker job is queued/running');
  assert(appSrc.includes("return { ok: false, reason: 'auth_required' }"), 'anonymous Cloud conversion is rejected before server work');
  console.log('PASS app worker conversion fallback wiring');
})();

(function testIndexLoadsWorkerClientBeforeApp(){
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'index.html'), 'utf8');
  assert(indexHtml.includes('core/audio_worker_conversion_client.js'), 'index loads worker conversion client');
  assert(indexHtml.includes('audio-analysis-v0'), 'index cache-busts the current Studio release');
  assert(indexHtml.indexOf('core/audio_worker_conversion_client.js') < indexHtml.indexOf('app.js?v='), 'worker client loads before app');
  console.log('PASS index worker conversion client load order');
})();
