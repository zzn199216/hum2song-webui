const assert = require('assert');
const engine = require('../../static/pianoroll/core/audio_analysis.js');

const mono = engine.analyzeChannels([new Float32Array([0, 1, -1, 0])], 4, {
  source: { clipId: 'mono-1', assetId: 'localidb:mono' },
});
assert.strictEqual(mono.schemaVersion, 'audio-analysis-v0');
assert.strictEqual(mono.analyzerVersion, 'audio-analysis-v0');
assert.strictEqual(mono.source.clipId, 'mono-1');
assert.strictEqual(mono.source.durationSec, 1);
assert.strictEqual(mono.technical.sampleRate, 4);
assert.strictEqual(mono.technical.channels, 1);
assert.strictEqual(mono.technical.peakDb, 0);
assert.ok(Math.abs(mono.technical.rmsDb - (-3.0102999566)) < 1e-8);

const stereo = engine.analyzeChannels([
  new Float32Array([0.5, -0.5]),
  new Float32Array([0.25, -0.25]),
], 2);
assert.strictEqual(stereo.source.durationSec, 1);
assert.strictEqual(stereo.technical.channels, 2);
assert.ok(Math.abs(stereo.technical.peakDb - (-6.020599913)) < 1e-9);
assert.ok(stereo.technical.rmsDb < -8 && stereo.technical.rmsDb > -9);

const empty = engine.analyzeChannels([new Float32Array(0)], 48000);
assert.strictEqual(empty.source.durationSec, 0);
assert.strictEqual(empty.technical.peakDb, null);
assert.strictEqual(empty.technical.rmsDb, null);

const quiet = engine.analyzeChannels([new Float32Array([1e-8, -1e-8])], 2);
assert.ok(quiet.technical.peakDb < -150);
assert.ok(quiet.technical.rmsDb < -150);

const buffer = {
  numberOfChannels: 1,
  sampleRate: 10,
  duration: 0.2,
  getChannelData: () => new Float32Array([0, 0.5]),
};
const fromBuffer = engine.analyzeAudioBuffer(buffer);
assert.strictEqual(fromBuffer.source.durationSec, 0.2);
assert.strictEqual(fromBuffer.technical.channels, 1);
assert.strictEqual(fromBuffer.rhythm.status, 'not_available_v0');
assert.strictEqual(fromBuffer.harmony.status, 'not_available_v0');
assert.strictEqual(fromBuffer.instruments.status, 'not_available_v0');

assert.throws(() => engine.analyzeAudioBuffer(null), /invalid_audio_buffer/);
assert.throws(() => engine.analyzeChannels([], 44100), /invalid_audio_channels/);
assert.throws(() => engine.analyzeChannels([new Float32Array(1)], 0), /invalid_audio_sample_rate/);

console.log('audio_analysis_engine.test.js: all passed');
