#!/usr/bin/env node
'use strict';

/**
 * Shared regression: Phase-1 deterministic slices (velocity_shape, local_transpose, rhythm_tighten_loosen)
 * contract — allowed fields, scope, revision, patchSummary.phase1Deterministic.
 */
const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim(){
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function loadPhase1Meta(){
  ensureWindowShim();
  if (globalThis.H2SPhase1DeterministicMeta) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/phase1_deterministic_meta.js'));
  if (globalThis.window && globalThis.window.H2SPhase1DeterministicMeta) globalThis.H2SPhase1DeterministicMeta = globalThis.window.H2SPhase1DeterministicMeta;
  assert(globalThis.H2SPhase1DeterministicMeta, 'H2SPhase1DeterministicMeta missing');
}

function loadVelocityShape(){
  ensureWindowShim();
  if (globalThis.H2SVelocityShape) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/velocity_shape.js'));
  if (globalThis.window && globalThis.window.H2SVelocityShape) globalThis.H2SVelocityShape = globalThis.window.H2SVelocityShape;
}

function loadLocalTranspose(){
  ensureWindowShim();
  if (globalThis.H2SLocalTranspose) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/local_transpose.js'));
  if (globalThis.window && globalThis.window.H2SLocalTranspose) globalThis.H2SLocalTranspose = globalThis.window.H2SLocalTranspose;
}

function loadRhythm(){
  ensureWindowShim();
  if (globalThis.H2SRhythmTightenLoosen) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/rhythm_tighten_loosen.js'));
  if (globalThis.window && globalThis.window.H2SRhythmTightenLoosen) globalThis.H2SRhythmTightenLoosen = globalThis.window.H2SRhythmTightenLoosen;
}

function loadAgentPatch(){
  ensureWindowShim();
  if (globalThis.H2SAgentPatch) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/agent_patch.js'));
  if (globalThis.window && globalThis.window.H2SAgentPatch) globalThis.H2SAgentPatch = globalThis.window.H2SAgentPatch;
}

function loadProject(){
  ensureWindowShim();
  if (globalThis.H2SProject && typeof globalThis.H2SProject.beginNewClipRevision === 'function') return;
  require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
  if (globalThis.window && globalThis.window.H2SProject) globalThis.H2SProject = globalThis.window.H2SProject;
}

function loadAgentController(){
  loadVelocityShape();
  loadLocalTranspose();
  loadRhythm();
  loadPhase1Meta();
  ensureWindowShim();
  if (globalThis.H2SAgentController) return;
  require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  if (globalThis.window && globalThis.window.H2SAgentController) globalThis.H2SAgentController = globalThis.window.H2SAgentController;
  assert(globalThis.H2SAgentController && typeof globalThis.H2SAgentController.create === 'function', 'H2SAgentController missing');
}

function assertPitchOnlyOps(patch){
  const ops = patch && Array.isArray(patch.ops) ? patch.ops : [];
  for (let i = 0; i < ops.length; i++){
    const op = ops[i];
    assert(op && op.op === 'setNote', 'only setNote');
    assert(op.pitch != null && op.velocity == null && op.startBeat == null && op.durationBeat == null, 'pitch field only');
  }
}

function testMetaBuilder(){
  loadPhase1Meta();
  const P1 = globalThis.H2SPhase1DeterministicMeta;
  const SRC = P1.PHASE1_INTENT_SOURCE;
  const m = P1.buildPhase1DeterministicResolvedMeta({
    capabilityId: 'velocity_shape',
    intentResolved: { capability_id: 'velocity_shape', mode: 'more_even', strength: 'medium' },
    noteIdsFilter: ['a', 'b'],
    targetNoteCount: 2,
    effectiveNoteCount: 2,
    intentSource: SRC.PRESET_DEFAULT,
  });
  assert(m.capabilityId === 'velocity_shape', 'capabilityId');
  assert(m.targetScope === 'note_ids', 'note scope');
  assert(m.intentSource === SRC.PRESET_DEFAULT, 'intentSource');
  assert(m.presetDefaultDescription && m.presetDefaultDescription.indexOf('more_even') >= 0, 'preset description');
  const dR = P1.describePhase1PresetDefault('rhythm_tighten_loosen');
  assert(dR && dR.indexOf('tighten') >= 0 && dR.indexOf('medium') >= 0, 'rhythm preset description');
}

function testVelocityPhase1SummaryAndOps(){
  loadProject();
  loadAgentPatch();
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
    tracks: [{
      id: 't0',
      notes: [
        { id: 'n0', pitch: 60, velocity: 60, startBeat: 0, durationBeat: 1 },
        { id: 'n1', pitch: 62, velocity: 60, startBeat: 1, durationBeat: 1 },
      ],
    }],
  };
  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'c_p1', name: 'p1' });
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
  const rev0 = String(project.clips[cid].revisionId || '');

  const res = ctrl.optimizeClip(cid, {
    requestedPresetId: 'velocity_shape',
    userPrompt: null,
    velocityShapeNoteIds: ['n0'],
    velocityShapeIntent: { mode: 'louder', strength: 'medium' },
  });
  assert(res && res.ok && res.ops >= 1, 'velocity apply');
  assert(res.executionPath === 'velocity_shape', 'executionPath');
  const head = project.clips[cid];
  const ps = head.meta && head.meta.agent && head.meta.agent.patchSummary;
  assert(ps && ps.phase1Deterministic && ps.phase1Deterministic.capabilityId === 'velocity_shape', 'phase1Deterministic');
  assert(ps.phase1Deterministic.targetScope === 'note_ids', 'targetScope note_ids');
  assert(ps.phase1Deterministic.intentSource === 'explicit_options', 'explicit_options velocity');
  assert(ps.phase1Deterministic.noteIdsFilterPreview && ps.phase1Deterministic.noteIdsFilterPreview[0] === 'n0', 'preview');

  assert(String(head.revisionId || '') !== rev0, 'revision when ops');
  const n0 = head.score.tracks[0].notes.find(function(n){ return n.id === 'n0'; });
  const n1 = head.score.tracks[0].notes.find(function(n){ return n.id === 'n1'; });
  assert(n0.velocity !== 60, 'n0 changed');
  assert(n1.velocity === 60, 'n1 unchanged');
  assert(n0.pitch === 60 && n1.pitch === 62, 'pitch untouched');
}

function testTransposePhase1AndNoOp(){
  loadProject();
  loadAgentPatch();
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
    tracks: [{
      id: 't0',
      notes: [{ id: 'm0', pitch: 127, velocity: 100, startBeat: 0, durationBeat: 1 }],
    }],
  };
  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'c_p1b', name: 'p1b' });
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
  const rev0 = String(project.clips[cid].revisionId || '');

  const res = ctrl.optimizeClip(cid, {
    requestedPresetId: 'local_transpose',
    localTransposeIntent: { semitone_delta: 1 },
  });
  assert(res && res.ok && res.ops === 0, 'clamp no-op');
  assert(res.executionPath === 'local_transpose', 'transpose path');
  assert(String(project.clips[cid].revisionId || '') === rev0, 'no revision');
  assert(res.patchSummary && res.patchSummary.phase1Deterministic && res.patchSummary.phase1Deterministic.intentSource === 'explicit_options', 'explicit transpose meta on no-op return');

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
      notes: [{ id: 'p0', pitch: 60, velocity: 80, startBeat: 0, durationBeat: 1 }],
    }],
  };
  const clip2 = globalThis.H2SProject.createClipFromScoreBeat(score2, { id: 'c_p1c', name: 'p1c' });
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
    userPrompt: 'transpose up 1 semitone',
  });
  assert(r2.ok && r2.ops === 1, 'narrowed prompt');
  const ps2 = project2.clips[clip2.id].meta.agent.patchSummary;
  assert(ps2.phase1Deterministic.intentSource === 'narrowed_from_prompt', 'narrowed');
  assertPitchOnlyOps({ ops: [{ op: 'setNote', noteId: 'p0', pitch: 61 }] });
}

function main(){
  testMetaBuilder();
  testVelocityPhase1SummaryAndOps();
  testTransposePhase1AndNoOp();
  console.log('phase1_deterministic_contract.test.js: OK');
}

main();
