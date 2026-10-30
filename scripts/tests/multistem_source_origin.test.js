'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
require('../../static/pianoroll/project.js');
const P = window.H2SProject;
const timeline = require('../../static/pianoroll/core/audio_separation_timeline.js');
window.H2SAudioSeparationTimeline = timeline;
const appSource = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/app.js'), 'utf8');
const start = appSource.indexOf('    async _convertSeparatedStem(');
const end = appSource.indexOf('    async convertAudioClipToEditable(', start);
const method = Function('return ({' + appSource.slice(start, end) + '})._convertSeparatedStem')();

async function main() {
  const manifest = { schemaVersion: 'h2s-multistem/v1', stems: [
    {stemId:'piano',category:'piano',presence:'candidate',audio:{artifactId:'p'}},
    {stemId:'guitar',category:'guitar',presence:'quiet',audio:{artifactId:'g'}}] };
  assert.deepEqual(timeline.timelineItems(manifest), [{stem:'piano',kind:'audio',artifactId:'p',stemId:'piano'}]);
  assert.equal(manifest.stems.length, 2, 'quiet artifact stays recoverable');
  const src = {jobId:'owned-separation',stemId:'piano',assetRef:'localidb:source'};
  let sent, materialized, trackIdentity;
  window.H2SAudioWorkerConversionClient = {convert: async options => {
    sent = options;
    return {ok:true,workerJobId:'midi',scoreDoc:{tempo_bpm:120,tracks:[{notes:[{pitch:60,start:4,duration:1,velocity:90}]}]}};
  }};
  const context = {
    project: {tracks:[{},{}],instances:[{id:'i',clipId:'c',startSec:7,trackIndex:0}]},
    _ensureAudioSeparationSourceInstance: () => 'i',
    _setSeparatedTrackIdentity:(index,stem)=>{trackIdentity={index,stem};},
    _setAudioConvertState:()=>{}, setImportStatus:()=>{}, _clearAudioConvertState:()=>{}, ensureTimelineTrackIndex:()=>{},
    getProjectV2:()=>({clips:{}}), setProjectFromV2:()=>{},
    _materializeScoreDocToTimeline:(score, options)=>{materialized={score,options};return {ok:true};},
  };
  assert.equal((await method.call(context,'c',src,{}, {startSec:2,durationSec:8}, {})).ok,true);
  assert.equal(sent.sourceStem,src, 'source reference is sent instead of a new recording');
  assert.equal(materialized.score.tracks[0].notes[0].start,2);
  assert.equal(materialized.options.placeStartSec,9);
  assert.equal(materialized.options.placeStartSec + materialized.score.tracks[0].notes[0].start,11, '7s source + 4s late piano');
  assert.equal(P.scoreSecToBeat(materialized.score,90).tracks[0].notes[0].startBeat,3, 'project BPM controls seconds to beats');
  for(const stem of ['drums','bass','guitar','piano']) {
    assert.equal((await method.call(context,'c',{...src,stemId:stem},{},{startSec:2,durationSec:8},{})).ok,true);
    assert.equal(trackIdentity.stem,stem,'MIDI uses canonical instrument identity before materialization');
    assert.equal(materialized.options.separationStem,stem,'MIDI stem metadata survives persistence');
  }
  sent=null;
  assert.equal((await method.call(context,'c',{...src,quiet:true},{},{},{})).reason,'stem_too_quiet');
  assert.equal((await method.call(context,'c',{...src,stemId:'instrumental'},{},{},{})).reason,'stem_audio_only');
  assert.equal(sent,null, 'audio-only tracks do not create paid tasks');
  const v2=P.migrateProjectV1toV2({version:1,bpm:120,tracks:[{id:'t'}],clips:[{id:'c',kind:'audio',audio:{assetRef:'localidb:source',durationSec:16},meta:{multistemSource:src}}],instances:[],ui:{}});
  assert.deepEqual(v2.clips.c.meta.multistemSource,src,'reloading/saving preserves routing');
  assert.equal(P.loadProjectDocV2(JSON.stringify(v2)).clips.c.meta.multistemSource.stemId,'piano');
  console.log('PASS multistem quiet folding, source routing, selected-range timing, project BPM and persistence');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
