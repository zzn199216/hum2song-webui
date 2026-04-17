#!/usr/bin/env node
/* PR-UX6a: Command layer tests — runCommand + event bus */
'use strict';

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Minimal window/document shim for app loading
if (typeof globalThis.window === 'undefined') globalThis.window = {};
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
}

// Load project (needed for H2SProject)
require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
if (globalThis.window && globalThis.window.H2SProject) {
  globalThis.H2SProject = globalThis.window.H2SProject;
}

// Create minimal app-like object with stub methods and runCommand
function createMinimalApp() {
  const events = [];
  const app = {
    _cmdSubs: [],
    onCommandEvent(fn) {
      this._cmdSubs = this._cmdSubs || [];
      this._cmdSubs.push(fn);
      return () => { this._cmdSubs = this._cmdSubs.filter(x => x !== fn); };
    },
    _emitCmd(type, detail) {
      (this._cmdSubs || []).forEach(fn => { try { fn({ type, ...detail }); } catch (e) {} }); },
    openAiSettingsDrawer: () => {},
    closeAiSettingsDrawer: () => {},
    render() { this._renderCount = (this._renderCount || 0) + 1; },
    project: { instances: [], clips: [] },
    state: { selectedInstanceId: null, selectedClipId: null },
    _renderCount: 0,
    setActiveTrackIndex: () => {},
    openClipEditor: () => {},
    optimizeClip: async () => ({ ok: true }),
    rollbackClipRevision: () => ({ ok: false }),
  };
  const setInspectorSectionOpen = () => {};
  app.runCommand = async function (command, payload) {
    payload = payload || {};
    const startedAt = Date.now();
    this._emitCmd('started', { command, payload, startedAt });
    try {
      let result = { ok: true, command, payload, startedAt, finishedAt: null, message: '', data: null };
      switch (command) {
        case 'open_ai_settings':
          this.openAiSettingsDrawer();
          result.message = 'opened';
          break;
        case 'close_ai_settings':
          this.closeAiSettingsDrawer();
          result.message = 'closed';
          break;
        case 'open_inspector_optimize':
          setInspectorSectionOpen('opt', true);
          this.render();
          result.message = 'opened';
          break;
        case 'select_instance': {
          const instId = payload.instanceId;
          if (!instId) throw new Error('instanceId required');
          const inst = (this.project.instances || []).find(x => x && x.id === instId);
          if (!inst) throw new Error('instance not found');
          result.data = { instanceId: instId, clipId: inst.clipId };
          break;
        }
        case 'select_clip': {
          const clipId = payload.clipId;
          if (!clipId) throw new Error('clipId required');
          const pc = this.project && this.project.clips;
          let clipExists = false;
          if (Array.isArray(pc)) {
            clipExists = pc.some(c => c && String(c.id) === String(clipId));
          } else if (pc && typeof pc === 'object') {
            clipExists = !!pc[clipId];
          }
          if (!clipExists) throw new Error('clip not found');
          this.state.selectedClipId = clipId;
          this.state.selectedInstanceId = null;
          this.render();
          result.data = { clipId };
          break;
        }
        default:
          throw new Error('unknown command: ' + command);
      }
      result.finishedAt = Date.now();
      this._emitCmd('done', { command, payload, result });
      return result;
    } catch (err) {
      const finishedAt = Date.now();
      const msg = (err && (err.message || String(err))) || 'error';
      const error = { message: msg.slice(0, 200), finishedAt };
      this._emitCmd('failed', { command, payload, error });
      return { ok: false, command, payload, startedAt, finishedAt, message: error.message, data: null };
    }
  };
  return app;
}

(function testOpenInspectorOptimize() {
  const app = createMinimalApp();
  const seen = [];
  app.onCommandEvent(ev => seen.push(ev));
  return app.runCommand('open_inspector_optimize').then(result => {
    assert(result.ok === true, 'open_inspector_optimize should return ok:true');
    assert(result.command === 'open_inspector_optimize', 'command should match');
    assert(seen.length >= 2, 'should see started and done events');
    assert(seen[0].type === 'started', 'first event should be started');
    assert(seen.some(e => e.type === 'done'), 'should have done event');
    console.log('PASS runCommand open_inspector_optimize: started -> done');
  });
})();

(function testUnknownCommand() {
  const app = createMinimalApp();
  const seen = [];
  app.onCommandEvent(ev => seen.push(ev));
  return app.runCommand('unknown').then(result => {
    assert(result.ok === false, 'unknown command should return ok:false');
    assert(result.command === 'unknown', 'command should match');
    assert(/unknown command/i.test(result.message), 'message should mention unknown');
    assert(seen.some(e => e.type === 'failed'), 'should have failed event');
    assert(seen[0].type === 'started', 'first event should still be started');
    console.log('PASS runCommand unknown: ok=false, failed event');
  });
})();

(function testSelectClipValid() {
  const app = createMinimalApp();
  app.project.clips = [{ id: 'c1' }];
  app.state.selectedInstanceId = 'inst_x';
  return app.runCommand('select_clip', { clipId: 'c1' }).then(result => {
    assert(result.ok === true, 'select_clip valid should return ok:true');
    assert(app.state.selectedClipId === 'c1', 'selectedClipId should match');
    assert(app.state.selectedInstanceId === null, 'selectedInstanceId should clear');
    assert(result.data && result.data.clipId === 'c1', 'data.clipId');
    assert(app._renderCount >= 1, 'render should run on success');
    console.log('PASS runCommand select_clip: valid updates state');
  });
})();

(function testSelectClipMissingClipId() {
  const app = createMinimalApp();
  app.project.clips = [{ id: 'c1' }];
  app.state.selectedClipId = 'c1';
  app.state.selectedInstanceId = 'i1';
  const rc = app._renderCount;
  return app.runCommand('select_clip', {}).then(result => {
    assert(result.ok === false, 'missing clipId should return ok:false');
    assert(/clipId required/i.test(result.message), 'message should mention clipId required');
    assert(app.state.selectedClipId === 'c1', 'selection should be unchanged on failure');
    assert(app.state.selectedInstanceId === 'i1', 'instance selection unchanged');
    assert(app._renderCount === rc, 'render should not run on failure');
    console.log('PASS runCommand select_clip: missing clipId fails cleanly');
  });
})();

(function testSelectClipUnknownClipId() {
  const app = createMinimalApp();
  app.project.clips = [{ id: 'c1' }];
  app.state.selectedClipId = 'c1';
  app.state.selectedInstanceId = null;
  const rc = app._renderCount;
  return app.runCommand('select_clip', { clipId: 'ghost' }).then(result => {
    assert(result.ok === false, 'unknown clipId should return ok:false');
    assert(/clip not found/i.test(result.message), 'message should mention clip not found');
    assert(app.state.selectedClipId === 'c1', 'prior clip selection unchanged');
    assert(app._renderCount === rc, 'render should not run on failure');
    console.log('PASS runCommand select_clip: unknown clipId fails cleanly');
  });
})();
