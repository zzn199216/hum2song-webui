#!/usr/bin/env node
'use strict';

/**
 * Phase-1 freeze-readiness: end-to-end smoke from Assistant-style phrase → narrow → optimizeClip.
 * Complements low-level contract tests; does not replace them.
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

function loadAssistantNarrow(){
  loadVelocityShape();
  loadLocalTranspose();
  loadRhythm();
  ensureWindowShim();
  if (globalThis.H2SPhase1AssistantNarrow) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/phase1_assistant_narrow.js'));
  if (globalThis.window && globalThis.window.H2SPhase1AssistantNarrow) globalThis.H2SPhase1AssistantNarrow = globalThis.window.H2SPhase1AssistantNarrow;
}

function loadPhase1Meta(){
  ensureWindowShim();
  if (globalThis.H2SPhase1DeterministicMeta) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/phase1_deterministic_meta.js'));
  if (globalThis.window && globalThis.window.H2SPhase1DeterministicMeta) globalThis.H2SPhase1DeterministicMeta = globalThis.window.H2SPhase1DeterministicMeta;
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
  loadAssistantNarrow();
  loadPhase1Meta();
  ensureWindowShim();
  if (globalThis.H2SAgentController) return;
  require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  if (globalThis.window && globalThis.window.H2SAgentController) globalThis.H2SAgentController = globalThis.window.H2SAgentController;
  assert(globalThis.H2SAgentController && typeof globalThis.H2SAgentController.create === 'function', 'H2SAgentController missing');
}

/** Mirrors Assistant Run: phrase → narrow → options shape passed toward optimizeClip. */
function assistantLikeOptsFromPhrase(phrase, noteIdsBySlice){
  const N = globalThis.H2SPhase1AssistantNarrow;
  const narrowed = N.resolvePhase1AssistantIntentFromText(phrase);
  assert(narrowed && narrowed.branch, 'phrase must narrow');
  const ids = noteIdsBySlice || null;
  const base = {
    requestedPresetId: narrowed.branch === 'rhythm_tighten_loosen' ? 'rhythm_tighten_loosen'
      : narrowed.branch === 'local_transpose' ? 'local_transpose'
        : 'velocity_shape',
    userPrompt: phrase,
  };
  if (narrowed.branch === 'rhythm_tighten_loosen'){
    base.rhythmIntent = narrowed.intent;
    if (ids && ids.length) base.rhythmNoteIds = ids.slice();
  } else if (narrowed.branch === 'local_transpose'){
    base.localTransposeIntent = narrowed.intent;
    if (ids && ids.length) base.localTransposeNoteIds = ids.slice();
  } else {
    base.velocityShapeIntent = narrowed.intent;
    if (ids && ids.length) base.velocityShapeNoteIds = ids.slice();
  }
  return base;
}

function assertFreezeSignals(res, expectedPath, expectedCapabilityId){
  assert(res && res.ok !== false, 'optimize result ok');
  assert(res.executionPath === expectedPath, 'executionPath ' + expectedPath);
  const ps = res.patchSummary;
  assert(ps && ps.phase1Deterministic, 'patchSummary.phase1Deterministic');
  const p1 = ps.phase1Deterministic;
  assert(p1.capabilityId === expectedCapabilityId, 'capabilityId');
  assert(p1.executionPath === expectedCapabilityId, 'phase1 executionPath');
  assert(typeof p1.intentSource === 'string' && p1.intentSource.length > 0, 'intentSource');
  assert(p1.targetScope === 'note_ids' || p1.targetScope === 'whole_clip', 'targetScope');
}

function makeProjectWithClip(notes, clipId){
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
  const scoreBeat = { version: 2, tracks: [{ id: 't0', notes: notes }] };
  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: clipId, name: 'freeze' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project);
  return project;
}

function testE2EVelocityAssistantPath(){
  loadProject();
  loadAgentPatch();
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  let project = makeProjectWithClip([
    { id: 'v0', pitch: 60, velocity: 60, startBeat: 0, durationBeat: 1 },
    { id: 'v1', pitch: 62, velocity: 60, startBeat: 1, durationBeat: 1 },
  ], 'c_vel_e2e');
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });
  const cid = 'c_vel_e2e';
  const rev0 = String(project.clips[cid].revisionId || '');
  const phrase = 'make this louder';
  const opts = assistantLikeOptsFromPhrase(phrase, ['v0']);
  const res = ctrl.optimizeClip(cid, opts);
  assert(res.ok && res.ops >= 1, 'velocity has ops');
  assertFreezeSignals(res, 'velocity_shape', 'velocity_shape');
  assert(res.patchSummary.phase1Deterministic.intentSource === 'explicit_options', 'assistant path uses explicit narrowed intent');
  assert(String(project.clips[cid].revisionId || '') !== rev0, 'revision on success');
  const n1 = project.clips[cid].score.tracks[0].notes.find(function(n){ return n.id === 'v1'; });
  assert(n1.velocity === 60, 'scoped note untouched');
}

function testE2ELocalTransposeAssistantPath(){
  loadProject();
  loadAgentPatch();
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  let project = makeProjectWithClip([
    { id: 't0', pitch: 60, velocity: 80, startBeat: 0, durationBeat: 1 },
  ], 'c_lt_e2e');
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });
  const cid = 'c_lt_e2e';
  const rev0 = String(project.clips[cid].revisionId || '');
  const phrase = 'transpose up 1 semitone';
  const opts = assistantLikeOptsFromPhrase(phrase, ['t0']);
  const res = ctrl.optimizeClip(cid, opts);
  assert(res.ok && res.ops === 1, 'transpose one op');
  assertFreezeSignals(res, 'local_transpose', 'local_transpose');
  assert(project.clips[cid].score.tracks[0].notes[0].pitch === 61, 'pitch +1');
  assert(String(project.clips[cid].revisionId || '') !== rev0, 'revision');
}

function testE2ERhythmAssistantPath(){
  loadProject();
  loadAgentPatch();
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  let project = makeProjectWithClip([
    { id: 'r0', pitch: 60, velocity: 80, startBeat: 0.12, durationBeat: 0.5 },
    { id: 'r1', pitch: 62, velocity: 80, startBeat: 1, durationBeat: 0.5 },
  ], 'c_rhy_e2e');
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });
  const cid = 'c_rhy_e2e';
  const rev0 = String(project.clips[cid].revisionId || '');
  const phrase = 'tighten the rhythm';
  const opts = assistantLikeOptsFromPhrase(phrase, ['r0']);
  const res = ctrl.optimizeClip(cid, opts);
  assert(res.ok && res.ops >= 1, 'rhythm has ops');
  assertFreezeSignals(res, 'rhythm_tighten_loosen', 'rhythm_tighten_loosen');
  const r1 = project.clips[cid].score.tracks[0].notes.find(function(n){ return n.id === 'r1'; });
  assert(r1.startBeat === 1, 'scoped out of edit');
}

function testE2ENoOpRevisionAndMetadata(){
  loadProject();
  loadAgentPatch();
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  let project = makeProjectWithClip([
    { id: 'm0', pitch: 127, velocity: 100, startBeat: 0, durationBeat: 1 },
  ], 'c_noop_e2e');
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });
  const cid = 'c_noop_e2e';
  const rev0 = String(project.clips[cid].revisionId || '');
  const phrase = 'transpose up 1 semitone';
  const opts = assistantLikeOptsFromPhrase(phrase, ['m0']);
  const res = ctrl.optimizeClip(cid, opts);
  assert(res.ok && res.ops === 0, 'clamp no-op');
  assert(res.executionPath === 'local_transpose', 'path');
  assert(String(project.clips[cid].revisionId || '') === rev0, 'no revision');
  assert(res.patchSummary && res.patchSummary.phase1Deterministic && res.patchSummary.noChanges === true, 'no-op metadata');
  assert(res.patchSummary.phase1Deterministic.intentSource === 'explicit_options', 'explicit');
}

function testE2EPromptOnlyNarrowingStillCoherent(){
  loadProject();
  loadAgentPatch();
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));

  let project = makeProjectWithClip([
    { id: 'p0', pitch: 60, velocity: 70, startBeat: 0, durationBeat: 1 },
  ], 'c_prompt_e2e');
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });
  const cid = 'c_prompt_e2e';
  const res = ctrl.optimizeClip(cid, {
    requestedPresetId: 'velocity_shape',
    userPrompt: 'make this louder',
  });
  assert(res.ok && res.ops >= 1, 'prompt-only narrow');
  assertFreezeSignals(res, 'velocity_shape', 'velocity_shape');
  assert(res.patchSummary.phase1Deterministic.intentSource === 'narrowed_from_prompt', 'narrowed from prompt only');
}

function main(){
  testE2EVelocityAssistantPath();
  testE2ELocalTransposeAssistantPath();
  testE2ERhythmAssistantPath();
  testE2ENoOpRevisionAndMetadata();
  testE2EPromptOnlyNarrowingStillCoherent();
  console.log('phase1_freeze_e2e_smoke.test.js: OK');
}

main();
