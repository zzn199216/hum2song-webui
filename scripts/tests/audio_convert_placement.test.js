#!/usr/bin/env node
/**
 * Audio → editable: single-instance placement (resolveAudioConvertPlacementV1) + app wiring smoke.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');

if (typeof globalThis.window === 'undefined') globalThis.window = {};
require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
if (globalThis.window && globalThis.window.H2SProject) {
  globalThis.H2SProject = globalThis.window.H2SProject;
}
const H2SProject = globalThis.H2SProject;
assert(H2SProject && typeof H2SProject.resolveAudioConvertPlacementV1 === 'function', 'resolveAudioConvertPlacementV1');

function baseProject(playheadSec){
  return {
    version: 1,
    bpm: 120,
    tracks: [
      { id: 'tr0', name: 'Track 1' },
      { id: 'tr1', name: 'Track 2' },
      { id: 'tr2', name: 'Track 3' },
    ],
    clips: [],
    instances: [],
    ui: { pxPerSec: 160, playheadSec: playheadSec != null ? playheadSec : 1.25 },
  };
}

(function testSingleInstanceAligned(){
  const proj = baseProject(99);
  proj.clips = [{ id: 'audio_a', name: 'A' }];
  proj.instances = [{ id: 'i1', clipId: 'audio_a', startSec: 4.5, trackIndex: 2 }];
  const r = H2SProject.resolveAudioConvertPlacementV1(proj, 'audio_a', 99, 0);
  assert.strictEqual(r.aligned, true);
  assert.strictEqual(r.reason, 'single_source_instance');
  assert.strictEqual(r.startSec, 4.5);
  assert.strictEqual(r.trackIndex, 2);
  console.log('PASS single instance → aligned placement');
})();

(function testZeroInstancesFallback(){
  const proj = baseProject(3);
  proj.clips = [{ id: 'audio_a', name: 'A' }];
  proj.instances = [];
  const r = H2SProject.resolveAudioConvertPlacementV1(proj, 'audio_a', 3, 0);
  assert.strictEqual(r.aligned, false);
  assert.strictEqual(r.reason, 'no_source_instance');
  assert.strictEqual(r.startSec, 3);
  assert.strictEqual(r.trackIndex, 0);
  console.log('PASS zero instances → fallback');
})();

(function testMultipleInstancesFallback(){
  const proj = baseProject(2);
  proj.clips = [{ id: 'audio_a', name: 'A' }];
  proj.instances = [
    { id: 'i1', clipId: 'audio_a', startSec: 1, trackIndex: 0 },
    { id: 'i2', clipId: 'audio_a', startSec: 5, trackIndex: 1 },
  ];
  const r = H2SProject.resolveAudioConvertPlacementV1(proj, 'audio_a', 2, 0);
  assert.strictEqual(r.aligned, false);
  assert.strictEqual(r.reason, 'multiple_source_instances');
  assert.strictEqual(r.startSec, 2);
  assert.strictEqual(r.trackIndex, 0);
  console.log('PASS multiple instances → fallback');
})();

(function testExplicitInstanceIdAlignsWhenMultiple(){
  const proj = baseProject(2);
  proj.clips = [{ id: 'audio_a', name: 'A' }];
  proj.instances = [
    { id: 'i1', clipId: 'audio_a', startSec: 1, trackIndex: 0 },
    { id: 'i2', clipId: 'audio_a', startSec: 5, trackIndex: 1 },
  ];
  const r = H2SProject.resolveAudioConvertPlacementV1(proj, 'audio_a', 2, 0, 'i2');
  assert.strictEqual(r.aligned, true);
  assert.strictEqual(r.reason, 'explicit_source_instance');
  assert.strictEqual(r.startSec, 5);
  assert.strictEqual(r.trackIndex, 1);
  console.log('PASS explicit instance id → aligned despite multiple');
})();

(function testAppWiringStrings(){
  const appPath = path.join(repoRoot, 'static', 'pianoroll', 'app.js');
  const appSrc = fs.readFileSync(appPath, 'utf8');
  assert(
    /uploadFileAndGenerate\s*\(\s*file\s*,\s*uploadOpts\s*\)/.test(appSrc) && /sourceAudioClipId\s*:\s*clipId/.test(appSrc),
    'convertAudioClipToEditable passes sourceAudioClipId via uploadOpts'
  );
  assert(
    /resolveAudioConvertPlacementV1/.test(appSrc) && /opts\.sourceAudioClipId/.test(appSrc),
    'uploadFileAndGenerate uses resolveAudioConvertPlacementV1 when opts.sourceAudioClipId set'
  );
  assert(/opts\.sourceAudioInstanceId/.test(appSrc), 'upload passes optional sourceAudioInstanceId to placement');
  assert(/clip\.meta\.sourceAudioClipId/.test(appSrc), 'new clip meta gets sourceAudioClipId on conversion');
  assert(/clip\.meta\.sourceAudioInstanceId/.test(appSrc), 'new clip meta gets sourceAudioInstanceId when instance-scoped');
  console.log('PASS app.js wiring strings');
})();

(function testConversionLeavesPipelineIntact(){
  const appPath = path.join(repoRoot, 'static', 'pianoroll', 'app.js');
  const appSrc = fs.readFileSync(appPath, 'utf8');
  assert(appSrc.includes('await this.uploadFileAndGenerate(file'), 'still async upload pipeline');
  assert(appSrc.includes('fetchJson(API.generate'), 'still generate API');
  assert(appSrc.includes('fetchJson(API.score'), 'still score fetch');
  const i0 = appSrc.indexOf('async convertAudioClipToEditable');
  const i1 = appSrc.indexOf('_isPlaying(){', i0);
  assert(i0 >= 0 && i1 > i0, 'can slice convertAudioClipToEditable');
  const convertFn = appSrc.slice(i0, i1);
  assert(!/removeClip|\.clips\.splice|delete\s+.*\.clips/.test(convertFn), 'convertAudioClipToEditable does not remove source clip');
  assert(!/project\.instances/.test(convertFn), 'convertAudioClipToEditable does not mutate timeline instances');
  console.log('PASS conversion still uses shared upload/generate/score path; source not removed in convert');
})();
