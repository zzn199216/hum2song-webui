#!/usr/bin/env node
'use strict';

/**
 * Phase-1 velocity_shape: intent narrowing, patch contract, no-op, revision, scope.
 */
const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim(){
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function loadVelocityShape(){
  ensureWindowShim();
  if (globalThis.H2SVelocityShape) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/velocity_shape.js'));
  if (globalThis.window && globalThis.window.H2SVelocityShape) globalThis.H2SVelocityShape = globalThis.window.H2SVelocityShape;
  assert(globalThis.H2SVelocityShape, 'H2SVelocityShape missing');
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

function loadPhase1Meta(){
  ensureWindowShim();
  if (globalThis.H2SPhase1DeterministicMeta) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/phase1_deterministic_meta.js'));
  if (globalThis.window && globalThis.window.H2SPhase1DeterministicMeta) globalThis.H2SPhase1DeterministicMeta = globalThis.window.H2SPhase1DeterministicMeta;
  assert(globalThis.H2SPhase1DeterministicMeta, 'H2SPhase1DeterministicMeta missing');
}

function loadAgentController(){
  ensureWindowShim();
  if (globalThis.H2SAgentController) return;
  loadVelocityShape();
  loadPhase1Meta();
  require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  if (globalThis.window && globalThis.window.H2SAgentController) globalThis.H2SAgentController = globalThis.window.H2SAgentController;
  assert(globalThis.H2SAgentController && typeof globalThis.H2SAgentController.create === 'function', 'H2SAgentController missing');
}

function testIntentNarrowing(){
  loadVelocityShape();
  const VS = globalThis.H2SVelocityShape;
  const a = VS.narrowVelocityShapeIntentFromText('make this louder');
  assert(a && a.mode === 'louder', 'louder');
  const b = VS.narrowVelocityShapeIntentFromText('make this softer');
  assert(b && b.mode === 'softer', 'softer');
  const c = VS.narrowVelocityShapeIntentFromText('make this more dynamic');
  assert(c && c.mode === 'more_dynamic', 'more_dynamic');
  const d = VS.narrowVelocityShapeIntentFromText('make this more even');
  assert(d && d.mode === 'more_even', 'more_even');
}

function assertVelocityOnlyPatch(patch){
  const ops = patch && Array.isArray(patch.ops) ? patch.ops : [];
  for (let i = 0; i < ops.length; i++){
    const op = ops[i];
    assert(op && op.op === 'setNote', 'only setNote');
    assert(op.noteId, 'noteId');
    assert(op.velocity != null && op.pitch == null && op.startBeat == null && op.durationBeat == null, 'velocity field only');
  }
}

function testPatchContract(){
  loadVelocityShape();
  const VS = globalThis.H2SVelocityShape;
  const clip = {
    id: 'c1',
    score: {
      version: 2,
      tracks: [{
        id: 't0',
        name: 't',
        notes: [
          { id: 'n0', pitch: 60, velocity: 80, startBeat: 0, durationBeat: 1 },
          { id: 'n1', pitch: 62, velocity: 90, startBeat: 1, durationBeat: 0.5 },
        ],
      }],
    },
  };
  const built = VS.buildVelocityShapePatch(clip, { mode: 'louder', strength: 'medium' }, null);
  assertVelocityOnlyPatch(built.patch);
  assert(built.patch.ops.length >= 1, 'expect some ops');
}

function testNoOpNoRevision(){
  loadProject();
  loadAgentPatch();
  loadVelocityShape();
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
      notes: [{ id: 'n0', pitch: 60, velocity: 64, startBeat: 0, durationBeat: 1 }],
    }],
  };

  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_vs', name: 'vs' });
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
    requestedPresetId: 'velocity_shape',
    userPrompt: 'make this more even',
    velocityShapeIntent: { mode: 'more_even', strength: 'medium' },
  });
  if (res && typeof res.then === 'function'){
    throw new Error('optimizeClip should be sync for velocity_shape');
  }

  assert(res.ok === true, 'ok');
  assert(res.ops === 0, 'single note more_even should be no-op');
  assert(String(project.clips[cid].revisionId || '') === revBefore, 'no revision when ops=0');
}

function testRevisionAndScope(){
  loadProject();
  loadAgentPatch();
  loadVelocityShape();
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
        { id: 'n0', pitch: 60, velocity: 60, startBeat: 0, durationBeat: 1 },
        { id: 'n1', pitch: 62, velocity: 60, startBeat: 1, durationBeat: 1 },
      ],
    }],
  };

  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_vs2', name: 'vs2' });
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
    requestedPresetId: 'velocity_shape',
    velocityShapeIntent: { mode: 'louder', strength: 'strong' },
    velocityShapeNoteIds: ['n0'],
  });
  assert(res && res.ok === true, 'ok');
  assert(res.ops >= 1, 'effective ops');
  const head = project.clips[cid];
  assert(String(head.parentRevisionId || '') === prevRev, 'parent revision chain');

  const n0 = head.score.tracks[0].notes.find(function(n){ return n.id === 'n0'; });
  const n1 = head.score.tracks[0].notes.find(function(n){ return n.id === 'n1'; });
  assert(n0 && n1, 'notes');
  assert(n0.velocity !== 60, 'n0 should change');
  assert(n1.velocity === 60, 'n1 unchanged (scope)');
}

function main(){
  testIntentNarrowing();
  testPatchContract();
  testNoOpNoRevision();
  testRevisionAndScope();
  console.log('velocity_shape.test.js: OK');
}

main();
