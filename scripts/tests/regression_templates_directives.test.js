// PR-E4a: Regression tests for templates + directives (deterministic, no real model).
// 1) templateId/promptVersion in patchSummary.promptMeta
// 2) DIRECTIVES block in LLM user message when template or intent present
// 3) quality_velocity_only retry hint is intent-specific
// 4) velocity-only patch rejected when fixPitch/tightenRhythm intent on

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim() {
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function ensureProjectLoaded() {
  ensureWindowShim();
  const hasBegin = globalThis.H2SProject && typeof globalThis.H2SProject.beginNewClipRevision === 'function';
  if (hasBegin) return;
  require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
  if (globalThis.window && globalThis.window.H2SProject) globalThis.H2SProject = globalThis.window.H2SProject;
  assert(globalThis.H2SProject && typeof globalThis.H2SProject.beginNewClipRevision === 'function', 'H2SProject missing');
}

function ensureAgentPatchLoaded() {
  ensureWindowShim();
  if (globalThis.H2SAgentPatch) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/agent_patch.js'));
  if (globalThis.window && globalThis.window.H2SAgentPatch) globalThis.H2SAgentPatch = globalThis.window.H2SAgentPatch;
  assert(globalThis.H2SAgentPatch, 'H2SAgentPatch missing');
}

function makeMinimalProject() {
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
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{
      id: 't0',
      name: 'ch0',
      program: 0,
      channel: 0,
      notes: [{ id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 }],
    }],
  };
  const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_e4a', name: 'e4a' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (H2SProject.normalizeProjectRevisionChains) H2SProject.normalizeProjectRevisionChains(project);
  return { project, clip };
}

async function testA_templateVelocityOnlyRejectedWithPromptMeta() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;
  const rev0 = String(project.clips[cid].revisionId || '');

  const velocityOnlyPatch = {
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }],
  };
  const rawText = '```json\n' + JSON.stringify(velocityOnlyPatch) + '\n```';

  let capturedMessages = null;
  const origClient = globalThis.H2S_LLM_CLIENT;
  const origConfig = globalThis.H2S_LLM_CONFIG;
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async (_cfg, messages) => {
      capturedMessages = messages;
      return { text: rawText };
    },
    extractJsonObject: (text) => {
      try {
        const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
        return m ? JSON.parse(m[1]) : null;
      } catch (_) { return null; }
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'test-model', velocityOnly: false }),
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
      templateId: 'fix_pitch_v1',
      intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
    });

    assert(res && res.ok === false, 'Case A: quality gate must reject');
    assert(res.reason === 'patch_rejected', 'Case A: reason patch_rejected');
    assert(res.detail === 'quality_velocity_only', 'Case A: detail quality_velocity_only');

    assert(res.patchSummary && res.patchSummary.promptMeta, 'Case A: patchSummary must have promptMeta');
    assert(res.patchSummary.promptMeta.templateId === 'fix_pitch_v1', 'Case A: promptMeta.templateId must be fix_pitch_v1');
    assert(/tmpl_v1\.fix_pitch/.test(res.patchSummary.promptMeta.promptVersion), 'Case A: promptMeta.promptVersion must match template');

    assert(capturedMessages && Array.isArray(capturedMessages), 'Case A: must capture messages');
    const userMsg = capturedMessages.find(m => m.role === 'user');
    assert(userMsg && userMsg.content, 'Case A: user message must exist');
    assert(userMsg.content.includes('DIRECTIVES:'), 'Case A: user content must contain DIRECTIVES:');
    assert(userMsg.content.includes('setNote with pitch'), 'Case A: user content must contain required ops hint');

    assert(String(project.clips[cid].revisionId || '') === rev0, 'Case A: no new revision on reject');
    assert(beginCalls === 0, 'Case A: beginNewClipRevision must not be called');
  } finally {
    globalThis.H2S_LLM_CLIENT = origClient;
    globalThis.H2S_LLM_CONFIG = origConfig;
    globalThis.H2SProject.beginNewClipRevision = origBegin;
  }

  console.log('PASS regression templates: Case A — velocity-only rejected, promptMeta + DIRECTIVES');
}

async function testB_opsZeroIncludesPromptMeta() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;

  const mockApp = {
    _optOptionsByClipId: {},
    getOptimizeOptions: () => ({
      requestedPresetId: 'noop',
      userPrompt: null,
      intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: false },
    }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
    getOptimizeOptions: mockApp.getOptimizeOptions,
  });

  const res = await ctrl.optimizeClip(cid);

  assert(res && res.ok === true, 'Case B: noop must ok');
  assert(res.ops === 0, 'Case B: ops must be 0');
  assert(res.patchSummary && res.patchSummary.promptMeta, 'Case B: patchSummary must have promptMeta');
  assert(res.patchSummary.promptMeta.promptVersion === 'manual_v0', 'Case B: promptVersion manual_v0 when no template');
  assert(res.patchSummary.promptMeta.templateId === null, 'Case B: templateId null when no template');

  console.log('PASS regression templates: Case B — ops===0 includes promptMeta');
}

async function testC_retryHintIntentSpecific() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;
  const rev0 = String(project.clips[cid].revisionId || '');

  const velocityOnlyPatch = {
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }],
  };
  const pitchChangePatch = {
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', noteId: 'n0', pitch: 61, velocity: 90 }],
  };

  let callCount = 0;
  let secondUserContent = null;
  const origClient = globalThis.H2S_LLM_CLIENT;
  const origConfig = globalThis.H2S_LLM_CONFIG;
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async (_cfg, messages) => {
      callCount++;
      const userMsg = messages.find(m => m.role === 'user');
      const content = userMsg ? userMsg.content : '';
      if (callCount === 1) {
        return { text: '```json\n' + JSON.stringify(velocityOnlyPatch) + '\n```' };
      }
      secondUserContent = content;
      return { text: '```json\n' + JSON.stringify(pitchChangePatch) + '\n```' };
    },
    extractJsonObject: (text) => {
      try {
        const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
        return m ? JSON.parse(m[1]) : null;
      } catch (_) { return null; }
    },
  };
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'test-model', velocityOnly: false }),
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
      intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
    });

    assert(res && res.ok === true, 'Case C: retry must succeed');
    assert(callCount === 2, 'Case C: must have 2 LLM calls (retry)');
    assert(secondUserContent, 'Case C: must capture second request content');
    assert(secondUserContent.includes('output setNote with pitch'), 'Case C: retry hint must include intent-specific setNote pitch');
  } finally {
    globalThis.H2S_LLM_CLIENT = origClient;
    globalThis.H2S_LLM_CONFIG = origConfig;
  }

  console.log('PASS regression templates: Case C — retry hint intent-specific');
}

(async () => {
  await testA_templateVelocityOnlyRejectedWithPromptMeta();
  await testB_opsZeroIncludesPromptMeta();
  await testC_retryHintIntentSpecific();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
