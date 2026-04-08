#!/usr/bin/env node
/**
 * Slice D: native audio clip creation + v1 migrate path for audio (persist round-trip).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..', '..');

function loadH2SProject(){
  const w = {};
  const m = { exports: {} };
  const ctx = vm.createContext({
    window: w,
    globalThis: w,
    console,
    module: m,
    exports: m.exports,
    setTimeout,
    clearTimeout,
  });
  const p = path.join(repoRoot, 'static', 'pianoroll', 'project.js');
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: 'project.js' });
  const api = ctx.window.H2SProject;
  assert.ok(api, 'H2SProject');
  return api;
}

function testCreateClipFromAudioNormalizeFlatten(){
  const P = loadH2SProject();
  const c = P.createClipFromAudio({ assetRef: 'blob:session-test', durationSec: 2.5, name: 'Imported', bpm: 120 });
  assert.strictEqual(c.kind, 'audio');
  assert.strictEqual(c.audio.assetRef, 'blob:session-test');
  assert.ok(Math.abs(c.audio.durationSec - 2.5) < 1e-9);
  assert.ok(c.meta && typeof c.meta.spanBeat === 'number' && c.meta.spanBeat > 0, 'spanBeat derived');

  const p2 = P.defaultProjectV2();
  p2.bpm = 120;
  p2.clips[c.id] = c;
  p2.clipOrder = [c.id];
  const tid = (p2.tracks && p2.tracks[0] && (p2.tracks[0].trackId || p2.tracks[0].id)) ? String(p2.tracks[0].trackId || p2.tracks[0].id) : P.SCHEMA_V2.DEFAULT_TRACK_ID;
  p2.instances = [{ id: 'inst_import_test', clipId: c.id, trackId: tid, startBeat: 0, transpose: 0 }];
  P.normalizeProjectV2(p2);
  assert.strictEqual(P.clipKind(p2.clips[c.id]), 'audio');

  const flat = P.flatten(p2);
  assert.ok(Array.isArray(flat.audioSegments) && flat.audioSegments.length === 1);
  assert.strictEqual(flat.audioSegments[0].assetRef, 'blob:session-test');
}

function testMigrateV1AudioRoundTrip(){
  const P = loadH2SProject();
  const v1 = {
    version: 1,
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1' }],
    clips: [{
      id: 'ca',
      kind: 'audio',
      name: 'Hum',
      createdAt: 1,
      audio: { assetRef: 'blob:roundtrip', durationSec: 3 },
      score: { version: 1, tempo_bpm: 120, time_signature: null, tracks: [] },
    }],
    instances: [],
    ui: { pxPerSec: 160, playheadSec: 0 },
  };
  const p2 = P.migrateProjectV1toV2(v1);
  assert.strictEqual(p2.clips['ca'].kind, 'audio');
  assert.strictEqual(p2.clips['ca'].audio.assetRef, 'blob:roundtrip');
  assert.strictEqual(P.clipKind(p2.clips['ca']), 'audio');
  assert.ok(!('score' in p2.clips['ca']) || p2.clips['ca'].score === undefined);
}

function testMigrateV1NoteUnchanged(){
  const P = loadH2SProject();
  const v1 = {
    version: 1,
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1' }],
    clips: [{
      id: 'n1',
      name: 'Melody',
      createdAt: 1,
      score: {
        version: 1,
        tempo_bpm: 120,
        time_signature: null,
        tracks: [{ id: 't0', name: '', notes: [{ pitch: 60, velocity: 100, start: 0, duration: 0.5 }] }],
      },
    }],
    instances: [],
    ui: { pxPerSec: 160, playheadSec: 0 },
  };
  const p2 = P.migrateProjectV1toV2(v1);
  assert.strictEqual(P.clipKind(p2.clips['n1']), 'note');
  assert.ok(p2.clips['n1'].score && Array.isArray(p2.clips['n1'].score.tracks));
}

(function main(){
  testCreateClipFromAudioNormalizeFlatten();
  console.log('PASS audio direct import: createClipFromAudio + flatten');
  testMigrateV1AudioRoundTrip();
  console.log('PASS audio direct import: migrate v1 audio');
  testMigrateV1NoteUnchanged();
  console.log('PASS audio direct import: migrate v1 note still note');
})();
