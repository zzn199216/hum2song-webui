#!/usr/bin/env node
'use strict';

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

global.window = global.window || {};

require(process.cwd() + '/static/pianoroll/project.js');
const H2SProject = global.window.H2SProject;
const AddBass = require(process.cwd() + '/static/pianoroll/core/add_bass_v0.js');

assert(H2SProject && AddBass, 'required modules not loaded');

function makeMelodyScore(){
  return {
    version: 2,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{
      id: 'mel_t0',
      name: 'Melody',
      notes: [
        { id: 'm0', pitch: 64, velocity: 90, startBeat: 0, durationBeat: 1 },
        { id: 'm1', pitch: 67, velocity: 90, startBeat: 1, durationBeat: 1 },
        { id: 'm2', pitch: 69, velocity: 85, startBeat: 2, durationBeat: 1 },
        { id: 'm3', pitch: 65, velocity: 88, startBeat: 4, durationBeat: 1 },
        { id: 'm4', pitch: 72, velocity: 92, startBeat: 5, durationBeat: 1 },
      ],
    }],
  };
}

const p2 = H2SProject.defaultProjectV2();
const melodyClip = H2SProject.createClipFromScoreBeat(makeMelodyScore(), { id: 'clip_melody', name: 'Melody' });
p2.clips[melodyClip.id] = melodyClip;
p2.clipOrder = [melodyClip.id];
const melodyInst = H2SProject.createInstanceV2(melodyClip.id, 8, p2.tracks[0].id);
p2.instances.push(melodyInst);
H2SProject.normalizeProjectV2(p2);

const melodyScoreBefore = JSON.stringify(p2.clips[melodyClip.id].score);
const melodyRevisionBefore = String(p2.clips[melodyClip.id].revisionId || '');
const trackCountBefore = p2.tracks.length;
const clipCountBefore = Object.keys(p2.clips).length;
const instanceCountBefore = p2.instances.length;

const built = AddBass.buildBassScoreFromMelodyClip(p2.clips[melodyClip.id], { H2SProject });
assert(built && built.ok, 'bass build should succeed');
assert(built.scoreBeat && Array.isArray(built.scoreBeat.tracks), 'bass score should exist');

const trackRes = AddBass.findOrCreateBassTrack(p2, { H2SProject });
assert(trackRes && trackRes.ok && trackRes.trackId, 'bass track should exist');
assert(p2.tracks.length === trackCountBefore + 1 || p2.tracks.length === trackCountBefore, 'track added or reused');
const bassTrack = p2.tracks.find(t => String(t.id || t.trackId) === String(trackRes.trackId));
assert(bassTrack, 'bass track should be present');
assert(String((bassTrack.name || '')).toLowerCase() === 'bass', 'track name should be Bass');
assert(typeof bassTrack.instrument === 'string' && bassTrack.instrument, 'track instrument should be set');

const bassClip = H2SProject.createClipFromScoreBeat(built.scoreBeat, {
  name: 'Bass',
  sourceTaskId: 'arrange:add_bass_v0',
});
p2.clips[bassClip.id] = bassClip;
p2.clipOrder.unshift(bassClip.id);
H2SProject.repairClipOrderV2(p2);
const bassInst = H2SProject.createInstanceV2(bassClip.id, melodyInst.startBeat, trackRes.trackId);
p2.instances.push(bassInst);
H2SProject.normalizeProjectV2(p2);

assert(Object.keys(p2.clips).length === clipCountBefore + 1, 'one new clip should be added');
assert(p2.instances.length === instanceCountBefore + 1, 'one new instance should be added');
assert(Number(bassInst.startBeat) === Number(melodyInst.startBeat), 'bass instance should align with melody startBeat');

assert(JSON.stringify(p2.clips[melodyClip.id].score) === melodyScoreBefore, 'melody clip score must remain unchanged');
assert(String(p2.clips[melodyClip.id].revisionId || '') === melodyRevisionBefore, 'melody revision must remain unchanged');

const bassHead = p2.clips[bassClip.id];
assert(typeof bassHead.revisionId === 'string' && bassHead.revisionId, 'bass clip must have revisionId');
assert(bassHead.parentRevisionId === null, 'new bass clip parentRevisionId should be null');
assert(bassHead.revisions && typeof bassHead.revisions === 'object', 'bass clip revisions map should exist');
assert(bassHead.revisions[bassHead.revisionId], 'bass clip head revision snapshot should exist');

const notes = bassHead.score.tracks[0].notes;
assert(Array.isArray(notes) && notes.length >= 1, 'bass notes must exist');
for (const n of notes){
  assert(typeof n.startBeat === 'number', 'startBeat must be number');
  assert(typeof n.durationBeat === 'number', 'durationBeat must be number');
  assert(!Object.prototype.hasOwnProperty.call(n, 'start'), 'legacy start must not exist');
  assert(!Object.prototype.hasOwnProperty.call(n, 'duration'), 'legacy duration must not exist');
}

const inv = H2SProject.checkProjectV2Invariants(p2);
assert(inv && inv.ok, 'project v2 invariants should hold');

const flat = H2SProject.flatten(p2);
const bassTrackFlat = (flat.tracks || []).find(tr => String(tr.trackId) === String(trackRes.trackId));
assert(bassTrackFlat && Array.isArray(bassTrackFlat.notes) && bassTrackFlat.notes.length >= 1, 'flatten should include bass notes');
assert(trackCountBefore >= 1, 'sanity');

console.log('PASS add_bass_v0.test.js');
