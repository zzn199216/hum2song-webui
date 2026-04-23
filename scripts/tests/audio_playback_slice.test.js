#!/usr/bin/env node
/**
 * Slice B: audio playback scheduling helper + flatten integration (no Tone runtime).
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

function loadAudioController(){
  return require(path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'audio_controller.js'));
}

function testComputeMatchesFlattenMixed(){
  const P = loadH2SProject();
  const AC = loadAudioController();
  const { computeAudioPlaybackSchedule } = AC;

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
  const flat = P.flatten(p2);
  assert.ok(Array.isArray(flat.audioSegments) && flat.audioSegments.length === 1, 'flatten emits one audio segment');

  const metaByTrackId = new Map();
  for (const t of p2.tracks){
    const id = t.trackId || t.id;
    metaByTrackId.set(id, { muted: !!t.muted, gainDb: Number.isFinite(Number(t.gainDb)) ? Number(t.gainDb) : 0 });
  }

  const startAt = 0;
  const sched = computeAudioPlaybackSchedule(flat, startAt, metaByTrackId);
  assert.strictEqual(sched.items.length, 1, 'one schedule row');
  assert.strictEqual(sched.items[0].assetRef, 'blob:test');
  assert.strictEqual(sched.items[0].t, 0);
  assert.ok(Math.abs(sched.items[0].dur - 2) < 1e-9, 'duration sec');
  assert.strictEqual(sched.skipped.length, 0);
}

function testMutedTrackSkipped(){
  const P = loadH2SProject();
  const AC = loadAudioController();
  const { computeAudioPlaybackSchedule } = AC;

  const flat = {
    bpm: 120,
    tracks: [],
    audioSegments: [
      { trackId: 'tMuted', startSec: 0, durationSec: 1, clipId: 'c', instanceId: 'i', assetRef: 'x' },
    ],
  };
  const metaByTrackId = new Map([['tMuted', { muted: true, gainDb: 0 }]]);
  const sched = computeAudioPlaybackSchedule(flat, 0, metaByTrackId);
  assert.strictEqual(sched.items.length, 0);
  assert.ok(sched.skipped.some(s => s.reason === 'muted'));
}

function testEmptyAssetRefSkipped(){
  const AC = loadAudioController();
  const { computeAudioPlaybackSchedule } = AC;
  const flat = {
    audioSegments: [{ trackId: 't1', startSec: 0, durationSec: 1, clipId: 'c', instanceId: 'i', assetRef: '  ' }],
  };
  const metaByTrackId = new Map([['t1', { muted: false, gainDb: 0 }]]);
  const sched = computeAudioPlaybackSchedule(flat, 0, metaByTrackId);
  assert.strictEqual(sched.items.length, 0);
  assert.ok(sched.skipped.some(s => s.reason === 'empty_assetRef'));
}

function testNoteOnlyFlattenNoAudioItems(){
  const P = loadH2SProject();
  const AC = loadAudioController();
  const { computeAudioPlaybackSchedule } = AC;

  const projectV1 = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/fixtures/frontend/project_2026-01-06_v1.json'), 'utf8'));
  const p2 = P.migrateProjectV1toV2(projectV1);
  const flat = P.flatten(p2);
  assert.ok(Array.isArray(flat.audioSegments));
  assert.strictEqual(flat.audioSegments.length, 0, 'fixture has no audio clips');

  const metaByTrackId = new Map();
  for (const t of p2.tracks){
    const id = t.trackId || t.id;
    metaByTrackId.set(id, { muted: !!t.muted, gainDb: 0 });
  }
  const sched = computeAudioPlaybackSchedule(flat, 0, metaByTrackId);
  assert.strictEqual(sched.items.length, 0);
}

function testGainDbPassedThrough(){
  const AC = loadAudioController();
  const { computeAudioPlaybackSchedule } = AC;
  const flat = {
    audioSegments: [{ trackId: 't1', startSec: 1, durationSec: 0.5, clipId: 'c', instanceId: 'i', assetRef: 'http://x/a.mp3' }],
  };
  const metaByTrackId = new Map([['t1', { muted: false, gainDb: -6 }]]);
  const sched = computeAudioPlaybackSchedule(flat, 0.5, metaByTrackId);
  assert.strictEqual(sched.items.length, 1);
  assert.strictEqual(sched.items[0].gainDb, -6);
  assert.ok(Math.abs(sched.items[0].t - 0.5) < 1e-9, 'relative start');
}

function main(){
  testComputeMatchesFlattenMixed();
  testMutedTrackSkipped();
  testEmptyAssetRefSkipped();
  testNoteOnlyFlattenNoAudioItems();
  testGainDbPassedThrough();
  console.log('audio_playback_slice.test.js: all passed');
}

main();
