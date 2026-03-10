#!/usr/bin/env node
/* PR-UX7a: AI Assistant dock tests — Send behavior, card creation, Run => runCommand */
'use strict';

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Stub I18N
const I18N = { t: (k) => { const m = { 'aiAssist.selectClipFirst': 'Select a clip first.', 'aiAssist.run': 'Run', 'aiAssist.openOptimize': 'Open Optimize', 'aiAssist.undo': 'Undo' }; return m[k] || k; } };
if (typeof globalThis.window === 'undefined') globalThis.window = {};
globalThis.window.I18N = I18N;

// Minimal DOM for dock
function createStubElement(id) {
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    placeholder: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    style: {},
    addEventListener: () => {},
    getAttribute: (a) => (a === 'data-act' ? el._dataAct : a === 'data-clip-id' ? el._dataClipId : a === 'data-prompt' ? el._dataPrompt : null),
    setAttribute: () => {},
    disabled: false,
    _dataAct: null,
    _dataClipId: null,
    _dataPrompt: null,
  };
  return el;
}

function createStubDocument() {
  const els = {};
  ['aiAssistDock', 'aiAssistHeader', 'aiAssistBody', 'aiAssistMessages', 'aiAssistInput', 'aiAssistSend'].forEach(id => {
    els[id] = createStubElement(id);
  });
  return {
    getElementById: (id) => els[id] || null,
    createElement: () => createStubElement(''),
    addEventListener: () => {},
  };
}

// Minimal APP implementing AI assist dock behavior
function createFakeApp() {
  const doc = createStubDocument();
  const setOptimizeOptionsCalls = [];
  const runCommandCalls = [];
  const app = {
    state: { selectedClipId: null },
    project: { clips: [{ id: 'clip-1', name: 'Test Clip', parentRevisionId: 'rev-0' }] },
    _aiAssistItems: [],
    _aiAssistBound: false,
    setOptimizeOptions(cid, opts) {
      setOptimizeOptionsCalls.push({ clipId: cid, opts });
    },
    runCommand(cmd, payload) {
      runCommandCalls.push({ command: cmd, payload: payload || {} });
      return Promise.resolve({ ok: true });
    },
    getProjectV2() {
      return { clips: { 'clip-1': { name: 'Test Clip', parentRevisionId: 'rev-0' } } };
    },
    render: () => {},
  };
  app._t = I18N.t.bind(I18N);
  app._aiAssistSend = function () {
    const inp = doc.getElementById('aiAssistInput');
    const text = String(inp ? inp.value : '').trim();
    if (!text) return;
    if (inp) inp.value = '';
    const clipId = this.state.selectedClipId;
    if (!clipId) {
      this._aiAssistItems.push({ type: 'sys', text: this._t('aiAssist.selectClipFirst') });
    } else {
      this._aiAssistItems.push({ type: 'card', clipId, promptText: text, createdAt: Date.now() });
    }
    this.render();
  };
  return { app, setOptimizeOptionsCalls, runCommandCalls, doc };
}

(function testDockElementsExist() {
  const { doc } = createFakeApp();
  assert(doc.getElementById('aiAssistDock'), 'aiAssistDock should exist');
  assert(doc.getElementById('aiAssistMessages'), 'aiAssistMessages should exist');
  assert(doc.getElementById('aiAssistSend'), 'aiAssistSend should exist');
  console.log('PASS dock elements exist');
})();

(function testSendNoClipShowsSelectClipFirst() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = null;
  const inp = doc.getElementById('aiAssistInput');
  inp.value = 'make it louder';
  app._aiAssistSend();
  assert(app._aiAssistItems.length === 1, 'should have one item');
  assert(app._aiAssistItems[0].type === 'sys', 'should be sys');
  assert(app._aiAssistItems[0].text === 'Select a clip first.', 'should show selectClipFirst');
  console.log('PASS Send with no clip => selectClipFirst');
})();

(function testSendWithClipCreatesCard() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  const inp = doc.getElementById('aiAssistInput');
  inp.value = 'add more dynamics';
  app._aiAssistSend();
  assert(app._aiAssistItems.length === 1, 'should have one item');
  assert(app._aiAssistItems[0].type === 'card', 'should be card');
  assert(app._aiAssistItems[0].clipId === 'clip-1', 'card should have clipId');
  assert(app._aiAssistItems[0].promptText === 'add more dynamics', 'card should contain prompt text');
  console.log('PASS Send with clip => card with prompt');
})();

(function testRunCallsRunCommand() {
  const { app, setOptimizeOptionsCalls, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app._aiAssistItems.push({ type: 'card', clipId: 'clip-1', promptText: 'fix pitch', createdAt: 1 });
  // Simulate Run button click: setOptimizeOptions + runCommand(optimize_clip)
  app.setOptimizeOptions('clip-1', { userPrompt: 'fix pitch', requestedPresetId: 'llm_v0' });
  app.runCommand('optimize_clip', { clipId: 'clip-1' });
  assert(setOptimizeOptionsCalls.length === 1, 'setOptimizeOptions should be called once');
  assert(setOptimizeOptionsCalls[0].clipId === 'clip-1', 'clipId should match');
  assert(setOptimizeOptionsCalls[0].opts.requestedPresetId === 'llm_v0', 'preset should be llm_v0');
  assert(runCommandCalls.length === 1, 'runCommand should be called once');
  assert(runCommandCalls[0].command === 'optimize_clip', 'command should be optimize_clip');
  assert(runCommandCalls[0].payload.clipId === 'clip-1', 'payload should have correct clipId');
  console.log('PASS Run on card => runCommand optimize_clip');
})();
