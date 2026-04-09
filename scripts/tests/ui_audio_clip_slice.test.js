#!/usr/bin/env node
/**
 * Slice C: library + timeline distinguish audio vs note; guards + v1 projection smoke (source).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');

function testLibraryAudioVsNote(){
  const libView = require(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'library_view.js'));
  const fmtSec = (x) => String(x) + 's';
  const escapeHtml = (s) => String(s);

  const audioClip = { id: 'a1', name: 'Hum', kind: 'audio' };
  const audioStats = { count: 0, spanSec: 3.5 };
  const htmlA = libView.clipCardInnerHTML(audioClip, audioStats, fmtSec, escapeHtml);
  assert(/clip-card-audio/.test(htmlA), 'audio card class');
  assert(/data-clip-kind="audio"/.test(htmlA), 'data-clip-kind audio');
  assert(!/\b0\s+notes\b/.test(htmlA), 'audio must not show 0 notes');
  assert(/Original audio/.test(htmlA) && /3\.5s/.test(htmlA), 'audio badge + duration subline');
  assert(!/<button[^>]*data-act="edit"/.test(htmlA), 'audio card must not show edit');
  assert(!/<button[^>]*data-act="optimize"/.test(htmlA), 'audio card must not show optimize');
  assert(/data-act="convertToEditable"/.test(htmlA), 'audio card shows convert to editable');
  assert(/Convert to editable/.test(htmlA), 'audio convert button label');

  const noteClip = { id: 'n1', name: 'Melody' };
  const noteStats = { count: 5, spanSec: 2 };
  const htmlN = libView.clipCardInnerHTML(noteClip, noteStats, fmtSec, escapeHtml);
  assert(!/clip-card-audio/.test(htmlN), 'note card not audio styled');
  assert(/data-clip-kind="note"/.test(htmlN), 'data-clip-kind note');
  assert(/\b5\s+notes\b/.test(htmlN), 'note count subline');
  assert(!/<button[^>]*data-act="edit"[^>]*disabled/.test(htmlN), 'note edit not disabled');
  assert(!/<button[^>]*data-act="optimize"[^>]*disabled/.test(htmlN), 'note optimize not disabled');
  assert(!/data-act="convertToEditable"/.test(htmlN), 'note card must not show convert to editable');
}

function testTimelineAudioVsNote(){
  const tv = require(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'timeline_view.js'));
  const fmtSec = (x) => String(x) + 's';
  const escapeHtml = (s) => String(s);

  const htmlA = tv.instanceInnerHTML({
    clipName: 'FX',
    startSec: 0,
    spanSec: 4,
    noteCount: 0,
    isAudio: true,
    fmtSec,
    escapeHtml,
  });
  assert(/inst-badge/.test(htmlA), 'badge');
  assert(/Original audio/.test(htmlA), 'audio badge label');
  assert(!/\b0\s+notes\b/.test(htmlA), 'no 0 notes for audio');
  assert(!/data-act="instEdit"/.test(htmlA), 'audio instance must not show instEdit');
  assert(!/data-act="instOptimize"/.test(htmlA), 'audio instance must not show instOptimize');

  const htmlN = tv.instanceInnerHTML({
    clipName: 'Melody',
    startSec: 1,
    spanSec: 2,
    noteCount: 7,
    isAudio: false,
    fmtSec,
    escapeHtml,
  });
  assert(/\b7\s+notes\b/.test(htmlN), 'note sub');
  assert(!/<button[^>]*data-act="instEdit"[^>]*disabled/.test(htmlN), 'note inst edit not disabled');
}

function testAppV1ProjectionSource(){
  const appPath = path.join(repoRoot, 'static', 'pianoroll', 'app.js');
  const src = fs.readFileSync(appPath, 'utf8');
  assert(src.includes("P.clipKind(c) === 'audio'"), 'v2 audio branch in _projectV2ToV1View');
  assert(src.includes("clipV1.kind = 'audio'"), 'clipV1 kind audio');
  assert(src.includes('clipV1.audio'), 'clipV1 audio field');
}

function testGuardsSource(){
  const agentPath = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'agent_controller.js');
  assert(fs.readFileSync(agentPath, 'utf8').includes('audio_clip_not_supported'), 'agent optimize guard');

  const edPath = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'editor_runtime.js');
  const edSrc = fs.readFileSync(edPath, 'utf8');
  assert(
    edSrc.includes('msg.audioClipNoEditor') || edSrc.includes('Audio clips cannot'),
    'editor guard message'
  );

  const libPath = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'library_controller.js');
  const libSrc = fs.readFileSync(libPath, 'utf8');
  assert(/clipKind\([^\)]*\)\s*===\s*['"]audio['"]/.test(libSrc), 'library controller audio guard');
}

function testImportWordingInIndexHtml(){
  const indexPath = path.join(repoRoot, 'static', 'pianoroll', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  assert(html.includes('data-i18n="top.uploadWav"'), 'top bar transcribe import key');
  assert(html.includes('data-i18n="top.importAudioClip"'), 'top bar native audio import key');
  assert(html.includes('data-i18n-title="top.uploadWavTitle"'), 'transcribe import title key');
}

function testRecordToNativeAudioWiring(){
  const indexPath = path.join(repoRoot, 'static', 'pianoroll', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  assert(html.includes('id="btnAddLastAsAudio"'), 'Add last as audio button');
  assert(html.includes('data-i18n="cliplib.addLastAsAudio"'), 'add last as audio i18n');
  const appPath = path.join(repoRoot, 'static', 'pianoroll', 'app.js');
  const src = fs.readFileSync(appPath, 'utf8');
  assert(src.includes('_commitNativeAudioFile'), 'shared _commitNativeAudioFile');
  assert(src.includes('addLastRecordingAsNativeAudioClip'), 'addLastRecordingAsNativeAudioClip');
  assert(src.includes('lastRecordedFile') && src.includes('addLastRecordingAsNativeAudioClip'), 'lastRecordedFile guard on record→audio path');
  const impIdx = src.indexOf('async importAudioFileAsNativeClip');
  assert(impIdx >= 0 && src.indexOf('_commitNativeAudioFile', impIdx) > impIdx, 'importAudioFileAsNativeClip uses _commitNativeAudioFile');
}

function testConvertAudioToEditableWiring(){
  const libPath = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'library_controller.js');
  const libSrc = fs.readFileSync(libPath, 'utf8');
  assert(libSrc.includes("act === 'convertToEditable'"), 'library handles convertToEditable');
  assert(/clipKind\([^\)]*\)\s*===\s*['"]audio['"]/.test(libSrc) && libSrc.indexOf('convertToEditable') > 0, 'convert gated to audio clips');

  const lasPath = path.join(repoRoot, 'static', 'pianoroll', 'core', 'local_audio_assets.js');
  const lasSrc = fs.readFileSync(lasPath, 'utf8');
  assert(lasSrc.includes('getFileForLocalAssetRef'), 'local audio exposes getFileForLocalAssetRef');

  const appPath = path.join(repoRoot, 'static', 'pianoroll', 'app.js');
  const appSrc = fs.readFileSync(appPath, 'utf8');
  assert(appSrc.includes('convertAudioClipToEditable'), 'app defines convertAudioClipToEditable');
  assert(
    appSrc.includes('convertAudioClipToEditable') && appSrc.includes('uploadFileAndGenerate'),
    'convert path delegates to uploadFileAndGenerate'
  );
  assert(
    /uploadFileAndGenerate\s*\(\s*file\s*,\s*\{\s*sourceAudioClipId\s*:\s*clipId\s*\}/.test(appSrc),
    'convert passes sourceAudioClipId for placement + provenance'
  );
  assert(
    appSrc.includes('getFileForLocalAssetRef') && appSrc.includes('isLocalImportedAudioRef'),
    'convert resolves localidb file before upload'
  );

  const enPath = path.join(repoRoot, 'static', 'i18n', 'locales', 'en.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  assert(en['cliplib.convertToEditable'] && en['cliplib.convertToEditableTitle'], 'en i18n convert keys');
}

function testMixedProjectH2S(){
  global.window = global.window || {};
  require(path.join(repoRoot, 'static', 'pianoroll', 'project.js'));
  const P = global.window.H2SProject;
  const tid = P.SCHEMA_V2.DEFAULT_TRACK_ID;
  const p2 = P.defaultProjectV2();
  p2.bpm = 120;
  p2.clips['ca'] = {
    id: 'ca',
    kind: 'audio',
    name: 'A',
    createdAt: 1,
    audio: { assetRef: 'blob:test', durationSec: 2 },
    meta: { notes: 0, pitchMin: null, pitchMax: null, spanBeat: 0, sourceTempoBpm: null },
  };
  const cn = P.createClipFromScoreBeat({
    version: 2,
    tempo_bpm: null,
    time_signature: null,
    tracks: [{ id: 's0', name: '', notes: [{ id: 'n1', pitch: 60, velocity: 100, startBeat: 0, durationBeat: 1 }] }],
  }, { id: 'cn', name: 'N' });
  p2.clips['cn'] = cn;
  p2.clipOrder = ['ca', 'cn'];
  p2.instances = [
    { id: 'ia', clipId: 'ca', trackId: tid, startBeat: 0, transpose: 0 },
    { id: 'in', clipId: 'cn', trackId: tid, startBeat: 4, transpose: 0 },
  ];
  P.normalizeProjectV2(p2);
  assert.strictEqual(P.clipKind(p2.clips['ca']), 'audio');
  assert.strictEqual(P.clipKind(p2.clips['cn']), 'note');
  const flat = P.flatten(p2);
  assert.ok(Array.isArray(flat.audioSegments) && flat.audioSegments.length >= 1, 'flatten audio segments');
}

(function main(){
  testLibraryAudioVsNote();
  console.log('PASS ui slice: library audio vs note');
  testTimelineAudioVsNote();
  console.log('PASS ui slice: timeline audio vs note');
  testImportWordingInIndexHtml();
  console.log('PASS ui slice: import wording keys in index.html');
  testRecordToNativeAudioWiring();
  console.log('PASS ui slice: record → native audio wiring');
  testAppV1ProjectionSource();
  console.log('PASS ui slice: app v1 projection source');
  testGuardsSource();
  console.log('PASS ui slice: guard sources');
  testMixedProjectH2S();
  console.log('PASS ui slice: mixed project H2S');
  testConvertAudioToEditableWiring();
  console.log('PASS ui slice: convert audio → editable wiring');
})();
