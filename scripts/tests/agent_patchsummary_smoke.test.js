// Smoke test: Optimize should produce a revision + patchSummary when it performs a real fix.
// This is intentionally lightweight and Node-safe (no DOM usage).

const path = require('path');

function assert(cond, msg){
  if(!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim(){
  // project.js / agent_patch.js attach exports to window in browser.
  // In Node tests we provide a minimal shim and then bridge to globalThis.
  if(typeof globalThis.window === 'undefined') globalThis.window = {};
}

function ensureProjectLoaded(){
  ensureWindowShim();

  const hasBegin = globalThis.H2SProject && (typeof globalThis.H2SProject.beginNewClipRevision === 'function');
  if(hasBegin) return;

  // Load the real implementation (Node-safe as long as `window` exists).
  require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
  if(globalThis.window && globalThis.window.H2SProject) globalThis.H2SProject = globalThis.window.H2SProject;

  assert(globalThis.H2SProject && typeof globalThis.H2SProject.beginNewClipRevision === 'function', 'H2SProject.beginNewClipRevision missing');
}

function ensureAgentPatchLoaded(){
  ensureWindowShim();

  if(globalThis.H2SAgentPatch) return;

  // Load core patch engine (attaches to window), then bridge.
  require(path.resolve(__dirname, '../../static/pianoroll/core/agent_patch.js'));
  if(globalThis.window && globalThis.window.H2SAgentPatch) globalThis.H2SAgentPatch = globalThis.window.H2SAgentPatch;

  assert(globalThis.H2SAgentPatch, 'H2SAgentPatch missing');
}

async function testPatchSummarySmoke(){
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  // Minimal v2 project.
  let project = {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    tracks: [{ id:'trk_0', name:'Track 1', instrument:'default', gainDb:0, muted:false, trackId:'trk_0' }],
    clips: {},
    clipOrder: [],
    instances: [],
    ui: { pxPerBeat: 120, playheadBeat: 0 },
  };

  // A tiny scoreBeat with one note.
  const scoreBeat = {
    version: 2,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{
      id: 't0',
      name: 'ch0',
      program: 0,
      channel: 0,
      notes: [{ id:'n0', pitch:60, velocity:90, startBeat:0, durationBeat:1 }],
    }],
  };

  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id:'clip_smoke', name:'smoke' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const cid = clip.id;
  const prevRev = String(project.clips[cid].revisionId || '');

  // Introduce an illegal value -> optimize should clamp (ops=1).
  project.clips[cid].score.tracks[0].notes[0].pitch = 999;

  const res0 = ctrl.optimizeClip(cid);
  const res = (res0 && typeof res0.then === 'function') ? await res0 : res0;

  assert(res && res.ok === true, 'opt should ok');
  assert(res.ops === 1, 'expected ops=1');

  const head = project.clips[cid];
  const pitch = head.score.tracks[0].notes[0].pitch;
  assert(pitch === 127, 'pitch should be clamped to 127');

  assert(head.meta && head.meta.agent, 'agent meta required');
  assert(head.meta.agent.patchOps === 1, 'patchOps should be 1');
  assert(head.meta.agent.patchSummary && head.meta.agent.patchSummary.ops === 1, 'patchSummary.ops should be 1');

  // Revision chain should reference previous head (either via parentRevisionId or history list).
  const parent = String(head.parentRevisionId || '');
  const histHasPrev = (head.revisions || []).some(r => String(r.revisionId || '') === prevRev);
  assert(parent === prevRev || histHasPrev, 'revision chain should reference previous head');

  const revInfo = globalThis.H2SProject.listClipRevisions(head);
  assert(revInfo && Array.isArray(revInfo.items) && revInfo.items.length >= 2, 'listClipRevisions should show 2+ versions');

  console.log('PASS agent patchSummary smoke');
}

(async () => {
  await testPatchSummarySmoke();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
