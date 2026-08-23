#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');

(function testWaveformModulePure(){
  const W = require(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'audio_waveform_editor.js'));
  const seg = W.clampSelection(120, 10, 45);
  assert.strictEqual(seg.startSec, 10);
  assert.strictEqual(seg.endSec, 45);
  assert.strictEqual(seg.durationSec, 35);
  const peaks = W.computePeaksFromChannel(new Float32Array([0, 0.5, -1, 0.25]), 4);
  assert.strictEqual(peaks.length, 4);
  assert.ok(peaks[2] >= peaks[0]);
  console.log('PASS waveform editor pure helpers');
})();

(function testAppRoutesAudioToWaveform(){
  const appSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'app.js'), 'utf8');
  assert(appSrc.includes('openAudioWaveformEditor'), 'app defines openAudioWaveformEditor');
  assert(appSrc.includes('_clipIsAudioForEditor'), 'app detects audio clips');
  assert(/openClipEditor\(clipId\)\{[\s\S]*openAudioWaveformEditor/.test(appSrc), 'openClipEditor routes audio to waveform');
  assert(appSrc.includes('extractAudioClipSegmentAsNewClip'), 'app extracts non-destructive segment clip');
  assert(appSrc.includes('audio.waveform.missingFile'), 'friendly missing-audio message');
  assert(!appSrc.includes('msg.audioClipNoEditor'), 'app must not surface raw audioClipNoEditor');
  console.log('PASS app audio open routing');
})();

(function testEditorRuntimeNoAlert(){
  const edSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'editor_runtime.js'), 'utf8');
  assert(!edSrc.includes('msg.audioClipNoEditor'), 'editor runtime must not alert audioClipNoEditor');
  assert(/if \(audioGuard\)\{[\s\S]*return;/.test(edSrc), 'audio guard returns silently');
  console.log('PASS editor_runtime audio guard');
})();

(function testIndexDefersWaveformScript(){
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'index.html'), 'utf8');
  const ver = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'studio_asset_version.js'), 'utf8').match(
    /H2S_STUDIO_ASSET_VERSION\s*=\s*'([^']+)'/,
  )[1];
  assert(!indexHtml.includes('audio_waveform_editor.js'), 'index should not eagerly load waveform editor');
  assert(indexHtml.includes('app.js?v=' + ver), 'index cache-busts app.js');
  assert(indexHtml.includes('core/local_audio_assets.js?v=' + ver), 'index cache-busts the local audio filename helper');
  const appSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'app.js'), 'utf8');
  assert(appSrc.includes('loadAudioWaveformEditorScript'), 'app lazy-loads waveform editor');
  assert(appSrc.includes('audio_waveform_editor.js?v='), 'lazy loader references versioned waveform script');
  console.log('PASS index defers waveform script');
})();

(function testSelectionAdvancedPanel(){
  const viewSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'selection_view.js'), 'utf8');
  assert(viewSrc.includes('h2s-audio-segment-advanced'), 'advanced segment collapsible');
  assert(viewSrc.includes('advancedSegmentTitle'), 'advanced title option');
  assert(!viewSrc.includes('btn mini primary" type="button" data-act="convertAudioEditable"'), 'inspector convert not primary');
  console.log('PASS selection advanced panel');
})();

(function testAdvancedStemSourcePreparation(){
  const appSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'app.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'core', 'audio_worker_advanced_stem_client.js'), 'utf8');
  assert(appSrc.includes('getFileForLocalAssetRef'), 'advanced stems resolve localidb through the existing local asset store');
  assert(appSrc.includes('client.prepareSource'), 'advanced stems prepare a provider source before job creation');
  assert(appSrc.includes("sourceKey = 'studio:' + originalSourceAssetId + '|range:'"), 'range source key is deterministic');
  assert(appSrc.includes('crop:studio-wav-pcm16-v1'), 'range source key includes crop version');
  assert(appSrc.includes('_segmentToWavArrayBuffer'), 'range preparation reuses the existing WAV materializer');
  assert(clientSrc.includes('H2S_CLOUD_ADVANCED_STEM_SOURCE_PREPARE'), 'advanced client exposes source preparation bridge');
  assert(clientSrc.includes('prepareSource: prepareSource'), 'advanced client exports source preparation');
  assert(clientSrc.includes('[audioBuffer]'), 'source preparation transfers audio bytes');
  assert(appSrc.includes('uploadFileAndGenerate'), 'standard audio-to-MIDI path remains present');
  console.log('PASS advanced stem source preparation wiring');
})();

(function testWaveformI18n(){
  const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'static', 'i18n', 'locales', 'en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(repoRoot, 'static', 'i18n', 'locales', 'zh.json'), 'utf8'));
  assert(en['audio.waveform.title'] === 'Audio segment editor');
  assert(en['audio.waveform.separatorOption.demucs'] === 'Stable separation (recommended)');
  assert(en['audio.waveform.separatorOption.uvr5'] === 'Vocal enhancement (experimental)');
  assert(zh['audio.waveform.title'] === '音频片段编辑');
  assert(zh['audio.waveform.separatorOption.demucs'] === '稳定分轨（推荐）');
  assert(zh['audio.waveform.separatorOption.uvr5'] === '人声增强（实验）');
  assert(zh['audio.waveform.uvr5Hint'].includes('仍在测试'));
  assert(!zh['audio.waveform.separatorOption.demucs'].includes('当前默认'));
  assert(zh['audio.waveform.missingFile'].includes('重新导入'));
  assert(zh['convert.fail.scoreFetch'].includes('结果读取失败'));
  console.log('PASS waveform i18n');
})();

(function testWaveformConvertStatusUi(){
  const wfSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'audio_waveform_editor.js'), 'utf8');
  assert(wfSrc.includes('setConvertStatus'), 'waveform editor exposes convert status');
  assert(wfSrc.includes('data-act="waveRetry"'), 'retry button in modal');
  assert(wfSrc.includes('data-act="waveDownloadOriginal"'), 'original audio download button in modal');
  assert(wfSrc.includes('h2s-audio-waveform-download-icon'), 'modal download uses a compact icon button');
  assert(wfSrc.includes("downloadBtn.setAttribute('aria-label', downloadLabel)"), 'icon download keeps an accessible localized label');
  assert(wfSrc.indexOf('data-act="waveCloseBtn"') < wfSrc.indexOf('data-act="waveDownloadOriginal"'), 'download icon is the last primary action to reduce accidental clicks');
  assert(wfSrc.includes('hooks.downloadOriginal(openCtx.clipId)'), 'modal download forwards the current audio clip');
  assert(wfSrc.includes("'audio.waveform.download'"), 'modal download uses the concise waveform-specific label');
  assert(wfSrc.includes('data-act="waveSeparate"'), 'AI separation button in waveform modal');
  assert(wfSrc.includes('data-role="wfSeparateBeforeConvert"'), 'waveform modal offers separation before MIDI conversion');
  assert(wfSrc.includes('data-role="wfSeparationPreset"'), 'separation target is inline in waveform modal');
  assert(wfSrc.includes('data-role="wfSeparationMode"'), 'separation mode is inline in waveform modal');
  assert(wfSrc.includes('data-role="wfSeparationSettingsToggle"'), 'separation settings have an opt-in checkbox');
  assert(wfSrc.includes('data-role="wfSeparationSettings" hidden'), 'separation settings are collapsed by default');
  assert(wfSrc.indexOf('h2s-audio-waveform-actions') < wfSrc.indexOf('h2s-audio-waveform-separation-actions'), 'separation action is placed on its own lower row');
  assert(wfSrc.includes('hooks.runSeparation'), 'waveform button runs the selected separation options directly');
  assert(wfSrc.includes('separateFirst: !!(separateBeforeConvert && separateBeforeConvert.checked)'), 'convert action forwards the separation checkbox');
  assert(wfSrc.includes('hooks.getTranscriptionControls'), 'waveform checkbox restores existing transcription settings');
  assert(!wfSrc.includes('hooks.openSeparation'), 'waveform button must not open a nested separation modal');
  assert(wfSrc.includes('retryConvert'), 'retry hook');
  const appSrc = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'app.js'), 'utf8');
  assert(appSrc.includes('getConvertState'), 'app provides convert state to waveform');
  assert(appSrc.includes('getTranscriptionControls(clipId)'), 'app exposes current transcription settings to waveform');
  assert(appSrc.includes('return self.downloadNativeAudioClip(clipId)'), 'waveform hook reuses the browser-local original download');
  assert(appSrc.includes("Object.prototype.hasOwnProperty.call(opts, 'separateFirst')"), 'clip conversion accepts an explicit separation override');
  console.log('PASS waveform convert status UI');
})();
