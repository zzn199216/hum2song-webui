#!/usr/bin/env node
'use strict';

// BPM invariants tests (pure numeric; no DOM/Tone).
// Purpose: lock the "beats are truth" rule and "pxPerBeat does not drift" rule.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

function repoPath(p){
  return path.join(process.cwd(), p);
}

function readJson(p){
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadH2SProject(){
  const projectJsPath = repoPath('static/pianoroll/project.js');
  const code = fs.readFileSync(projectJsPath, 'utf8');
  const sandbox = {
    window: {},
    console,
    setTimeout,
    clearTimeout,
    // minimal globals used by some helpers
    Date,
    Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'static/pianoroll/project.js' });
  const api = sandbox.window.H2SProject || sandbox.H2SProject;
  if(!api){
    throw new Error('H2SProject not found after loading static/pianoroll/project.js');
  }
  return api;
}

function pickExistingFixture(){
  const candidates = [
    repoPath('tests/fixtures/frontend/project_v1_sample.json'),
    repoPath('tests/fixtures/frontend/project_v1.json'),
    repoPath('tests/fixtures/frontend/project.json'),
  ];
  for(const p of candidates){
    if(fs.existsSync(p)) return p;
  }
  throw new Error('No project v1 fixture found under tests/fixtures/frontend/.');
}

function snapshotBeats(projectV2){
  // Build a host-realm snapshot that is stable and comparable.
  const clipOrder = Array.from(projectV2.clipOrder || []);
  const insts = Array.from(projectV2.instances || []).map(inst => ({
    id: String(inst.id),
    clipId: String(inst.clipId),
    trackId: String(inst.trackId),
    startBeat: Number(inst.startBeat),
    transpose: Number(inst.transpose || 0),
  })).sort((a,b)=>a.id.localeCompare(b.id));

  const clips = clipOrder.map(clipId => {
    const clip = projectV2.clips[clipId];
    const score = clip && clip.score;
    const tracks = Array.from((score && score.tracks) || []).map(t => {
      const notes = Array.from(t.notes || []).map(n => ({
        id: String(n.id),
        pitch: Number(n.pitch),
        velocity: Number(n.velocity),
        startBeat: Number(n.startBeat),
        durationBeat: Number(n.durationBeat),
      })).sort((a,b)=>a.id.localeCompare(b.id));
      return { id: String(t.id), name: String(t.name || ''), notes };
    }).sort((a,b)=>a.id.localeCompare(b.id));
    return {
      id: String(clip.id),
      clipId: String(clipId),
      name: String(clip.name || ''),
      tracks,
    };
  });

  return {
    version: Number(projectV2.version),
    timebase: String(projectV2.timebase),
    bpm: Number(projectV2.bpm),
    pxPerBeat: Number(projectV2.ui && projectV2.ui.pxPerBeat),
    playheadBeat: Number(projectV2.ui && projectV2.ui.playheadBeat),
    clipOrder,
    instances: insts,
    clips,
  };
}

function findComparableEventPair(eventsOld, eventsNew){
  // Find first note with startSec > 0 to avoid division by 0.
  const oldNotes = (eventsOld.tracks || []).flatMap(t => t.notes || []);
  const newNotes = (eventsNew.tracks || []).flatMap(t => t.notes || []);

  // index new by (clipId, instanceId, noteId)
  const idx = new Map();
  for(const n of newNotes){
    idx.set(`${n.clipId}|${n.instanceId}|${n.noteId}`, n);
  }
  for(const o of oldNotes){
    if(!(o.startSec > 0)) continue;
    const k = `${o.clipId}|${o.instanceId}|${o.noteId}`;
    const n = idx.get(k);
    if(n && n.startSec > 0){
      return { o, n };
    }
  }
  return null;
}

function main(){
  console.log('[bpm] Test D/E: bpm change preserves beats + pxPerBeat, only affects derived seconds');
  const H = loadH2SProject();
  const fixturePath = pickExistingFixture();
  const v1 = readJson(fixturePath);

  const p2 = H.migrateProjectV1toV2(v1);
  const oldBpm = Number(p2.bpm);
  const oldSnap = snapshotBeats(p2);
  const evOld = H.flatten(p2);

  const newBpm = oldBpm === 120 ? 150 : (oldBpm + 30);
  p2.bpm = newBpm;
  // mimic app-level safety normalize (should not alter beats semantics)
  if(typeof H.normalizeProjectV2 === 'function'){
    H.normalizeProjectV2(p2);
  }
  const newSnap = snapshotBeats(p2);

  // D) pxPerBeat MUST NOT drift
  assert.strictEqual(newSnap.pxPerBeat, oldSnap.pxPerBeat, 'ui.pxPerBeat must not change when bpm changes');

  // E) beats fields MUST NOT change when bpm changes
  // We'll compare the entire beats snapshot except bpm.
  const { bpm: _bpm0, ...oldNoBpm } = oldSnap;
  const { bpm: _bpm1, ...newNoBpm } = newSnap;
  assert.deepStrictEqual(newNoBpm, oldNoBpm, 'beats snapshot must be identical after bpm change (except bpm)');

  // Derived seconds MUST change proportionally.
  const evNew = H.flatten(p2);
  const pair = findComparableEventPair(evOld, evNew);
  if(pair){
    const ratioStart = pair.n.startSec / pair.o.startSec;
    const ratioDur = pair.n.durationSec / pair.o.durationSec;
    const expected = oldBpm / newBpm;
    assert.ok(Math.abs(ratioStart - expected) < 1e-6, `startSec scaling mismatch: got ${ratioStart}, expected ${expected}`);
    assert.ok(Math.abs(ratioDur - expected) < 1e-6, `durationSec scaling mismatch: got ${ratioDur}, expected ${expected}`);
  } else {
    // Fallback: if there is no note with startSec>0, at least check duration scaling on any note.
    const oldNotes = (evOld.tracks || []).flatMap(t => t.notes || []);
    const newNotes = (evNew.tracks || []).flatMap(t => t.notes || []);
    if(oldNotes.length && newNotes.length){
      const expected = oldBpm / newBpm;
      const ratioDur = newNotes[0].durationSec / oldNotes[0].durationSec;
      assert.ok(Math.abs(ratioDur - expected) < 1e-6, `durationSec scaling mismatch: got ${ratioDur}, expected ${expected}`);
    }
  }

  console.log('PASS bpm invariants (beats stable; pxPerBeat stable; seconds derived scale)');
}

main();
