#!/usr/bin/env node
'use strict';

const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim(){
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function loadLocalTranspose(){
  ensureWindowShim();
  if (globalThis.H2SLocalTranspose) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/local_transpose.js'));
  if (globalThis.window && globalThis.window.H2SLocalTranspose) globalThis.H2SLocalTranspose = globalThis.window.H2SLocalTranspose;
  assert(globalThis.H2SLocalTranspose, 'H2SLocalTranspose missing');
}

function loadPhase1Meta(){
  ensureWindowShim();
  if (globalThis.H2SPhase1DeterministicMeta) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/phase1_deterministic_meta.js'));
  if (globalThis.window && globalThis.window.H2SPhase1DeterministicMeta) globalThis.H2SPhase1DeterministicMeta = globalThis.window.H2SPhase1DeterministicMeta;
  assert(globalThis.H2SPhase1DeterministicMeta, 'H2SPhase1DeterministicMeta missing');
}

function loadAgentPatch(){
  ensureWindowShim();
  if (globalThis.H2SAgentPatch) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/agent_patch.js'));
  if (globalThis.window && globalThis.window.H2SAgentPatch) globalThis.H2SAgentPatch = globalThis.window.H2SAgentPatch;
  assert(globalThis.H2SAgentPatch, 'H2SAgentPatch missing');
}

function loadProject(){
  ensureWindowShim();
  if (globalThis.H2SProject && typeof globalThis.H2SProject.beginNewClipRevision === 'function') return;
  require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
  if (globalThis.window && globalThis.window.H2SProject) globalThis.H2SProject = globalThis.window.H2SProject;
  assert(globalThis.H2SProject, 'H2SProject missing');
}

function loadAgentController(){
  loadLocalTranspose();
  loadPhase1Meta();
  ensureWindowShim();
  if (globalThis.H2SAgentController) return;
  require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  if (globalThis.window && globalThis.window.H2SAgentController) globalThis.H2SAgentController = globalThis.window.H2SAgentController;
  assert(globalThis.H2SAgentController && typeof globalThis.H2SAgentController.create === 'function', 'H2SAgentController missing');
}

function testIntentNarrowing(){
  loadLocalTranspose();
  const LT = globalThis.H2SLocalTranspose;
  assert(LT.narrowLocalTransposeIntentFromText('transpose up 1 semitone').semitone_delta === 1, 'up 1');
  assert(LT.narrowLocalTransposeIntentFromText('transpose down 2 semitones').semitone_delta === -2, 'down 2');
  assert(LT.narrowLocalTransposeIntentFromText('move this up a whole step').semitone_delta === 2, 'whole up');
  assert(LT.narrowLocalTransposeIntentFromText('move this down a half step').semitone_delta === -1, 'half down');
}

function assertPitchOnlyPatch(patch){
  const ops = patch && Array.isArray(patch.ops) ? patch.ops : [];
  for (let i = 0; i < ops.length; i++){
    const op = ops[i];
    assert(op && op.op === 'setNote', 'setNote only');
    assert(op.pitch != null && op.velocity == null && op.startBeat == null && op.durationBeat == null, 'pitch field only');
  }
}

function testPatchContract(){
  loadLocalTranspose();
  const LT = globalThis.H2SLocalTranspose;
  const clip = {
    id: 'c1',
    score: {
      version: 2,
      tracks: [{
        id: 't0',
        notes: [
          { id: 'n0', pitch: 60, velocity: 80, startBeat: 0, durationBeat: 1 },
          { id: 'n1', pitch: 62, velocity: 90, startBeat: 1, durationBeat: 0.5 },
        ],
      }],
    },
  };
  const built = LT.buildLocalTransposePatch(clip, { semitone_delta: 2 }, null);
  assertPitchOnlyPatch(built.patch);
  assert(built.patch.ops.length === 2, 'two notes');
}

function testNoOpNoRevision(){
  loadProject();
  loadAgentPatch();
  loadLocalTranspose();
  loadAgentController();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  let project = {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1', instrument: 'default', gainDb: 0, muted: false, trackId: 'trk_0' }],
    clips: {},
    clipOrder: [],
    instances: [],
    ui: { pxPerBeat: 120, playheadBeat: 0 },
  };

  const scoreBeat = {
    version: 2,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{
      id: 't0',
      name: 'ch0',
      notes: [{ id: 'n0', pitch: 127, velocity: 100, startBeat: 0, durationBeat: 1 }],
    }],
  };

  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_lt', name: 'lt' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project);

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const cid = clip.id;
  const revBefore = String(project.clips[cid].revisionId || '');

  const res = ctrl.optimizeClip(cid, {
    requestedPresetId: 'local_transpose',
    localTransposeIntent: { semitone_delta: 1 },
  });
  if (res && typeof res.then === 'function') throw new Error('expected sync');

  assert(res.ok === true, 'ok');
  assert(res.ops === 0, 'at max pitch +1 is no-op');
  assert(String(project.clips[cid].revisionId || '') === revBefore, 'no revision');
}

function testRevisionScopeAndClamp(){
  loadProject();
  loadAgentPatch();
  loadLocalTranspose();
  loadAgentController();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  let project = {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1', instrument: 'default', gainDb: 0, muted: false, trackId: 'trk_0' }],
    clips: {},
    clipOrder: [],
    instances: [],
    ui: { pxPerBeat: 120, playheadBeat: 0 },
  };

  const scoreBeat = {
    version: 2,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{
      id: 't0',
      name: 'ch0',
      notes: [
        { id: 'n0', pitch: 60, velocity: 70, startBeat: 0, durationBeat: 1 },
        { id: 'n1', pitch: 62, velocity: 71, startBeat: 1, durationBeat: 1 },
      ],
    }],
  };

  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_lt2', name: 'lt2' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project);

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const cid = clip.id;
  const prevRev = String(project.clips[cid].revisionId || '');

  const res = ctrl.optimizeClip(cid, {
    requestedPresetId: 'local_transpose',
    localTransposeIntent: { semitone_delta: 1 },
    localTransposeNoteIds: ['n0'],
  });
  assert(res && res.ok && res.ops === 1, 'one op');
  const head = project.clips[cid];
  assert(String(head.parentRevisionId || '') === prevRev, 'revision chain');
  const n0 = head.score.tracks[0].notes.find(function(n){ return n.id === 'n0'; });
  const n1 = head.score.tracks[0].notes.find(function(n){ return n.id === 'n1'; });
  assert(n0.pitch === 61, 'n0 +1');
  assert(n1.pitch === 62, 'n1 scope');

  let project2 = {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1', instrument: 'default', gainDb: 0, muted: false, trackId: 'trk_0' }],
    clips: {},
    clipOrder: [],
    instances: [],
    ui: { pxPerBeat: 120, playheadBeat: 0 },
  };
  const score2 = {
    version: 2,
    tracks: [{
      id: 't0',
      notes: [{ id: 'm0', pitch: 126, velocity: 80, startBeat: 0, durationBeat: 1 }],
    }],
  };
  const clip2 = globalThis.H2SProject.createClipFromScoreBeat(score2, { id: 'clip_lt3', name: 'lt3' });
  project2.clips[clip2.id] = clip2;
  project2.clipOrder.push(clip2.id);
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project2);
  const ctrl2 = AgentController.create({
    getProjectV2: () => project2,
    setProjectFromV2: (p) => { project2 = p; },
    persist: () => {},
    render: () => {},
  });
  const r2 = ctrl2.optimizeClip(clip2.id, {
    requestedPresetId: 'local_transpose',
    localTransposeIntent: { semitone_delta: 5 },
  });
  assert(r2.ok && r2.ops === 1, 'clamp produces one step');
  const p = project2.clips[clip2.id].score.tracks[0].notes[0].pitch;
  assert(p === 127, 'clamped to 127');
}

function main(){
  testIntentNarrowing();
  testPatchContract();
  testNoOpNoRevision();
  testRevisionScopeAndClamp();
  console.log('local_transpose.test.js: OK');
}

main();
