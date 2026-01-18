#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const REPO_ROOT = process.cwd();

function readJson(relPath){
  const p = path.join(REPO_ROOT, relPath);
  const txt = fs.readFileSync(p, 'utf8');
  return JSON.parse(txt);
}

function loadH2SProject(){
  const projectJsPath = path.join(REPO_ROOT, 'static', 'pianoroll', 'project.js');
  const code = fs.readFileSync(projectJsPath, 'utf8');

  // Minimal browser-like sandbox
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
  };

  // Provide crypto.randomUUID fallback
  const nodeCrypto = require('crypto');
  sandbox.crypto = {
    randomUUID: nodeCrypto.randomUUID ? () => nodeCrypto.randomUUID() : undefined,
  };

  // window/global
  sandbox.window = {};
  sandbox.window.window = sandbox.window;
  sandbox.window.crypto = sandbox.crypto;
  sandbox.globalThis = sandbox.window;

  // Some front-end code may reference these; keep as safe no-ops
  sandbox.document = {};
  sandbox.localStorage = {
    getItem(){ return null; },
    setItem(){},
    removeItem(){},
    key(){ return null; },
    get length(){ return 0; }
  };

  vm.runInNewContext(code, sandbox, { filename: 'static/pianoroll/project.js' });

  const api = sandbox.window.H2SProject || sandbox.window.Project || sandbox.H2SProject;
  assert(api, 'H2SProject API not found on window after loading static/pianoroll/project.js');
  return api;
}

function collectNotes(score){
  const out = [];
  const tracks = score.tracks || [];
  for(const t of tracks){
    for(const n of (t.notes || [])) out.push(n);
  }
  return out;
}

function approxEqual(a, b, tol, msg){
  if(Number.isNaN(a) || Number.isNaN(b)){
    assert.fail(`NaN encountered: ${msg} (a=${a}, b=${b})`);
  }
  if(Math.abs(a - b) > tol){
    assert.fail(`${msg}: |${a} - ${b}| > ${tol}`);
  }
}

function stableKey(n){
  // For id-less notes: build a deterministic key with rounded sec values.
  const s = (typeof n.start === 'number') ? n.start : (typeof n.startSec === 'number' ? n.startSec : 0);
  const d = (typeof n.duration === 'number') ? n.duration : (typeof n.durationSec === 'number' ? n.durationSec : 0);
  return [n.pitch, Math.round(s*1e6), Math.round(d*1e6), n.velocity ?? 0].join('|');
}

function testScoreRoundTrip(H2SProject, fixtureRelPath){
  const scoreSec = readJson(fixtureRelPath);
  const bpm = (() => {
    const t = scoreSec.tempo_bpm ?? scoreSec.bpm;
    if(typeof t === 'number' && t >= 40 && t <= 240) return t;
    return 120;
  })();

  assert(typeof H2SProject.scoreSecToBeat === 'function', 'scoreSecToBeat not found');
  assert(typeof H2SProject.scoreBeatToSec === 'function', 'scoreBeatToSec not found');

  const scoreBeat = H2SProject.scoreSecToBeat(scoreSec, bpm);
  const scoreSec2 = H2SProject.scoreBeatToSec(scoreBeat, bpm);

  const a = collectNotes(scoreSec);
  const b = collectNotes(scoreSec2);

  assert.strictEqual(b.length, a.length, `note count must match for ${fixtureRelPath}`);

  const allHaveId = a.every(n => typeof n.id === 'string' && n.id.length > 0);

  if(allHaveId){
    const mapB = new Map(b.map(n => [n.id, n]));
    for(const n1 of a){
      const n2 = mapB.get(n1.id);
      assert(n2, `missing note id after roundtrip: ${n1.id}`);
      assert.strictEqual(n2.pitch, n1.pitch, `pitch mismatch for id=${n1.id}`);
      assert.strictEqual(n2.velocity, n1.velocity, `velocity mismatch for id=${n1.id}`);
      approxEqual(n2.start, n1.start, 1e-4, `startSec mismatch for id=${n1.id}`);
      approxEqual(n2.duration, n1.duration, 1e-4, `durationSec mismatch for id=${n1.id}`);
    }
  } else {
    // If input lacks ids, conversion is allowed to add ids, but timing/pitch/vel must be preserved.
    assert(b.every(n => typeof n.id === 'string' && n.id.length > 0), 'roundtrip notes must have ids even if input does not');

    const sa = [...a].sort((x,y)=> (x.pitch-y.pitch) || (x.start-y.start) || (x.duration-y.duration) || ((x.velocity??0)-(y.velocity??0)));
    const sb = [...b].sort((x,y)=> (x.pitch-y.pitch) || (x.start-y.start) || (x.duration-y.duration) || ((x.velocity??0)-(y.velocity??0)));

    for(let i=0;i<sa.length;i++){
      const n1 = sa[i], n2 = sb[i];
      assert.strictEqual(n2.pitch, n1.pitch, `pitch mismatch @${i}`);
      assert.strictEqual(n2.velocity, n1.velocity, `velocity mismatch @${i}`);
      approxEqual(n2.start, n1.start, 1e-4, `startSec mismatch @${i}`);
      approxEqual(n2.duration, n1.duration, 1e-4, `durationSec mismatch @${i}`);
    }
  }

  // Optional: spanBeat consistency if helper exists
  if(typeof H2SProject.recomputeScoreBeatStats === 'function'){
    const stats = H2SProject.recomputeScoreBeatStats(scoreBeat);
    // recomputeScoreBeatStats should at least have spanBeat
    if(stats && typeof stats.spanBeat === 'number'){
      const manual = (() => {
        let maxEnd = 0;
        for(const n of collectNotes(scoreBeat)){
          const sb = n.startBeat ?? 0;
          const db = n.durationBeat ?? 0;
          const end = sb + db;
          if(end > maxEnd) maxEnd = end;
        }
        return maxEnd;
      })();
      approxEqual(stats.spanBeat, manual, 1e-9, `spanBeat must match recompute for ${fixtureRelPath}`);
    }
  }
}

function getV1PlayheadSec(p){
  if(p && p.ui && typeof p.ui.playheadSec === 'number') return p.ui.playheadSec;
  if(typeof p.playheadSec === 'number') return p.playheadSec;
  return 0;
}

function getV1InstanceStartSec(inst){
  if(typeof inst.startSec === 'number') return inst.startSec;
  if(typeof inst.start === 'number') return inst.start;
  return 0;
}

function testProjectMigration(H2SProject, fixtureRelPath){
  const p1 = readJson(fixtureRelPath);
  assert.strictEqual(p1.version, 1, 'fixture must be v1 project');
  assert(typeof H2SProject.migrateProjectV1toV2 === 'function', 'migrateProjectV1toV2 not found');
  assert(typeof H2SProject.beatToSec === 'function', 'beatToSec not found');

  const p2 = H2SProject.migrateProjectV1toV2(p1);

  assert.strictEqual(p2.version, 2, 'migrated project must be version 2');
  assert.strictEqual(p2.timebase, 'beat', 'migrated project must have timebase=beat');

  // clipOrder preserves original clip list order
  const clipIdsV1 = (p1.clips || []).map(c => c.id);
  // NOTE: p2 is created in a vm context; Array prototypes differ across realms.
  // Convert to a host Array before deepStrictEqual to avoid prototype mismatch.
  assert.deepStrictEqual(Array.from(p2.clipOrder || []), clipIdsV1, 'clipOrder must preserve v1 clips[] order');

  // clips map contains all ids
  for(const cid of clipIdsV1){
    assert(p2.clips && p2.clips[cid], `missing clip in v2 clips map: ${cid}`);
  }

  // instances count and IDs preserved
  assert.strictEqual(p2.instances.length, (p1.instances||[]).length, 'instances length must match');
  const map1 = new Map((p1.instances||[]).map(i => [i.id, i]));
  const map2 = new Map((p2.instances||[]).map(i => [i.id, i]));
  for(const [iid, inst1] of map1.entries()){
    const inst2 = map2.get(iid);
    assert(inst2, `missing migrated instance id=${iid}`);

    const s1 = getV1InstanceStartSec(inst1);
    const s2 = H2SProject.beatToSec(inst2.startBeat, p2.bpm);
    approxEqual(s2, s1, 1e-4, `instance startSec mismatch for id=${iid}`);
  }

  // playhead sec -> beat -> sec consistency
  const ph1 = getV1PlayheadSec(p1);
  const ph2 = H2SProject.beatToSec(p2.ui.playheadBeat, p2.bpm);
  approxEqual(ph2, ph1, 1e-4, 'playheadSec mismatch after migration');

  // No leftover sec fields (best-effort)
  assert(!('playheadSec' in (p2.ui||{})), 'v2 ui must not contain playheadSec');
  assert(!('pxPerSec' in (p2.ui||{})), 'v2 ui must not contain pxPerSec');
  // ensure instances do not contain startSec/trackIndex
  for(const inst of p2.instances){
    assert(!('startSec' in inst), 'v2 instance must not contain startSec');
    assert(!('trackIndex' in inst), 'v2 instance must not contain trackIndex');
  }
}

function testFlattenExpansion(H2SProject){
  assert(typeof H2SProject.flatten === 'function', 'flatten not found');
  assert(typeof H2SProject.defaultProjectV2 === 'function', 'defaultProjectV2 not found');

  const p = H2SProject.defaultProjectV2();
  p.bpm = 120;

  const trackId = p.tracks[0].id;

  const scoreBeat = {
    version: 2,
    tempo_bpm: null,
    time_signature: null,
    tracks: [{
      id: 't1',
      name: 'Track 1',
      notes: [
        { id: 'n1', pitch: 60, velocity: 80, startBeat: 0, durationBeat: 1 },
        { id: 'n2', pitch: 64, velocity: 80, startBeat: 1, durationBeat: 1 },
      ]
    }]
  };

  const clipId = 'clip_test';
  p.clips[clipId] = {
    id: clipId,
    name: 'Test Clip',
    createdAt: 0,
    sourceTaskId: null,
    score: scoreBeat,
    meta: { notes: 2, pitchMin: 60, pitchMax: 64, spanBeat: 2, sourceTempoBpm: null }
  };
  p.clipOrder = [clipId];

  p.instances.push({ id: 'inst_a', clipId, trackId, startBeat: 0, transpose: 0 });
  p.instances.push({ id: 'inst_b', clipId, trackId, startBeat: 0, transpose: 0 });

  const ev = H2SProject.flatten(p);
  assert(ev && Array.isArray(ev.tracks) && ev.tracks.length === 1, 'flatten must return one track');

  const notes = ev.tracks[0].notes;
  assert.strictEqual(notes.length, 4, 'flatten must expand notes per-instance (no merge)');

  const byInst = notes.reduce((m, n) => {
    m[n.instanceId] = (m[n.instanceId] || 0) + 1;
    return m;
  }, {});

  assert.strictEqual(byInst['inst_a'], 2, 'inst_a must contribute 2 notes');
  assert.strictEqual(byInst['inst_b'], 2, 'inst_b must contribute 2 notes');
}

function main(){
  const H2SProject = loadH2SProject();

  console.log('[numeric] Test A: score sec->beat->sec roundtrip');
  testScoreRoundTrip(H2SProject, 'tests/fixtures/frontend/score_2026-01-06_120bpm.json');
  testScoreRoundTrip(H2SProject, 'tests/fixtures/frontend/score_2026-01-04_90bpm.json');

  console.log('[numeric] Test B: project v1->v2 migration consistency');
  testProjectMigration(H2SProject, 'tests/fixtures/frontend/project_v1_sample.json');

  console.log('[numeric] Test C: flatten expansion (no merge)');
  testFlattenExpansion(H2SProject);

  console.log('\nNumeric invariants tests passed.');
}

main();
