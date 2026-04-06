#!/usr/bin/env node
'use strict';

/**
 * Bounded llm_v0 hardening: patchSummary.llm.outcome + top-level llmOutcome (not phase1Deterministic).
 */
const path = require('path');

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
  assertLlmOutcomeContract(res, 'failed_config');
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
  assert(res && res.ok === false && res.reason === 'patch_rejected', 'validation reject');
  assertLlmOutcomeContract(res, 'rejected_validation');
}

async function testRejectedQuality(){
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

  const res = await ctrl.optimizeClip(cid, {
    requestedPresetId: 'llm_v0',
    userPrompt: 'x',
    templateId: 'fix_pitch_v1',
    intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
  });
  assert(res && res.ok === false && res.reason === 'patch_rejected', 'quality reject');
  assertLlmOutcomeContract(res, 'rejected_quality');
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
  await testAppliedOutcome();
  await testNoOpOutcome();
  await testFailedExtract();
  await testFailedConfig();
  await testRejectedSafeMode();
  await testRejectedValidation();
  await testRejectedQuality();
  await testRejectedSemantic();
  await testFailedApplyStub();
  await testFailedRequest();
  await testFailedRevision();
  console.log('llm_v0_optimize_hardening.test.js: OK');
}

main().catch(function(e){
  console.error(e);
  process.exit(1);
});
