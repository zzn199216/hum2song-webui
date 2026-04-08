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

// Contract: app.js must expose these runCommand cases (keep in sync with static/pianoroll/app.js)
(function testAppSourceHasMvpCases(){
  const p = path.join(__dirname, '..', '..', 'static', 'pianoroll', 'app.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(/case 'add_clip_to_timeline':/.test(src), 'app.js missing add_clip_to_timeline');
  assert(/case 'remove_instance':/.test(src), 'app.js missing remove_instance');
  assert(/case 'move_instance':/.test(src), 'app.js missing move_instance');
  assert(/case 'add_track':/.test(src), 'app.js missing add_track');
  console.log('PASS run_command_mvp: app.js contains MVP command cases');
})();

/**
 * Minimal app.runCommand implementation for the four MVP commands only.
 * Logic mirrors static/pianoroll/app.js — update both when changing behavior.
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
        switch (command) {
          case 'add_clip_to_timeline': {
            const clipId = payload.clipId;
            if (!clipId) throw new Error('clipId required');
            const clips = this.project.clips || [];
            const clipOk = Array.isArray(clips) && clips.some(c => c && c.id === clipId);
            if (!clipOk) throw new Error('clip not found');
            const P = (typeof globalThis !== 'undefined' && globalThis.H2SProject) ? globalThis.H2SProject : null;
            const bpm = (this.project && typeof this.project.bpm === 'number' && isFinite(this.project.bpm)) ? this.project.bpm : 120;
            let startSec;
            if (payload.startBeat != null && P && typeof P.normalizeBeat === 'function' && typeof P.beatToSec === 'function' && isFinite(Number(payload.startBeat))) {
              const sb = P.normalizeBeat(Number(payload.startBeat));
              startSec = P.beatToSec(sb, bpm);
            }
            let trackIndex;
            if (payload.trackIndex != null && Number.isFinite(Number(payload.trackIndex))) {
              const max = Math.max(0, ((this.project.tracks || []).length) - 1);
              trackIndex = Math.max(0, Math.min(max, Math.round(Number(payload.trackIndex))));
            }
            this.addClipToTimeline(clipId, startSec, trackIndex);
            result.message = 'added';
            const selId = this.state && this.state.selectedInstanceId;
            const instAdded = selId ? (this.project.instances || []).find(x => x && x.id === selId) : null;
            const tiOut = instAdded && typeof instAdded.trackIndex === 'number' ? instAdded.trackIndex : (trackIndex != null ? trackIndex : (Number.isFinite(this.state.activeTrackIndex) ? this.state.activeTrackIndex : 0));
            const sbOut = (instAdded && P && typeof P.secToBeat === 'function') ? P.secToBeat(instAdded.startSec || 0, bpm) : ((startSec != null && P && typeof P.secToBeat === 'function') ? P.secToBeat(startSec, bpm) : null);
            result.data = { clipId, instanceId: instAdded ? instAdded.id : null, startBeat: sbOut, trackIndex: tiOut };
            break;
          }
          case 'remove_instance': {
            const instanceId = payload.instanceId;
            if (!instanceId) throw new Error('instanceId required');
            const idx = (this.project.instances || []).findIndex(x => x && x.id === instanceId);
            if (idx < 0) throw new Error('instance not found');
            this.deleteInstance(instanceId);
            result.message = 'removed';
            result.data = { instanceId };
            break;
          }
          case 'move_instance': {
            const instanceId = payload.instanceId;
            if (!instanceId) throw new Error('instanceId required');
            const inst = (this.project.instances || []).find(x => x && x.id === instanceId);
            if (!inst) throw new Error('instance not found');
            const P = (typeof globalThis !== 'undefined' && globalThis.H2SProject) ? globalThis.H2SProject : null;
            const bpm = (this.project && typeof this.project.bpm === 'number' && isFinite(this.project.bpm)) ? this.project.bpm : 120;
            let changed = false;
            if (payload.startBeat != null && P && typeof P.normalizeBeat === 'function' && typeof P.beatToSec === 'function' && isFinite(Number(payload.startBeat))) {
              const sb = P.normalizeBeat(Number(payload.startBeat));
              inst.startSec = P.beatToSec(sb, bpm);
              changed = true;
            }
            if (payload.trackIndex != null && Number.isFinite(Number(payload.trackIndex))) {
              const max = Math.max(0, ((this.project.tracks || []).length) - 1);
              inst.trackIndex = Math.max(0, Math.min(max, Math.round(Number(payload.trackIndex))));
              changed = true;
            }
            if (!changed) {
              result.message = 'noop';
              result.data = { instanceId, noop: true };
              break;
            }
            this.persist();
            this.render();
            result.message = 'moved';
            result.data = {
              instanceId,
              startBeat: (P && typeof P.secToBeat === 'function') ? P.secToBeat(inst.startSec || 0, bpm) : null,
              trackIndex: (typeof inst.trackIndex === 'number') ? inst.trackIndex : 0,
            };
            break;
          }
          case 'add_track': {
            this.addTrack();
            result.message = 'added';
            const p2 = (typeof this.getProjectV2 === 'function') ? this.getProjectV2() : null;
            const tracks = (p2 && Array.isArray(p2.tracks)) ? p2.tracks : [];
            const last = tracks.length ? tracks[tracks.length - 1] : null;
            result.data = { trackIndex: tracks.length - 1, trackId: last && (last.trackId || last.id) ? String(last.trackId || last.id) : null };
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
