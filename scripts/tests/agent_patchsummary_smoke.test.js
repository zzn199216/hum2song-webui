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
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project);

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

  // PR-5 semantic: after Optimize, parentRevisionId MUST equal the previous active revisionId (so Undo works).
  const parent = String(head.parentRevisionId || '');
  assert(parent === prevRev, 'parentRevisionId must equal previous revisionId (parentMatchesRev0)');

  // Revisions must be object map (not Array); no dangling refs.
  assert(!Array.isArray(head.revisions), 'clip.revisions must not be Array');
  assert(head.revisions && typeof head.revisions === 'object', 'clip.revisions must be object');
  assert(head.revisions[head.revisionId], 'clip.revisions[clip.revisionId] must exist');
  if (head.parentRevisionId != null && head.parentRevisionId !== '') assert(head.revisions[head.parentRevisionId], 'clip.revisions[parentRevisionId] must exist when parent set');

  const revInfo = globalThis.H2SProject.listClipRevisions(head);
  assert(revInfo && Array.isArray(revInfo.items) && revInfo.items.length >= 2, 'listClipRevisions should show 2+ versions');

  // PR-5b: Deterministic no-op (requestedPresetId: 'noop' returns empty patch).
  const scoreBeatOk = { version: 2, tempo_bpm: 120, time_signature: '4/4', tracks: [{ id: 't0', name: 'ch0', program: 0, channel: 0, notes: [{ id: 'n1', pitch: 60, velocity: 80, startBeat: 0, durationBeat: 0.5 }] }] };
  const clip0 = globalThis.H2SProject.createClipFromScoreBeat(scoreBeatOk, { id: 'clip_ops0', name: 'ops0' });
  project.clips[clip0.id] = clip0;
  project.clipOrder.push(clip0.id);
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project);
  const revBefore0 = String(project.clips[clip0.id].revisionId || '');
  const parentBefore0 = String(project.clips[clip0.id].parentRevisionId || '');
  const revKeysBefore0 = Object.keys(project.clips[clip0.id].revisions || {}).length;

  let beginNewClipRevisionCalls = 0;
  let commitV2Calls = 0;
  const origBegin = globalThis.H2SProject.beginNewClipRevision;
  globalThis.H2SProject.beginNewClipRevision = function(...args) {
    beginNewClipRevisionCalls++;
    return origBegin.apply(this, args);
  };
  const ctrlNoop = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
    commitV2: (reason) => { commitV2Calls++; },
  });
  const resZeroPromise = ctrlNoop.optimizeClip(clip0.id, { requestedPresetId: 'noop' });
  const resZero = (resZeroPromise && typeof resZeroPromise.then === 'function') ? await resZeroPromise : resZeroPromise;
  globalThis.H2SProject.beginNewClipRevision = origBegin;

  assert(resZero && resZero.ok === true, 'no-op optimize should ok');
  assert(resZero.ops === 0, 'no-op must return ops===0 deterministically');
  assert(typeof (resZero.patchSummary && resZero.patchSummary.ops) === 'number', 'patchSummary.ops must exist and be number');
  assert(resZero.patchSummary.ops === 0, 'patchSummary.ops must be 0');
  const head0 = project.clips[clip0.id];
  assert(String(head0.revisionId || '') === revBefore0, 'no-op: revisionId must be unchanged');
  assert(String(head0.parentRevisionId || '') === parentBefore0, 'no-op: parentRevisionId must be unchanged');
  assert(Object.keys(head0.revisions || {}).length === revKeysBefore0, 'no-op: revisions key count unchanged');
  assert(beginNewClipRevisionCalls === 0, 'no-op must not call beginNewClipRevision');
  assert(commitV2Calls === 0, 'no-op must not call commitV2');

  // PR-5c: setOptimizeOptions order-agnostic; getOptimizeOptions(clipId) flows to optimizeClip; noop preset => ops===0
  const mockApp = {
    _optPresetByClipId: {},
    _optOptionsByClipId: {},
    _lastOptimizeOptions: null,
    setOptimizeOptions(arg0, arg1) {
      let cid = null;
      let opts = null;
      if (typeof arg0 === 'string') {
        cid = arg0;
        opts = (arg1 && typeof arg1 === 'object') ? arg1 : null;
      } else if (typeof arg1 === 'string') {
        cid = arg1;
        opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
      } else {
        opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
      }
      const preset = opts && (opts.requestedPresetId != null ? opts.requestedPresetId : opts.presetId != null ? opts.presetId : opts.preset);
      const normalizedOpts = opts ? { requestedPresetId: (preset != null && preset !== '') ? String(preset) : null, userPrompt: opts.userPrompt != null ? opts.userPrompt : null } : null;
      this._lastOptimizeOptions = normalizedOpts;
      if (cid) {
        this._optPresetByClipId[cid] = normalizedOpts ? normalizedOpts.requestedPresetId : null;
        this._optOptionsByClipId[cid] = normalizedOpts;
      }
    },
    getOptimizePresetForClip(clipId) {
      return (this._optPresetByClipId && this._optPresetByClipId[clipId] != null) ? this._optPresetByClipId[clipId] : null;
    },
    getOptimizeOptions(clipId) {
      if (clipId && this._optOptionsByClipId && this._optOptionsByClipId[clipId] != null) return this._optOptionsByClipId[clipId];
      return this._lastOptimizeOptions || null;
    },
  };
  const ctrlApp = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
    getOptimizeOptions: (cid) => mockApp.getOptimizeOptions(cid),
  });
  const cid5c = clip0.id;

  mockApp._optPresetByClipId = {};
  mockApp._optOptionsByClipId = {};
  mockApp._lastOptimizeOptions = null;
  mockApp.setOptimizeOptions(cid5c, { requestedPresetId: 'noop' });
  assert(mockApp.getOptimizePresetForClip(cid5c) === 'noop', 'PR-5c: setOptimizeOptions(cid, options) must set preset');

  mockApp._optPresetByClipId = {};
  mockApp._optOptionsByClipId = {};
  mockApp._lastOptimizeOptions = null;
  mockApp.setOptimizeOptions({ requestedPresetId: 'noop' }, cid5c);
  assert(mockApp.getOptimizePresetForClip(cid5c) === 'noop', 'PR-5c: setOptimizeOptions(options, cid) must set preset');

  mockApp.setOptimizeOptions({ requestedPresetId: 'noop' }, cid5c);
  const revBefore5c = String(project.clips[cid5c].revisionId || '');
  const parentBefore5c = String(project.clips[cid5c].parentRevisionId || '');
  const revKeysBefore5c = Object.keys(project.clips[cid5c].revisions || {}).length;
  const res5cPromise = ctrlApp.optimizeClip(cid5c);
  const res5c = (res5cPromise && typeof res5cPromise.then === 'function') ? await res5cPromise : res5cPromise;
  assert(res5c && res5c.ok === true && res5c.ops === 0, 'PR-5c: optimizeClip(cid) must use stored noop preset and return ops===0');
  const head5c = project.clips[cid5c];
  assert(String(head5c.revisionId || '') === revBefore5c, 'PR-5c: revisionId unchanged after optimizeClip with noop');
  assert(String(head5c.parentRevisionId || '') === parentBefore5c, 'PR-5c: parentRevisionId unchanged');
  assert(Object.keys(head5c.revisions || {}).length === revKeysBefore5c, 'PR-5c: revCount unchanged');

  // PR-5e: one-shot optOverride must not mutate stored options; no-op must not call beginNewClipRevision/commitV2
  mockApp.setOptimizeOptions({ requestedPresetId: 'dynamics_accent' }, cid5c);
  assert(mockApp.getOptimizePresetForClip(cid5c) === 'dynamics_accent', 'PR-5e: stored preset set to dynamics_accent');
  const revBefore5e = String(project.clips[cid5c].revisionId || '');
  const parentBefore5e = String(project.clips[cid5c].parentRevisionId || '');
  const revKeysBefore5e = Object.keys(project.clips[cid5c].revisions || {}).length;
  let begin5e = 0;
  let commit5e = 0;
  const origBegin5e = globalThis.H2SProject.beginNewClipRevision;
  globalThis.H2SProject.beginNewClipRevision = function(...args) {
    begin5e++;
    return origBegin5e.apply(this, args);
  };
  const ctrl5e = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
    getOptimizeOptions: (c) => mockApp.getOptimizeOptions(c),
    commitV2: () => { commit5e++; },
  });
  const res5ePromise = ctrl5e.optimizeClip(cid5c, { requestedPresetId: 'noop' });
  const res5e = (res5ePromise && typeof res5ePromise.then === 'function') ? await res5ePromise : res5ePromise;
  globalThis.H2SProject.beginNewClipRevision = origBegin5e;
  assert(res5e && res5e.ok === true && res5e.ops === 0, 'PR-5e: one-shot noop override must return ops===0');
  assert(typeof (res5e.patchSummary && res5e.patchSummary.ops) === 'number', 'PR-5e: patchSummary.ops must be number');
  const head5e = project.clips[cid5c];
  assert(String(head5e.revisionId || '') === revBefore5e, 'PR-5e: revisionId unchanged');
  assert(String(head5e.parentRevisionId || '') === parentBefore5e, 'PR-5e: parentRevisionId unchanged');
  assert(Object.keys(head5e.revisions || {}).length === revKeysBefore5e, 'PR-5e: revCount unchanged');
  assert(mockApp.getOptimizePresetForClip(cid5c) === 'dynamics_accent', 'PR-5e: stored preset must remain dynamics_accent');
  assert(begin5e === 0, 'PR-5e: beginNewClipRevision must not be called on no-op');
  assert(commit5e === 0, 'PR-5e: commitV2 must not be called on no-op');

  console.log('PASS agent patchSummary smoke');
}

function assertRevchainConsistent(project, label) {
  if (!project || !project.clips || typeof project.clips !== 'object') return;
  for (const cid of Object.keys(project.clips)) {
    const clip = project.clips[cid];
    assert(!Array.isArray(clip.revisions), label + ': clip.revisions must not be Array');
    assert(clip.revisions && typeof clip.revisions === 'object', label + ': clip.revisions must be object');
    assert(clip.revisionId != null && clip.revisions[clip.revisionId], label + ': clip.revisions[clip.revisionId] must exist');
    if (clip.parentRevisionId != null && clip.parentRevisionId !== '') {
      assert(clip.revisions[clip.parentRevisionId], label + ': clip.revisions[parentRevisionId] must exist when parent set');
    }
  }
}

async function testPersistReloadRevchain() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

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
    tracks: [{ id: 't0', name: 'ch0', program: 0, channel: 0, notes: [{ id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 }] }],
  };
  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_reload', name: 'reload' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project);

  assertRevchainConsistent(project, 'after normalize');

  project.clips[clip.id].score.tracks[0].notes[0].pitch = 999;
  let persistedState = null;
  const persistFn = () => { persistedState = JSON.parse(JSON.stringify(project)); };
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: persistFn,
    render: () => {},
  });
  const resPromise = ctrl.optimizeClip(clip.id);
  const res = (resPromise && typeof resPromise.then === 'function') ? await resPromise : resPromise;
  assert(res && res.ok && res.ops > 0, 'optimize should apply ops');
  assertRevchainConsistent(project, 'after optimize');

  persistFn();
  assert(persistedState != null, 'persisted state must be captured');

  const reloaded = JSON.parse(JSON.stringify(persistedState));
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(reloaded);
  project = reloaded;

  assertRevchainConsistent(project, 'after reload');

  console.log('PASS persist/reload revchain consistency');
}

async function testRollbackRevchain() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const H2SProject = globalThis.H2SProject;

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
    tracks: [{ id: 't0', name: 'ch0', program: 0, channel: 0, notes: [{ id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 }] }],
  };
  const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_rollback', name: 'rollback' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (H2SProject.normalizeProjectRevisionChains) H2SProject.normalizeProjectRevisionChains(project);

  const cid = clip.id;
  assertRevchainConsistent(project, 'PR-5d baseline');

  const rev0 = String(project.clips[cid].revisionId || '');
  const parent0 = String(project.clips[cid].parentRevisionId || '');
  const count0 = Object.keys(project.clips[cid].revisions || {}).length;

  project.clips[cid].score.tracks[0].notes[0].pitch = 999;
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });
  const resPromise = ctrl.optimizeClip(cid);
  const res = (resPromise && typeof resPromise.then === 'function') ? await resPromise : resPromise;
  assert(res && res.ok && res.ops > 0, 'PR-5d: optimize must apply ops');

  const rev1 = String(project.clips[cid].revisionId || '');
  const parent1 = String(project.clips[cid].parentRevisionId || '');
  const count1 = Object.keys(project.clips[cid].revisions || {}).length;
  assert(rev1 !== rev0, 'PR-5d: after optimize head must change (rev1 != rev0)');
  assert(parent1 === rev0, 'PR-5d: after optimize parent1 must equal rev0');
  assert(count1 >= 2, 'PR-5d: revisions must contain both');
  assertRevchainConsistent(project, 'PR-5d after optimize');

  const rb = H2SProject.rollbackClipRevision(project, cid);
  assert(rb && rb.ok, 'PR-5d: rollback must return ok');

  const headAfter = project.clips[cid];
  assert(String(headAfter.revisionId || '') === rev0, 'PR-5d: after rollback head must be rev0');
  assert(String(headAfter.parentRevisionId || '') === parent0, 'PR-5d: after rollback parent must match pre-optimize parent0');
  const headEntry = headAfter.revisions && headAfter.revisions[headAfter.revisionId];
  assert(headEntry, 'PR-5d: head entry must exist in revisions');
  assert(String(headEntry.parentRevisionId || '') === parent0, 'PR-5d: headEntry.parentRevisionId must match parent0');
  assertRevchainConsistent(project, 'PR-5d after rollback');

  console.log('PASS rollback revchain semantics');
}

async function testOptPresetPersistReload() {
  ensureProjectLoaded();
  ensureAgentPatchLoaded();

  const AgentController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  const H2SProject = globalThis.H2SProject;

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
    tracks: [{ id: 't0', name: 'ch0', program: 0, channel: 0, notes: [{ id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 }] }],
  };
  const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_opt_persist', name: 'opt_persist' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (H2SProject.normalizeProjectRevisionChains) H2SProject.normalizeProjectRevisionChains(project);

  const cid = clip.id;
  const mockStorage = {};
  const mockApp = {
    _optPresetByClipId: {},
    _optOptionsByClipId: {},
    _lastOptimizeOptions: null,
    setOptimizeOptions(arg0, arg1) {
      let cidArg = null;
      let opts = null;
      if (typeof arg0 === 'string') {
        cidArg = arg0;
        opts = (arg1 && typeof arg1 === 'object') ? arg1 : null;
      } else if (typeof arg1 === 'string') {
        cidArg = arg1;
        opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
      } else {
        opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
      }
      const preset = opts && (opts.requestedPresetId != null ? opts.requestedPresetId : opts.presetId != null ? opts.presetId : opts.preset);
      const normalizedOpts = opts ? { requestedPresetId: (preset != null && preset !== '') ? String(preset) : null, userPrompt: opts.userPrompt != null ? opts.userPrompt : null } : null;
      this._lastOptimizeOptions = normalizedOpts;
      if (cidArg) {
        this._optPresetByClipId[cidArg] = normalizedOpts ? normalizedOpts.requestedPresetId : null;
        this._optOptionsByClipId[cidArg] = normalizedOpts;
        mockStorage[cidArg] = normalizedOpts;
      }
    },
    getOptimizeOptions(clipId) {
      if (clipId && this._optOptionsByClipId[clipId] != null) return this._optOptionsByClipId[clipId];
      if (clipId && mockStorage[clipId] != null) {
        this._optOptionsByClipId[clipId] = mockStorage[clipId];
        this._optPresetByClipId[clipId] = (mockStorage[clipId].requestedPresetId != null) ? mockStorage[clipId].requestedPresetId : null;
        return mockStorage[clipId];
      }
      return this._lastOptimizeOptions || null;
    },
    getOptimizePresetForClip(clipId) {
      const opts = this.getOptimizeOptions(clipId);
      return (opts && opts.requestedPresetId != null) ? opts.requestedPresetId : null;
    },
    simulateReload() {
      this._optPresetByClipId = {};
      this._optOptionsByClipId = {};
      for (const k of Object.keys(mockStorage)) {
        this._optOptionsByClipId[k] = mockStorage[k];
        this._optPresetByClipId[k] = (mockStorage[k].requestedPresetId != null) ? mockStorage[k].requestedPresetId : null;
      }
    },
  };

  mockApp.setOptimizeOptions({ requestedPresetId: 'noop' }, cid);
  assert(mockApp.getOptimizePresetForClip(cid) === 'noop', 'PR-5f: stored preset set to noop');

  mockApp.simulateReload();
  assert(mockApp.getOptimizePresetForClip(cid) === 'noop', 'PR-5f: after reload getOptimizePresetForClip must still return noop');

  const revBefore = String(project.clips[cid].revisionId || '');
  const parentBefore = String(project.clips[cid].parentRevisionId || '');
  const revKeysBefore = Object.keys(project.clips[cid].revisions || {}).length;
  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
    getOptimizeOptions: (c) => mockApp.getOptimizeOptions(c),
  });
  const resPromise = ctrl.optimizeClip(cid);
  const res = (resPromise && typeof resPromise.then === 'function') ? await resPromise : resPromise;
  assert(res && res.ok && res.ops === 0, 'PR-5f: optimizeClip(cid) after reload must use stored noop and return ops===0');
  const head = project.clips[cid];
  assert(String(head.revisionId || '') === revBefore, 'PR-5f: revisionId unchanged');
  assert(String(head.parentRevisionId || '') === parentBefore, 'PR-5f: parentRevisionId unchanged');
  assert(Object.keys(head.revisions || {}).length === revKeysBefore, 'PR-5f: revCount unchanged');

  const resOverride = await (ctrl.optimizeClip(cid, { requestedPresetId: 'dynamics_accent' }));
  assert(resOverride && resOverride.ok, 'PR-5f: one-shot override optimize should succeed');
  assert(mockApp.getOptimizePresetForClip(cid) === 'noop', 'PR-5f: stored preset must remain noop after one-shot override');

  console.log('PASS optimize preset persist/reload');
}

(async () => {
  await testPatchSummarySmoke();
  await testPersistReloadRevchain();
  await testRollbackRevchain();
  await testOptPresetPersistReload();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
