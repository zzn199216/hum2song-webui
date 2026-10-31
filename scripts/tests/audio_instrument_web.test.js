const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const worker = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'core', 'audio_instrument_worker.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'core', 'audio_instrument_client.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'controllers', 'audio_analysis_controller.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.py'), 'utf8');

assert(worker.includes("importScripts(new URL('../vendor/onnxruntime-web/ort.wasm.min.js?v=ort-web-118'"), 'worker should load the WASM-only ORT build locally');
assert(worker.includes('Math.exp(-logit)'), 'worker should convert independent AudioSet logits to probabilities');
assert(worker.includes("executionProviders: ['wasm']"), 'worker should use the WASM execution provider');
assert(worker.includes("new URL('../vendor/yamnet-v1/yamnet.onnx?v=yamnet-inline-v1'"), 'worker should use the pinned YAMNet model');
assert(worker.includes('PATCH_FRAMES = 96') && worker.includes('PATCH_HOP_FRAMES = 96'), 'fast YAMNet patch framing should remain explicit');
assert(worker.includes('MAX_PATCHES = 32') && worker.includes('samplingMode: \'fast-scan\''), 'long audio should use bounded fast scanning');
assert(worker.includes('frequencyToBin') && worker.includes('buildMelFilterBank'), 'YAMNet FFT/Mel preprocessing helpers should remain testable');
assert(worker.includes('message.diagnostic === true') && worker.includes('topRawLabels'), 'raw per-patch diagnostics should require explicit opt-in');
assert(worker.includes("status: 'ok'") && worker.includes('items: items'), 'worker should return multi-label instrument items');
assert(worker.includes('item.confidence > 0.08'), 'worker should keep every instrument above the display confidence threshold');
assert(worker.includes("{ id: 'piano'") && worker.includes("{ id: 'drums'"), 'worker should map core instruments');
assert(client.includes('new Worker(workerUrl'), 'client should isolate inference in a browser Worker');
assert(client.includes('[samples.buffer]'), 'audio samples should transfer instead of clone');
assert(controller.includes('instrumentAnalyzer') && controller.includes('result.instruments = await instrumentAnalyzer') && controller.includes('onProgress: renderInstrumentProgress'), 'controller should merge worker results and show progress');
assert(index.includes('audio_instrument_client.js?v=separation-choices-v7'), 'index should load the worker client');
assert(index.includes('app.js?v=separation-choices-v7'), 'app cache version should match the current Studio release');
assert(fs.existsSync(path.join(root, 'static', 'pianoroll', 'vendor', 'onnxruntime-web', 'ort.wasm.min.js')), 'ORT runtime asset should be vendored');
assert(fs.existsSync(path.join(root, 'static', 'pianoroll', 'vendor', 'onnxruntime-web', 'ort-wasm-simd.wasm')), 'ORT SIMD WASM asset should be vendored');
assert(fs.existsSync(path.join(root, 'static', 'pianoroll', 'vendor', 'onnxruntime-web', 'ort-wasm.wasm')), 'ORT fallback WASM asset should be vendored');
assert(fs.statSync(path.join(root, 'static', 'pianoroll', 'vendor', 'yamnet-v1', 'yamnet.onnx')).size > 1000000, 'YAMNet model should be self-contained for browser loading');
assert(fs.existsSync(path.join(root, 'static', 'pianoroll', 'vendor', 'yamnet-v1', 'yamnet.onnx')), 'YAMNet ONNX graph should be vendored');
assert(app.includes('public, max-age=31536000, immutable'), 'model and runtime assets should use immutable versioned caching');

console.log('audio_instrument_web.test.js: all passed');
