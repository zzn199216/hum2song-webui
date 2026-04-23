#!/usr/bin/env node
'use strict';

const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim(){
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function loadRhythm(){
  ensureWindowShim();
  if (globalThis.H2SRhythmTightenLoosen) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/rhythm_tighten_loosen.js'));
  if (globalThis.window && globalThis.window.H2SRhythmTightenLoosen) globalThis.H2SRhythmTightenLoosen = globalThis.window.H2SRhythmTightenLoosen;
  assert(globalThis.H2SRhythmTightenLoosen, 'H2SRhythmTightenLoosen missing');
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
  loadRhythm();
  loadPhase1Meta();
  ensureWindowShim();
  if (globalThis.H2SAgentController) return;
  require(path.resolve(__dirname, '../../static/pianoroll/controllers/agent_controller.js'));
  if (globalThis.window && globalThis.window.H2SAgentController) globalThis.H2SAgentController = globalThis.window.H2SAgentController;
  assert(globalThis.H2SAgentController && typeof globalThis.H2SAgentController.create === 'function', 'H2SAgentController missing');
}

function assertTimingOnlyPatch(patch){
  const ops = patch && Array.isArray(patch.ops) ? patch.ops : [];
  for (let i = 0; i < ops.length; i++){
    const op = ops[i];
    assert(op && op.op === 'setNote', 'setNote only');
    assert(op.pitch == null && op.velocity == null, 'no pitch/velocity');
    assert(op.startBeat != null || op.durationBeat != null, 'timing field');
  }
}

function testIntentNarrowing(){
  loadRhythm();
  const R = globalThis.H2SRhythmTightenLoosen;
  const t = R.narrowRhythmIntentFromText('tighten the rhythm');
  assert(t && t.mode === 'tighten', 'tighten');
  const l = R.narrowRhythmIntentFromText('make this looser');
  assert(l && l.mode === 'loosen', 'loosen');
  const e = R.narrowRhythmIntentFromText('make this more even rhythmically');
  assert(e && e.mode === 'even', 'even');
}

function testPatchContract(){
  loadRhythm();
  const R = globalThis.H2SRhythmTightenLoosen;
  const clip = {
    id: 'c1',
    score: {
      version: 2,
      tracks: [{
        id: 't0',
        notes: [
          { id: 'n0', pitch: 60, velocity: 80, startBeat: 0.11, durationBeat: 0.5 },
          { id: 'n1', pitch: 62, velocity: 90, startBeat: 1, durationBeat: 0.55 },
        ],
      }],
    },
  };
  const built = R.buildRhythmPatch(clip, { mode: 'tighten', strength: 'medium' }, null);
  assertTimingOnlyPatch(built.patch);
  assert(built.patch.ops.length >= 1, 'at least one timing change');
  const forbidden = ['addNote', 'deleteNote', 'moveNote'];
  for (const op of built.patch.ops){
    assert(forbidden.indexOf(op.op) < 0, 'forbidden op');
  }
}

function testNoOpNoRevision(){
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
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{
      id: 't0',
      name: 'ch0',
      notes: [
        { id: 'n0', pitch: 60, velocity: 100, startBeat: 0, durationBeat: 1 },
        { id: 'n1', pitch: 62, velocity: 100, startBeat: 1, durationBeat: 1 },
      ],
    }],
  };

  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_rhy', name: 'rhy' });
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
    requestedPresetId: 'rhythm_tighten_loosen',
    rhythmIntent: { mode: 'tighten', strength: 'medium' },
  });
  assert(res && res.ok && res.ops === 0, 'grid-aligned no-op');
  assert(String(project.clips[cid].revisionId || '') === revBefore, 'no revision');
  assert(res.patchSummary && res.patchSummary.phase1Deterministic && res.patchSummary.phase1Deterministic.capabilityId === 'rhythm_tighten_loosen', 'phase1 meta');
  assert(res.patchSummary.phase1Deterministic.intentSource === 'explicit_options', 'explicit');
}

function testRevisionAndScope(){
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
        { id: 'a0', pitch: 60, velocity: 80, startBeat: 0.13, durationBeat: 0.5 },
        { id: 'a1', pitch: 62, velocity: 80, startBeat: 1, durationBeat: 0.5 },
      ],
    }],
  };

  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_r2', name: 'r2' });
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
    requestedPresetId: 'rhythm_tighten_loosen',
    rhythmIntent: { mode: 'tighten', strength: 'strong' },
    rhythmNoteIds: ['a0'],
  });
  assert(res && res.ok && res.ops >= 1, 'has ops');
  const head = project.clips[cid];
  assert(String(head.parentRevisionId || '') === prevRev, 'revision chain');
  assert(head.meta && head.meta.agent && head.meta.agent.patchSummary && head.meta.agent.patchSummary.phase1Deterministic, 'clip meta');
  const n0 = head.score.tracks[0].notes.find(function(n){ return n.id === 'a0'; });
  const n1 = head.score.tracks[0].notes.find(function(n){ return n.id === 'a1'; });
  assert(n0.startBeat !== 0.13, 'a0 timing changed');
  assert(n1.startBeat === 1, 'a1 scope');
  assert(n0.pitch === 60 && n1.pitch === 62, 'pitch contour');
  assert(n0.velocity === 80 && n1.velocity === 80, 'velocity untouched');
}

function testNarrowedPrompt(){
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
      notes: [{ id: 'p0', pitch: 60, velocity: 80, startBeat: 0.07, durationBeat: 0.5 }],
    }],
  };
  const clip = globalThis.H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'c_nr', name: 'nr' });
  project.clips[clip.id] = clip;
  project.clipOrder.push(clip.id);
  if (globalThis.H2SProject.normalizeProjectRevisionChains) globalThis.H2SProject.normalizeProjectRevisionChains(project);

  const ctrl = AgentController.create({
    getProjectV2: () => project,
    setProjectFromV2: (p) => { project = p; },
    persist: () => {},
    render: () => {},
  });

  const r = ctrl.optimizeClip(clip.id, {
    requestedPresetId: 'rhythm_tighten_loosen',
    userPrompt: 'tighten the rhythm',
  });
  assert(r.ok && r.ops >= 1, 'narrowed');
  const ps = project.clips[clip.id].meta.agent.patchSummary;
  assert(ps.phase1Deterministic.intentSource === 'narrowed_from_prompt', 'narrowed source');
  assert(ps.rhythm && ps.rhythm.intent && ps.rhythm.intent.mode === 'tighten', 'legacy rhythm slot');
  assert(r.executionPath === 'rhythm_tighten_loosen', 'path');
}

function main(){
  testIntentNarrowing();
  testPatchContract();
  testNoOpNoRevision();
  testRevisionAndScope();
  testNarrowedPrompt();
  console.log('rhythm_tighten_loosen.test.js: OK');
}

main();
