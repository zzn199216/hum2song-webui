'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the actual App method; synthetic source/transport never call a server.
const app = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/app.js'), 'utf8');
const start = app.indexOf('async _runAdvancedStemSeparationForClip(clipId, opts){');
const end = app.indexOf('\n    _initTopBarImportTranscriptionControls(){', start);
assert(start >= 0 && end > start);
const methodSource = app.slice(start, end);

async function runCase({ cloudCopy = true, startSec = 0, durationSec = 118.44, missing = false, tooLarge = false, sourceDurationSec = 118.44 } = {}) {
  const uploads = [], submissions = [], crops = [];
  const file = { name: 'music.mp3', type: 'audio/mpeg', arrayBuffer: async () => new ArrayBuffer(tooLarge ? 20 * 1024 * 1024 + 1 : 4) };
  const project = { bpm: 120, clips: { clip: { kind: 'audio', audio: { assetRef: 'localidb:fixture', durationSec: 118.44 } } }, instances: [{ id: 'instance', clipId: 'clip', startBeat: 8 }] };
  const sandbox = { window: {
    H2SProject: { clipKind: clip => clip.kind },
    H2SLocalAudioAssets: {
      getSourceMetadataForLocalAssetRef: async () => cloudCopy ? { cloudSourceAssetId: 'core-fixture', durationSec: 118.4 } : {},
      getFileForLocalAssetRef: async () => missing ? null : file,
    },
    H2SAudioWorkerConversionClient: { _segmentToWavArrayBuffer: async (_file, range) => { crops.push(range); return new ArrayBuffer(8); } },
    H2SAudioWorkerAdvancedStemClient: {
      isEnabled: () => true,
      prepareSource: async payload => { uploads.push(payload); return { ok: true, sourceAssetId: 'src-exact', sourceDurationSec: startSec ? durationSec : sourceDurationSec, reused: true }; },
      separate: async payload => {
        submissions.push(payload);
        // The server's strict complete-source comparison must accept the staged file.
        const authoritative = payload.sourceAssetId === 'src-exact' ? (startSec ? durationSec : sourceDurationSec) : 118.4;
        assert(Math.abs(payload.durationSec - authoritative) <= 0.01, 'complete source must not mix decoded and rounded Cloud durations');
        assert(Math.abs(payload.sourceDurationSec - authoritative) <= 0.01);
        return { ok: true, workerJobId: 'fixture-job', manifest: { stems: [] }, artifacts: [] };
      },
    },
  }, console, Blob, File, ArrayBuffer };
  const method = vm.runInNewContext('({' + methodSource + '})._runAdvancedStemSeparationForClip', sandbox);
  const ctx = { _requireCloudServerFeatureAuth: () => true, getProjectV2: () => project, _setAudioSeparationStatus() {}, setImportStatus() {} };
  let result, error;
  try { result = await method.call(ctx, 'clip', { sourceAudioInstanceId: 'instance', startSec, durationSec }); }
  catch (err) { error = err.message; }
  return { result, error, uploads, submissions, crops };
}

(async () => {
  const full = await runCase();
  assert.strictEqual(full.result.ok, true);
  assert.strictEqual(full.uploads.length, 1, 'Cloud playback copies must stage their actual bytes');
  assert.strictEqual(full.uploads[0].sourceDurationSec, 118.44);
  assert.strictEqual(full.submissions[0].sourceAssetId, 'src-exact');
  assert.strictEqual(full.submissions[0].metadata.cloudSourceAssetId, 'core-fixture');
  assert.strictEqual(full.crops.length, 0, 'complete MP3 should preserve the original file');
  const again = await runCase();
  assert.strictEqual(again.uploads[0].sourceKey, full.uploads[0].sourceKey, 'retries retain the stable source key');
  const canonical = await runCase({ sourceDurationSec: 118.439 });
  assert.strictEqual(canonical.submissions[0].durationSec, 118.439, 'use the prepared source response, including millisecond normalization');
  const range = await runCase({ startSec: 20, durationSec: 10 });
  assert.strictEqual(range.result.ok, true);
  assert.strictEqual(range.crops.length, 1);
  assert.strictEqual(range.uploads[0].mimeType, 'audio/wav');
  assert.strictEqual(range.uploads[0].sourceDurationSec, 10);
  assert.strictEqual(range.submissions[0].startSec, 0, 'cropped upload is a complete new provider source');
  assert.strictEqual(range.submissions[0].metadata.alignment.sourceStartBeat, 48, 'retain original timeline alignment');
  const local = await runCase({ cloudCopy: false });
  assert.strictEqual(local.result.ok, true);
  const missing = await runCase({ missing: true });
  assert.strictEqual(missing.error, 'missing_audio_asset');
  assert.strictEqual(missing.submissions.length, 0);
  const large = await runCase({ tooLarge: true });
  assert.strictEqual(large.error, 'advanced_source_too_large');
  assert.strictEqual(large.uploads.length, 0);
  assert.strictEqual(large.submissions.length, 0);
  console.log('PASS advanced source precision, stable retry, crop alignment, local source and pre-submit failures');
})().catch(err => { console.error(err); process.exitCode = 1; });
