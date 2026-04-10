/* Hum2Song Studio — internal bounded action registry (MVP).
 * Not user-configurable. Describes a small set of runCommand names + metadata;
 * execution stays in run() bodies that mirror app.runCommand behavior.
 * Out of scope for this slice: optimize_clip, rollback_clip, convertAudioClipToEditable.
 */
(function (ROOT) {
  'use strict';

  var KIND = { timeline: 'timeline', track: 'track' };
  var DESTRUCTIVE = { none: 'none', timeline_edit: 'timeline_edit', timeline_remove: 'timeline_remove' };
  var CONFIRM = { never: 'never', assistant_remove_instance: 'assistant_remove_instance' };

  /**
   * @typedef {Object} BoundedInternalAction
   * @property {string} id
   * @property {string} kind
   * @property {{ requiredPayloadKeys: string[], notes?: string }} requires
   * @property {{ required?: string[], optional?: string[] }} params
   * @property {string} destructive
   * @property {string} confirm
   * @property {{ running: string }} labels i18n keys (running = status bar / cmd label)
   * @property {string} availability short rule text for tooling
   * @property {function(object, object, {persist?: function, render?: function}): {message: string, data: object}} run
   */

  var BOUNDED = {
    add_clip_to_timeline: {
      id: 'add_clip_to_timeline',
      kind: KIND.timeline,
      requires: { requiredPayloadKeys: ['clipId'], notes: 'clip must exist on project.clips' },
      params: { required: ['clipId'], optional: ['startBeat', 'trackIndex'] },
      destructive: DESTRUCTIVE.timeline_edit,
      confirm: CONFIRM.never,
      labels: { running: 'cmd.addClipTimeline' },
      availability: 'library clip exists; optional beat placement',
      run: function (app, payload) {
        var clipId = payload.clipId;
        if (!clipId) throw new Error('clipId required');
        var clips = app.project.clips || [];
        var clipOk = Array.isArray(clips) && clips.some(function (c) { return c && c.id === clipId; });
        if (!clipOk) throw new Error('clip not found');
        var P = (typeof ROOT !== 'undefined' && ROOT.H2SProject) ? ROOT.H2SProject : null;
        var bpm = (app.project && typeof app.project.bpm === 'number' && isFinite(app.project.bpm)) ? app.project.bpm : 120;
        var startSec;
        if (payload.startBeat != null && P && typeof P.normalizeBeat === 'function' && typeof P.beatToSec === 'function' && isFinite(Number(payload.startBeat))) {
          var sb = P.normalizeBeat(Number(payload.startBeat));
          startSec = P.beatToSec(sb, bpm);
        }
        var trackIndex;
        if (payload.trackIndex != null && Number.isFinite(Number(payload.trackIndex))) {
          var max = Math.max(0, ((app.project.tracks || []).length) - 1);
          trackIndex = Math.max(0, Math.min(max, Math.round(Number(payload.trackIndex))));
        }
        app.addClipToTimeline(clipId, startSec, trackIndex);
        var selId = app.state && app.state.selectedInstanceId;
        var instAdded = selId ? (app.project.instances || []).find(function (x) { return x && x.id === selId; }) : null;
        var tiOut = instAdded && typeof instAdded.trackIndex === 'number' ? instAdded.trackIndex : (trackIndex != null ? trackIndex : (Number.isFinite(app.state.activeTrackIndex) ? app.state.activeTrackIndex : 0));
        var sbOut = (instAdded && P && typeof P.secToBeat === 'function') ? P.secToBeat(instAdded.startSec || 0, bpm) : ((startSec != null && P && typeof P.secToBeat === 'function') ? P.secToBeat(startSec, bpm) : null);
        return {
          message: 'added',
          data: { clipId: clipId, instanceId: instAdded ? instAdded.id : null, startBeat: sbOut, trackIndex: tiOut },
        };
      },
    },
    remove_instance: {
      id: 'remove_instance',
      kind: KIND.timeline,
      requires: { requiredPayloadKeys: ['instanceId'] },
      params: { required: ['instanceId'] },
      destructive: DESTRUCTIVE.timeline_remove,
      confirm: CONFIRM.assistant_remove_instance,
      labels: { running: 'cmd.removeInstance' },
      availability: 'instance must exist; assistant layer confirms before run',
      run: function (app, payload) {
        var instanceId = payload.instanceId;
        if (!instanceId) throw new Error('instanceId required');
        var idx = (app.project.instances || []).findIndex(function (x) { return x && x.id === instanceId; });
        if (idx < 0) throw new Error('instance not found');
        app.deleteInstance(instanceId);
        return { message: 'removed', data: { instanceId: instanceId } };
      },
    },
    move_instance: {
      id: 'move_instance',
      kind: KIND.timeline,
      requires: { requiredPayloadKeys: ['instanceId'], notes: 'at least one of startBeat or trackIndex to mutate' },
      params: { required: ['instanceId'], optional: ['startBeat', 'trackIndex'] },
      destructive: DESTRUCTIVE.timeline_edit,
      confirm: CONFIRM.never,
      labels: { running: 'cmd.moveInstance' },
      availability: 'noop if no placement fields',
      run: function (app, payload, hooks) {
        var instanceId = payload.instanceId;
        if (!instanceId) throw new Error('instanceId required');
        var inst = (app.project.instances || []).find(function (x) { return x && x.id === instanceId; });
        if (!inst) throw new Error('instance not found');
        var P = (typeof ROOT !== 'undefined' && ROOT.H2SProject) ? ROOT.H2SProject : null;
        var bpm = (app.project && typeof app.project.bpm === 'number' && isFinite(app.project.bpm)) ? app.project.bpm : 120;
        var changed = false;
        if (payload.startBeat != null && P && typeof P.normalizeBeat === 'function' && typeof P.beatToSec === 'function' && isFinite(Number(payload.startBeat))) {
          var sb2 = P.normalizeBeat(Number(payload.startBeat));
          inst.startSec = P.beatToSec(sb2, bpm);
          changed = true;
        }
        if (payload.trackIndex != null && Number.isFinite(Number(payload.trackIndex))) {
          var max2 = Math.max(0, ((app.project.tracks || []).length) - 1);
          inst.trackIndex = Math.max(0, Math.min(max2, Math.round(Number(payload.trackIndex))));
          changed = true;
        }
        if (!changed) {
          return { message: 'noop', data: { instanceId: instanceId, noop: true } };
        }
        if (hooks && typeof hooks.persist === 'function') hooks.persist();
        if (hooks && typeof hooks.render === 'function') hooks.render();
        return {
          message: 'moved',
          data: {
            instanceId: instanceId,
            startBeat: (P && typeof P.secToBeat === 'function') ? P.secToBeat(inst.startSec || 0, bpm) : null,
            trackIndex: (typeof inst.trackIndex === 'number') ? inst.trackIndex : 0,
          },
        };
      },
    },
    add_track: {
      id: 'add_track',
      kind: KIND.track,
      requires: { requiredPayloadKeys: [] },
      params: { optional: [] },
      destructive: DESTRUCTIVE.timeline_edit,
      confirm: CONFIRM.never,
      labels: { running: 'cmd.addTrack' },
      availability: 'getProjectV2 tracks extended via addTrack()',
      run: function (app) {
        app.addTrack();
        var p2 = (typeof app.getProjectV2 === 'function') ? app.getProjectV2() : null;
        var tracks = (p2 && Array.isArray(p2.tracks)) ? p2.tracks : [];
        var last = tracks.length ? tracks[tracks.length - 1] : null;
        return {
          message: 'added',
          data: { trackIndex: tracks.length - 1, trackId: last && (last.trackId || last.id) ? String(last.trackId || last.id) : null },
        };
      },
    },
  };

  function isBounded(command) {
    return Object.prototype.hasOwnProperty.call(BOUNDED, command);
  }

  function boundedActionIds() {
    return Object.keys(BOUNDED);
  }

  function getBoundedEntry(command) {
    return BOUNDED[command] || null;
  }

  function labelRunningKey(command) {
    var e = BOUNDED[command];
    return (e && e.labels && e.labels.running) ? e.labels.running : null;
  }

  /**
   * @param {object} app
   * @param {string} command
   * @param {object} payload
   * @param {{ persist?: function, render?: function }} [hooks]
   * @returns {{ message: string, data: object }}
   */
  function executeBounded(app, command, payload, hooks) {
    var entry = BOUNDED[command];
    if (!entry) throw new Error('not a bounded internal action: ' + command);
    return entry.run(app, payload || {}, hooks || {});
  }

  ROOT.H2SInternalActionRegistry = {
    KIND: KIND,
    DESTRUCTIVE: DESTRUCTIVE,
    CONFIRM: CONFIRM,
    boundedActionIds: boundedActionIds,
    isBounded: isBounded,
    getBoundedEntry: getBoundedEntry,
    labelRunningKey: labelRunningKey,
    executeBounded: executeBounded,
    /** @internal test hook */
    _BOUNDED: BOUNDED,
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
