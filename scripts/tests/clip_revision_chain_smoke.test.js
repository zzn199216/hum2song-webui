#!/usr/bin/env node
'use strict';

// Smoke test for clip revision chain semantics.
// Goal: lock that revision switching / rollback never "loses" the previous head,
// and listClipRevisions reflects the current active revision.

function assert(cond, msg){
  if(!cond) throw new Error(msg || 'assertion failed');
}

// Minimal browser-ish globals expected by static/pianoroll/project.js
global.window = global.window || {};

// Load project.js (attaches window.H2SProject)
require(process.cwd() + '/static/pianoroll/project.js');
const H2SProject = global.window.H2SProject;
assert(H2SProject, 'window.H2SProject missing after require(project.js)');

function mkScoreBeat(){
  return {
    version: 2,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [
      {
        id: 't_0',
        name: 'ch0',
        program: 0,
        channel: 0,
        notes: [
          { id: 'n0', pitch: 60, velocity: 90, startBeat: 0, durationBeat: 1 },
          { id: 'n1', pitch: 64, velocity: 80, startBeat: 1, durationBeat: 1 },
        ],
      },
    ],
  };
}

function headPitch0(project, clipId){
  return project.clips[clipId].score.tracks[0].notes[0].pitch;
}

// Arrange: baseline project with 1 clip
const p = H2SProject.defaultProjectV2();
const scoreBeat = mkScoreBeat();
const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_test', name: 'test' });
p.clips[clip.id] = clip;
p.clipOrder = [clip.id];

const clipId = clip.id;
const rev0 = p.clips[clipId].revisionId;
assert(!!rev0, 'baseline clip must have revisionId');
assert((p.clips[clipId].revisions || []).length === 0, 'baseline revisions must be empty');

// Act: create new revision and change pitch (visible diff)
H2SProject.beginNewClipRevision(p, clipId);
const rev1 = p.clips[clipId].revisionId;
assert(rev1 && rev1 !== rev0, 'beginNewClipRevision must create new revisionId');
assert(p.clips[clipId].parentRevisionId === rev0, 'new head parentRevisionId must point to old rev');
assert((p.clips[clipId].revisions || []).length === 1, 'beginNewClipRevision must snapshot old head');

p.clips[clipId].score.tracks[0].notes[0].pitch = 72;
H2SProject.recomputeClipMetaFromScoreBeat(p.clips[clipId]);
assert(headPitch0(p, clipId) === 72, 'head pitch should reflect edit on new revision');

// listClipRevisions must show 2 items
const info1 = H2SProject.listClipRevisions(p.clips[clipId]);
assert(info1.items && info1.items.length === 2, 'listClipRevisions must show 2 items after 1 revision');
assert(info1.activeRevisionId === rev1, 'activeRevisionId must match current head');

// Act: switch to original via setClipActiveRevision
const sw0 = H2SProject.setClipActiveRevision(p, clipId, rev0);
assert(sw0.ok, 'setClipActiveRevision must return ok');
assert(p.clips[clipId].revisionId === rev0, 'after switching, head revisionId must be target');
assert(headPitch0(p, clipId) === 60, 'after switching to rev0, pitch must match original');

// Switching should not "lose" the other revision.
const info2 = H2SProject.listClipRevisions(p.clips[clipId]);
assert(info2.items && info2.items.length === 2, 'switching revisions must keep 2 items');

// Act: switch back to rev1
const sw1 = H2SProject.setClipActiveRevision(p, clipId, rev1);
assert(sw1.ok, 'switch back must be ok');
assert(p.clips[clipId].revisionId === rev1, 'head must be rev1 again');
assert(headPitch0(p, clipId) === 72, 'pitch must match rev1 again');

// Act: rollback should go to parent (rev0)
const rb = H2SProject.rollbackClipRevision(p, clipId);
assert(rb.ok, 'rollback must return ok');
assert(p.clips[clipId].revisionId === rev0, 'rollback must land on parent rev0');
assert(headPitch0(p, clipId) === 60, 'rollback must restore original pitch');

console.log('PASS clip revision chain smoke');
