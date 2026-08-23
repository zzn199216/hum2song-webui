#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const timeline = require(path.join(repoRoot, 'static', 'pianoroll', 'core', 'audio_separation_timeline.js'));

(function testModalAndImportControls(){
  const html = read('static', 'pianoroll', 'index.html');
  assert(html.includes('id="audioSeparationModal"'));
  assert(html.includes('id="audioSeparationPreset"'));
  assert(html.includes('value="four_stem" data-i18n="transcription.separationPreset.fourStem" selected'));
  assert(html.includes('id="audioSeparationMode"'));
  assert(html.includes('id="chkImportAudioSeparateFirst"'));
  assert(html.includes('id="selImportAudioSeparationPreset" disabled'));
  assert(html.includes('id="transcriptionSettingsSeparateFirst"'));
  assert(html.includes('id="transcriptionSettingsSeparationPreset" disabled'));
  assert(html.includes('data-i18n="audio.waveform.separationHelp"'));
  assert(html.includes('data-i18n="audio.waveform.separationStart"'));
  console.log('PASS audio separation modal and import controls');
})();

(function testUvr5AssetsUseOneCacheVersion(){
  const html = read('static', 'pianoroll', 'index.html');
  const assetVersion = read('static', 'pianoroll', 'studio_asset_version.js');
  const locale = read('static', 'i18n', 'locales', 'zh.json');
  assert(assetVersion.includes("H2S_STUDIO_ASSET_VERSION = 'audio-analysis-v2'"));
  assert(html.includes('studio_asset_version.js?v=audio-analysis-v2'));
  assert(html.includes('audio_worker_separation_client.js?v=audio-analysis-v2'));
  assert(html.includes('app.js?v=audio-analysis-v2'));
  assert(locale.includes('"audio.waveform.separatorOption.uvr5"'));
  console.log('PASS UVR5 UI and locale assets share a cache-busting version');
})();

(function testAudioOnlySelectionEntry(){
  const view = require(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'selection_view.js'));
  const common = { fmtSec: String, escapeHtml: String, clipName: 'clip', startSec: 0 };
  const audioHtml = view.selectionBoxInnerHTML({ ...common, isAudio: true, showAudioSegment: false });
  const midiHtml = view.selectionBoxInnerHTML({ ...common, isAudio: false, showAudioSegment: false });
  assert(audioHtml.includes('data-act="audioSeparation"'));
  assert(!midiHtml.includes('data-act="audioSeparation"'));
  console.log('PASS separation entry is audio-only');
})();

(function testWaveformLibraryAndSegmentTranscriptionEntries(){
  const waveform = read('static', 'pianoroll', 'ui', 'audio_waveform_editor.js');
  const libraryView = read('static', 'pianoroll', 'ui', 'library_view.js');
  const libraryController = read('static', 'pianoroll', 'controllers', 'library_controller.js');
  const app = read('static', 'pianoroll', 'app.js');
  assert(waveform.includes('data-act="waveSeparate"'));
  assert(waveform.includes('data-role="wfSeparateBeforeConvert"'));
  assert(waveform.includes('data-role="wfSeparationPreset"'));
  assert(waveform.includes('data-role="wfSeparationMode"'));
  assert(waveform.includes('data-role="wfSeparatorOption"'));
  assert(waveform.includes('data-role="wfSeparatorOptionChoices"'));
  assert(waveform.includes('data-role="wfSeparationModeChoices"'));
  assert(waveform.includes('data-separator-option-value="uvr5_ensemble_vocal_full"'));
  assert(waveform.includes('data-separation-mode-value="separate_and_transcribe"'));
  assert(waveform.includes("button.classList.toggle('is-selected', selected)"));
  assert(waveform.includes('transcribeOption.disabled = uvrSelected'));
  assert(waveform.includes('value="uvr5_ensemble_vocal_full" data-uvr5-option hidden disabled'));
  assert(waveform.includes("uvrOption.disabled = !uvr5EnsembleUiEnabled() || midiEnabled"));
  assert(waveform.includes("preset.disabled = uvrSelected || separationBusy || _isConvertBusy()"));
  assert(waveform.includes("audio.waveform.uvr5FailedRefunded"));
  assert(waveform.includes('data-role="wfSeparationSettingsToggle"'));
  assert(waveform.includes('data-role="wfSeparationSettings" hidden'));
  assert(waveform.includes('hooks.runSeparation'));
  assert(waveform.includes("message === 'payload_too_large'"));
  assert(waveform.includes("audio.waveform.separationTooLarge"));
  assert(!waveform.includes('hooks.openSeparation'));
  assert(libraryView.includes('data-act="audioSeparation"'));
  assert(libraryController.includes("act === 'audioSeparation'"));
  assert(/openAudioSeparation\(opts\)\{[\s\S]*openAudioWaveformEditor\(clipId/.test(app), 'all separation entries route to the waveform editor');
  assert(app.includes('transcriptionControls.separateFirst === true'));
  assert(app.includes("mode: 'separate_and_transcribe'"));
  assert(app.includes("transcriptionControls.separateFirst = opts.separateFirst === true"));
  assert(app.includes('durationSecOverride: seg.durationSec'));
  assert(app.includes('placementOffsetSec: seg.startSec'));
  assert(app.includes("this.project.tracks[trackIndex].instrument = 'drum'"));
  assert(app.includes('artifact.filename || downloaded.filename'));
  assert(app.includes("artifactMime || 'audio/wav'"));
  assert(app.includes('LAS.normalizeAudioDownloadFilename(stemNameCandidate'));
  console.log('PASS waveform, library, and segment transcription separation entries');
})();

(function testPresetTimelineMaterialization(){
  assert.deepStrictEqual(
    timeline.timelineItems({ timelineAudioStems: ['vocals', 'instrumental'], transcribedStems: [] }),
    [
      { stem: 'vocals', kind: 'audio', artifactRole: 'stem_vocals_audio' },
      { stem: 'instrumental', kind: 'audio', artifactRole: 'stem_instrumental_audio' },
    ]
  );
  assert.deepStrictEqual(
    timeline.timelineItems({
      timelineAudioStems: ['vocals', 'drums', 'bass', 'other'],
      transcribedStems: [],
    }),
    [
      { stem: 'vocals', kind: 'audio', artifactRole: 'stem_vocals_audio' },
      { stem: 'drums', kind: 'audio', artifactRole: 'stem_drums_audio' },
      { stem: 'bass', kind: 'audio', artifactRole: 'stem_bass_audio' },
      { stem: 'other', kind: 'audio', artifactRole: 'stem_other_audio' },
    ],
    'separate-only must materialize audio stems rather than MIDI'
  );
  assert.deepStrictEqual(
    timeline.timelineItems({
      timelineAudioStems: ['vocals', 'drums', 'bass', 'other'],
      transcribedStems: ['vocals', 'drums', 'bass', 'other'],
    }),
    [
      { stem: 'vocals', kind: 'midi', artifactRole: 'stem_vocals_score' },
      { stem: 'drums', kind: 'midi', artifactRole: 'stem_drums_score' },
      { stem: 'bass', kind: 'midi', artifactRole: 'stem_bass_score' },
      { stem: 'other', kind: 'midi', artifactRole: 'stem_other_score' },
    ]
  );
  assert.deepStrictEqual(
    timeline.timelineItems({ timelineAudioStems: ['drums', 'bass', 'other'], transcribedStems: ['bass'] }),
    [
      { stem: 'drums', kind: 'audio', artifactRole: 'stem_drums_audio' },
      { stem: 'bass', kind: 'midi', artifactRole: 'stem_bass_score' },
      { stem: 'other', kind: 'audio', artifactRole: 'stem_other_audio' },
    ],
    'a failed other transcription must fall back to its audio stem'
  );
  assert.deepStrictEqual(
    timeline.timelineItems({ timelineAudioStems: ['vocals', 'bass', 'drums'], transcribedStems: ['vocals', 'bass', 'drums'] }),
    [
      { stem: 'vocals', kind: 'midi', artifactRole: 'stem_vocals_score' },
      { stem: 'bass', kind: 'midi', artifactRole: 'stem_bass_score' },
      { stem: 'drums', kind: 'midi', artifactRole: 'stem_drums_score' },
    ]
  );
  console.log('PASS manifest-driven preset materialization');
})();

(function testEmptyTracksThenAppend(){
  const project = {
    tracks: [{}, {}, {}, {}],
    instances: [
      { id: 'source', trackIndex: 0, startSec: 4.25 },
      { id: 'occupied', trackIndex: 2, startSec: 0 },
    ],
  };
  const plan = timeline.planTrackIndices(project, 'source', 4);
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.trackIndices, [1, 3, 4, 5]);
  assert.strictEqual(plan.sourceStartSec, 4.25);
  assert.strictEqual(plan.requiredTrackCount, 6);
  console.log('PASS empty tracks below source are reused before append');
})();

(async function testPayloadIncludesPresetAndTenMinuteClientLimit(){
  const previousWindow = global.window;
  let createPayload = null;
  global.window = {
    H2SAudioWorkerConversionClient: {
      isEnabled: () => true,
      isCloudMode: () => true,
      _segmentToWavArrayBuffer: async () => new ArrayBuffer(8),
      _requestHost: async (type, payload) => {
        if (type === 'H2S_CLOUD_AUDIO_SEPARATION_JOB_CREATE') {
          createPayload = payload;
          return { job: { id: 'job-1', status: 'queued' }, costUnits: 2 };
        }
        if (type === 'H2S_CLOUD_AUDIO_SEPARATION_JOB_STATUS') return { job: { id: 'job-1', status: 'succeeded' } };
        if (type === 'H2S_CLOUD_AUDIO_SEPARATION_JOB_RESULT') return { manifest: {}, artifacts: [] };
        throw new Error(`unexpected bridge request: ${type}`);
      },
    },
  };
  const clientPath = path.join(repoRoot, 'static', 'pianoroll', 'core', 'audio_worker_separation_client.js');
  delete require.cache[require.resolve(clientPath)];
  const client = require(clientPath);
  const result = await client.separate({
    file: { name: 'mix.wav' },
    durationSec: 600,
    mode: 'separate_and_transcribe',
    separationPreset: 'vocals_bass_drums',
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(client.maxDurationSec, 600);
  assert.strictEqual(createPayload.separationPreset, 'vocals_bass_drums');
  assert.strictEqual(createPayload.mode, 'separate_and_transcribe');
  assert.strictEqual(createPayload.separatorOption, 'demucs');
  const invalidUvr = await client.separate({
    file: { name: 'mix.wav' },
    durationSec: 20,
    mode: 'separate_and_transcribe',
    separationPreset: 'vocals_instrumental',
    separatorOption: 'uvr5_ensemble_vocal_full',
  });
  assert.deepStrictEqual(invalidUvr, { ok: false, reason: 'uvr5_separate_only' });
  const validUvr = await client.separate({
    file: { name: 'mix.wav' },
    durationSec: 20,
    mode: 'separate_only',
    separationPreset: 'vocals_instrumental',
    separatorOption: 'uvr5_ensemble_vocal_full',
  });
  assert.strictEqual(validUvr.ok, true);
  assert.strictEqual(createPayload.separatorOption, 'uvr5_ensemble_vocal_full');
  const tooLong = await client.separate({
    file: { name: 'mix.wav' },
    durationSec: 600.01,
    mode: 'separate_only',
    separationPreset: 'four_stem',
  });
  assert.deepStrictEqual(tooLong, { ok: false, reason: 'audio_too_long' });
  delete require.cache[require.resolve(clientPath)];
  if (previousWindow === undefined) delete global.window;
  else global.window = previousWindow;
  console.log('PASS separation payload and 10 minute bound');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

(function testOldImportPathRemains(){
  const app = read('static', 'pianoroll', 'app.js');
  assert(app.includes("if (toNotes && separateFirst && separateFirst.checked)"));
  assert(app.includes("else if (toNotes) await this.pickWavAndGenerate(this.getTopBarImportTranscriptionControls())"));
  assert(app.includes("else await this.importAudioFileAsNativeClip()"));
  assert(app.includes("separationCost.textContent = enabled"));
  assert(app.includes("separateFirst.addEventListener('change', captureTopBarSeparationControls)"));
  assert(app.includes('this.setTopBarImportTranscriptionControls({'));
  console.log('PASS legacy import/transcription branches remain');
})();
