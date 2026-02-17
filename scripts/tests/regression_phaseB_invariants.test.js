// PR-B6: Regression guard tests for Phase B invariants.
// A) Quality gate rejection creates NO new revision
// B) ops===0 creates NO new revision
// C) Accepted ops>0 refreshes project clip (draft refresh semantics)

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim() {
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function ensureProjectLoaded() {
  ensureWindowShim();
  const hasBegin = globalThis.H2SProject && (typeof globalThis.H2SProject.beginNewClipRevision === 'function');
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
  const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_b6', name: 'b6' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (H2SProject.normalizeProjectRevisionChains) H2SProject.normalizeProjectRevisionChains(project);
  return { project, clip };
}

async function testA_qualityGateNoNewRevision() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;
  const rev0 = String(project.clips[cid].revisionId || '');

  // Velocity-only patch (valid structure, passes validatePatch, but isVelocityOnly)
  const velocityOnlyPatch = {
    version: 1,
    clipId: cid,
    ops: [{ op: 'setNote', noteId: 'n0', velocity: 80 }],
  };
  const rawText = '```json\n' + JSON.stringify(velocityOnlyPatch) + '\n```';

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
    const resPromise = ctrl.optimizeClip(cid, {
      requestedPresetId: 'llm_v0',
      intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
    });
    const res = (resPromise && typeof resPromise.then === 'function') ? await resPromise : resPromise;

    assert(res && res.ok === false, 'Test A: quality gate must reject (ok false)');
    assert(res.reason === 'patch_rejected', 'Test A: reason must be patch_rejected');
    assert(res.detail === 'quality_velocity_only', 'Test A: detail must be quality_velocity_only');
    assert(res.patchSummary && res.patchSummary.reason === 'quality_velocity_only', 'Test A: patchSummary must have reason');

    const head = project.clips[cid];
    assert(String(head.revisionId || '') === rev0, 'Test A: revisionId must be unchanged (no new revision)');
    assert(beginCalls === 0, 'Test A: beginNewClipRevision must not be called');
  } finally {
    globalThis.H2S_LLM_CLIENT = origClient;
    globalThis.H2S_LLM_CONFIG = origConfig;
    globalThis.H2SProject.beginNewClipRevision = origBegin;
  }

  console.log('PASS regression Phase B: quality gate rejection => no new revision');
}

async function testB_opsZeroNoNewRevision() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;
  const rev0 = String(project.clips[cid].revisionId || '');

  const mockApp = {
    _optOptionsByClipId: {},
    getOptimizeOptions: () => ({ requestedPresetId: 'noop', userPrompt: null, intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: false } }),
  };

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
    getOptimizeOptions: mockApp.getOptimizeOptions,
  });

  const resPromise = ctrl.optimizeClip(cid);
  const res = (resPromise && typeof resPromise.then === 'function') ? await resPromise : resPromise;

  assert(res && res.ok === true, 'Test B: no-op must return ok');
  assert(res.ops === 0, 'Test B: ops must be 0');

  const head = project.clips[cid];
  assert(String(head.revisionId || '') === rev0, 'Test B: ops===0 must not create new revision');

  console.log('PASS regression Phase B: ops===0 => no new revision');
}

async function testC_acceptedOpsRefreshesProjectClip() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const { project: proj, clip } = makeMinimalProject();
  let project = proj;
  const cid = clip.id;

  // Introduce invalid pitch -> pseudo agent will clamp (ops>0)
  project.clips[cid].score.tracks[0].notes[0].pitch = 999;
  const scoreBefore = JSON.stringify(project.clips[cid].score);

  let commitCalls = 0;
  let persistedProject = null;
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
    commitV2: (reason) => {
      commitCalls++;
      persistedProject = JSON.parse(JSON.stringify(project));
    },
  });

  const resPromise = ctrl.optimizeClip(cid);
  const res = (resPromise && typeof resPromise.then === 'function') ? await resPromise : resPromise;

  assert(res && res.ok === true, 'Test C: optimize must succeed');
  assert(res.ops > 0, 'Test C: must have ops>0');

  const head = project.clips[cid];
  const pitchAfter = head.score.tracks[0].notes[0].pitch;
  assert(pitchAfter === 127, 'Test C: project clip score must reflect optimized changes (pitch clamped to 127)');
  assert(JSON.stringify(head.score) !== scoreBefore, 'Test C: score must differ from pre-optimize');

  // Simulate Save: commitV2 is called (e.g. from editor) - persisted project must have optimized score
  ctrl.optimizeClip(cid); // already ran; the commitV2 is called by the agent when it applies
  // Actually commitV2 is passed to create() and the agent calls opts.commitV2 - but the agent controller
  // receives opts from create(), and commitV2 is called inside the agent when patch is applied.
  // So we need the agent to have applied. Our ctrl.optimizeClip already ran - and for dynamics_accent or
  // the pseudo agent (pitch 999 -> clamp), it goes through the non-llm path. The non-llm path doesn't
  // call commitV2 - let me check. Actually the agent_controller create() receives opts with commitV2.
  // The preset path (dynamics_accent, etc.) applies the patch, calls beginNewClipRevision, sets head.score,
  // then opts.setProjectFromV2(project), then opts.commitV2?.('agent_optimize'). So commitV2 IS called.
  // Our ctrl has commitV2 that captures persistedProject. So after optimize, persistedProject should have
  // the optimized score. Let me add that assert.
  assert(commitCalls >= 1, 'Test C: commitV2 must be called when ops>0');
  assert(persistedProject && persistedProject.clips[cid], 'Test C: persisted project must have clip');
  const persistedPitch = persistedProject.clips[cid].score.tracks[0].notes[0].pitch;
  assert(persistedPitch === 127, 'Test C: persisted project must reflect optimized score (Save would persist this)');

  console.log('PASS regression Phase B: accepted ops>0 => project refreshed, commit persists optimized score');
}

(async () => {
  await testA_qualityGateNoNewRevision();
  await testB_opsZeroNoNewRevision();
  await testC_acceptedOpsRefreshesProjectClip();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
