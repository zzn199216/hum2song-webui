#!/usr/bin/env node
/* Unit tests: score_heuristic_split.js — pure pitch-bucket partition */
'use strict';

const path = require('path');
const assert = require('assert');

const split = require(path.resolve(__dirname, '../../static/pianoroll/core/score_heuristic_split.js'));
const { splitScoreDocByPitchBuckets } = split;

function assertDeep(a, b, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
}

// --- 1) basic low/mid/high separation (3-track) ---
(function () {
  const score = {
    version: 1,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [
      {
        id: 't1',
        name: 'A',
        notes: [
          { id: 'n1', pitch: 40, start: 0, duration: 0.5, velocity: 80 },
          { id: 'n2', pitch: 60, start: 0.5, duration: 0.5, velocity: 80 },
          { id: 'n3', pitch: 90, start: 1, duration: 0.5, velocity: 80 },
        ],
      },
    ],
  };
  const out = splitScoreDocByPitchBuckets(score, { numTracks: 3, lowMax: 41, midMax: 83 });
  assert.strictEqual(out.tracks.length, 3);
  assert.strictEqual(out.tracks[0].name, 'High');
  assert.strictEqual(out.tracks[1].name, 'Mid');
  assert.strictEqual(out.tracks[2].name, 'Low');
  assert.strictEqual(out.tracks[0].notes.length, 1);
  assert.strictEqual(out.tracks[0].notes[0].pitch, 90);
  assert.strictEqual(out.tracks[1].notes.length, 1);
  assert.strictEqual(out.tracks[1].notes[0].pitch, 60);
  assert.strictEqual(out.tracks[2].notes.length, 1);
  assert.strictEqual(out.tracks[2].notes[0].pitch, 40);
})();

// --- 2) empty / missing ---
(function () {
  const out0 = splitScoreDocByPitchBuckets(null);
  assert.strictEqual(out0.tracks.length, 3);
  assert.strictEqual(out0.tracks[0].notes.length + out0.tracks[1].notes.length + out0.tracks[2].notes.length, 0);

  const out1 = splitScoreDocByPitchBuckets({ tracks: [] });
  assert.strictEqual(out1.tracks[0].notes.length, 0);

  const out2 = splitScoreDocByPitchBuckets({ tracks: [{ notes: [] }] });
  assert.strictEqual(out2.tracks[1].notes.length, 0);
})();

// --- 3) deterministic ordering (same input → same output) ---
(function () {
  const score = {
    tracks: [
      {
        notes: [
          { pitch: 84, start: 0.2, duration: 0.1 },
          { pitch: 84, start: 0.1, duration: 0.1 },
        ],
      },
    ],
  };
  const a = splitScoreDocByPitchBuckets(score);
  const b = splitScoreDocByPitchBuckets(score);
  assertDeep(a, b, 'deterministic');
  assert.strictEqual(a.tracks[0].notes[0].start, 0.1);
  assert.strictEqual(a.tracks[0].notes[1].start, 0.2);
})();

// --- 4) no note loss (partition) ---
(function () {
  const notes = [];
  for (let i = 0; i < 20; i++) {
    notes.push({ pitch: (i * 7) % 128, start: i * 0.1, duration: 0.05, velocity: 90 });
  }
  const out = splitScoreDocByPitchBuckets({ tracks: [{ notes }] });
  let c = 0;
  for (let t = 0; t < out.tracks.length; t++) c += out.tracks[t].notes.length;
  assert.strictEqual(c, 20);
})();

// --- 5) no duplicate notes (ids unique per output if input ids unique) ---
(function () {
  const out = splitScoreDocByPitchBuckets({
    tracks: [
      {
        notes: [
          { id: 'a', pitch: 10, start: 0, duration: 1 },
          { id: 'b', pitch: 50, start: 0, duration: 1 },
          { id: 'c', pitch: 100, start: 0, duration: 1 },
        ],
      },
    ],
  });
  const seen = new Set();
  for (const tr of out.tracks) {
    for (const n of tr.notes) {
      assert.ok(!seen.has(n.id), 'no duplicate id across tracks');
      seen.add(n.id);
    }
  }
  assert.strictEqual(seen.size, 3);
})();

// --- 6) all notes in one bucket ---
(function () {
  const out = splitScoreDocByPitchBuckets({
    tracks: [
      {
        notes: [
          { pitch: 90, start: 0, duration: 0.1 },
          { pitch: 100, start: 0.2, duration: 0.1 },
        ],
      },
    ],
  });
  assert.strictEqual(out.tracks[0].notes.length, 2);
  assert.strictEqual(out.tracks[1].notes.length, 0);
  assert.strictEqual(out.tracks[2].notes.length, 0);
})();

// --- 7) stable shape: version, tempo_bpm, tracks with id/name/notes ---
(function () {
  const out = splitScoreDocByPitchBuckets(
    { version: 1, tempo_bpm: 100, time_signature: '3/4', tracks: [{ notes: [{ pitch: 60, start: 0, duration: 1 }] }] },
    { numTracks: 2, midMax: 83 }
  );
  assert.strictEqual(out.version, 1);
  assert.strictEqual(out.tempo_bpm, 100);
  assert.strictEqual(out.time_signature, '3/4');
  assert.strictEqual(out.tracks.length, 2);
  assert.ok(out.tracks[0].id && out.tracks[1].id);
  assert.strictEqual(out.tracks[0].name, 'High');
  assert.strictEqual(out.tracks[1].name, 'Low+Mid');
  assert.ok(Array.isArray(out.tracks[0].notes));
})();

// --- merge multiple input tracks ---
(function () {
  const out = splitScoreDocByPitchBuckets({
    tracks: [
      { notes: [{ pitch: 20, start: 0, duration: 0.1 }] },
      { notes: [{ pitch: 90, start: 1, duration: 0.1 }] },
    ],
  });
  assert.strictEqual(out.tracks[0].notes.length, 1);
  assert.strictEqual(out.tracks[2].notes.length, 1);
})();

// --- input not mutated ---
(function () {
  const score = {
    tracks: [{ notes: [{ pitch: 50, start: 0, duration: 1, velocity: 64 }] }],
  };
  const copy = JSON.parse(JSON.stringify(score));
  splitScoreDocByPitchBuckets(score);
  assertDeep(score, copy, 'input unchanged');
})();

console.log('PASS score_heuristic_split tests');
