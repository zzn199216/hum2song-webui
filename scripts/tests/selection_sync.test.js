#!/usr/bin/env node
/* Regression: timeline single-click selection must trigger full render so Clip Library
   highlight and AI Assistant target update immediately. This test locks in the fix. */
'use strict';

const path = require('path');
const fs = require('fs');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// --- 1) Behavioral test: selection path must call render() ---
(function testSelectionTriggersFullRender() {
  const state = { selectedClipId: null, selectedInstanceId: null };
  const project = { instances: [{ id: 'inst1', clipId: 'clipA', trackIndex: 0 }] };
  let renderCount = 0;
  let renderClipListCount = 0;
  let renderAiAssistDockCount = 0;

  const stub = {
    state,
    project,
    setActiveTrackIndex: () => {},
    _selectedInstEl: null,
    render() {
      renderCount++;
      this.renderClipList();
      this._renderAiAssistDock();
    },
    renderClipList() {
      renderClipListCount++;
    },
    _renderAiAssistDock() {
      renderAiAssistDockCount++;
    },
  };

  // Mirrors the fixed app.js onSelectInstance logic
  const onSelectInstance = (instId, el) => {
    stub.state.selectedInstanceId = instId;
    const inst = (stub.project.instances || []).find(x => x && x.id === instId);
    if (inst && inst.clipId) stub.state.selectedClipId = inst.clipId;
    if (inst && Number.isFinite(inst.trackIndex)) stub.setActiveTrackIndex(inst.trackIndex);
    if (stub._selectedInstEl && stub._selectedInstEl !== el) {
      try { stub._selectedInstEl.classList?.remove('selected'); } catch (e) {}
    }
    if (el) {
      try { el.classList?.add('selected'); } catch (e) {}
      stub._selectedInstEl = el;
    }
    stub.render();
  };

  const mockEl = { classList: { add: () => {}, remove: () => {} } };
  onSelectInstance('inst1', mockEl);

  assert(state.selectedInstanceId === 'inst1', 'selectedInstanceId should be set');
  assert(state.selectedClipId === 'clipA', 'selectedClipId should sync from instance');
  assert(renderCount === 1, 'render() must be called exactly once');
  assert(renderClipListCount === 1, 'renderClipList must be reached via render');
  assert(renderAiAssistDockCount === 1, '_renderAiAssistDock must be reached via render');

  console.log('PASS selection sync: state + full render');
})();

// --- 2) Source check: app.js onSelectInstance must call this.render() ---
(function testAppSourceCallsRender() {
  const appPath = path.resolve(__dirname, '../../static/pianoroll/app.js');
  const src = fs.readFileSync(appPath, 'utf8');

  const onSelectIdx = src.indexOf('onSelectInstance:');
  assert(onSelectIdx >= 0, 'onSelectInstance must exist');

  const handlerStart = onSelectIdx + 'onSelectInstance:'.length;
  const nextCallback = src.indexOf('onOpenClipEditor:', handlerStart);
  const handlerEnd = nextCallback >= 0 ? nextCallback : handlerStart + 800;
  const handlerBody = src.slice(handlerStart, handlerEnd);

  assert(
    handlerBody.includes('this.render()'),
    'onSelectInstance must call this.render() for Clip Library + AI Assistant sync'
  );

  console.log('PASS app.js onSelectInstance calls this.render()');
})();
