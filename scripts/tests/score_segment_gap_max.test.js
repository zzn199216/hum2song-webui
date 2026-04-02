#!/usr/bin/env node
/* Unit tests: segmentScoreDocByGapAndMaxDuration — pure time segmentation for seconds-based scores */
'use strict';

const path = require('path');
const assert = require('assert');

const split = require(path.resolve(__dirname, '../../static/pianoroll/core/score_heuristic_split.js'));
const { segmentScoreDocByGapAndMaxDuration } = split;

function assertDeep(a, b, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
}

function countNotes(score) {
  let c = 0;
  for (const tr of score.tracks || []) {
    for (const n of tr.notes || []) c += 1;
  }
  return c;
}

// --- 1) no segmentation needed (single segment) ---
(function () {
  const score = {
    version: 1,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [
      {
        id: 'a',
        name: 'A',
        notes: [
          { id: 'n1', pitch: 60, start: 0, duration: 0.5, velocity: 80 },
          { id: 'n2', pitch: 61, start: 0.6, duration: 0.5, velocity: 80 },
        ],
      },
    ],
  };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 2, maxDurationSec: 999 });
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].tMin, 0);
  assert.strictEqual(segs[0].tMax, 1.1);
  assert.strictEqual(countNotes(segs[0].score), 2);
})();

// --- 2) split on large gap ---
(function () {
  const score = {
    tracks: [
      {
        notes: [
          { pitch: 60, start: 0, duration: 0.5 },
          { pitch: 60, start: 3, duration: 0.5 },
        ],
      },
    ],
  };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 1, maxDurationSec: 1e9 });
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].tMin, 0);
  assert.strictEqual(segs[0].tMax, 0.5);
  assert.strictEqual(segs[1].tMin, 3);
  assert.strictEqual(segs[1].tMax, 3.5);
  assert.strictEqual(segs[0].score.tracks[0].notes[0].start, 0);
  assert.strictEqual(segs[1].score.tracks[0].notes[0].start, 0);
})();

// --- 3) split because of max duration cap ---
(function () {
  const notes = [];
  for (let i = 0; i < 6; i++) {
    notes.push({ pitch: 60, start: i * 0.2, duration: 0.15, velocity: 80 });
  }
  const score = { tracks: [{ id: 't', name: 'T', notes }] };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 999, maxDurationSec: 0.35 });
  assert.ok(segs.length >= 2, 'max duration should create multiple segments');
  let total = 0;
  for (const s of segs) total += countNotes(s.score);
  assert.strictEqual(total, 6);
})();

// --- 4) multi-note ordering preserved (stable sort within segment) ---
(function () {
  const score = {
    tracks: [
      {
        notes: [
          { id: 'b', pitch: 61, start: 0, duration: 0.1 },
          { id: 'a', pitch: 60, start: 0, duration: 0.1 },
        ],
      },
    ],
  };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 99, maxDurationSec: 99 });
  assert.strictEqual(segs.length, 1);
  const ns = segs[0].score.tracks[0].notes;
  assert.strictEqual(ns[0].pitch, 60);
  assert.strictEqual(ns[1].pitch, 61);
})();

// --- 5) no note loss across tracks ---
(function () {
  const score = {
    tracks: [
      { notes: [{ pitch: 60, start: 0, duration: 0.1 }, { pitch: 60, start: 5, duration: 0.1 }] },
      { notes: [{ pitch: 40, start: 0.05, duration: 0.1 }] },
    ],
  };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 1, maxDurationSec: 999 });
  let total = 0;
  for (const s of segs) total += countNotes(s.score);
  assert.strictEqual(total, 3);
})();

// --- 6) no mutation of input ---
(function () {
  const score = {
    tracks: [{ notes: [{ pitch: 50, start: 7, duration: 1, velocity: 64 }] }],
  };
  const copy = JSON.parse(JSON.stringify(score));
  segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 0.5, maxDurationSec: 10 });
  assertDeep(score, copy);
})();

// --- 7) deterministic tMin / tMax ---
(function () {
  const score = {
    tracks: [{ notes: [{ pitch: 60, start: 1, duration: 0.5 }, { pitch: 61, start: 4, duration: 0.25 }] }],
  };
  const a = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 1, maxDurationSec: 999 });
  const b = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 1, maxDurationSec: 999 });
  assertDeep(a, b);
  assert.strictEqual(a.length, 2);
  assert.strictEqual(a[0].tMin, 1);
  assert.strictEqual(a[0].tMax, 1.5);
  assert.strictEqual(a[1].tMin, 4);
  assert.strictEqual(a[1].tMax, 4.25);
})();

// --- 8) absolute-time round-trip: instanceStart + tMin + rebasedStart ---
(function () {
  const instanceStart = 100;
  const score = {
    tracks: [{ notes: [{ pitch: 60, start: 12, duration: 2, velocity: 80 }] }],
  };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 1, maxDurationSec: 50 });
  assert.strictEqual(segs.length, 1);
  const { score: out, tMin } = segs[0];
  const rebased = out.tracks[0].notes[0].start;
  assert.strictEqual(rebased, 0);
  const absolute = instanceStart + tMin + rebased;
  assert.strictEqual(absolute, instanceStart + 12);
})();

// --- 9a) empty score ---
(function () {
  const segs = segmentScoreDocByGapAndMaxDuration({ version: 1, tempo_bpm: 90, tracks: [] }, { minGapSec: 1, maxDurationSec: 10 });
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].tMin, 0);
  assert.strictEqual(segs[0].tMax, 0);
  assert.strictEqual(segs[0].score.tracks.length, 0);
})();

// --- 9b) single note ---
(function () {
  const score = { tracks: [{ notes: [{ pitch: 60, start: 5, duration: 1.5 }] }] };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 0.1, maxDurationSec: 0.5 });
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].tMin, 5);
  assert.strictEqual(segs[0].tMax, 6.5);
  assert.strictEqual(segs[0].score.tracks[0].notes[0].start, 0);
})();

// --- 9c) long note vs max-duration cap (whole note stays in one segment; split before next note) ---
(function () {
  const score = {
    tracks: [
      {
        notes: [
          { id: 'long', pitch: 60, start: 0, duration: 8 },
          { id: 'after', pitch: 62, start: 8, duration: 0.2 },
        ],
      },
    ],
  };
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 999, maxDurationSec: 2 });
  assert.strictEqual(segs.length, 2);
  const longSeg = segs[0].score.tracks[0].notes.find((n) => n.id === 'long');
  assert.ok(longSeg, 'long note not split');
  assert.strictEqual(longSeg.duration, 8);
  assert.strictEqual(segs[0].tMax - segs[0].tMin, 8);
})();

// --- 10) multi-track round-trip all notes ---
(function () {
  const score = {
    tracks: [
      { id: 't0', name: 'Hi', notes: [{ pitch: 72, start: 100, duration: 0.2 }] },
      { id: 't1', name: 'Lo', notes: [{ pitch: 48, start: 100.1, duration: 0.1 }] },
    ],
  };
  const instanceStart = 50;
  const segs = segmentScoreDocByGapAndMaxDuration(score, { minGapSec: 5, maxDurationSec: 999 });
  assert.strictEqual(segs.length, 1);
  const { score: out, tMin } = segs[0];
  const absHi = instanceStart + tMin + out.tracks[0].notes[0].start;
  const absLo = instanceStart + tMin + out.tracks[1].notes[0].start;
  assert.strictEqual(absHi, 50 + 100);
  assert.strictEqual(absLo, 50 + 100.1);
})();

console.log('PASS score_segment_gap_max tests');
