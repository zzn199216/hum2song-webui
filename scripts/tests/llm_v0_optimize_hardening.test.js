#!/usr/bin/env node
'use strict';

/**
 * Bounded llm_v0 hardening: patchSummary.llm.outcome + top-level llmOutcome (not phase1Deterministic).
 */
const path = require('path');
const fs = require('fs');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

/** Contract: llm_v0 optimize results mirror outcome, stay on executionPath llm, and never carry Phase-1 metadata. */
function assertLlmOutcomeContract(res, expectedOutcome, opts){
  const o = opts || {};
  assert(res && typeof res === 'object', 'result object');
  assert(res.executionPath === 'llm', 'executionPath must be llm for llm_v0');
  assert(res.patchSummary && typeof res.patchSummary === 'object', 'patchSummary');
  assert(res.patchSummary.llm && typeof res.patchSummary.llm === 'object', 'patchSummary.llm must exist');
  assert(res.patchSummary.llm.outcome === expectedOutcome, 'patchSummary.llm.outcome');
  assert(res.llmOutcome === res.patchSummary.llm.outcome, 'llmOutcome mirrors patchSummary.llm.outcome');
  if (!o.allowPhase1){
    assert(!res.patchSummary.phase1Deterministic, 'phase1Deterministic must be absent on llm path');
  }
}

/** llm_v0 retry observability: llmDebug + patchSummary.llm share bounded attempt fields. */
function assertLlmRetryMeta(res, expected){
  const d = res.llmDebug;
  assert(d && typeof d === 'object', 'llmDebug');
  assert(d.totalAttempts === expected.totalAttempts, 'llmDebug.totalAttempts');
  assert(d.finalAttemptIndex === expected.finalAttemptIndex, 'llmDebug.finalAttemptIndex');
  assert(d.attemptCount === expected.totalAttempts, 'attemptCount matches totalAttempts');
  assert(Array.isArray(d.attemptSummaries), 'attemptSummaries');
  assert(d.attemptSummaries.length === expected.totalAttempts, 'summaries length');
  assert(res.patchSummary.llm.totalAttempts === expected.totalAttempts, 'patchSummary.llm.totalAttempts');
  assert(res.patchSummary.llm.finalAttemptIndex === expected.finalAttemptIndex, 'patchSummary.llm.finalAttemptIndex');
  assert(Array.isArray(res.patchSummary.llm.attemptSummaries), 'patchSummary.llm.attemptSummaries');
}

/** Pre-request fail (no chat-completions): zero attempts, preRequestExit flag. */
function assertLlmPreRequestMeta(res, expectedOutcome){
  assertLlmOutcomeContract(res, expectedOutcome);
  assert(res.llmDebug && typeof res.llmDebug === 'object', 'llmDebug');
  assert(res.llmDebug.preRequestExit === true, 'preRequestExit');
  assert(res.llmDebug.totalAttempts === 0 && res.llmDebug.attemptCount === 0, 'llmDebug zero counts');
  assert(res.llmDebug.finalAttemptIndex === 0, 'llmDebug finalAttemptIndex 0');
  assert(Array.isArray(res.llmDebug.attemptSummaries) && res.llmDebug.attemptSummaries.length === 0, 'empty attemptSummaries');
  assert(res.patchSummary.llm.preRequestExit === true, 'patchSummary.llm.preRequestExit');
  assert(res.patchSummary.llm.totalAttempts === 0 && res.patchSummary.llm.finalAttemptIndex === 0, 'patchSummary.llm zero attempts');
}

function ensureWindowShim(){
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function loadProject(){
  ensureWindowShim();
  if (globalThis.H2SProject && typeof globalThis.H2SProject.beginNewClipRevision === 'function') return;
  require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
  if (globalThis.window && globalThis.window.H2SProject) globalThis.H2SProject = globalThis.window.H2SProject;
}

function loadAgentPatch(){
  ensureWindowShim();
  if (globalThis.H2SAgentPatch) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/agent_patch.js'));
  if (globalThis.window && globalThis.window.H2SAgentPatch) globalThis.H2SAgentPatch = globalThis.window.H2SAgentPatch;
}

function loadAgentController(){
  loadAgentPatch();
  loadProject();
  ensureWindowShim();
  require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  if (globalThis.window && globalThis.window.H2SAgentController) globalThis.H2SAgentController = globalThis.window.H2SAgentController;
}

function loadLlmClient(){
  ensureWindowShim();
  require(path.resolve(__dirname, '../../static/pianoroll/llm_client.js'));
}

function makeClip(){
  const H2SProject = globalThis.H2SProject;
  const project = {
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
      notes: [{ id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 }],
    }],
  };
  const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'llm_h1', name: 'h1' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (H2SProject.normalizeProjectRevisionChains) H2SProject.normalizeProjectRevisionChains(project);
  return { project, clip };
}

function makeClipWithNoteCount(count){
  const H2SProject = globalThis.H2SProject;
  const project = {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1', instrument: 'default', gainDb: 0, muted: false, trackId: 'trk_0' }],
    clips: {},
    clipOrder: [],
    instances: [],
    ui: { pxPerBeat: 120, playheadBeat: 0 },
  };
  const notes = [];
  for (let i = 0; i < count; i++){
    notes.push({
      id: 'editable_note_' + String(i).padStart(2, '0') + '_cloud_smoke',
      pitch: 60 + (i % 12),
      velocity: 80 + (i % 20),
      startBeat: i * 0.5,
      durationBeat: 0.5,
    });
  }
  const clip = H2SProject.createClipFromScoreBeat({
    version: 2,
    tracks: [{ id: 't0', notes }],
  }, { id: 'llm_cloud_24', name: 'cloud 24' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (H2SProject.normalizeProjectRevisionChains) H2SProject.normalizeProjectRevisionChains(project);
  return { project, clip };
}

function extractJsonFromFence(text){
  const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
  return m ? JSON.parse(m[1]) : null;
}

function installPatchLlmMock(patch, opts){
  const o = opts || {};
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';
  const capture = { cfg: null, messages: null, opts: null };
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async (cfg, messages, callOpts) => {
      capture.cfg = cfg;
      capture.messages = messages;
      capture.opts = callOpts || null;
      return { text: rawText };
    },
    extractJsonObject: extractJsonFromFence,
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: o.velocityOnly === true }),
  };
  return capture;
}

function agentControllerSource(){
  return fs.readFileSync(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'), 'utf8');
}

function makeOptimizeController(projectRef){
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  return AgentController.create({
    getProjectV2: () => projectRef.project,
    setProjectFromV2: (p) => { projectRef.project = p; },
    persist: () => {},
    render: () => {},
  });
}

function flattenNotes(clip){
  const out = [];
  const tracks = clip && clip.score && Array.isArray(clip.score.tracks) ? clip.score.tracks : [];
  for (const t of tracks){
    const notes = Array.isArray(t.notes) ? t.notes : [];
    for (const n of notes) out.push(Object.assign({ trackId: t.id }, n));
  }
  return out;
}

async function testAppliedOutcome(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'test' });
  assert(res && res.ok === true && res.ops === 1, 'applied');
  assertLlmOutcomeContract(res, 'applied');
  assertLlmRetryMeta(res, { totalAttempts: 1, finalAttemptIndex: 1 });
  assert(res.llmDebug.attemptSummaries[0].outcome === 'applied', 'single attempt outcome');
}

async function testUserTextPromptDisablesVelocityOnlySafeMode(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', pitch: 62, velocity: 82 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, {
    requestedPresetId: 'llm_v0',
    userPrompt: '优化一下，让这段音乐更好听，这段有一些音不符合乐理',
    _assistantFreeformTextRequest: true,
  });
  assert(res && res.ok === true, 'user text prompt should allow pitch edits even when stored config is velocityOnly');
  assert(res.llmDebug && res.llmDebug.safeModeResolved === false, 'user text prompt resolves normal mode');
  const updated = project.clips[cid].score.tracks[0].notes.find((n) => n.id === 'n0');
  assert(updated && updated.pitch === 62, 'pitch change applied');
}

async function testVagueMakeBetterCanApplyMultiDimensionalPatch(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClipWithNoteCount(4);
  let project = proj;
  const cid = clip.id;
  const beforeRevisionId = clip.revisionId;

  const patch = {
    version: 1,
    clipId: cid,
    ops: [
      { op: 'setNote', noteId: 'editable_note_00_cloud_smoke', pitch: 61, velocity: 86, startBeat: 0.125, durationBeat: 0.375 },
      { op: 'moveNote', noteId: 'editable_note_01_cloud_smoke', deltaBeat: 0.125 },
    ],
  };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '优化一下，让这段音乐更好听，这段有一些音不符合乐理' });
  assert(res && res.ok === true && res.ops === 2, 'vague make-better prompt can apply pitch/timing/velocity patch');
  assertLlmOutcomeContract(res, 'applied');
  assert(res.patchSummary.hasPitchChange === true, 'patch summary has pitch change');
  assert(res.patchSummary.hasTimingChange === true, 'patch summary has timing change');
  assert(project.clips[cid].revisionId !== beforeRevisionId, 'applied patch creates new revision');
  const updated = project.clips[cid].score.tracks[0].notes.find((n) => n.id === 'editable_note_00_cloud_smoke');
  assert(updated.pitch === 61 && updated.velocity === 86 && updated.startBeat === 0.125 && updated.durationBeat === 0.375, 'multi-dimensional edit applied');
}

async function testCleanUnmusicalNotesCanDeleteSmallOutlierSet(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClipWithNoteCount(10);
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'deleteNote', noteId: 'editable_note_09_cloud_smoke' }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'clean unmusical notes' });
  assert(res && res.ok === true, 'small outlier delete applies');
  assert(project.clips[cid].score.tracks[0].notes.length === 9, 'one note deleted');
}

async function testTooManyDeletesRejectedAndClipUnchanged(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClipWithNoteCount(10);
  let project = proj;
  const cid = clip.id;
  const before = JSON.stringify(project.clips[cid].score);

  const patch = {
    version: 1,
    clipId: cid,
    ops: [0, 1, 2].map((i) => ({ op: 'deleteNote', noteId: 'editable_note_0' + i + '_cloud_smoke' })),
  };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'clean unmusical notes' });
  assert(res && res.ok === false && res.reason === 'too_destructive', 'too many deletes rejected');
  assertLlmOutcomeContract(res, 'rejected_destructive');
  assert(JSON.stringify(project.clips[cid].score) === before, 'rejected delete patch leaves original unchanged');
}

async function testInvalidNoteIdRejectedWithSpecificReason(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;
  const before = JSON.stringify(project.clips[cid].score);

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'missing_note_id', pitch: 62 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'fix wrong note' });
  assert(res && res.ok === false && res.reason === 'invalid_note_reference', 'invalid noteId gets specific reason');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(JSON.stringify(project.clips[cid].score) === before, 'invalid noteId leaves original unchanged');
}

async function testSecondsFieldsRejectedWithSpecificReason(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;
  const before = JSON.stringify(project.clips[cid].score);

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', startSec: 0.25, durationSec: 0.5, velocity: 82 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'tighten this note' });
  assert(res && res.ok === false && res.reason === 'invalid_timing', 'seconds fields get timing validation reason');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(JSON.stringify(project.clips[cid].score) === before, 'seconds patch leaves original unchanged');
}

async function testAddNoteChordifyAppliesWithGeneratedIds(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;
  const beforeRevisionId = clip.revisionId;

  const patch = {
    version: 1,
    clipId: cid,
    ops: [
      { op: 'addNote', note: { pitch: 64, velocity: 78, startBeat: 0, durationBeat: 1 } },
      { op: 'addNote', note: { pitch: 67, velocity: 76, startBeat: 0, durationBeat: 1 } },
    ],
  };
  installPatchLlmMock(patch);
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '把这里的单音转化为和弦' });
  assert(res && res.ok === true && res.ops === 2, 'chordify addNote patch applies');
  assertLlmOutcomeContract(res, 'applied');
  assert(res.patchSummary.byOp && res.patchSummary.byOp.addNote === 2, 'patchSummary includes addNote count');
  assert(res.patchSummary.hasStructuralChange === true, 'addNote is structural');
  assert(res.llmPromptTrace && res.llmPromptTrace.finalSystemPrompt.indexOf('addNote') >= 0, 'prompt mentions addNote');
  assert(res.llmPromptTrace.finalSystemPrompt.indexOf('Example addNote') >= 0, 'prompt includes addNote example');
  assert(res.llmPromptTrace.finalSystemPrompt.indexOf('"op":"addNote"') >= 0, 'prompt example shows op discriminator');
  assert(res.llmPromptTrace.finalSystemPrompt.indexOf('Do not use addNote') < 0, 'prompt no longer forbids addNote');
  const notes = flattenNotes(state.project.clips[cid]);
  assert(notes.length === 3, 'two generated notes added');
  const ids = notes.map((n) => String(n.id));
  assert(new Set(ids).size === ids.length, 'all note ids are unique');
  assert(ids.indexOf('n0') >= 0, 'original note remains');
  const added = notes.filter((n) => String(n.id) !== 'n0');
  assert(added.length === 2, 'added notes have generated ids');
  assert(added.every((n) => n.trackId === 't0'), 'missing trackId defaults to primary clip track');
  assert(added.some((n) => n.pitch === 64) && added.some((n) => n.pitch === 67), 'harmony pitches inserted');
  assert(state.project.clips[cid].revisionId !== beforeRevisionId, 'addNote creates a new revision');

  const rb = globalThis.H2SProject.rollbackClipRevision(state.project, cid);
  assert(rb && rb.ok, 'rollback succeeds after addNote revision');
  assert(flattenNotes(state.project.clips[cid]).length === 1, 'rollback removes added notes');
}

async function testMissingOpFlatNoteLikeObjectNormalizesToAddNote(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;

  const patch = {
    version: 1,
    clipId: cid,
    ops: [
      { pitch: 64, velocity: 78, startBeat: 0, durationBeat: 1 },
    ],
  };
  installPatchLlmMock(patch);
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '把它做成好听的和弦' });
  assert(res && res.ok === true && res.ops === 1, 'flat missing-op note-like object normalizes to addNote');
  assertLlmOutcomeContract(res, 'applied');
  assert(res.patchSummary.byOp && res.patchSummary.byOp.addNote === 1, 'normalized flat object counted as addNote');
  const notes = flattenNotes(state.project.clips[cid]);
  assert(notes.length === 2, 'normalized flat object inserts note');
  const added = notes.find((n) => String(n.id) !== 'n0');
  assert(added && added.pitch === 64 && added.trackId === 't0', 'normalized flat addNote uses default track');
}

async function testMissingOpNestedNoteObjectNormalizesToAddNote(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;

  const patch = {
    version: 1,
    clipId: cid,
    ops: [
      { note: { pitch: 67, velocity: 76, startBeat: 0, durationBeat: 1 } },
    ],
  };
  installPatchLlmMock(patch);
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'add harmony' });
  assert(res && res.ok === true && res.ops === 1, 'nested missing-op note object normalizes to addNote');
  assertLlmOutcomeContract(res, 'applied');
  assert(res.patchSummary.byOp && res.patchSummary.byOp.addNote === 1, 'normalized nested object counted as addNote');
  const notes = flattenNotes(state.project.clips[cid]);
  const added = notes.find((n) => String(n.id) !== 'n0');
  assert(added && added.pitch === 67 && added.trackId === 't0', 'normalized nested addNote uses default track');
}

async function testMissingOpAmbiguousObjectStillFails(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;
  const before = JSON.stringify(state.project.clips[cid].score);

  installPatchLlmMock({ version: 1, clipId: cid, ops: [{ pitch: 64, velocity: 78 }] });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'add harmony' });
  assert(res && res.ok === false && res.reason === 'validation_failed', 'ambiguous missing-op object remains rejected');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(String(res.detail || '').indexOf('missing_op') >= 0, 'ambiguous rejection keeps missing_op diagnostic');
  assert(JSON.stringify(state.project.clips[cid].score) === before, 'ambiguous missing-op rejection leaves original unchanged');
}

async function testMissingOpSecondsObjectStillFails(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;
  const before = JSON.stringify(state.project.clips[cid].score);

  installPatchLlmMock({ version: 1, clipId: cid, ops: [{ pitch: 64, velocity: 78, startBeat: 0, durationBeat: 1, startSec: 0 }] });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'add harmony' });
  assert(res && res.ok === false && res.reason === 'invalid_timing', 'missing-op object with seconds remains rejected');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(String(res.detail || '').indexOf('seconds_field') >= 0, 'seconds rejection keeps seconds diagnostic');
  assert(JSON.stringify(state.project.clips[cid].score) === before, 'seconds missing-op rejection leaves original unchanged');
}

async function testAddNoteProvidedIdIsRewrittenAndMixedSetNoteApplies(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;

  const patch = {
    version: 1,
    clipId: cid,
    ops: [
      { op: 'setNote', noteId: 'n0', velocity: 70 },
      { op: 'addNote', trackId: 't0', note: { id: 'n0', pitch: 72, velocity: 75, startBeat: 0, durationBeat: 1 } },
    ],
  };
  installPatchLlmMock(patch);
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '加八度' });
  assert(res && res.ok === true && res.ops === 2, 'mixed setNote + addNote patch applies');
  assertLlmOutcomeContract(res, 'applied');
  assert(res.patchSummary.byOp.setNote === 1 && res.patchSummary.byOp.addNote === 1, 'mixed op counts are preserved');
  const notes = flattenNotes(state.project.clips[cid]);
  const ids = notes.map((n) => String(n.id));
  assert(notes.length === 2, 'one note added');
  assert(new Set(ids).size === ids.length, 'model-provided colliding id is rewritten');
  assert(ids.filter((id) => id === 'n0').length === 1, 'original note id is not duplicated');
  const original = notes.find((n) => String(n.id) === 'n0');
  const added = notes.find((n) => String(n.id) !== 'n0');
  assert(original && original.velocity === 70, 'setNote still applied to original note');
  assert(added && added.pitch === 72 && added.trackId === 't0', 'valid existing track receives addNote');
}

async function testAddNoteInvalidTrackRejectedAndClipUnchanged(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;
  const before = JSON.stringify(state.project.clips[cid].score);

  const patch = { version: 1, clipId: cid, ops: [{ op: 'addNote', trackId: 'missing_track', note: { pitch: 64, velocity: 80, startBeat: 0, durationBeat: 1 } }] };
  installPatchLlmMock(patch);
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'add harmony' });
  assert(res && res.ok === false, 'missing addNote track rejected');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(String(res.detail || '').indexOf('add_track_not_found') >= 0, 'diagnostics include missing track validation reason');
  assert(JSON.stringify(state.project.clips[cid].score) === before, 'rejected missing-track addNote leaves original unchanged');
}

async function testAddNoteSecondsFieldsRejected(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;
  const before = JSON.stringify(state.project.clips[cid].score);

  const patch = { version: 1, clipId: cid, ops: [{ op: 'addNote', trackId: 't0', note: { pitch: 64, velocity: 80, startBeat: 0, durationBeat: 1, startSec: 0.1, durationSec: 0.5 } }] };
  installPatchLlmMock(patch);
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '加一点和声' });
  assert(res && res.ok === false && res.reason === 'invalid_timing', 'addNote seconds fields rejected with timing reason');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(String(res.detail || '').indexOf('seconds_field') >= 0, 'diagnostics include seconds field reason');
  assert(JSON.stringify(state.project.clips[cid].score) === before, 'seconds addNote leaves original unchanged');
}

async function testAddNoteInvalidNumbersRejected(){
  loadAgentController();
  const cases = [
    { label: 'pitch', note: { pitch: 128, velocity: 80, startBeat: 0, durationBeat: 1 }, reason: 'invalid_pitch_or_velocity', detail: 'add_pitch_oob' },
    { label: 'velocity', note: { pitch: 64, velocity: 0, startBeat: 0, durationBeat: 1 }, reason: 'invalid_pitch_or_velocity', detail: 'add_velocity_oob' },
    { label: 'startBeat', note: { pitch: 64, velocity: 80, startBeat: -0.25, durationBeat: 1 }, reason: 'invalid_timing', detail: 'add_startBeat_invalid' },
    { label: 'durationBeat', note: { pitch: 64, velocity: 80, startBeat: 0, durationBeat: 0 }, reason: 'invalid_timing', detail: 'add_durationBeat_invalid' },
  ];
  for (const c of cases){
    const { project: proj, clip } = makeClip();
    const state = { project: proj };
    const cid = clip.id;
    const before = JSON.stringify(state.project.clips[cid].score);
    installPatchLlmMock({ version: 1, clipId: cid, ops: [{ op: 'addNote', trackId: 't0', note: c.note }] });
    const ctrl = makeOptimizeController(state);
    const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'add harmony ' + c.label });
    assert(res && res.ok === false && res.reason === c.reason, c.label + ' rejected with expected reason');
    assertLlmOutcomeContract(res, 'rejected_validation');
    assert(String(res.detail || '').indexOf(c.detail) >= 0, c.label + ' detail includes validation code');
    assert(JSON.stringify(state.project.clips[cid].score) === before, c.label + ' rejection leaves original unchanged');
  }
}

async function testAddNoteOutsideClipRejectedAndClipUnchanged(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;
  const before = JSON.stringify(state.project.clips[cid].score);

  const patch = { version: 1, clipId: cid, ops: [{ op: 'addNote', trackId: 't0', note: { pitch: 64, velocity: 80, startBeat: 1.25, durationBeat: 0.5 } }] };
  installPatchLlmMock(patch);
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '加几个经过音' });
  assert(res && res.ok === false && res.reason === 'invalid_timing', 'outside-span addNote rejected');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(String(res.detail || '').indexOf('add_outside_clip_span') >= 0, 'outside-span detail included');
  assert(JSON.stringify(state.project.clips[cid].score) === before, 'outside-span addNote leaves original unchanged');
}

async function testAddNoteDensityCapRejectedAndClipUnchanged(){
  loadAgentController();
  const { project: proj, clip } = makeClip();
  const state = { project: proj };
  const cid = clip.id;
  const before = JSON.stringify(state.project.clips[cid].score);
  const ops = [];
  for (let i = 0; i < 17; i++){
    ops.push({ op: 'addNote', trackId: 't0', note: { pitch: 60 + (i % 12), velocity: 70, startBeat: 0, durationBeat: 0.25 } });
  }
  installPatchLlmMock({ version: 1, clipId: cid, ops });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '让旋律更丰满' });
  assert(res && res.ok === false, 'excessive addNote count rejected');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(String(res.detail || '').indexOf('add_count_excess') >= 0, 'density cap detail included');
  assert(JSON.stringify(state.project.clips[cid].score) === before, 'density rejection leaves original unchanged');
}

async function testCloudSmallClipPromptStaysBounded(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClipWithNoteCount(24);
  let project = proj;
  const cid = clip.id;
  const patch = { version: 1, clipId: cid, ops: [{ op: 'moveNote', noteId: 'editable_note_00_cloud_smoke', deltaBeat: 0.125 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';
  let capturedMessages = null;
  let capturedCfg = null;

  const prevCloudMode = globalThis.H2S_CLOUD_MODE;
  const prevCloudClient = globalThis.H2S_CLOUD_LLM_CLIENT;
  const prevLlmConfig = globalThis.H2S_LLM_CONFIG;
  globalThis.H2S_CLOUD_MODE = true;
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: '', model: '', authToken: 'LOCAL_TOKEN_SHOULD_NOT_BE_USED', modelProfileId: 'qwen36_plus' }),
  };
  globalThis.H2S_CLOUD_LLM_CLIENT = {
    callChatCompletions: async (cfg, messages, callOpts) => {
      capturedCfg = cfg;
      capturedMessages = messages;
      capturedCfg.callOpts = callOpts || null;
      return { text: rawText };
    },
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });

    const res = await ctrl.optimizeClip(cid, {
      requestedPresetId: 'llm_v0',
      userPrompt: 'tighten rhythm gently',
      intent: { fixPitch: false, tightenRhythm: true, reduceOutliers: false },
    });
    assert(res && res.ok === true, 'cloud optimize succeeds');
    assert(capturedCfg && capturedCfg.modelProfileId === 'qwen36_plus', 'cloud optimize should carry selected modelProfileId');
    assert(capturedCfg.callOpts && capturedCfg.callOpts.maxOutputTokens === 8192, '24-note optimize requests 8192 output tokens');
    assert(capturedCfg.callOpts && capturedCfg.callOpts.task === 'studio_ai_optimize', 'cloud optimize sends task metadata');
    assert(capturedCfg.callOpts && capturedCfg.callOpts.noteCount === 24, 'cloud optimize sends note count metadata');
    assert(Array.isArray(capturedMessages), 'cloud messages captured');
    assert(capturedMessages.length === 2, 'cloud request sends system + user messages only');
    const totalChars = capturedMessages.reduce((sum, m) => sum + String(m.content || '').length, 0);
    assert(totalChars <= 4000, '24-note cloud prompt should fit free_basic maxInputChars');
    const serialized = JSON.stringify(capturedMessages);
    assert(serialized.indexOf('"clips"') < 0 && serialized.indexOf('"instances"') < 0, 'request must not include whole project');
    assert(serialized.indexOf('llmPromptTrace') < 0 && serialized.indexOf('finalSystemPrompt') < 0, 'request must not include prompt trace/debug');
    assert(/musically meaningful/i.test(serialized), 'normal llm prompt encourages musically meaningful edits');
    assert(/expressive but bounded/i.test(serialized), 'normal llm prompt allows expressive bounded changes');
    assert(/do not respond with velocity-only unless explicitly requested/i.test(serialized), 'normal llm prompt should not default to velocity-only');
  } finally {
    globalThis.H2S_CLOUD_MODE = prevCloudMode;
    globalThis.H2S_CLOUD_LLM_CLIENT = prevCloudClient;
    globalThis.H2S_LLM_CONFIG = prevLlmConfig;
  }
}

async function testLongClip252NotesSendsAllEditableRows(){
  loadAgentController();
  const { project: proj, clip } = makeClipWithNoteCount(252);
  const state = { project: proj };
  const cid = clip.id;
  const capture = installPatchLlmMock({ version: 1, clipId: cid, ops: [] }, { velocityOnly: false });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'make it more musical' });
  assert(res && res.ok === true, '252-note clip should not be pre-blocked');
  assert(capture.messages && capture.messages.length === 2, '252-note clip should reach LLM request');
  assert(res.llmPromptTrace && res.llmPromptTrace.requestStats.noteRowsTotal === 252, '252-note total rows tracked');
  assert(res.llmPromptTrace.requestStats.noteRowsSent === 252, '252-note clip exposes every editable note under cap');
  assert(res.llmPromptTrace.requestStats.requestedMaxOutputTokens === 32768, '252-note clip requests 32768 output tokens');
  assert(capture.opts && capture.opts.maxOutputTokens === 32768, '252-note optimize sends 32768 output token hint');
  assert(capture.opts && capture.opts.task === 'studio_ai_optimize', '252-note optimize sends task metadata');
  assert(capture.opts && capture.opts.noteCount === 252, '252-note optimize sends note count metadata');
  const userPrompt = String(capture.messages[1].content || '');
  assert(userPrompt.indexOf('Allowed noteIds') < 0, 'prompt should not include separate Allowed noteIds block');
  assert(userPrompt.indexOf('idx,trackId,noteId,pitch,startBeat,durationBeat,velocity') >= 0, 'NOTE TABLE keeps noteId and adds idx');
  assert(userPrompt.indexOf('For setNote/moveNote/deleteNote, prefer idx values from the NOTE TABLE above.') >= 0, 'prompt prefers concise idx references');
  assert(userPrompt.indexOf('noteId remains accepted for compatibility.') >= 0, 'prompt keeps noteId compatibility');
  assert(userPrompt.indexOf('For addNote, do not provide noteId; the app will generate one.') >= 0, 'prompt tells addNote to omit noteId');
  assert(userPrompt.indexOf('editable_note_00_cloud_smoke') >= 0, 'first note listed');
  assert(userPrompt.indexOf('editable_note_251_cloud_smoke') >= 0, 'last 252nd note listed');
  assert(userPrompt.indexOf('first 252 editable notes') < 0, 'under-cap clip should not claim bounded first rows');
  const noteIds = [];
  for (let i = 0; i < 252; i++) noteIds.push('editable_note_' + String(i).padStart(2, '0') + '_cloud_smoke');
  const oldAllowedBlock = '\nAllowed noteIds (use ONLY these for setNote/moveNote/deleteNote):\n' + noteIds.join(', ') + '\n';
  assert(oldAllowedBlock.length > 1000, 'old 252-note Allowed noteIds block was prompt bloat');
}

async function testLlmV0PromptNoteRowCapIs2000(){
  const src = agentControllerSource();
  assert(/\bLLM_V0_MAX_PROMPT_NOTE_ROWS\s*=\s*2000\b/.test(src), 'llm_v0 prompt note row cap must be 2000');
}

async function testLongClipAbove2000ShowsHonestBoundedContext(){
  loadAgentController();
  const { project: proj, clip } = makeClipWithNoteCount(2005);
  const state = { project: proj };
  const cid = clip.id;
  const capture = installPatchLlmMock({ version: 1, clipId: cid, ops: [] }, { velocityOnly: false });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'make it more musical' });
  assert(res && res.ok === true, 'above-cap clip should still be attempted');
  assert(res.llmPromptTrace && res.llmPromptTrace.requestStats.noteRowsTotal === 2005, 'above-cap total rows tracked');
  assert(res.llmPromptTrace.requestStats.noteRowsSent === 2000, 'above-cap prompt is bounded at 2000 rows');
  const userPrompt = String(capture.messages[1].content || '');
  assert(userPrompt.indexOf('first 2000 editable notes') >= 0, 'prompt declares bounded note table');
  assert(userPrompt.indexOf('Clip has 2005 notes total; context is bounded to the listed editable notes') >= 0, 'prompt explains only listed notes are editable');
  assert(userPrompt.indexOf('Allowed noteIds') < 0, 'above-cap prompt should not include separate Allowed noteIds block');
  assert(userPrompt.indexOf('editable_note_1999_cloud_smoke') >= 0, 'last listed note at cap is present');
  assert(userPrompt.indexOf('editable_note_2000_cloud_smoke') < 0, 'first note beyond cap is not listed');
  assert(capture.opts && capture.opts.maxOutputTokens === 65536, 'above-300-note optimize sends 65536 output token hint');
}

async function testOptimizePromptDoesNotForceFixedModesOrHighestValueWording(){
  loadAgentController();
  const { project: proj, clip } = makeClipWithNoteCount(4);
  const state = { project: proj };
  const cid = clip.id;
  const capture = installPatchLlmMock({ version: 1, clipId: cid, ops: [] }, { velocityOnly: false });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'make it more musical' });
  assert(res && res.ok === true, 'freeform optimize request succeeds');
  const serialized = JSON.stringify(capture.messages || []).toLowerCase();
  assert(serialized.indexOf('fix_pitch') < 0, 'prompt should not force fix_pitch mode');
  assert(serialized.indexOf('tighten_rhythm') < 0, 'prompt should not force tighten_rhythm mode');
  assert(serialized.indexOf('velocity_shape') < 0, 'prompt should not force velocity_shape mode');
  assert(serialized.indexOf('highest-value edits') < 0, 'prompt should not use highest-value edits wording');
  assert(res.llmPromptTrace.requestStats.noteRowsSent === 4, 'small clip still sends all rows');
}

async function testExistingNoteOpsWithValidNoteIdsStillApply(){
  loadAgentController();
  const { project: proj, clip } = makeClipWithNoteCount(10);
  const state = { project: proj };
  const cid = clip.id;

  const patch = {
    version: 1,
    clipId: cid,
    ops: [
      { op: 'setNote', noteId: 'editable_note_00_cloud_smoke', velocity: 70 },
      { op: 'moveNote', noteId: 'editable_note_01_cloud_smoke', deltaBeat: 0.125 },
      { op: 'deleteNote', noteId: 'editable_note_09_cloud_smoke' },
    ],
  };
  installPatchLlmMock(patch, { velocityOnly: false });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'clean this up' });
  assert(res && res.ok === true && res.ops === 3, 'set/move/delete with valid noteIds still apply');
  assertLlmOutcomeContract(res, 'applied');
  const notes = flattenNotes(state.project.clips[cid]);
  assert(notes.length === 9, 'deleteNote removed one note');
  const n0 = notes.find((n) => String(n.id) === 'editable_note_00_cloud_smoke');
  const n1 = notes.find((n) => String(n.id) === 'editable_note_01_cloud_smoke');
  assert(n0 && n0.velocity === 70, 'setNote by noteId applied');
  assert(n1 && n1.startBeat === 0.625, 'moveNote by noteId applied');
}

async function testExistingNoteOpsCanUseIdxFromNoteTable(){
  loadAgentController();
  const { project: proj, clip } = makeClipWithNoteCount(4);
  const state = { project: proj };
  const cid = clip.id;

  installPatchLlmMock({
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', idx: 2, velocity: 71 }],
  }, { velocityOnly: false });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'soften the third note' });
  assert(res && res.ok === true && res.ops === 1, 'idx reference resolves and applies');
  assertLlmOutcomeContract(res, 'applied');
  const notes = flattenNotes(state.project.clips[cid]);
  const n2 = notes.find((n) => String(n.id) === 'editable_note_02_cloud_smoke');
  assert(n2 && n2.velocity === 71, 'idx 2 resolved to third NOTE TABLE row noteId');
}

async function testInvalidIdxReferenceRejectedAndClipUnchanged(){
  loadAgentController();
  const { project: proj, clip } = makeClipWithNoteCount(4);
  const state = { project: proj };
  const cid = clip.id;
  const before = JSON.stringify(state.project.clips[cid].score);

  installPatchLlmMock({
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', idx: 99, velocity: 71 }],
  }, { velocityOnly: false });
  const ctrl = makeOptimizeController(state);

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'soften a note' });
  assert(res && res.ok === false && res.reason === 'invalid_note_reference', 'invalid idx rejected as note reference');
  assertLlmOutcomeContract(res, 'rejected_validation');
  assert(String(res.detail || '').indexOf('idx_invalid') >= 0, 'invalid idx diagnostic retained');
  assert(JSON.stringify(state.project.clips[cid].score) === before, 'invalid idx rejection leaves original unchanged');
}

async function testLengthFinishWithParseableJsonDiscardsPatchAndLeavesClipUnchanged(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;
  const before = JSON.stringify(project.clips[cid].score);
  const beforeRevisionId = project.clips[cid].revisionId;
  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 70 }] };
  const rawText = 'HEAD-' + 'a'.repeat(4500) + '\n```json\n' + JSON.stringify(patch) + '\n```\nTAIL-' + 'z'.repeat(4500);
  let callN = 0;

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => {
      callN++;
      return {
        text: rawText,
        raw: {
          choices: [{ finish_reason: 'length' }],
          providerId: 'qwen',
          modelProfileId: 'auto',
          resolvedModelProfileId: 'qwen36_flash',
          requestedMaxOutputTokens: 8192,
          effectiveMaxOutputTokens: 4096,
        },
      };
    },
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'make it smoother' });
  assert(res && res.ok === false && res.reason === 'truncated_generation', 'length finish fails safely even with parseable JSON');
  assertLlmOutcomeContract(res, 'truncated_generation');
  assert(res.detail === 'finish_reason_length', 'top-level detail keeps finish_reason_length');
  assert(res.patchSummary.detail === 'finish_reason_length', 'patchSummary detail keeps finish_reason_length');
  assert(res.patchSummary.llm.partialJsonDiscarded === true, 'patchSummary records discarded parseable partial JSON');
  assert(res.llmDebug.partialJsonDiscarded === true, 'llmDebug records discarded parseable partial JSON');
  assert(res.llmDebug.finishReason === 'length', 'llmDebug records length finish reason');
  assert(res.llmDebug.requestedMaxOutputTokens === 8192, 'llmDebug records requested output token budget');
  assert(res.llmDebug.effectiveMaxOutputTokens === 4096, 'llmDebug records effective output token budget');
  assert(res.llmDebug.providerId === 'qwen', 'llmDebug records provider');
  assert(res.llmDebug.modelProfileId === 'auto', 'llmDebug records model profile');
  assert(res.llmDebug.resolvedModelProfileId === 'qwen36_flash', 'llmDebug records resolved model profile');
  assert(res.llmDebug.rawModelOutputLength === rawText.length, 'llmDebug records raw model output length');
  assert(typeof res.llmDebug.rawModelOutputPreviewHead === 'string', 'llmDebug includes preview head');
  assert(typeof res.llmDebug.rawModelOutputPreviewTail === 'string', 'llmDebug includes preview tail');
  assert(res.llmDebug.rawModelOutputPreviewHead.length <= 5000, 'preview head is bounded');
  assert(res.llmDebug.rawModelOutputPreviewTail.length <= 5000, 'preview tail is bounded');
  assert(res.llmDebug.rawModelOutputPreviewHead === rawText.slice(0, res.llmDebug.rawModelOutputPreviewHead.length), 'preview head is from start');
  assert(res.llmDebug.rawModelOutputPreviewTail === rawText.slice(rawText.length - res.llmDebug.rawModelOutputPreviewTail.length), 'preview tail is from end');
  assert(res.patchSummary.llm.finishReason === 'length', 'patchSummary llm records length finish reason');
  assert(res.patchSummary.llm.requestedMaxOutputTokens === 8192, 'patchSummary llm records requested output token budget');
  assert(res.patchSummary.llm.effectiveMaxOutputTokens === 4096, 'patchSummary llm records effective output token budget');
  assert(res.patchSummary.llm.rawModelOutputLength === rawText.length, 'patchSummary llm records raw model output length');
  assert(res.patchSummary.llm.rawModelOutputPreviewHead === res.llmDebug.rawModelOutputPreviewHead, 'patchSummary llm carries preview head');
  assert(res.patchSummary.llm.rawModelOutputPreviewTail === res.llmDebug.rawModelOutputPreviewTail, 'patchSummary llm carries preview tail');
  assert(res.llmDebug.totalAttempts === 1, 'truncated response is not retried');
  assert(callN === 1, 'only one provider call on length finish');
  assert(JSON.stringify(project.clips[cid].score) === before, 'truncated parseable output leaves original unchanged');
  assert(project.clips[cid].revisionId === beforeRevisionId, 'truncated parseable output does not create revision');
}

async function testNoOpOutcome(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === true && res.ops === 0, 'no op');
  assertLlmOutcomeContract(res, 'no_op');
  assert(res.patchSummary.noChanges === true, 'noChanges');
  assertLlmRetryMeta(res, { totalAttempts: 1, finalAttemptIndex: 1 });
  assert(res.llmDebug.attemptSummaries[0].outcome === 'no_op', 'no_op snapshot');
}

async function testPlainJsonObjectWithoutFenceAccepted(){
  loadAgentController();
  loadLlmClient();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;
  const client = globalThis.H2S_LLM_CLIENT;
  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 81 }] };

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: JSON.stringify(patch) }),
    extractJsonObject: client.extractJsonObject,
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'make smoother' });
  assert(res && res.ok === true && res.ops === 1, 'plain JSON object accepted');
  assertLlmRetryMeta(res, { totalAttempts: 1, finalAttemptIndex: 1 });
}

async function testFailedExtract(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: 'no json here' }),
    extractJsonObject: () => null,
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === false && res.reason === 'llm_no_valid_json', 'extract fail');
  assertLlmOutcomeContract(res, 'failed_extract');
  assertLlmRetryMeta(res, { totalAttempts: 2, finalAttemptIndex: 2 });
  assert(res.llmDebug.attemptSummaries[0].outcome === 'failed_extract' && res.llmDebug.attemptSummaries[1].outcome === 'failed_extract', 'both attempts failed_extract');
  assert(res.llmDebug.invalidJsonDiagnostics, 'invalid JSON diagnostics');
  assert(res.llmDebug.invalidJsonDiagnostics.responseChars === 'no json here'.length, 'responseChars');
  assert(res.llmDebug.invalidJsonDiagnostics.containsJsonFence === false, 'containsJsonFence');
  assert(res.llmDebug.invalidJsonDiagnostics.extractionOutcome === 'no_json', 'extractionOutcome');
  assert(res.llmDebug.invalidJsonDiagnostics.retryAttempted === true, 'retryAttempted');
}

async function testLengthFinishWithoutJsonReportsTruncatedGeneration(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({
      text: '<think>reasoning consumed the response budget',
      raw: { choices: [{ finish_reason: 'length' }] },
    }),
    extractJsonObject: () => null,
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === false, 'truncated generation fails safely');
  assert(res.reason === 'truncated_generation', 'specific truncation reason');
  assertLlmOutcomeContract(res, 'truncated_generation');
  assert(res.patchSummary.detail === 'finish_reason_length', 'truncation detail');
}

async function testThinkBlockStrippedBeforeJsonExtraction(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;
  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '<think>{"version":1,"clipId":"' + cid + '","ops":[{"op":"deleteNote","noteId":"n0"}]}</think>\n' + JSON.stringify(patch);
  let extractedInput = '';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText, raw: { choices: [{ finish_reason: 'stop' }] } }),
    extractJsonObject: (text) => {
      extractedInput = String(text || '');
      const s = extractedInput.trim();
      return s ? JSON.parse(s) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === true, 'JSON after think block applies');
  assert(!/<think/i.test(extractedInput), 'extractor receives text without think block');
  assertLlmOutcomeContract(res, 'applied');
}

/** Second attempt succeeds after first JSON extract failure. */
async function testRetryRecoverFromFailedExtract(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  let callN = 0;
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => {
      callN++;
      if (callN === 1) return { text: 'no fenced json' };
      return { text: rawText };
    },
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === true && res.ops === 1, 'applied on retry');
  assertLlmOutcomeContract(res, 'applied');
  assertLlmRetryMeta(res, { totalAttempts: 2, finalAttemptIndex: 2 });
  assert(res.llmDebug.attemptSummaries[0].outcome === 'failed_extract', 'first failed_extract');
  assert(res.llmDebug.attemptSummaries[1].outcome === 'applied', 'second applied');
}

/** Invalid JSON retry is a compact repair call that includes the previous model response. */
async function testFailedExtractRepairRetryUsesPreviousResponse(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const previousModelText = '我会把旋律变得更顺一点，但这里没有JSON。';
  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 82 }] };
  const repairedText = '```json\n' + JSON.stringify(patch) + '\n```';
  const calls = [];
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async (_cfg, messages) => {
      calls.push(messages);
      return { text: calls.length === 1 ? previousModelText : repairedText };
    },
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'make smoother' });
  assert(res && res.ok === true && res.ops === 1, 'repair retry applied');
  assert(calls.length === 2, 'one repair retry');
  assert(calls[1].length === 2, 'repair retry sends system + user only');
  const repairUser = String(calls[1][1].content || '');
  assert(repairUser.indexOf('Convert this into exactly one valid Hum2Song patch JSON object') >= 0, 'repair instruction');
  assert(repairUser.indexOf(previousModelText) >= 0, 'previous model response included');
  assert(repairUser.indexOf('NOTE TABLE CSV') < 0, 'repair retry should not resend full note table');
  assert(repairUser.indexOf('Allowed noteIds') < 0, 'repair retry should not include verbose Allowed noteIds list');
  assert(repairUser.length < 1400, 'repair retry stays bounded');
  assert(res.llmDebug.invalidJsonDiagnostics.retryAttempted === true, 'diagnostic retryAttempted');
}

async function testBassRequestIsNotHardRejectedAsUnsupported(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;
  let callN = 0;

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => { callN++; return { text: '{}' }; },
    extractJsonObject: () => null,
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: '给这段加一段bass' });
  assert(res && res.ok === false, 'direct optimize still fails safely with invalid mock output');
  assert(res.reason !== 'unsupported_request', 'bass prompt should not hit old unsupported_request hard reject');
  assert(callN >= 1, 'no pre-request hard reject in llm_v0');
}

async function testFailedConfig(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: '', model: '', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === false && res.reason === 'llm_config_missing', 'config');
  assertLlmPreRequestMeta(res, 'failed_config');
}

async function testFailedClientNotLoaded(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const savedClient = globalThis.H2S_LLM_CLIENT;
  globalThis.H2S_LLM_CLIENT = null;
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });

    const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
    assert(res && res.ok === false && res.reason === 'llm_client_not_loaded', 'client');
    assertLlmPreRequestMeta(res, 'failed_client');
  } finally {
    globalThis.H2S_LLM_CLIENT = savedClient;
  }
}

async function testRejectedSafeMode(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', pitch: 61, velocity: 90 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === false, 'reject');
  assertLlmOutcomeContract(res, 'rejected_safe_mode');
}

async function testRejectedValidation(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', pitch: 500, velocity: 90 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x', intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false } });
  assert(res && res.ok === false && res.reason === 'invalid_pitch_or_velocity', 'validation reject');
  assertLlmOutcomeContract(res, 'rejected_validation');
}

async function testTemplateVelocityOnlyPatchRejectedByQualityGate(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;
  const rev0 = String(project.clips[cid].revisionId || '');

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  let callN = 0;
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => {
      callN++;
      return { text: rawText };
    },
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };
  let beginCalls = 0;
  const origBegin = globalThis.H2SProject.beginNewClipRevision;
  globalThis.H2SProject.beginNewClipRevision = function (...args) {
    beginCalls++;
    return origBegin.apply(this, args);
  };

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });

    const res = await ctrl.optimizeClip(cid, {
      requestedPresetId: 'llm_v0',
      userPrompt: 'x',
      templateId: 'fix_pitch_v1',
      intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
    });
    assert(res && res.ok === false, 'velocity-only patch must be rejected by template quality gate');
    assert(res.reason === 'patch_rejected', 'velocity-only quality rejection reason');
    assert(res.detail === 'quality_velocity_only', 'velocity-only quality rejection detail');
    assertLlmOutcomeContract(res, 'rejected_quality');
    assertLlmRetryMeta(res, { totalAttempts: 1, finalAttemptIndex: 1 });
    assert(callN === 1, 'quality rejection should not retry');
    assert(String(project.clips[cid].revisionId || '') === rev0, 'quality rejection must not create a revision');
    assert(beginCalls === 0, 'quality rejection must not call beginNewClipRevision');
  } finally {
    globalThis.H2SProject.beginNewClipRevision = origBegin;
  }
}

async function testTemplateFixPitchCanApplyTimingOnlyPatch(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  // Not velocity-only, but still no pitch change.
  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', startBeat: 0.5 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, {
    requestedPresetId: 'llm_v0',
    userPrompt: 'x',
    templateId: 'fix_pitch_v1',
    intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
  });
  assert(res && res.ok === true, 'missing pitch is no longer blanket rejected');
  assertLlmOutcomeContract(res, 'applied');
}

async function testTemplateFixPitchCanApplyBroadPitchPatch(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const H2SProject = globalThis.H2SProject;
  const project = {
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
        { id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 },
        { id: 'n1', pitch: 62, velocity: 90, startBeat: 1, durationBeat: 1 },
        { id: 'n2', pitch: 64, velocity: 90, startBeat: 2, durationBeat: 1 },
        { id: 'n3', pitch: 65, velocity: 90, startBeat: 3, durationBeat: 1 },
      ],
    }],
  };
  const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'llm_h1_scope', name: 'h1_scope' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (H2SProject.normalizeProjectRevisionChains) H2SProject.normalizeProjectRevisionChains(project);
  const cid = clip.id;

  // 2 / 4 notes changed used to be rejected by an overly narrow scope gate.
  const patch = {
    version: 1,
    clipId: cid,
    ops: [
      { op: 'setNote', noteId: 'n0', pitch: 61 },
      { op: 'setNote', noteId: 'n1', pitch: 63 },
    ],
  };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: () => {},
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, {
    requestedPresetId: 'llm_v0',
    userPrompt: 'x',
    templateId: 'fix_pitch_v1',
    intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
  });
  assert(res && res.ok === true, 'broad but structurally valid pitch patch applies');
  assertLlmOutcomeContract(res, 'applied');
}

async function testTemplateTightenRhythmCanApplyPitchPatch(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  // Not velocity-only, but still no timing change.
  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', pitch: 62 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, {
    requestedPresetId: 'llm_v0',
    userPrompt: 'x',
    templateId: 'tighten_rhythm_v1',
    intent: { fixPitch: false, tightenRhythm: true, reduceOutliers: false },
  });
  assert(res && res.ok === true, 'missing timing is no longer blanket rejected');
  assertLlmOutcomeContract(res, 'applied');
}

async function testRejectedSemantic(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', startBeat: 50, durationBeat: 1, velocity: 90 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: false }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === false && res.reason === 'apply_failed', 'semantic apply fail');
  assertLlmOutcomeContract(res, 'rejected_semantic');
}

async function testFailedApplyStub(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const H2SAgentPatch = globalThis.H2SAgentPatch;
  const origApply = H2SAgentPatch.applyPatchToClip;
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  H2SAgentPatch.applyPatchToClip = function(){
    return { ok: false, errors: ['apply_engine_error'] };
  };

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });

    const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
    assert(res && res.ok === false && res.reason === 'apply_failed', 'apply_failed');
    assertLlmOutcomeContract(res, 'failed_apply');
  } finally {
    H2SAgentPatch.applyPatchToClip = origApply;
  }
}

/** Error text contains "semantic" but is not a semantic-gate code → must stay failed_apply (not substring-misclassified). */
async function testFailedApplyMisleadingSubstring(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const H2SAgentPatch = globalThis.H2SAgentPatch;
  const origApply = H2SAgentPatch.applyPatchToClip;
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  H2SAgentPatch.applyPatchToClip = function(){
    return { ok: false, errors: ['non_semantic_apply_error'] };
  };

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });

    const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
    assert(res && res.ok === false && res.reason === 'apply_failed', 'apply_failed');
    assertLlmOutcomeContract(res, 'failed_apply');
  } finally {
    H2SAgentPatch.applyPatchToClip = origApply;
  }
}

/** Legacy path: first error uses semantic_* code prefix without semanticReject flag → still rejected_semantic. */
async function testSemanticCodePrefixFallback(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const H2SAgentPatch = globalThis.H2SAgentPatch;
  const origApply = H2SAgentPatch.applyPatchToClip;
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  H2SAgentPatch.applyPatchToClip = function(){
    return { ok: false, errors: ['semantic_span_growth_excess:99>24'] };
  };

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });

    const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
    assert(res && res.ok === false && res.reason === 'apply_failed', 'apply_failed');
    assertLlmOutcomeContract(res, 'rejected_semantic');
  } finally {
    H2SAgentPatch.applyPatchToClip = origApply;
  }
}

async function testFailedRequest(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => { throw new Error('network_unreachable'); },
    extractJsonObject: () => null,
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
  assert(res && res.ok === false, 'request fail');
  assertLlmOutcomeContract(res, 'failed_request');
  assertLlmRetryMeta(res, { totalAttempts: 1, finalAttemptIndex: 1 });
  assert(res.patchSummary.llm.preRequestExit !== true, 'post-request failure not preRequest');
}

async function testFailedRevision(){
  loadAgentController();
  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const H2SProject = globalThis.H2SProject;
  const origBegin = H2SProject.beginNewClipRevision;
  const { project: proj, clip } = makeClip();
  let project = proj;
  const cid = clip.id;

  const patch = { version: 1, clipId: cid, ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }] };
  const rawText = '```json\n' + JSON.stringify(patch) + '\n```';

  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'm', velocityOnly: true }),
  };

  H2SProject.beginNewClipRevision = function(){ return { ok: false }; };

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });

    const res = await ctrl.optimizeClip(cid, { requestedPresetId: 'llm_v0', userPrompt: 'x' });
    assert(res && res.ok === false && res.reason === 'beginNewClipRevision_failed', 'revision fail');
    assertLlmOutcomeContract(res, 'failed_revision');
  } finally {
    H2SProject.beginNewClipRevision = origBegin;
  }
}

async function main(){
  await testLlmV0PromptNoteRowCapIs2000();
  await testAppliedOutcome();
  await testUserTextPromptDisablesVelocityOnlySafeMode();
  await testVagueMakeBetterCanApplyMultiDimensionalPatch();
  await testCleanUnmusicalNotesCanDeleteSmallOutlierSet();
  await testTooManyDeletesRejectedAndClipUnchanged();
  await testInvalidNoteIdRejectedWithSpecificReason();
  await testAddNoteChordifyAppliesWithGeneratedIds();
  await testMissingOpFlatNoteLikeObjectNormalizesToAddNote();
  await testMissingOpNestedNoteObjectNormalizesToAddNote();
  await testMissingOpAmbiguousObjectStillFails();
  await testMissingOpSecondsObjectStillFails();
  await testAddNoteProvidedIdIsRewrittenAndMixedSetNoteApplies();
  await testAddNoteInvalidTrackRejectedAndClipUnchanged();
  await testAddNoteSecondsFieldsRejected();
  await testAddNoteInvalidNumbersRejected();
  await testAddNoteOutsideClipRejectedAndClipUnchanged();
  await testAddNoteDensityCapRejectedAndClipUnchanged();
  await testCloudSmallClipPromptStaysBounded();
  await testLongClip252NotesSendsAllEditableRows();
  await testLongClipAbove2000ShowsHonestBoundedContext();
  await testOptimizePromptDoesNotForceFixedModesOrHighestValueWording();
  await testExistingNoteOpsWithValidNoteIdsStillApply();
  await testExistingNoteOpsCanUseIdxFromNoteTable();
  await testInvalidIdxReferenceRejectedAndClipUnchanged();
  await testNoOpOutcome();
  await testPlainJsonObjectWithoutFenceAccepted();
  await testFailedExtract();
  await testLengthFinishWithoutJsonReportsTruncatedGeneration();
  await testLengthFinishWithParseableJsonDiscardsPatchAndLeavesClipUnchanged();
  await testThinkBlockStrippedBeforeJsonExtraction();
  await testRetryRecoverFromFailedExtract();
  await testFailedExtractRepairRetryUsesPreviousResponse();
  await testBassRequestIsNotHardRejectedAsUnsupported();
  await testFailedConfig();
  await testFailedClientNotLoaded();
  await testRejectedSafeMode();
  await testRejectedValidation();
  await testTemplateVelocityOnlyPatchRejectedByQualityGate();
  await testTemplateFixPitchCanApplyTimingOnlyPatch();
  await testTemplateFixPitchCanApplyBroadPitchPatch();
  await testTemplateTightenRhythmCanApplyPitchPatch();
  await testRejectedSemantic();
  await testFailedApplyStub();
  await testFailedApplyMisleadingSubstring();
  await testSemanticCodePrefixFallback();
  await testFailedRequest();
  await testFailedRevision();
  console.log('llm_v0_optimize_hardening.test.js: OK');
}

main().catch(function(e){
  console.error(e);
  process.exit(1);
});
