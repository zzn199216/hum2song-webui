#!/usr/bin/env node
/* Regression: timeline selection must use targeted updates (no full render) so dblclick
   and live drag work. Clip Library highlight and AI Assistant target still sync via
   renderInspector, renderSelection, renderSelectedClip, libraryCtrl.render, _renderAiAssistDock. */
'use strict';

const path = require('path');
const fs = require('fs');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// --- 1) Behavioral test: selection path must NOT call render(), must call targeted updates ---
(function testSelectionUsesTargetedUpdates() {
  const state = { selectedClipId: null, selectedInstanceId: null };
  const project = { instances: [{ id: 'inst1', clipId: 'clipA', trackIndex: 0 }] };
  let renderCount = 0;
  let renderInspectorCount = 0;
  let renderSelectionCount = 0;
  let renderSelectedClipCount = 0;
  let libraryRenderCount = 0;
  let aiAssistDockCount = 0;

  const stub = {
    state,
    project,
    setActiveTrackIndex: () => {},
    _selectedInstEl: null,
    libraryCtrl: { render() { libraryRenderCount++; } },
    render() { renderCount++; },
    renderInspector() { renderInspectorCount++; },
    renderSelection() { renderSelectionCount++; },
    renderSelectedClip() { renderSelectedClipCount++; },
    _renderAiAssistDock() { aiAssistDockCount++; },
    _initMasterVolumeUI() {},
  };

  // Mirrors the repaired app.js onSelectInstance logic (targeted updates, no full render)
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
    stub.renderInspector();
    stub.renderSelection();
    stub.renderSelectedClip();
    if (stub.libraryCtrl && stub.libraryCtrl.render) stub.libraryCtrl.render();
    stub._renderAiAssistDock();
    try { stub._initMasterVolumeUI(); } catch (e) {}
  };

  const mockEl = { classList: { add: () => {}, remove: () => {} } };
  onSelectInstance('inst1', mockEl);

  assert(state.selectedInstanceId === 'inst1', 'selectedInstanceId should be set');
  assert(state.selectedClipId === 'clipA', 'selectedClipId should sync from instance');
  assert(renderCount === 0, 'render() must NOT be called (avoids timeline rebuild)');
  assert(renderInspectorCount === 1, 'renderInspector must be called');
  assert(renderSelectionCount === 1, 'renderSelection must be called');
  assert(renderSelectedClipCount === 1, 'renderSelectedClip must be called');
  assert(libraryRenderCount === 1, 'libraryCtrl.render must be called for Clip Library highlight');
  assert(aiAssistDockCount === 1, '_renderAiAssistDock must be called for AI Assistant target');

  console.log('PASS selection sync: state + targeted updates (no full render)');
})();

// --- 2) Source check: app.js onSelectInstance must NOT call this.render() ---
(function testAppSourceNoFullRender() {
  const appPath = path.resolve(__dirname, '../../static/pianoroll/app.js');
  const src = fs.readFileSync(appPath, 'utf8');

  const onSelectIdx = src.indexOf('onSelectInstance:');
  assert(onSelectIdx >= 0, 'onSelectInstance must exist');

  const handlerStart = onSelectIdx + 'onSelectInstance:'.length;
  const nextCallback = src.indexOf('onOpenClipEditor:', handlerStart);
  const handlerEnd = nextCallback >= 0 ? nextCallback : handlerStart + 800;
  const handlerBody = src.slice(handlerStart, handlerEnd);

  assert(
    !handlerBody.includes('this.render()'),
    'onSelectInstance must NOT call this.render() (preserves dblclick + live drag)'
  );
  assert(
    handlerBody.includes('this.renderInspector()') && handlerBody.includes('this.renderSelection()'),
    'onSelectInstance must call targeted updates (renderInspector, renderSelection, etc.)'
  );

  console.log('PASS app.js onSelectInstance uses targeted updates, no full render');
})();
