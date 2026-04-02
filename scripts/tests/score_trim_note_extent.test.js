#!/usr/bin/env node
/* Unit tests: trimScoreDocToNoteExtent — pure trim/rebase for seconds-based scores */
'use strict';

const path = require('path');
const assert = require('assert');

const split = require(path.resolve(__dirname, '../../static/pianoroll/core/score_heuristic_split.js'));
const { trimScoreDocToNoteExtent } = split;

function assertDeep(a, b, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
}

// --- 1) basic trim and rebase ---
(function () {
  const score = {
    version: 1,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [
      {
        id: 'a',
        name: 'A',
        notes: [{ id: 'n1', pitch: 60, start: 10, duration: 0.5, velocity: 80 }],
      },
    ],
  };
  const { score: out, tMin, tMax } = trimScoreDocToNoteExtent(score);
  assert.strictEqual(tMin, 10);
  assert.strictEqual(tMax, 10.5);
  assert.strictEqual(out.tracks[0].notes[0].start, 0);
  assert.strictEqual(out.tracks[0].notes[0].duration, 0.5);
  assert.strictEqual(out.tracks[0].notes[0].pitch, 60);
})();

// --- 2) multi-track: extent across all tracks ---
(function () {
  const score = {
    tracks: [
      { id: 't0', name: 'Hi', notes: [{ pitch: 72, start: 100, duration: 0.2, velocity: 90 }] },
      { id: 't1', name: 'Lo', notes: [{ pitch: 48, start: 5, duration: 1, velocity: 90 }] },
    ],
  };
  const { score: out, tMin, tMax } = trimScoreDocToNoteExtent(score);
  assert.strictEqual(tMin, 5);
  assert.strictEqual(tMax, 100.2);
  assert.strictEqual(out.tracks[0].notes[0].start, 95);
  assert.strictEqual(out.tracks[1].notes[0].start, 0);
})();

// --- 3) no note loss ---
(function () {
  const notes = [];
  for (let i = 0; i < 15; i++) {
    notes.push({ pitch: 60 + i, start: 50 + i * 0.1, duration: 0.05, velocity: 80 });
  }
  const score = { tracks: [{ notes }, { notes: [{ pitch: 40, start: 51, duration: 0.1 }] }] };
  const { score: out } = trimScoreDocToNoteExtent(score);
  let c = 0;
  for (const tr of out.tracks) c += tr.notes.length;
  assert.strictEqual(c, 16);
})();

// --- 4) duration unchanged ---
(function () {
  const score = {
    tracks: [{ notes: [{ pitch: 60, start: 2, duration: 3.25, velocity: 64 }] }],
  };
  const { score: out } = trimScoreDocToNoteExtent(score);
  assert.strictEqual(out.tracks[0].notes[0].duration, 3.25);
})();

// --- 5) deterministic tMin / tMax and output ---
(function () {
  const score = {
    tracks: [{ notes: [{ pitch: 60, start: 1, duration: 0.5 }, { pitch: 61, start: 3, duration: 0.25 }] }],
  };
  const a = trimScoreDocToNoteExtent(score);
  const b = trimScoreDocToNoteExtent(score);
  assertDeep(a, b);
  assert.strictEqual(a.tMin, 1);
  assert.strictEqual(a.tMax, 3.25);
})();

// --- 6) empty-score behavior ---
(function () {
  const emptyTracks = trimScoreDocToNoteExtent({ version: 2, tempo_bpm: 90, time_signature: '3/4', tracks: [] });
  assert.strictEqual(emptyTracks.tMin, 0);
  assert.strictEqual(emptyTracks.tMax, 0);
  assert.strictEqual(emptyTracks.score.tracks.length, 0);
  assert.strictEqual(emptyTracks.score.tempo_bpm, 90);

  const emptyNotes = trimScoreDocToNoteExtent({
    tracks: [{ id: 'x', name: 'X', notes: [] }],
  });
  assert.strictEqual(emptyNotes.tMin, 0);
  assert.strictEqual(emptyNotes.tMax, 0);
  assert.strictEqual(emptyNotes.score.tracks[0].notes.length, 0);
  assert.strictEqual(emptyNotes.score.tracks[0].id, 'x');
})();

// --- 7) non-mutation of input ---
(function () {
  const score = {
    tracks: [{ notes: [{ pitch: 50, start: 7, duration: 1, velocity: 64 }] }],
  };
  const copy = JSON.parse(JSON.stringify(score));
  trimScoreDocToNoteExtent(score);
  assertDeep(score, copy);
})();

// --- 8) absolute-time round-trip ---
(function () {
  const instanceStart = 100;
  const score = {
    tracks: [{ notes: [{ pitch: 60, start: 12, duration: 2, velocity: 80 }] }],
  };
  const { score: out, tMin, tMax } = trimScoreDocToNoteExtent(score);
  assert.strictEqual(tMin, 12);
  assert.strictEqual(tMax, 14);
  const rebased = out.tracks[0].notes[0].start;
  assert.strictEqual(rebased, 0);
  const newInstanceStart = instanceStart + tMin;
  const absolute = newInstanceStart + rebased;
  assert.strictEqual(absolute, instanceStart + 12);
})();

console.log('PASS score_trim_note_extent tests');
