#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

function scoreStats(score){
  const pitches = [];
  for (const tr of (score && score.tracks) || []){
    for (const n of (tr.notes || [])){
      if (Number.isFinite(Number(n.pitch))) pitches.push(Number(n.pitch));
    }
  }
  if (!pitches.length) return { minPitch: 60, maxPitch: 60, count: 0, spanSec: 0 };
  return {
    minPitch: Math.min.apply(null, pitches),
    maxPitch: Math.max.apply(null, pitches),
    count: pitches.length,
    spanSec: 0,
  };
}

const H2SProject = {
  scoreStats,
  clamp(v, lo, hi){
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  },
};

const testState = {};
const rtApi = require(path.resolve(__dirname, '../../static/pianoroll/controllers/editor_runtime.js'));
const rt = rtApi.create({
  H2SProject,
  getProject: () => ({ bpm: 120 }),
  getState: () => testState,
  $: () => null,
});

const padL = 60;
const padT = 20;
const pxPerSec = 160;
const rowH = 18;

function noteRect(note){
  const x = padL + note.start * pxPerSec;
  const y = padT + (127 - note.pitch) * rowH + 1;
  const w = Math.max(6, note.duration * pxPerSec);
  const h = rowH - 2;
  return { x, y, w, h };
}

function hitOn(note, xOffset){
  const r = noteRect(note);
  const px = r.x + xOffset;
  const py = r.y + Math.floor(r.h / 2);
  return rt.modalHitTest(px, py);
}

(function testNarrowAndOneCellHitZones(){
  const oneCell = { id: 'n_one', pitch: 60, start: 1.0, duration: 0.125 }; // 1/16 @120bpm = 1 grid cell
  const veryNarrow = { id: 'n_narrow', pitch: 58, start: 2.0, duration: 0.02 }; // width clamps to 6px
  const normal = { id: 'n_normal', pitch: 56, start: 3.0, duration: 0.5 };

  testState.modal = {
    draftScore: { tracks: [{ notes: [oneCell, veryNarrow, normal] }] },
    padL,
    padT,
    pxPerSec,
    rowH,
    usePitchVScroll: true,
    pitchViewRows: 32,
    pitchCenter: 60,
  };

  // 1-cell note: center must be draggable (not swallowed by resize zones).
  const oneRect = noteRect(oneCell);
  const oneCenter = hitOn(oneCell, Math.floor(oneRect.w / 2));
  assert(oneCenter && oneCenter.type === 'note' && oneCenter.noteId === oneCell.id, '1-cell note center should be move zone');
  assert(hitOn(oneCell, 1).type === 'resize_left', '1-cell note left edge should resize_left');
  assert(hitOn(oneCell, oneRect.w - 1).type === 'resize', '1-cell note right edge should resize');

  // Very narrow note: still keeps both resize affordances and a tiny move center.
  const narrowRect = noteRect(veryNarrow);
  assert(hitOn(veryNarrow, 0).type === 'resize_left', 'very narrow left edge should resize_left');
  assert(hitOn(veryNarrow, narrowRect.w - 1).type === 'resize', 'very narrow right edge should resize');
  assert(hitOn(veryNarrow, Math.floor(narrowRect.w / 2)).type === 'note', 'very narrow center should still move');

  // Normal note: behavior remains recognizable.
  assert(hitOn(normal, 1).type === 'resize_left', 'normal note left edge should resize_left');
  assert(hitOn(normal, noteRect(normal).w - 1).type === 'resize', 'normal note right edge should resize');
  assert(hitOn(normal, Math.floor(noteRect(normal).w / 2)).type === 'note', 'normal note center should move');
})();

console.log('PASS editor note hit-zones: narrow + one-cell move/resize symmetry');
