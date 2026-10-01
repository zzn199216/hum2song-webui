'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('static/pianoroll/core/audio_worker_advanced_stem_client.js','utf8');
async function run({statusTimeouts=0,resultTimeouts=0,failed=false,permanent=false,expired=false}={}){
 let now=0,creates=0,statuses=0,results=0;const updates=[];
 const base={isEnabled:()=>true,isCloudMode:()=>true,_requestHost:async(type,payload)=>{
  if(type==='H2S_CLOUD_ADVANCED_STEM_JOB_CREATE'){creates++;return{job:{id:'original-job',status:'running'},reused:true,costUnits:0};}
  assert.equal(payload.jobId,'original-job');
  if(type.endsWith('JOB_STATUS')){statuses++;if(permanent)throw Error('auth_required');if(statuses<=statusTimeouts){now+=expired?3600001:60000;throw Error('worker_timeout');}return{job:{status:failed?'failed':'succeeded',error:failed?{message:'provider_failed'}:null}};}
  if(type.endsWith('JOB_RESULT')){results++;if(results<=resultTimeouts){now+=120000;throw Error('worker_timeout');}return{manifest:{stems:[]},artifacts:[]};}
  throw Error('Unexpected operation');
 }};
 const sandbox={window:{H2SAudioWorkerConversionClient:base},Date:{now:()=>now},setTimeout:(fn,ms)=>{now+=ms;fn();},module:{exports:{}}};vm.runInNewContext(source,sandbox);
 let result,error;try{result=await sandbox.module.exports.separate({sourceAssetId:'source',durationSec:141.624,onStatus:s=>updates.push(s)});}catch(e){error=e.message;}
 return{result,error,creates,statuses,results,updates};
}
(async()=>{
 const resumed=await run({statusTimeouts:2,resultTimeouts:1});assert.equal(resumed.result.ok,true);assert.equal(resumed.creates,1);assert.equal(resumed.result.workerJobId,'original-job');assert.equal(resumed.result.reused,true);assert.equal(resumed.result.costUnits,0);assert.equal(resumed.statuses,3);assert.equal(resumed.results,2);assert.equal(resumed.updates.filter(s=>s.retrying).length,3);
 const failed=await run({failed:true});assert.equal(failed.error,'provider_failed');assert.equal(failed.results,0);
 const auth=await run({permanent:true});assert.equal(auth.error,'auth_required');assert.equal(auth.statuses,1);
 const expired=await run({statusTimeouts:1,expired:true});assert.equal(expired.error,'worker_timeout');assert.equal(expired.statuses,1);assert.equal(expired.creates,1);
 console.log('PASS advanced stem timeout recovery: same job, status/result retries, terminal failures, bounded deadline');
})().catch(e=>{console.error(e);process.exitCode=1;});
