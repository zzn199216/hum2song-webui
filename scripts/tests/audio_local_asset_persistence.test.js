#!/usr/bin/env node
/**
 * Slice E: localidb assetRef helpers + playback resolution (Node: no IndexedDB / no Tone).
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
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'project.js'), 'utf8'), ctx, { filename: 'project.js' });
  return ctx.window.H2SProject;
}

function testLocalAudioAssetsModule(){
  const LA = require(path.join(repoRoot, 'static', 'pianoroll', 'core', 'local_audio_assets.js'));
  assert.strictEqual(LA.LOCAL_AUDIO_ASSET_PREFIX, 'localidb:');
  assert.strictEqual(LA.isLocalImportedAudioRef('localidb:la_x'), true);
  assert.strictEqual(LA.isLocalImportedAudioRef('blob:http://x'), false);
  assert.strictEqual(LA.localAssetIdFromRef('localidb:la_abc'), 'la_abc');
  assert.strictEqual(LA.localAssetIdFromRef('http://x'), null);
  return LA.resolveAssetRefToPlaybackUrl('https://example.com/a.wav').then(function(r){
    assert.ok(r && r.url === 'https://example.com/a.wav' && r.revoke == null);
    return LA.resolveAssetRefToPlaybackUrl('localidb:la_missing');
  }).then(function(r2){
    assert.strictEqual(r2, null);
  });
}

function testAudioControllerResolveWithoutBrowserStore(){
  const AC = require(path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'audio_controller.js'));
  assert.strictEqual(typeof AC.resolveAssetRefForTone, 'function');
  return AC.resolveAssetRefForTone('blob:https://test').then(function(r){
    assert.ok(r && r.url === 'blob:https://test' && r.revoke == null);
    return AC.resolveAssetRefForTone('localidb:la_only');
  }).then(function(r2){
    assert.strictEqual(r2, null);
  });
}

function testFlattenKeepsLocalIdbRef(){
  const P = loadH2SProject();
  const c = P.createClipFromAudio({
    assetRef: 'localidb:la_test123',
    durationSec: 2,
    name: 'Local',
    bpm: 120,
  });
  const p2 = P.defaultProjectV2();
  p2.bpm = 120;
  p2.clips[c.id] = c;
  p2.clipOrder = [c.id];
  const tid = P.SCHEMA_V2.DEFAULT_TRACK_ID;
  p2.instances = [{ id: 'inst_e', clipId: c.id, trackId: tid, startBeat: 0, transpose: 0 }];
  P.normalizeProjectV2(p2);
  const flat = P.flatten(p2);
  assert.strictEqual(flat.audioSegments.length, 1);
  assert.strictEqual(flat.audioSegments[0].assetRef, 'localidb:la_test123');
}

function testNoteClipStillNote(){
  const P = loadH2SProject();
  const cn = P.createClipFromScoreBeat({
    version: 2,
    tracks: [{ id: 't0', name: '', notes: [{ id: 'n1', pitch: 60, velocity: 100, startBeat: 0, durationBeat: 1 }] }],
  }, { id: 'cn', name: 'N' });
  assert.strictEqual(P.clipKind(cn), 'note');
}

async function main(){
  await testLocalAudioAssetsModule();
  console.log('PASS local asset: module helpers + non-local URL resolution');
  await testAudioControllerResolveWithoutBrowserStore();
  console.log('PASS local asset: audio_controller resolve without LAS');
  testFlattenKeepsLocalIdbRef();
  console.log('PASS local asset: flatten preserves localidb assetRef');
  testNoteClipStillNote();
  console.log('PASS local asset: note clip unchanged');
}

if (require.main === module){
  main().catch(function(e){
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };
