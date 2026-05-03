#!/usr/bin/env node
'use strict';

const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

if (typeof globalThis.window === 'undefined') globalThis.window = {};

require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
const H2SProject = globalThis.window.H2SProject;
const Q = require(path.resolve(__dirname, '../../static/pianoroll/core/arrangement_quality_v0.js'));

function hasCode(ws, code){
  return ws.some(function(w){ return w && String(w.code) === code; });
}

function mkShortCoveragePatch(trackInst){
  return {
    kind: 'arrangement_patch_v0',
    version: 1,
    ops: [
      { op: 'createTrack', trackId: trackInst, name: 'A', instrument: 'bass' },
      {
        op: 'createClip',
        clipId: 'c1',
        name: 'C1',
        scoreBeat: {
          version: 2,
          tracks: [{ id: 't', notes: [{ id: 'n0', pitch: 40, velocity: 50, startBeat: 0, durationBeat: 4 }] }],
        },
      },
      { op: 'addInstance', instanceId: 'i1', clipId: 'c1', trackId: trackInst, startBeat: 0 },
    ],
  };
}

function mkTwoTrackImbalancePatch(){
  return {
    version: 1,
    ops: [
      { op: 'createTrack', trackId: 't1', name: 'A', instrument: 'bass', gainDb: -8 },
      { op: 'createTrack', trackId: 't2', name: 'B', instrument: 'drum', gainDb: -10 },
      {
        op: 'createClip',
        clipId: 'c_long',
        name: 'L',
        scoreBeat: {
          version: 2,
          tracks: [{ id: 'x', notes: [{ id: 'a', pitch: 40, velocity: 50, startBeat: 0, durationBeat: 20 }] }],
        },
      },
      {
        op: 'createClip',
        clipId: 'c_short',
        name: 'S',
        scoreBeat: {
          version: 2,
          tracks: [{ id: 'y', notes: [{ id: 'b', pitch: 40, velocity: 50, startBeat: 0, durationBeat: 6 }] }],
        },
      },
      { op: 'addInstance', instanceId: 'i1', clipId: 'c_long', trackId: 't1', startBeat: 0 },
      { op: 'addInstance', instanceId: 'i2', clipId: 'c_short', trackId: 't2', startBeat: 0 },
    ],
  };
}

function mkDensePatch(){
  const notes = [];
  for (let i = 0; i < 110; i++){
    notes.push({ id: 'n' + i, pitch: 40 + (i % 5), velocity: 50, startBeat: i * 0.08, durationBeat: 0.06 });
  }
  return {
    version: 1,
    ops: [
      { op: 'createTrack', trackId: 'td', name: 'Dense', instrument: 'lead' },
      { op: 'createClip', clipId: 'cd', name: 'D', scoreBeat: { version: 2, tracks: [{ id: 't', notes: notes }] } },
      { op: 'addInstance', instanceId: 'id1', clipId: 'cd', trackId: 'td', startBeat: 0 },
    ],
  };
}

async function main(){
  assert(Q && typeof Q.analyzeArrangementQualityV0 === 'function', 'analyzer export');

  {
    const rBad = Q.analyzeArrangementQualityV0(null, null, {}, {});
    assert(hasCode(rBad.warnings, 'invalid_patch_json'), 'null patch flagged');
  }

  {
    const span = 24;
    const p = mkShortCoveragePatch('trk1');
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: span, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'short_coverage'), 'expect short_coverage when endBeat << span');
  }

  {
    const p = mkTwoTrackImbalancePatch();
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 20, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'track_imbalance'), 'expect track_imbalance');
  }

  {
    const p = mkDensePatch();
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 8, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'overly_dense'), 'expect overly_dense');
  }

  {
    const p = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'tq', name: 'Q', instrument: 'sampler:bad-unknown-pack-xx' },
        { op: 'createClip', clipId: 'cq', name: 'Q', scoreBeat: { version: 2, tracks: [{ id: 't', notes: [{ id: 'n', pitch: 55, velocity: 50, startBeat: 0, durationBeat: 12 }] }] } },
        { op: 'addInstance', instanceId: 'iq', clipId: 'cq', trackId: 'tq', startBeat: 0 },
      ],
    };
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 16, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'questionable_instrument'), 'unknown sampler pack is questionable');
  }

  {
    const p = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'tg', name: 'G', instrument: 'sampler:tonejs:piano' },
        { op: 'createClip', clipId: 'cg', name: 'G', scoreBeat: { version: 2, tracks: [{ id: 't', notes: [{ id: 'n', pitch: 55, velocity: 50, startBeat: 0, durationBeat: 12 }] }] } },
        { op: 'addInstance', instanceId: 'ig', clipId: 'cg', trackId: 'tg', startBeat: 0 },
      ],
    };
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 16, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(!hasCode(r.warnings, 'questionable_instrument'), 'known tonejs sampler accepted');
  }

  {
    const p = mkShortCoveragePatch('trkL');
    p.ops[1].scoreBeat.tracks[0].notes[0].velocity = 95;
    p.ops[0].gainDb = 0;
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 24, melodyMaxVelocity: 88 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'loud_combo'), 'high vel + high gain triggers loud_combo');
  }

  {
    const p = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'te', name: 'E', instrument: 'bass' },
        { op: 'createClip', clipId: 'ce', name: 'E', scoreBeat: { version: 2, tracks: [{ id: 't', notes: [] }] } },
        { op: 'addInstance', instanceId: 'ie', clipId: 'ce', trackId: 'te', startBeat: 0 },
      ],
    };
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 8, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'empty_clip'), 'empty clip');
  }

  {
    const p = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'to', name: 'O', instrument: 'bass' },
        { op: 'createClip', clipId: 'co', name: 'O', scoreBeat: { version: 2, tracks: [{ id: 't', notes: [{ id: 'a', pitch: 40, velocity: 50, startBeat: 0, durationBeat: 1 }] }] } },
      ],
    };
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 20, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'orphan_clip'), 'orphan clip');
  }

  {
    const p = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'ts', name: 'S', instrument: 'bass' },
        { op: 'createClip', clipId: 'cs', name: 'S', scoreBeat: { version: 2, tracks: [{ id: 't', notes: [
          { id: 'a', pitch: 40, velocity: 50, startBeat: 0, durationBeat: 1 },
          { id: 'b', pitch: 41, velocity: 50, startBeat: 4, durationBeat: 1 },
        ] }] } },
        { op: 'addInstance', instanceId: 'is', clipId: 'cs', trackId: 'ts', startBeat: 0 },
      ],
    };
    const r = Q.analyzeArrangementQualityV0({}, p, { selectedClipSpanBeat: 32, melodyMaxVelocity: 80 }, { H2SProject: H2SProject });
    assert(hasCode(r.warnings, 'sparse_notes'), 'sparse notes on long span');
  }

  console.log('PASS arrangement_quality_v0.test.js');
}

main().catch(function(e){
  console.error(e);
  process.exit(1);
});
