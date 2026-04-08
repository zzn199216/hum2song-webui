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
  assert(/Audio/.test(htmlA) && /3\.5s/.test(htmlA), 'audio subtitle duration');
  assert(/<button[^>]*data-act="edit"[^>]*disabled/.test(htmlA), 'edit disabled');
  assert(/<button[^>]*data-act="optimize"[^>]*disabled/.test(htmlA), 'optimize disabled');

  const noteClip = { id: 'n1', name: 'Melody' };
  const noteStats = { count: 5, spanSec: 2 };
  const htmlN = libView.clipCardInnerHTML(noteClip, noteStats, fmtSec, escapeHtml);
  assert(!/clip-card-audio/.test(htmlN), 'note card not audio styled');
  assert(/data-clip-kind="note"/.test(htmlN), 'data-clip-kind note');
  assert(/\b5\s+notes\b/.test(htmlN), 'note count subline');
  assert(!/<button[^>]*data-act="edit"[^>]*disabled/.test(htmlN), 'note edit not disabled');
  assert(!/<button[^>]*data-act="optimize"[^>]*disabled/.test(htmlN), 'note optimize not disabled');
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
  assert(!/\b0\s+notes\b/.test(htmlA), 'no 0 notes for audio');
  assert(/<button[^>]*data-act="instEdit"[^>]*disabled/.test(htmlA), 'inst edit disabled');
  assert(/<button[^>]*data-act="instOptimize"[^>]*disabled/.test(htmlA), 'inst optimize disabled');

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
  testAppV1ProjectionSource();
  console.log('PASS ui slice: app v1 projection source');
  testGuardsSource();
  console.log('PASS ui slice: guard sources');
  testMixedProjectH2S();
  console.log('PASS ui slice: mixed project H2S');
})();
