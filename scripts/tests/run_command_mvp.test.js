#!/usr/bin/env node
/* runCommand MVP: add_clip_to_timeline, remove_instance, move_instance, add_track */
'use strict';

const path = require('path');
const fs = require('fs');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

if (typeof globalThis.window === 'undefined') globalThis.window = {};
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
}

require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
if (globalThis.window && globalThis.window.H2SProject) {
  globalThis.H2SProject = globalThis.window.H2SProject;
}

require(path.resolve(__dirname, '../../static/pianoroll/internal_action_registry.js'));
if (globalThis.window && globalThis.window.H2SInternalActionRegistry) {
  globalThis.H2SInternalActionRegistry = globalThis.window.H2SInternalActionRegistry;
}

require(path.resolve(__dirname, '../../static/pianoroll/internal_skill_registry.js'));
if (globalThis.window && globalThis.window.H2SInternalSkillRegistry) {
  globalThis.H2SInternalSkillRegistry = globalThis.window.H2SInternalSkillRegistry;
}

// Contract: bounded actions live in internal_action_registry.js; app.js dispatches via H2SInternalActionRegistry
(function testAppSourceUsesBoundedRegistry(){
  const appPath = path.join(__dirname, '..', '..', 'static', 'pianoroll', 'app.js');
  const regPath = path.join(__dirname, '..', '..', 'static', 'pianoroll', 'internal_action_registry.js');
  const skillPath = path.join(__dirname, '..', '..', 'static', 'pianoroll', 'internal_skill_registry.js');
  const appSrc = fs.readFileSync(appPath, 'utf8');
  const regSrc = fs.readFileSync(regPath, 'utf8');
  const skillSrc = fs.readFileSync(skillPath, 'utf8');
  assert(/H2SInternalActionRegistry/.test(appSrc), 'app.js should dispatch bounded commands via H2SInternalActionRegistry');
  assert(/executeBounded/.test(appSrc), 'app.js should call executeBounded for bounded commands');
  assert(/H2SInternalSkillRegistry/.test(appSrc), 'app.js should reference internal skill registry for assistant metadata');
  assert(/_isAssistantBoundedSkillEnabled/.test(appSrc), 'app.js should gate assistant bounded skills');
  assert(/_ASSISTANT_BOUNDED_RESOLVER_BY_PHRASE_ID/.test(appSrc), 'app.js should map phraseResolverId to resolvers');
  assert(/_tryAssistantBoundedSkillDispatch/.test(appSrc), 'app.js should dispatch bounded assistant skills via helper');
  assert(/assistant_add_track_v1:\s*_resolveAssistantAddTrackIntentFromText/.test(appSrc), 'add_track phrase resolver wiring');
  assert(/assistant_move_instance_v1:\s*_resolveAssistantMoveInstanceIntentFromText/.test(appSrc), 'move_instance phrase resolver wiring');
  assert(/assistant_remove_instance_v1:\s*_resolveAssistantRemoveInstanceIntentFromText/.test(appSrc), 'remove_instance phrase resolver wiring');
  assert(/add_track/.test(skillSrc) && /move_instance/.test(skillSrc) && /remove_instance/.test(skillSrc), 'skill registry defines bounded assistant slice');
  assert(/add_clip_to_timeline/.test(regSrc) && /move_instance/.test(regSrc) && /remove_instance/.test(regSrc) && /add_track/.test(regSrc), 'registry should define MVP command ids');
  const R = globalThis.H2SInternalActionRegistry;
  assert(R && typeof R.boundedActionIds === 'function', 'registry exposes boundedActionIds');
  const ids = R.boundedActionIds().sort();
  const exp = ['add_clip_to_timeline', 'add_track', 'move_instance', 'remove_instance'].sort();
  assert(JSON.stringify(ids) === JSON.stringify(exp), 'bounded ids must match MVP set');
  console.log('PASS run_command_mvp: bounded registry contract');
})();

/**
 * Minimal app.runCommand for the four bounded commands — uses H2SInternalActionRegistry.executeBounded (same as app.js).
 */
function createMvpCommandHarness() {
  const calls = {
    addClipToTimeline: [],
    deleteInstance: [],
    addTrack: [],
    persist: [],
    render: [],
    events: [],
  };

  const app = {
    _cmdSubs: [],
    onCommandEvent(fn) {
      this._cmdSubs.push(fn);
      return () => { this._cmdSubs = this._cmdSubs.filter(x => x !== fn); };
    },
    _emitCmd(type, detail) {
      (this._cmdSubs || []).forEach(fn => { try { fn({ type, ...detail }); } catch (_e) {} });
      calls.events.push({ type, command: detail.command });
    },
    project: {
      bpm: 120,
      tracks: [{ id: 't0', name: 'Track 1', trackId: 't0' }],
      clips: [{ id: 'clip_a' }],
      instances: [{ id: 'inst_1', clipId: 'clip_a', startSec: 0, trackIndex: 0 }],
      ui: { playheadSec: 2 },
    },
    state: { activeTrackIndex: 0, selectedInstanceId: null },
    _projectV2: {
      version: 2,
      timebase: 'beat',
      bpm: 120,
      tracks: [{ id: 't0', name: 'Track 1', trackId: 't0', instrument: 'default', gainDb: 0, muted: false }],
    },
    getProjectV2() {
      return this._projectV2;
    },
    addClipToTimeline(clipId, startSec, trackIndex, opts) {
      calls.addClipToTimeline.push({ clipId, startSec, trackIndex, opts });
      const ti = (trackIndex == null) ? (Number.isFinite(this.state.activeTrackIndex) ? this.state.activeTrackIndex : 0) : trackIndex;
      const sec = (startSec != null) ? startSec : (this.project.ui.playheadSec || 0);
      const inst = {
        id: 'inst_new_' + calls.addClipToTimeline.length,
        clipId,
        startSec: Math.max(0, sec),
        trackIndex: ti,
      };
      this.project.instances.push(inst);
      this.state.selectedInstanceId = inst.id;
    },
    deleteInstance(instId) {
      calls.deleteInstance.push(instId);
      const idx = this.project.instances.findIndex(x => x && x.id === instId);
      if (idx >= 0) this.project.instances.splice(idx, 1);
      if (this.state.selectedInstanceId === instId) this.state.selectedInstanceId = null;
    },
    addTrack() {
      calls.addTrack.push(1);
      const n = this._projectV2.tracks.length + 1;
      const id = 'trk_' + n;
      this._projectV2.tracks.push({ id, name: 'Track ' + n, trackId: id, instrument: 'default', gainDb: 0, muted: false });
    },
    persist() {
      calls.persist.push(1);
    },
    render() {
      calls.render.push(1);
    },
    async runCommand(command, payload) {
      payload = payload || {};
      const startedAt = Date.now();
      this._emitCmd('started', { command, payload, startedAt });
      try {
        let result = { ok: true, command, payload, startedAt, finishedAt: null, message: '', data: null };
        const R = globalThis.H2SInternalActionRegistry;
        if (!R || !R.isBounded(command)) {
          throw new Error('unknown command: ' + command);
        }
        const hooks = { persist: () => this.persist(), render: () => this.render() };
        const out = R.executeBounded(this, command, payload, hooks);
        result.message = out.message;
        result.data = out.data;
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
    },
  };

  return { app, calls };
}

(async function main() {
  {
    const { app, calls } = createMvpCommandHarness();
    const P = globalThis.H2SProject;
    const r = await app.runCommand('add_clip_to_timeline', { clipId: 'clip_a', startBeat: 4, trackIndex: 0 });
    assert(r.ok === true, 'add_clip_to_timeline ok');
    assert(calls.addClipToTimeline.length === 1, 'addClipToTimeline called');
    const expSec = P.beatToSec(P.normalizeBeat(4), 120);
    assert(Math.abs(calls.addClipToTimeline[0].startSec - expSec) < 1e-9, 'startBeat converted to startSec');
    assert(calls.addClipToTimeline[0].trackIndex === 0, 'trackIndex passed');
    assert(r.data && r.data.startBeat != null && Math.abs(r.data.startBeat - P.normalizeBeat(4)) < 1e-6, 'result startBeat');
    console.log('PASS add_clip_to_timeline');
  }
  {
    const { app, calls } = createMvpCommandHarness();
    await app.runCommand('add_clip_to_timeline', { clipId: 'clip_a' });
    assert(calls.addClipToTimeline[0].startSec === undefined, 'default uses playhead via addClipToTimeline');
    assert(calls.addClipToTimeline[0].trackIndex === undefined, 'default track uses active');
    console.log('PASS add_clip_to_timeline defaults');
  }
  {
    const { app } = createMvpCommandHarness();
    const r = await app.runCommand('add_clip_to_timeline', { clipId: 'nope' });
    assert(r.ok === false && /clip not found/.test(r.message), 'missing clip');
    console.log('PASS add_clip_to_timeline missing clip');
  }
  {
    const { app, calls } = createMvpCommandHarness();
    const r = await app.runCommand('remove_instance', { instanceId: 'inst_1' });
    assert(r.ok === true, 'remove ok');
    assert(calls.deleteInstance[0] === 'inst_1', 'deleteInstance');
    const bad = await app.runCommand('remove_instance', { instanceId: 'x' });
    assert(bad.ok === false && /instance not found/.test(bad.message), 'bad id');
    console.log('PASS remove_instance');
  }
  {
    const { app, calls } = createMvpCommandHarness();
    const P = globalThis.H2SProject;
    const r = await app.runCommand('move_instance', { instanceId: 'inst_1', startBeat: 2 });
    assert(r.ok === true && r.data && !r.data.noop, 'moved');
    assert(calls.persist.length >= 1 && calls.render.length >= 1, 'persist+render');
    const inst = app.project.instances.find(x => x.id === 'inst_1');
    assert(Math.abs(inst.startSec - P.beatToSec(P.normalizeBeat(2), 120)) < 1e-9, 'startSec from beat');
    const noop = await app.runCommand('move_instance', { instanceId: 'inst_1' });
    assert(noop.ok === true && noop.data && noop.data.noop === true, 'noop');
    console.log('PASS move_instance');
  }
  {
    const { app, calls } = createMvpCommandHarness();
    const r = await app.runCommand('move_instance', { instanceId: 'inst_1', trackIndex: 0 });
    assert(r.ok === true && r.data && !r.data.noop, 'track-only move ok');
    const inst = app.project.instances.find(function (x) { return x.id === 'inst_1'; });
    assert(inst && inst.trackIndex === 0, 'trackIndex applied');
    assert(calls.persist.length >= 1 && calls.render.length >= 1, 'persist+render for track move');
    console.log('PASS move_instance trackIndex only');
  }
  {
    const { app, calls } = createMvpCommandHarness();
    const r = await app.runCommand('add_track', {});
    assert(r.ok === true && r.data && r.data.trackIndex === 1, 'second track');
    assert(calls.addTrack.length === 1, 'addTrack');
    assert(typeof r.data.trackId === 'string' && r.data.trackId.length > 0, 'trackId');
    console.log('PASS add_track');
  }
  {
    const { app, calls } = createMvpCommandHarness();
    app.onCommandEvent(() => {});
    await app.runCommand('add_track', {});
    assert(calls.events.some(e => e.type === 'started'), 'started');
    assert(calls.events.some(e => e.type === 'done'), 'done');
    console.log('PASS run_command_mvp events');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
