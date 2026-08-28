#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

if (typeof globalThis.window === 'undefined') globalThis.window = {};
require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
const Project = globalThis.window.H2SProject;

function score(pitch) {
  return {
    version: 2,
    tracks: [{
      id: 'score-' + pitch,
      notes: [{ id: 'note-' + pitch, pitch, velocity: 96, startBeat: 0, durationBeat: 1 }],
    }],
  };
}

function canonicalProject() {
  return {
    version: 2,
    timebase: 'beat',
    bpm: 120,
    futureProjectField: { nested: ['project', { keep: true }] },
    tracks: [
      {
        id: 'track-1', trackId: 'track-1', name: 'Lead', instrument: 'synth_lead',
        gainDb: -2, muted: false, role: 'melody', futureTrackField: { keep: 1 },
      },
      {
        id: 'track-2', trackId: 'track-2', name: 'Pad', instrument: 'synth_pad',
        gainDb: -5, muted: true, role: 'harmony', futureTrackField: { keep: 2 },
      },
    ],
    clips: {
      'clip-1': {
        id: 'clip-1', name: 'Notes', createdAt: 10, updatedAt: 20, score: score(62),
        meta: { notes: 1, pitchMin: 62, pitchMax: 62, spanBeat: 1, futureClipMeta: { keep: true } },
        futureClipField: { keep: 'clip' }, revisionId: 'rev-current', parentRevisionId: 'rev-root',
        revisions: {
          'rev-root': { revisionId: 'rev-root', parentRevisionId: null, score: score(60) },
          'rev-current': { revisionId: 'rev-current', parentRevisionId: 'rev-root', score: score(62) },
        },
      },
      'clip-2': {
        id: 'clip-2', kind: 'audio', name: 'Audio', createdAt: 11, updatedAt: 21,
        audio: { assetRef: 'localidb:test', durationSec: 4, futureAudioField: { keep: true } },
        meta: { notes: 0, pitchMin: null, pitchMax: null, spanBeat: 0, futureClipMeta: { keep: 'audio' } },
        futureClipField: { keep: 'audio-clip' },
      },
    },
    clipOrder: ['clip-1', 'clip-2'],
    instances: [
      { id: 'instance-1', clipId: 'clip-1', trackId: 'track-1', startBeat: 2, transpose: 0, gainDb: -3, futureInstanceField: { keep: 1 } },
      { id: 'instance-2', clipId: 'clip-2', trackId: 'track-2', startBeat: 8, transpose: 0, gainDb: 2, futureInstanceField: { keep: 2 } },
    ],
    ui: { pxPerBeat: 240, playheadBeat: 1, futureUiField: { keep: true } },
  };
}

function projectV1View(projectV2) {
  const bpm = projectV2.bpm;
  return {
    version: 1,
    bpm,
    tracks: projectV2.tracks.map((track) => ({
      id: track.id, trackId: track.trackId, name: track.name, instrument: track.instrument,
      gainDb: track.gainDb, muted: track.muted, role: track.role,
    })),
    clips: projectV2.clipOrder.map((clipId) => {
      const clip = projectV2.clips[clipId];
      if (clip.kind === 'audio') {
        return {
          id: clip.id, kind: 'audio', name: clip.name, createdAt: clip.createdAt,
          audio: { assetRef: clip.audio.assetRef, durationSec: clip.audio.durationSec },
          meta: { notes: 0, pitchMin: null, pitchMax: null, spanSec: clip.audio.durationSec },
        };
      }
      return {
        id: clip.id, name: clip.name, createdAt: clip.createdAt,
        score: Project.scoreBeatToSec(clip.score, bpm),
        meta: { notes: 1, pitchMin: 62, pitchMax: 62, spanSec: Project.beatToSec(1, bpm) },
      };
    }),
    instances: projectV2.instances.map((instance) => ({
      id: instance.id,
      clipId: instance.clipId,
      trackIndex: projectV2.tracks.findIndex((track) => track.id === instance.trackId),
      startSec: Project.beatToSec(instance.startBeat, bpm),
      transpose: instance.transpose,
      gainDb: instance.gainDb,
    })),
    ui: {
      pxPerSec: Project.pxPerBeatToPxPerSec(projectV2.ui.pxPerBeat, bpm),
      playheadSec: Project.beatToSec(projectV2.ui.playheadBeat, bpm),
    },
  };
}

(function preservesCanonicalExtensionsDuringV1Edit() {
  const previous = canonicalProject();
  const previousSnapshot = Project.deepClone(previous);
  const view = projectV1View(previous);
  view.instances[0].startSec = 3.25;

  const result = Project.mergeProjectV1ViewIntoV2(previous, view);

  assert.strictEqual(result.instances[0].startBeat, 6.5, 'v1 seconds edit updates canonical beats');
  assert.strictEqual(result.instances[0].gainDb, -3, 'instance gain survives the projection');
  assert.deepStrictEqual(result.futureProjectField, previous.futureProjectField);
  assert.deepStrictEqual(result.ui.futureUiField, previous.ui.futureUiField);
  assert.deepStrictEqual(result.tracks[0].futureTrackField, previous.tracks[0].futureTrackField);
  assert.deepStrictEqual(result.clips['clip-1'].futureClipField, previous.clips['clip-1'].futureClipField);
  assert.deepStrictEqual(result.clips['clip-1'].meta.futureClipMeta, previous.clips['clip-1'].meta.futureClipMeta);
  assert.deepStrictEqual(result.clips['clip-2'].audio.futureAudioField, previous.clips['clip-2'].audio.futureAudioField);
  assert.deepStrictEqual(result.instances[0].futureInstanceField, previous.instances[0].futureInstanceField);
  assert.strictEqual(result.clips['clip-1'].revisionId, 'rev-current');
  assert.strictEqual(result.clips['clip-1'].parentRevisionId, 'rev-root');
  assert.deepStrictEqual(result.clips['clip-1'].revisions, previous.clips['clip-1'].revisions);
  assert.deepStrictEqual(previous, previousSnapshot, 'canonical input is not mutated');
})();

(function collectionMembershipFollowsTheV1View() {
  const previous = canonicalProject();
  const view = projectV1View(previous);
  view.tracks = view.tracks.slice(0, 1);
  view.clips = view.clips.filter((clip) => clip.id === 'clip-1');
  view.instances = view.instances.filter((instance) => instance.id === 'instance-1');

  const result = Project.mergeProjectV1ViewIntoV2(previous, view);
  assert.deepStrictEqual(result.tracks.map((track) => track.id), ['track-1']);
  assert.deepStrictEqual(Object.keys(result.clips), ['clip-1']);
  assert.deepStrictEqual(result.clipOrder, ['clip-1']);
  assert.deepStrictEqual(result.instances.map((instance) => instance.id), ['instance-1']);
})();

console.log('PASS ProjectDoc v1/v2 persistence preserves canonical extension data');
