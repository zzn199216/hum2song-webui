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

console.log('\nAll editor contract tests passed.');
