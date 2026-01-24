/* Hum2Song Studio MVP - frontend numeric invariants tests (Node)

   Runs WITHOUT a browser. We vm-eval plain scripts that attach to window.

   Tests included:
   A) score sec->beat->sec roundtrip
   B) project v1->v2 migration consistency
   B2) legacy v2 schema guard (missing tracks/clipOrder)
   C) flatten expansion (no merge)
   D) agent patch apply+invert roundtrip
   E) semantic sanity gate (reject insane patches)
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* -------------------- tiny assert helpers -------------------- */
function assertOk(cond, msg){
  if (!cond) throw new Error(msg || 'assertOk failed');
}
function toPlain(x){
  // vm contexts create arrays/objects with different prototypes; convert to host realm
  if (x && typeof x === 'object'){
    try { return JSON.parse(JSON.stringify(x)); } catch(e) { return x; }
  }
  return x;
}

function assertEq(a, b, msg){
  assert.deepStrictEqual(toPlain(a), toPlain(b), msg);
}

/* -------------------- loader helpers (plain scripts) -------------------- */
const repoRoot = path.resolve(__dirname, '..');

function evalPlainScript(absPath, ctx){
  const code = fs.readFileSync(absPath, 'utf8');
  vm.runInContext(code, ctx, { filename: absPath });
}

function makeCtx(){
  // Provide a minimal DOM-ish / global surface.
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
  return ctx;
}

function loadH2SProject(){
  const ctx = makeCtx();
  const p = path.join(repoRoot, 'static', 'pianoroll', 'project.js');
  evalPlainScript(p, ctx);
  const api = ctx.window.H2SProject || ctx.globalThis.H2SProject;
  assertOk(api, 'H2SProject not found after eval project.js');
  return api;
}

function loadAgentPatch(){
  const ctx = makeCtx();
  // agent_patch expects H2SProject helpers for recompute meta etc.
  const projectPath = path.join(repoRoot, 'static', 'pianoroll', 'project.js');
  evalPlainScript(projectPath, ctx);
  const patchPath = path.join(repoRoot, 'static', 'pianoroll', 'core', 'agent_patch.js');
  evalPlainScript(patchPath, ctx);
  const api = ctx.window.H2SAgentPatch || ctx.globalThis.H2SAgentPatch;
  assertOk(api, 'H2SAgentPatch not found after eval agent_patch.js');
  return api;
}

function readJson(rel){
  const abs = path.join(repoRoot, rel);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function almostEq(a, b, eps, msg){
  const x = Number(a), y = Number(b);
  if (!isFinite(x) || !isFinite(y)) throw new Error((msg||'') + ' non-finite');
  if (Math.abs(x - y) > eps){
    throw new Error((msg||'') + ` |${x} - ${y}| > ${eps}`);
  }
}

/* -------------------- Tests -------------------- */

function testScoreRoundtrip(){
  console.log('[numeric] Test A: score sec->beat->sec roundtrip');
  const P = loadH2SProject();

  const scoreSec = readJson('tests/fixtures/frontend/score_2026-01-06_120bpm.json');
  const bpm = 120;

  const beat = P.scoreSecToBeat(scoreSec, bpm);
  const sec2 = P.scoreBeatToSec(beat, bpm);

  // Compare note-by-note (same order expected from conversion).
  const t1 = (scoreSec.tracks || [])[0] || { notes: [] };
  const t2 = (sec2.tracks || [])[0] || { notes: [] };

  assertEq(t2.notes.length, t1.notes.length, 'note count preserved');

  const eps = 1e-6;
  for (let i = 0; i < t1.notes.length; i++){
    const a = t1.notes[i];
    const b = t2.notes[i];
    assertEq(b.pitch, a.pitch, 'pitch preserved');
    assertEq(b.velocity, a.velocity, 'velocity preserved');
    almostEq(b.start, a.start, eps, 'start preserved');
    almostEq(b.duration, a.duration, eps, 'duration preserved');
  }
}

function testProjectMigration(){
  console.log('[numeric] Test B: project v1->v2 migration consistency');
  const P = loadH2SProject();

  const projectV1 = readJson('tests/fixtures/frontend/project_2026-01-06_v1.json');
  const p2 = P.migrateProjectV1toV2(projectV1);

  // Invariants
  const inv = P.checkProjectV2Invariants(p2);
  assertOk(inv.ok, 'project v2 invariants ok: ' + JSON.stringify(inv.errors || []));

  // clipOrder preserves v1 clips[] order
  const expectedClipOrder = (projectV1.clips || []).map(c => c.id).filter(Boolean);
  assertEq(p2.clipOrder, expectedClipOrder, 'clipOrder must preserve v1 clips[] order');

  // instances startBeat equals secToBeat(startSec)
  const bpm = P.getProjectBpm(p2);
  for (const inst1 of (projectV1.instances || [])){
    const inst2 = (p2.instances || []).find(x => x.id === inst1.id);
    assertOk(!!inst2, 'instance migrated: ' + inst1.id);
    const want = P.normalizeBeat(P.secToBeat(inst1.startSec || 0, bpm));
    almostEq(inst2.startBeat, want, 1e-6, 'instance startBeat');
  }
}

function testLegacyV2SchemaGuard(){
  console.log('[numeric] Test B2: legacy v2 schema guard (missing tracks/clipOrder)');
  const P = loadH2SProject();

  // Simulate an older v2-ish project missing fields.
  const legacy = {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    // tracks missing
    clips: {
      clip_a: {
        id: 'clip_a',
        name: 'A',
        createdAt: 1,
        score: { version: 2, tempo_bpm: null, time_signature: null, tracks: [{ id:'trk_s', name:'', notes:[{ id:'n1', pitch:60, velocity:100, startBeat:0, durationBeat:1 }]}] },
        meta: { notes: 1, pitchMin: 60, pitchMax: 60, spanBeat: 1, sourceTempoBpm: null }
      },
      clip_b: {
        id: 'clip_b',
        name: 'B',
        createdAt: 2,
        score: { version: 2, tempo_bpm: null, time_signature: null, tracks: [{ id:'trk_s', name:'', notes:[{ id:'n2', pitch:62, velocity:100, startBeat:0, durationBeat:1 }]}] },
        meta: { notes: 1, pitchMin: 62, pitchMax: 62, spanBeat: 1, sourceTempoBpm: null }
      },
    },
    // clipOrder missing
    instances: [
      { id:'inst_1', clipId:'clip_a', startBeat:0, transpose:0 }, // trackId missing
    ],
    ui: { pxPerBeat: 80, playheadBeat: 0 },
  };

  // T3-0b adds a schema guard in normalizeProjectV2 (or equivalent) to fill these.
  const p = P.deepClone(legacy);
  P.normalizeProjectV2(p);

  const inv = P.checkProjectV2Invariants(p);
  assertOk(inv.ok, 'legacy v2: invariants ok: ' + JSON.stringify(inv.errors || []));

  // default track should exist and instances should bind to it.
  assertOk(Array.isArray(p.tracks) && p.tracks.length >= 1, 'legacy v2: tracks auto-filled');
  const t0 = p.tracks[0];
  assertOk(!!t0.id, 'legacy v2: default track id present');
  // If your guard pins id to trk_0, keep this strong check; otherwise allow trk_*.
  assertOk((t0.id === 'trk_0') || String(t0.id).startsWith('trk_'), 'legacy v2: default track id is trk_0 or trk_*');

  assertOk(Array.isArray(p.clipOrder) && p.clipOrder.length === 2, 'legacy v2: clipOrder auto-filled');
  // Expect createdAt order (A then B).
  assertEq(p.clipOrder, ['clip_a', 'clip_b'], 'legacy v2: clipOrder derived deterministically');

  const inst = p.instances[0];
  assertOk(!!inst.trackId, 'legacy v2: instance.trackId auto-filled');
  assertEq(inst.trackId, t0.id, 'legacy v2: instance.trackId set to default');
}

function testFlattenExpansion(){
  console.log('[numeric] Test C: flatten expansion (no merge)');
  const P = loadH2SProject();

  const projectV1 = readJson('tests/fixtures/frontend/project_2026-01-06_v1.json');
  const p2 = P.migrateProjectV1toV2(projectV1);
  const flat = P.flatten(p2);

  assertOk(flat && Array.isArray(flat.tracks), 'flatten tracks array');

  // total notes equals sum of all clip notes times instances referenced.
  let expect = 0;
  for (const inst of p2.instances){
    const clip = p2.clips[inst.clipId];
    if (!clip) continue;
    for (const trk of (clip.score.tracks || [])){
      expect += (trk.notes || []).length;
    }
  }
  let got = 0;
  for (const trk of flat.tracks){
    got += (trk.notes || []).length;
  }
  assertEq(got, expect, 'flatten note count equals expanded instances');

  // basic monotonic start order inside each track
  for (const trk of flat.tracks){
    let prev = -1;
    for (const n of (trk.notes || [])){
      assertOk(isFinite(n.startSec) && n.startSec >= 0, 'startSec finite');
      assertOk(isFinite(n.durationSec) && n.durationSec > 0, 'durationSec finite');
      assertOk(n.pitch >= 0 && n.pitch <= 127, 'pitch range');
      assertOk(n.velocity >= 1 && n.velocity <= 127, 'velocity range');
      assertOk(n.startSec + 1e-12 >= prev, 'sorted by startSec');
      prev = n.startSec;
    }
  }
}

function mkClipWithNotes(P, count){
  // Build a single-track beat score.
  const notes = [];
  for (let i=0;i<count;i++){
    notes.push({
      id: 'n_' + i,
      pitch: 60 + (i % 5),
      velocity: 100,
      startBeat: i * 0.25,
      durationBeat: 0.25,
    });
  }
  const score = { version: 2, tempo_bpm: null, time_signature: null, tracks: [{ id:'trk_s', name:'', notes }] };
  const clip = {
    id: 'clip_test',
    name: 'Test',
    createdAt: Date.now(),
    sourceTaskId: null,
    score,
    meta: { notes: count, pitchMin: 60, pitchMax: 64, spanBeat: (count>0)? ((count-1)*0.25+0.25):0, sourceTempoBpm: null }
  };
  // Normalize and recompute meta.
  clip.score = P.ensureScoreBeatIds(clip.score);
  P.recomputeClipMetaFromScoreBeat(clip);
  return clip;
}

function testAgentPatchRoundtrip(){
  console.log('[numeric] Test D: agent patch apply+invert roundtrip');
  const P = loadH2SProject();
  const AP = loadAgentPatch();

  const clip0 = mkClipWithNotes(P, 8);

  const patch = {
    version: 1,
    id: 'patch_1',
    meta: { reason: 'test' },
    ops: [
      { op: 'moveNote', noteId: 'n_2', deltaBeat: 0.5 },
      { op: 'setNote', noteId: 'n_3', pitch: 72, velocity: 90 },
      { op: 'addNote', trackId: 'trk_s', note: { id:'n_new', pitch: 67, velocity: 110, startBeat: 0.125, durationBeat: 0.125 } },
    ]
  };

  const r1 = AP.applyPatchToClip(P, clip0, patch);
  assertOk(r1 && r1.ok, 'applyPatch ok: ' + JSON.stringify((r1 && r1.errors) || []));

  // Invert using appliedPatch (preferred) if available, else invertAppliedPatch.
  let inv;
  if (r1.inversePatch){
    inv = { ok:true, patch:r1.inversePatch };
  } else {
    inv = AP.invertAppliedPatch(r1.appliedPatch);
  }
  assertOk(inv && inv.ok, 'invert ok');

  const r2 = AP.applyPatchToClip(P, r1.clip, inv.patch);
  assertOk(r2 && r2.ok, 'apply invert ok');

  // Compare key aspects back to original.
  // (IDs/order may differ because addNote/deleteNote; so compare by noteId set)
  const aNotes = [];
  for (const t of clip0.score.tracks){ for (const n of t.notes) aNotes.push(n); }
  const bNotes = [];
  for (const t of r2.clip.score.tracks){ for (const n of t.notes) bNotes.push(n); }

  const mapA = new Map(aNotes.map(n => [n.id, n]));
  const mapB = new Map(bNotes.map(n => [n.id, n]));

  // After roundtrip, original note ids should exist with same shapes.
  for (const [id, na] of mapA.entries()){
    const nb = mapB.get(id);
    assertOk(!!nb, 'note preserved after roundtrip: ' + id);
    assertEq(nb.pitch, na.pitch, 'pitch preserved: ' + id);
    assertEq(nb.velocity, na.velocity, 'velocity preserved: ' + id);
    almostEq(nb.startBeat, na.startBeat, 1e-6, 'startBeat preserved: ' + id);
    almostEq(nb.durationBeat, na.durationBeat, 1e-6, 'durationBeat preserved: ' + id);
  }

  // Meta strong consistency (notes count)
  assertEq(r2.clip.meta.notes, clip0.meta.notes, 'meta.notes back to original');
}

function testSemanticSanityGate(){
  console.log('[numeric] Test E: semantic sanity gate (reject insane patches)');
  const P = loadH2SProject();
  const AP = loadAgentPatch();

  const clip0 = mkClipWithNotes(P, 40);

  // Insane patch: delete 95% notes
  const delOps = [];
  for (let i=0;i<38;i++) delOps.push({ op:'deleteNote', noteId:'n_' + i });
  const insane = { version:1, id:'patch_insane', ops: delOps };

  const r = AP.applyPatchToClip(P, clip0, insane);
  assertOk(r && !r.ok, 'insane patch must be rejected');
  assertOk(Array.isArray(r.errors) && r.errors.length > 0, 'insane patch returns errors');
}

function main(){
  testScoreRoundtrip();
  testProjectMigration();
  testLegacyV2SchemaGuard();
  testFlattenExpansion();
  testAgentPatchRoundtrip();
  testSemanticSanityGate();

  console.log('\nNumeric invariants tests passed.');
}

main();
