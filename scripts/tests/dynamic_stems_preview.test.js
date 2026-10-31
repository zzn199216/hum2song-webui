'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const timeline=require('../../static/pianoroll/core/audio_separation_timeline.js');
for(const language of ['en','zh','ja']){
  const labels=JSON.parse(fs.readFileSync('static/i18n/locales/'+language+'.json','utf8'));
  for(const stem of Object.keys(timeline.STEM_LABELS)) assert.ok(labels['audio.stem.'+stem],language+': '+stem);
}
const stems=['violin','flute','accordion','harp','banjo','organ','marimba','other'].map(stem=>({stemId:stem,category:stem,presence:'candidate',audio:{artifactId:stem+'.mp3'},transcriptionSource:{artifactId:stem+'.flac'}}));
const items=timeline.timelineItems({schemaVersion:'h2s-multistem/v1',stems});
assert.equal(items.length,8);
assert.ok(items.every(item=>item.artifactId.endsWith('.mp3')),'browser never imports lossless transcription sources');
assert.equal(timeline.stemInstrument('violin'),'violin');
assert.equal(timeline.stemInstrument('flute'),'flute');

async function retryTest(permanent){
  let creates=0,statuses=0,results=0,downloads=0,now=0;
  const base={isEnabled:()=>true,isCloudMode:()=>true,_segmentToWavArrayBuffer:async()=>new ArrayBuffer(8),_requestHost:async(type)=>{
    if(type==='H2S_CLOUD_MULTISTEM_AVAILABILITY')return{enabled:true};
    if(type.endsWith('JOB_CREATE')){creates++;return{job:{id:'same-job'}};}
    if(type.endsWith('JOB_STATUS')){statuses++;if(permanent)throw Error('auth_required');if(statuses<3){now+=60000;throw Error('worker_timeout');}return{job:{status:'succeeded'}};}
    if(type.endsWith('JOB_RESULT')){results++;if(results<2)throw Error('worker_timeout');return{manifest:{stems},artifacts:[]};}
    if(type.endsWith('ARTIFACT')){downloads++;if(downloads<2)throw Error('network_error');return{artifactBuffer:new ArrayBuffer(8),mimeType:'audio/mpeg',filename:'violin.mp3'};}
    throw Error('Unexpected operation '+type);
  }};
  const box={window:{H2SAudioWorkerConversionClient:base},module:{exports:{}},ArrayBuffer,Date:{now:()=>now},setTimeout:(fn,ms)=>{now+=ms;fn();}};
  vm.runInNewContext(fs.readFileSync('static/pianoroll/core/audio_worker_separation_client.js','utf8'),box);
  const client=box.module.exports,options={file:{name:'test.wav',type:'audio/wav',arrayBuffer:async()=>new ArrayBuffer(8)},durationSec:16,separationIntent:'multitrack'};
  if(permanent){await assert.rejects(client.separate(options),/auth_required/);assert.equal(statuses,1);}
  else{assert.equal((await client.separate(options)).workerJobId,'same-job');assert.equal(statuses,3);assert.equal(results,2);assert.equal((await client.downloadArtifact('same-job','violin.mp3')).mimeType,'audio/mpeg');assert.equal(downloads,2);}
  assert.equal(creates,1,'read retries must never create or charge another task');
}
Promise.all([retryTest(false),retryTest(true)]).then(()=>console.log('PASS dynamic instruments, localized names, compressed previews and read-only timeout recovery')).catch(e=>{console.error(e);process.exitCode=1;});
