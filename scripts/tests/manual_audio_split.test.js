/* Real application regression: intact stem imports, explicit split, atomic timeline replacement. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
global.window = {};
require('../../static/pianoroll/project.js');
const P = window.H2SProject;
const segmenter = require('../../static/pianoroll/core/audio_stem_silence_segments.js');
const analysis = require('../../static/pianoroll/core/audio_analysis.js');
const source = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/app.js'), 'utf8').replace(/\r\n/g, '\n');
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const methods = extract('    async _prepareSeparatedAudioStemParts(', '    _addNativeAudioClipInstance(') +
  extract('    async splitAudioClipAtSilence(', '    /**\n     * Non-destructive: encode selected source range');
function buffer(mode = 'gaps') {
  const sampleRate = 1000, data = new Float32Array(sampleRate * 10);
  for (let i = 0; i < data.length; i++) {
    const sec = i / sampleRate;
    if (mode === 'continuous' || (mode === 'gaps' && ((sec >= 1 && sec < 2) || (sec >= 5 && sec < 6) || (sec >= 8 && sec < 9)))) {
      data[i] = Math.sin(i * 0.13 + (sec > 7 ? 0.001 : 0)) * (sec > 4 ? 0.4 : 0.5);
    }
  }
  return { sampleRate, length: data.length, duration: 10, numberOfChannels: 1, getChannelData: () => data };
}
function setup(options = {}) {
  let p2 = {
    version: 2, timebase: 'beat', bpm: 90,
    tracks: [{ id: 'a', trackId: 'a', name: 'Other' }, { id: 'b', trackId: 'b', name: 'Keyboard' }],
    clips: { full: P.createClipFromAudio({ id: 'full', name: 'Keyboard', assetRef: 'localidb:full', durationSec: 10, bpm: 90 }) },
    instances: [{ id: 'selected', clipId: 'full', trackId: 'b', startBeat: 7, gainDb: -4, transpose: 2 },
      { id: 'other-occurrence', clipId: 'full', trackId: 'a', startBeat: 30, gainDb: -8, transpose: 0 }],
    clipOrder: ['full'], ui: { playheadBeat: 0 },
  };
  p2.clips.full.meta.separationStem = 'keyboard';
  P.normalizeProjectV2(p2);
  let decodeCalls = 0, segmentCalls = 0, stores = 0, undo = null, projectKey = 'fixture-project';
  const storedFiles = [], file = new File(['original provider bytes'], 'keyboard.mp3', { type: 'audio/mpeg' });
  const win = {
    H2SProject: P, H2SAudioAnalysis: analysis,
    H2SAudioDecode: { decodeAudioFile: async () => { decodeCalls++; if (options.decodeError) throw Error('decode'); return buffer(options.mode); } },
    H2SAudioStemSilenceSegments: { ...segmenter,
      findAudibleRanges(value) { segmentCalls++; return segmenter.findAudibleRanges(value); },
      groupNearDuplicateRanges() { throw Error('Repeated audio must retain its own source samples'); },
    },
    H2SLocalAudioAssets: { async storeImportedAudioFile(value) {
      stores++;
      if (options.onStore) options.onStore({ get project() { return p2; }, setProjectKey: value => { projectKey = value; } }, stores);
      if (options.failStore === stores) throw Error('storage full');
      storedFiles.push(value);
      return { assetRef: 'localidb:piece-' + stores };
    } },
  };
  const app = vm.runInNewContext('({' + methods + '})', { window: win, File, Blob, console,
    _getActiveProjectDocStorageKey: () => projectKey });
  Object.assign(app, {
    state: { selectedClipId: 'full', selectedClipIds: ['full'], selectedInstanceId: 'selected', activeTrackIndex: 1 },
    getProjectV2: () => p2,
    setProjectFromV2: value => { p2 = value; return { ok: true }; },
    _resolveLocalAudioFileForClip: async () => file,
    _analyzeAudioFileForTimeline: async value => {
      const bytes = new DataView(await value.arrayBuffer());
      return { durationSec: bytes.getUint32(40, true) / (bytes.getUint32(24, true) * bytes.getUint16(22, true) * 2) };
    },
    captureTimelineUndo: () => { undo = { snapshot: P.deepClone(p2), state: { ...app.state } }; },
    setImportStatus: text => { app.status = text; },
  });
  return { app, file, get project() { return p2; }, get undo() { return undo; },
    get counts() { return { decodeCalls, segmentCalls, stores }; }, storedFiles };
}
(async () => {
  const intact = setup();
  for (const opts of [{}, { discardWholeSilent: false }, { discardWholeSilent: true }]) {
    const result = await intact.app._prepareSeparatedAudioStemParts(intact.file, 'Keyboard', opts);
    assert(!result.trimmed && !result.discardedSilent);
    assert.strictEqual(result.parts.length, 1);
    assert.strictEqual(result.parts[0].file, intact.file, 'provider bytes are preserved');
    assert.strictEqual(result.parts[0].startOffsetSec, 0);
  }
  assert.strictEqual(intact.counts.decodeCalls, 1, 'only silent-stem classification decodes default imports');
  assert.strictEqual(intact.counts.segmentCalls, 0, 'neither standard nor Suno imports are auto-segmented');
  const silent = setup({ mode: 'silent' });
  const dropped = await silent.app._prepareSeparatedAudioStemParts(silent.file, 'Silent', { discardWholeSilent: true });
  assert(dropped.discardedSilent && dropped.parts.length === 0, 'existing Suno empty-stem filtering remains');
  const keepSilent = await silent.app._prepareSeparatedAudioStemParts(silent.file, 'Silent', { discardWholeSilent: false });
  assert.strictEqual(keepSilent.parts[0].file, silent.file);
  const good = setup();
  const before = P.deepClone(good.project);
  const result = await good.app.splitAudioClipAtSilence('full', 'selected');
  assert(result.ok && result.changed && result.count === 3);
  assert.strictEqual(good.project.instances.length, 4);
  assert(!good.project.instances.some(i => i.id === 'selected'));
  assert.deepStrictEqual(good.project.instances.find(i => i.id === 'other-occurrence'), before.instances[1]);
  assert.deepStrictEqual(good.project.clips.full, before.clips.full, 'original full material stays in the library');
  const pieces = good.project.instances.filter(i => i.id !== 'other-occurrence');
  const ranges = segmenter.findAudibleRanges(buffer());
  for (let i = 0; i < pieces.length; i++) {
    assert.strictEqual(pieces[i].trackId, 'b');
    assert.strictEqual(pieces[i].gainDb, -4);
    assert.strictEqual(pieces[i].transpose, 2);
    assert(Math.abs(pieces[i].startBeat - (7 + ranges[i].startSec * 90 / 60)) < 1e-6);
    const clip = good.project.clips[pieces[i].clipId];
    assert(Math.abs(clip.audio.durationSec - ranges[i].durationSec) < 0.002);
    assert.strictEqual(clip.meta.separationStem, 'keyboard');
    assert(!('startSec' in pieces[i]), 'timeline persistence uses beats');
  }
  assert.strictEqual(new Set(pieces.map(i => good.project.clips[i.clipId].audio.assetRef)).size, 3);
  assert(!Buffer.from(await good.storedFiles[1].arrayBuffer()).equals(Buffer.from(await good.storedFiles[2].arrayBuffer())), 'similar phrases keep their actual audio');
  const saved = JSON.parse(JSON.stringify(good.project));
  P.normalizeProjectV2(saved);
  assert.strictEqual(saved.instances.length, 4, 'pieces survive canonical reload');
  assert.deepStrictEqual(good.undo.snapshot, before);
  good.app.setProjectFromV2(good.undo.snapshot);
  assert.deepStrictEqual(good.project, before, 'one undo restores the unsplit timeline');
  for (const mode of ['continuous', 'silent']) {
    const noGap = setup({ mode });
    const snapshot = JSON.stringify(noGap.project);
    const noChange = await noGap.app.splitAudioClipAtSilence('full', 'selected');
    assert(noChange.ok && !noChange.changed);
    assert.strictEqual(JSON.stringify(noGap.project), snapshot);
    assert.strictEqual(noGap.counts.stores, 0);
    assert.strictEqual(noGap.undo, null);
  }
  for (const options of [{ failStore: 2 }, { decodeError: true }]) {
    const failure = setup(options), snapshot = JSON.stringify(failure.project);
    const failed = await failure.app.splitAudioClipAtSilence('full', 'selected');
    assert(!failed.ok);
    assert.strictEqual(JSON.stringify(failure.project), snapshot, 'failure never partially replaces the timeline');
    assert.strictEqual(failure.undo, null);
    assert.strictEqual(failure.app._audioSilenceSplitBusy, false);
  }
  for (const onStore of [({ project }, count) => { if (count === 1) project.instances[0].startBeat = 20; },
    ({ setProjectKey }, count) => { if (count === 1) setProjectKey('another-project'); }]) {
    const changed = setup({ onStore });
    const aborted = await changed.app.splitAudioClipAtSilence('full', 'selected');
    assert.strictEqual(aborted.reason, 'source_changed');
    assert.strictEqual(changed.project.instances.length, 2);
    assert.strictEqual(changed.undo, null);
  }
  const parallelEdit = setup({ onStore: ({ project }, count) => { if (count === 1) project.tracks[0].name = 'User edit during split'; } });
  assert((await parallelEdit.app.splitAudioClipAtSilence('full', 'selected')).ok);
  assert.strictEqual(parallelEdit.project.tracks[0].name, 'User edit during split', 'unrelated edits survive atomic replacement');
  const wrong = setup();
  for (const instanceId of [null, 'missing']) {
    assert.strictEqual((await wrong.app.splitAudioClipAtSilence('full', instanceId)).reason, 'source_instance_required');
  }
  assert.strictEqual(wrong.counts.decodeCalls, 0);
  console.log('PASS intact stem imports and explicit silence splitting: timing, originals, gain, repeat fidelity, undo, failure atomicity and concurrent edits');
})().catch(error => { console.error(error); process.exitCode = 1; });
