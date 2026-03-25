// PR-E4a: Regression tests for templates + directives (deterministic, no real model).
// 1) templateId/promptVersion in patchSummary.promptMeta
// 2) DIRECTIVES block in LLM user message when template or intent present
// 3) quality_velocity_only retry hint is intent-specific
// 4) velocity-only patch rejected when fixPitch/tightenRhythm intent on
// INFRA-1a: shared registry contains four built-in templates with required fields

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

(function testInfra1aSharedRegistry() {
  const regPath = path.resolve(__dirname, '../../static/pianoroll/core/optimize_templates_v1.js');
  require(regPath);
  const MAP = (typeof globalThis !== 'undefined' ? globalThis : global).H2S_OPTIMIZE_TEMPLATES_V1_MAP;
  const ARR = (typeof globalThis !== 'undefined' ? globalThis : global).H2S_OPTIMIZE_TEMPLATES_V1;
  assert(MAP && typeof MAP === 'object', 'INFRA-1a: H2S_OPTIMIZE_TEMPLATES_V1_MAP must exist');
  assert(ARR && Array.isArray(ARR) && ARR.length >= 4, 'INFRA-1a: H2S_OPTIMIZE_TEMPLATES_V1 must have 4+ templates');
  const ids = ['fix_pitch_v1', 'tighten_rhythm_v1', 'clean_outliers_v1', 'bluesy_v1'];
  for (const id of ids) assert(MAP[id], 'INFRA-1a: map must contain ' + id);
  const fp = MAP.fix_pitch_v1;
  assert(fp && fp.promptVersion === 'tmpl_v1.fix_pitch.r1', 'INFRA-1a: fix_pitch_v1 promptVersion');
  for (const id of ids) {
    const t = MAP[id];
    assert(t.id && t.label && t.intent && typeof t.seed === 'string', 'INFRA-1a: ' + id + ' must have id, label, intent, seed');
  }
  console.log('PASS INFRA-1a: shared registry contains four templates with required fields');
})();

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
    assert(userMsg.content.includes('NOTE TABLE (beats-only, all editable notes):'), 'Case A: user content must include NOTE TABLE block');
    assert(userMsg.content.indexOf('noteId=n0') >= 0 && userMsg.content.indexOf('pitch=60') >= 0 && userMsg.content.indexOf('startBeat=0') >= 0 && userMsg.content.indexOf('durationBeat=1') >= 0 && userMsg.content.indexOf('velocity=90') >= 0, 'Case A: note table must list id pitch startBeat durationBeat velocity');

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

// Quality fix: fixPitch intent with velocityOnly:true (default) must allow pitch edits through
async function testD_fixPitchWithVelocityOnlyTrueAllowsPitchEdits() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;
  const rev0 = String(project.clips[cid].revisionId || '');

  const pitchChangePatch = {
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', noteId: 'n0', pitch: 61, velocity: 90 }],
  };
  const rawText = '```json\n' + JSON.stringify(pitchChangePatch) + '\n```';

  const origClient = globalThis.H2S_LLM_CLIENT;
  const origConfig = globalThis.H2S_LLM_CONFIG;
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async () => ({ text: rawText }),
    extractJsonObject: (text) => {
      try {
        const m = (text || '').match(/```json\s*([\s\S]*?)\s*```/);
        return m ? JSON.parse(m[1]) : null;
      } catch (_) { return null; }
    },
  };
  // velocityOnly: true = default Safe mode; without fix would block pitch edits
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({ baseUrl: 'https://test', model: 'test-model', velocityOnly: true }),
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

    assert(res && res.ok === true, 'Case D: fixPitch with velocityOnly:true must succeed');
    assert(res.ops === 1, 'Case D: ops must be 1');
    assert(beginCalls === 1, 'Case D: revision must be created');
    assert(String(project.clips[cid].revisionId || '') !== rev0, 'Case D: revisionId must change');
    assert(project.clips[cid].score.tracks[0].notes[0].pitch === 61, 'Case D: pitch must be applied');
  } finally {
    globalThis.H2S_LLM_CLIENT = origClient;
    globalThis.H2S_LLM_CONFIG = origConfig;
    globalThis.H2SProject.beginNewClipRevision = origBegin;
  }

  console.log('PASS regression templates: Case D — fixPitch with velocityOnly:true allows pitch edits');
}

// PR3: When plan is passed in options, user message must include PLAN block
async function testE_planBlockIncludedWhenPlanProvided() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;

  const pitchChangePatch = {
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', noteId: 'n0', pitch: 61, velocity: 90 }],
  };
  const rawText = '```json\n' + JSON.stringify(pitchChangePatch) + '\n```';

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

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });
    const plan = {
      planKind: 'fix-pitch',
      planTitle: 'Fix Pitch (AI)',
      planLines: ['Goal: correct out-of-tune notes.', 'Strategy: minimal edits.'],
    };
    const res = await ctrl.optimizeClip(cid, {
      requestedPresetId: 'llm_v0',
      templateId: 'fix_pitch_v1',
      intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
      userPrompt: 'the pitch is off',
      plan,
    });

    assert(res && res.ok === true, 'Case E: must succeed');
    assert(capturedMessages && Array.isArray(capturedMessages), 'Case E: must capture messages');
    const userMsg = capturedMessages.find((m) => m.role === 'user');
    assert(userMsg && userMsg.content, 'Case E: user message must exist');
    assert(userMsg.content.includes('PLAN:'), 'Case E: user content must contain PLAN:');
    assert(userMsg.content.includes('Fix Pitch (AI)'), 'Case E: planTitle must appear');
    assert(userMsg.content.includes('correct out-of-tune notes'), 'Case E: planLines must appear');
    assert(userMsg.content.includes('DIRECTIVES:'), 'Case E: DIRECTIVES still present with plan');
    assert(userMsg.content.includes('NOTE TABLE (beats-only, all editable notes):'), 'Case E: NOTE TABLE still present with plan');
  } finally {
    globalThis.H2S_LLM_CLIENT = origClient;
    globalThis.H2S_LLM_CONFIG = origConfig;
  }

  console.log('PASS regression templates: Case E — plan block included when plan provided');
}

// Assistant PR: clean_outliers_v1 must resolve promptMeta (not manual_v0) when templateId is passed
async function testF_cleanOutliersTemplateResolvesPromptMeta() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });
  const res = await ctrl.optimizeClip(cid, {
    requestedPresetId: 'noop',
    templateId: 'clean_outliers_v1',
    intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true },
  });

  assert(res && res.ok === true, 'Case F: noop must ok');
  assert(res.patchSummary && res.patchSummary.promptMeta, 'Case F: patchSummary must have promptMeta');
  assert(res.patchSummary.promptMeta.templateId === 'clean_outliers_v1', 'Case F: templateId clean_outliers_v1');
  assert(res.patchSummary.promptMeta.promptVersion === 'tmpl_v1.clean_outliers', 'Case F: promptVersion must match registry (not manual_v0)');

  console.log('PASS regression templates: Case F — clean_outliers_v1 resolves promptMeta');
}

// LLM Context PR1: full per-note table in user prompt (additive; noop path unchanged)
async function testG_llmPromptIncludesNoteTablePreservesBlocks() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;

  const pitchChangePatch = {
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', noteId: 'n0', pitch: 61, velocity: 90 }],
  };
  const rawText = '```json\n' + JSON.stringify(pitchChangePatch) + '\n```';

  let capturedUser = null;
  const origClient = globalThis.H2S_LLM_CLIENT;
  const origConfig = globalThis.H2S_LLM_CONFIG;
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: async (_cfg, messages) => {
      const userMsg = messages.find((m) => m.role === 'user');
      capturedUser = userMsg ? userMsg.content : '';
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

  try {
    const ctrl = AgentController.create({
      getProjectV2: () => project,
      setProjectFromV2: (p) => { project = p; },
      persist: () => {},
      render: () => {},
    });
    const res = await ctrl.optimizeClip(cid, {
      requestedPresetId: 'llm_v0',
      templateId: 'clean_outliers_v1',
      intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true },
      userPrompt: 'remove stray notes',
    });

    assert(res && res.ok === true, 'Case G: must succeed');
    assert(capturedUser && typeof capturedUser === 'string', 'Case G: captured user prompt');
    assert(capturedUser.includes('NOTE TABLE (beats-only, all editable notes):'), 'Case G: NOTE TABLE block');
    assert(capturedUser.includes('trackId=t0') && capturedUser.includes('noteId=n0'), 'Case G: row has trackId and noteId');
    assert(/pitch=60[\s\S]*startBeat=0[\s\S]*durationBeat=1[\s\S]*velocity=90/.test(capturedUser), 'Case G: row has pitch startBeat durationBeat velocity');
    assert(capturedUser.includes('DIRECTIVES:'), 'Case G: DIRECTIVES preserved');
    assert(capturedUser.includes('Clip context (beats-only):'), 'Case G: clip summary preserved');
  } finally {
    globalThis.H2S_LLM_CLIENT = origClient;
    globalThis.H2S_LLM_CONFIG = origConfig;
  }

  console.log('PASS regression templates: Case G — NOTE TABLE + existing blocks');
}

(async () => {
  await testA_templateVelocityOnlyRejectedWithPromptMeta();
  await testB_opsZeroIncludesPromptMeta();
  await testC_retryHintIntentSpecific();
  await testD_fixPitchWithVelocityOnlyTrueAllowsPitchEdits();
  await testE_planBlockIncludedWhenPlanProvided();
  await testF_cleanOutliersTemplateResolvesPromptMeta();
  await testG_llmPromptIncludesNoteTablePreservesBlocks();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
