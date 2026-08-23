const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const client = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'core', 'audio_worker_analysis_client.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'controllers', 'audio_analysis_controller.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'index.html'), 'utf8');

assert(client.includes('H2S_CLOUD_AUDIO_ANALYSIS_JOB_CREATE'), 'analysis client should create a cloud job');
assert(client.includes('H2S_CLOUD_AUDIO_ANALYSIS_JOB_STATUS'), 'analysis client should poll status');
assert(client.includes('H2S_CLOUD_AUDIO_ANALYSIS_JOB_RESULT'), 'analysis client should fetch the result');
assert(client.includes('audioBuffer: bytes'), 'analysis client should transfer the source bytes to the host');
assert(controller.includes('workerAnalyzer') && controller.includes('worker_result_unavailable'), 'controller should prefer the cloud worker in cloud mode');
assert(index.includes('core/audio_worker_analysis_client.js?v=audio-analysis-worker-v1'), 'index should load the worker analysis bridge');

console.log('audio_worker_analysis_client.test.js: all passed');
