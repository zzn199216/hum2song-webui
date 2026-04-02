#!/usr/bin/env node
/* Unit tests: segmentScoreDocByBarBoundaries (multi-track bar segmentation) */
'use strict';

const path = require('path');
const assert = require('assert');

const split = require(path.resolve(__dirname, '../../static/pianoroll/core/score_heuristic_split.js'));
const { segmentScoreDocByBarBoundaries } = split;

function assertDeep(a, b, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
}

function countNotesInSegments(segs) {
  let n = 0;
  for (const seg of segs) {
    for (const tr of seg.score.tracks || []) {
      n += (tr.notes || []).length;
    }
  }
  return n;
}

function flattenNoteAbsTimes(score, tOffset) {
  const out = [];
  for (const tr of score.tracks || []) {
    for (const note of tr.notes || []) {
      out.push(tOffset + note.start);
    }
  }
  return out.sort((a, b) => a - b);
}

// --- 1) no segmentation needed (span <= maxBars * secPerBar) ---
(function () {
  const score = {
    version: 1,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{ id: 'a', name: 'A', notes: [{ pitch: 60, start: 0, duration: 0.5, velocity: 80 }] }],
  };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 8 });
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].tMin, 0);
  assert.strictEqual(segs[0].tMax, 0.5);
})();

// --- 2) segmentation on bar boundaries (120 BPM 4/4 => 2s/bar; maxBars=1) ---
(function () {
  const score = {
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [
      {
        notes: [
          { id: 'x', pitch: 60, start: 0, duration: 0.4, velocity: 80 },
          { id: 'y', pitch: 62, start: 2, duration: 0.4, velocity: 80 },
          { id: 'z', pitch: 64, start: 4, duration: 0.4, velocity: 80 },
        ],
      },
    ],
  };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  assert.strictEqual(segs.length, 3);
  assert.strictEqual(segs[0].tMin, 0);
  assert.strictEqual(segs[0].tMax, 0.4);
  assert.strictEqual(segs[1].tMin, 2);
  assert.strictEqual(segs[2].tMin, 4);
})();

// --- 3) max-bars cap on dense score (span must exceed maxBars*secPerBar to split) ---
(function () {
  const notes = [];
  for (let i = 0; i < 40; i++) {
    notes.push({ pitch: 60 + (i % 12), start: i * 0.1, duration: 0.05, velocity: 80 });
  }
  const score = { tempo_bpm: 120, time_signature: '4/4', tracks: [{ notes }] };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  assert.ok(segs.length >= 2, 'dense passage should yield multiple segments');
})();

// --- 4) multi-track alignment (same cuts for both tracks) ---
(function () {
  const score = {
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [
      { id: 't0', name: 'A', notes: [{ pitch: 60, start: 0, duration: 0.3, velocity: 80 }] },
      { id: 't1', name: 'B', notes: [{ pitch: 72, start: 2, duration: 0.3, velocity: 80 }] },
    ],
  };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].score.tracks[0].notes.length, 1);
  assert.strictEqual(segs[0].score.tracks[1].notes.length, 0);
  assert.strictEqual(segs[1].score.tracks[0].notes.length, 0);
  assert.strictEqual(segs[1].score.tracks[1].notes.length, 1);
})();

// --- 5) no note loss (split adds two halves; count matches) ---
(function () {
  const score = {
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{ notes: [{ id: 'only', pitch: 60, start: 0, duration: 10, velocity: 80 }] }],
  };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  let total = countNotesInSegments(segs);
  assert.strictEqual(total, 5, 'long note split across 5 bar cuts at 2s each');
})();

// --- 6) input not mutated ---
(function () {
  const score = {
    tracks: [{ notes: [{ pitch: 60, start: 0, duration: 0.5, velocity: 80 }] }],
  };
  const copy = JSON.parse(JSON.stringify(score));
  segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  assertDeep(score, copy, 'input unchanged');
})();

// --- 7) deterministic tMin / tMax (two runs) ---
(function () {
  const score = {
    tempo_bpm: 100,
    time_signature: '4/4',
    tracks: [{ notes: [{ pitch: 60, start: 0, duration: 0.2, velocity: 80 }, { pitch: 61, start: 2.4, duration: 0.2, velocity: 80 }] }],
  };
  const a = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  const b = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  assertDeep(a.map((s) => ({ tMin: s.tMin, tMax: s.tMax })), b.map((s) => ({ tMin: s.tMin, tMax: s.tMax })));
})();

// --- 8) absolute-time round-trip: instanceStart + tMin + localStart === original start ---
(function () {
  const score = {
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [
      {
        notes: [
          { pitch: 60, start: 0.1, duration: 0.1, velocity: 80 },
          { pitch: 61, start: 2.05, duration: 0.1, velocity: 80 },
        ],
      },
    ],
  };
  const origStarts = score.tracks[0].notes.map((n) => n.start).sort((a, b) => a - b);
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  const instanceStart = 3.7;
  const rebuilt = [];
  for (const seg of segs) {
    rebuilt.push(...flattenNoteAbsTimes(seg.score, instanceStart + seg.tMin));
  }
  rebuilt.sort((a, b) => a - b);
  const expected = origStarts.map((s) => instanceStart + s);
  assertDeep(rebuilt, expected);
})();

// --- 9a) empty score ---
(function () {
  const score = { tempo_bpm: 120, tracks: [{ id: 'x', name: 'E', notes: [] }] };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 2 });
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].tMin, 0);
  assert.strictEqual(segs[0].tMax, 0);
})();

// --- 9b) invalid BPM / time signature fallback (defaults to 120 and 4/4) ---
(function () {
  const score = {
    tempo_bpm: NaN,
    time_signature: 'not-a-meter',
    tracks: [{ notes: [{ pitch: 60, start: 0, duration: 0.1, velocity: 80 }] }],
  };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 8 });
  assert.strictEqual(segs.length, 1);
})();

// --- 9c) long note crossing bar boundary (forced split) ---
(function () {
  const score = {
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{ notes: [{ id: 'long', pitch: 48, start: 0, duration: 5, velocity: 80 }] }],
  };
  const segs = segmentScoreDocByBarBoundaries(score, { maxBars: 1 });
  assert.ok(segs.length >= 2);
  const left = segs[0].score.tracks[0].notes[0];
  const right = segs[1].score.tracks[0].notes[0];
  assert.ok(left.duration <= 2.0001 && left.duration >= 1.999);
  assert.ok(right.start < 0.001);
})();

console.log('PASS score_bar_segment tests');
