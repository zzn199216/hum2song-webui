'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.window = {};
require('../../static/pianoroll/project.js');
const P = window.H2SProject;
const timeline = require('../../static/pianoroll/core/audio_separation_timeline.js');
const source = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/app.js'), 'utf8');
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
// Include complete methods directly from the application, not copies of their logic.
const methodSource =
  extract('    async _commitPreparedSeparatedAudioParts(', '    async _runAudioSeparationForClip(') +
  extract('    async _runAudioSeparationForClip(', '    async _checkAdvancedStemAvailability(') +
  extract('    async _commitNativeAudioFile(', '    async importAudioFileAsNativeClip(') +
  extract('    _materializeScoreDocToTimeline(', '    _materializeWorkerScoreAsClip(');
function score(pitch = 60) {
  return { version: 1, tempo_bpm: 120, tracks: [{ notes: [{ pitch, start: 0, duration: 0.3, velocity: 90 }] }] };
}
async function run(mode) {
  let p2 = {
    version: 2, timebase: 'beat', bpm: 120,
    tracks: Array.from({ length: 6 }, (_, i) => ({ id: 't' + i, trackId: 't' + i, instrument: 'default', name: 'Track ' + i })),
    clips: { source: { id: 'source', name: 'Source', kind: 'audio', audio: { durationSec: 5, assetRef: 'localidb:source' }, meta: {} } },
    instances: [{ id: 'source-instance', clipId: 'source', trackId: 't0', startBeat: 4 }],
    clipOrder: ['source'], ui: { playheadBeat: 0 },
  };
  const stems = ['vocals', 'drums', 'bass', 'other'];
  const win = { H2SProject: P, H2SAudioSeparationTimeline: timeline,
    H2SLocalAudioAssets: { storeImportedAudioFile: async () => ({ assetRef: 'localidb:stem' }) },
    H2SAudioWorkerSeparationClient: {
      isEnabled: () => true,
      separate: async () => ({ ok: true, workerJobId: 'test-job', manifest: {
        timelineAudioStems: stems, transcribedStems: mode === 'separate_only' ? [] : stems,
      }, artifacts: stems.map(stem => ({ artifactId: stem, role: 'stem_' + stem + (mode === 'separate_only' ? '_audio' : '_score') })) }),
      downloadArtifact: async (_job, stem) => ({ buffer: new TextEncoder().encode(JSON.stringify(
        stem === 'vocals' ? { tracks: [{ notes: [] }] } : score(stem === 'drums' ? 36 : 48)
      )).buffer }),
    },
  };
  let app;
  const persist = () => { p2 = P.mergeProjectV1ViewIntoV2(p2, app.project); };
  app = vm.runInNewContext('({' + methodSource + '})', {
    window: win, Blob, File, TextDecoder, Uint8Array, console, persist, log() {},
    _isProjectV2: P.isProjectV2,
  });
  app.getProjectV2 = () => p2;
  app.setProjectFromV2 = (value) => {
    p2 = value;
    app.project = {
      version: 1, bpm: p2.bpm, tracks: P.deepClone(p2.tracks),
      clips: p2.clipOrder.map(id => P.deepClone(p2.clips[id])),
      instances: p2.instances.map(i => ({ ...i, startSec: i.startBeat / 2, trackIndex: p2.tracks.findIndex(t => t.id === i.trackId) })),
      ui: { playheadSec: 0 },
    };
  };
  app.setProjectFromV2(p2);
  Object.assign(app, {
    state: {}, _requireCloudServerFeatureAuth: () => true,
    getAudioTranscriptionControls: () => ({ transcriptionTarget: 'auto', cleanupStrength: 50 }),
    _audioSeparationElements: () => ({}), _setAudioSeparationStatus() {}, setImportStatus() {}, closeAudioSeparation() {}, render() {},
    ensureTimelineTrackIndex(index) { assert(index < 6); },
    _analyzeAudioFileForTimeline: async () => ({ durationSec: 5 }),
    _prepareSeparatedAudioStemParts: async (file, stem) => ({ parts: [{ file, baseName: stem, startOffsetSec: 0 }] }),
    _addRepeatedNoteInstancesForSource() {},
    addClipToTimeline(id, startSec, trackIndex) {
      app.project.instances.push({ id: 'i-' + id, clipId: id, startSec, trackIndex });
      persist();
    },
  });
  const result = await app._runAudioSeparationForClip('source', {
    mode, sourceAudioInstanceId: 'source-instance', fileOverride: new File(['wave'], 'source.wav'),
  });
  assert(result.ok);
  assert.strictEqual(result.failures.length, 0);
  const saved = JSON.parse(JSON.stringify(p2));
  assert.strictEqual(saved.tracks[2].instrument, 'drum');
  assert.strictEqual(saved.tracks[3].instrument, 'bass');
  assert.strictEqual(saved.tracks[2].name, 'Drums');
  const bass = Object.values(p2.clips).find(c => c.meta && c.meta.separationStem === 'bass');
  assert(bass, 'stem provenance survives canonical save');
  if (mode === 'separate_only') {
    const instance = p2.instances.find(i => i.clipId === bass.id);
    app.setProjectFromV2(p2);
    const added = app._materializeScoreDocToTimeline(score(40), {
      sourceAudioClipId: bass.id, sourceAudioInstanceId: instance.id,
    });
    assert(added.ok);
    const noteInstance = p2.instances.find(i => i.clipId === added.clipIds[0]);
    assert.strictEqual(p2.tracks.find(t => t.id === noteInstance.trackId).instrument, 'bass');
  } else {
    assert(!Object.values(p2.clips).some(c => c.name === 'vocals'), 'zero-note residual must not create a MIDI clip');
  }
}
(async () => {
  await run('separate_only');
  await run('separate_and_transcribe');
  const controls = { transcriptionTarget: 'melody', cleanupStrength: 75, preserveRawCandidates: true };
  const topbar = vm.runInNewContext('({' + extract('    async runTopBarImportAudio(', '    async pickWavAndGenerate(') + '})', {
    document: { getElementById: id => id === 'selImportAudioSeparationPreset' ? { value: 'four_stem' } : { checked: true } },
  });
  let sent;
  Object.assign(topbar, {
    pickFile: async () => 'fixture',
    getTopBarImportTranscriptionControls: () => controls,
    _commitNativeAudioFile: async () => ({ ok: true, clipId: 'new', instanceId: 'instance' }),
    _runAudioSeparationForClip: async (_id, options) => { sent = options; },
  });
  await topbar.runTopBarImportAudio();
  assert.strictEqual(sent.transcriptionControls, controls, 'topbar automatic import must keep selected controls');
  const emptyConversion = vm.runInNewContext('({' + extract('    async _tryWorkerConvertAudioClipToEditable(', '    async convertAudioClipToEditable(') + '})', {
    window: { H2SAudioWorkerConversionClient: {
      isEnabled: () => true, convert: async () => ({ ok: true, scoreDoc: { tracks: [{ notes: [] }] } }),
    } },
  });
  let emptyStatus;
  Object.assign(emptyConversion, {
    getAudioTranscriptionControls: () => controls,
    getProjectV2: () => ({ clips: { source: { meta: { separationStem: 'vocals' } } } }),
    _setAudioConvertState() {}, _clearAudioConvertState() {}, _audioConvertStatusText: () => '',
    setImportStatus: text => { emptyStatus = text; },
    _materializeWorkerScoreAsClip: () => { throw new Error('Empty score must not be materialized'); },
  });
  const empty = await emptyConversion._tryWorkerConvertAudioClipToEditable('source', {}, { startSec: 0, durationSec: 1 });
  assert(empty.ok && empty.clipId === null);
  assert(emptyStatus.includes('No editable notes'));
  console.log('PASS real stem imports persist drum/bass instruments, metadata and manual MIDI inheritance');
})().catch(error => { console.error(error); process.exitCode = 1; });
