#!/usr/bin/env node
'use strict';
/*
  Editor boundary contract tests:
  - editor_controller should export createEditorController
  - patch() should wrap openClipEditor and closeModal without changing return values
*/
function assert(cond, msg){
  if(!cond){ throw new Error(msg || 'assertion failed'); }
}

global.window = global.window || {};
global.window.H2S = global.window.H2S || {};
global.H2S = global.window.H2S; // for convenience

const { createEditorController } = require('../static/pianoroll/controllers/editor_controller.js');
const { create: createEditorRuntime } = require('../static/pianoroll/controllers/editor_runtime.js');

(function testExports(){
  assert(typeof createEditorController === 'function', 'createEditorController should be function');
  console.log('PASS editor_controller exports');
})();

(function testPatchWrap(){
  const calls = [];
  const app = {
    openClipEditor: (clipId) => { calls.push(['open', clipId]); return 'OPEN_OK'; },
    closeModal: (save) => { calls.push(['close', !!save]); return 'CLOSE_OK'; },
  };
  global.window.H2SApp = app;

  const ctrl = createEditorController({
    getApp: () => global.window.H2SApp,
    onOpen: (clipId) => calls.push(['hookOpen', clipId]),
    onClose: (save) => calls.push(['hookClose', !!save]),
  });

  const ok = ctrl.patch();
  assert(ok === true, 'patch should return true when app present');

  const r1 = app.openClipEditor('c1');
  const r2 = app.closeModal(true);

  assert(r1 === 'OPEN_OK', 'open return value must be preserved');
  assert(r2 === 'CLOSE_OK', 'close return value must be preserved');

  // Verify call sequence includes hooks + originals.
  const kinds = calls.map(x=>x[0]);
  assert(kinds.includes('hookOpen') && kinds.includes('open'), 'open should call hook and original');
  assert(kinds.includes('hookClose') && kinds.includes('close'), 'close should call hook and original');

  console.log('PASS editor_controller patch wraps open/close');
})();


(function testRuntimeNodeSafe(){
  assert(typeof createEditorRuntime === 'function', 'createEditorRuntime should be function');
  const rt = createEditorRuntime({ getProject: ()=>null, getState: ()=>({ modal: {} }), persist: ()=>{}, render: ()=>{}, log: ()=>{} });
  assert(rt && typeof rt.openClipEditor === 'function', 'runtime instance should have openClipEditor');
  console.log('PASS editor runtime exports (Node safe)');
})();



(function testEditorBoundarySaveCancelV2Commit(){
  // Load timebase/project helpers into window.H2SProject (Node-safe).
  require('../static/pianoroll/project.js');
  const H2SProject = global.window.H2SProject;
  assert(H2SProject && typeof H2SProject.scoreSecToBeat === 'function', 'H2SProject should load in Node');

  // Minimal DOM stubs used by closeModal().
  const modalEl = {
    classList: { add: ()=>{}, remove: ()=>{} },
    setAttribute: ()=>{},
    getAttribute: ()=>null,
  };
  const dummyEl = () => ({
    value: '',
    textContent: '',
    style: {},
    classList: { add: ()=>{}, remove: ()=>{} },
    setAttribute: ()=>{},
    getAttribute: ()=>null,
    clientHeight: 600,
  });
  const elMap = { '#modal': modalEl };
  const $ = (sel) => elMap[sel] || dummyEl();
  const $$ = (_sel) => [];

  // Prepare minimal v1 view + v2 truth.
  const beatsScore = {
    version: 2,
    timebase: 'beat',
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{ id: 't0', name: 'T0', notes: [{ id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 }] }]
  };
  const clipMeta = { agent: { patchOps: 0 }, sourceTempoBpm: 120 };

  const v1Project = {
    version: 1,
    timebase: 'sec',
    bpm: 120,
    clips: {
      clip_1: { id: 'clip_1', name: 'Clip 1', score: JSON.parse(JSON.stringify(beatsScore)), meta: JSON.parse(JSON.stringify(clipMeta)) }
    },
    ui: {}
  };

  const v2Project = {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1', instrument: 'default', gainDb: 0, muted: false }],
    clipOrder: ['clip_1'],
    clips: {
      clip_1: { id: 'clip_1', name: 'Clip 1', score: JSON.parse(JSON.stringify(beatsScore)), meta: JSON.parse(JSON.stringify(clipMeta)) }
    },
    instances: [],
    ui: {}
  };

  const draftScoreSec = {
    version: 1,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{ id: 't0', name: 'T0', notes: [{ id: 'n1', pitch: 64, velocity: 100, start: 0.5, duration: 0.25 }] }]
  };

  const state = { modal: {
    show: true,
    clipId: 'clip_1',
    draftScore: JSON.parse(JSON.stringify(draftScoreSec)),
    savedScore: JSON.parse(JSON.stringify(draftScoreSec)),
    _sourceClipWasBeat: true,
    _projectWantsBeat: true,
  }};

  const calls = [];
  const rt = createEditorRuntime({
    H2SProject,
    getProject: () => v1Project,
    getProjectV2: () => v2Project,
    commitV2: (_p2, reason) => calls.push(['commitV2', reason]),
    persistFromV1: (reason) => calls.push(['persistFromV1', reason]),
    persist: () => calls.push(['persist']),
    render: () => calls.push(['render']),
    log: () => {},
    getState: () => state,
    $,
    $$,
    fmtSec: (x) => String(x),
    escapeHtml: (s) => String(s || ''),
  });

  // Avoid any audio-related work in Node.
  rt.modalStop = () => {};

  // Cancel must NOT persist.
  rt.closeModal(false);
  const kindsCancel = calls.map(x=>x[0]);
  assert(!kindsCancel.includes('commitV2'), 'cancel must not call commitV2');
  assert(!kindsCancel.includes('persistFromV1'), 'cancel must not call persistFromV1');
  assert(!kindsCancel.includes('persist'), 'cancel must not call persist');

  // Reset modal state for save.
  calls.length = 0;
  state.modal.show = true;
  state.modal.clipId = 'clip_1';
  state.modal.draftScore = JSON.parse(JSON.stringify(draftScoreSec));
  state.modal.savedScore = JSON.parse(JSON.stringify(draftScoreSec));
  state.modal._sourceClipWasBeat = true;
  state.modal._projectWantsBeat = true;

  // Save should go through commitV2 if provided (beats-only writeback).
  rt.closeModal(true);
  const kindsSave = calls.map(x=>x[0]);
  assert(kindsSave.includes('commitV2'), 'save must call commitV2 when available');
  assert(!kindsSave.includes('persistFromV1'), 'save should not fall back to persistFromV1 when commitV2 succeeds');
  assert(!kindsSave.includes('persist'), 'save should not fall back to persist when commitV2 succeeds');

  const out = v2Project.clips.clip_1.score;
  const n = out && out.tracks && out.tracks[0] && out.tracks[0].notes && out.tracks[0].notes[0];
  assert(n && typeof n.startBeat === 'number' && typeof n.durationBeat === 'number', 'saved score must use startBeat/durationBeat');
  assert(Math.abs(n.startBeat - 1.0) < 1e-6, 'startBeat should be 1.0 for 0.5s at 120bpm');
  assert(Math.abs(n.durationBeat - 0.5) < 1e-6, 'durationBeat should be 0.5 for 0.25s at 120bpm');
  assert(v2Project.clips.clip_1.meta && v2Project.clips.clip_1.meta.agent, 'meta.agent must be preserved on save');

  console.log('PASS editor boundary save/cancel v2 commit');
})();

console.log('\nAll editor contract tests passed.');
