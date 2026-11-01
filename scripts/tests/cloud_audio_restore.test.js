'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
function setup(available=true){
 const win=new EventTarget();let downloads=0,stored=0;
 Object.assign(win,{H2SApp:{_nativeAudioImportEpoch:0},I18N:{t:k=>k},H2SLocalAudioAssets:{
  getFileForLocalAssetRef:async ref=>ref==='localidb:exists'?new File(['existing'],'existing.wav'):null,
  storeImportedAudioFile:async(file,options)=>{stored++;assert.equal(options.sourceMetadata.cloudSourceAssetId,'owned-audio');return {assetRef:'localidb:restored'};}
 }});
 win.H2S_REQUEST_CLOUD_MATERIAL_CONTENT=id=>{
  downloads++;win.dispatchEvent(new CustomEvent('h2s-cloud-material-content',{detail:{id,ok:available,mimeType:'audio/wav',audioBuffer:new ArrayBuffer(8)}}));
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../static/pianoroll/cloud_materials_panel.js'),'utf8'),{
  window:win,document:{readyState:'loading',addEventListener(){}},File,Blob,ArrayBuffer,CustomEvent,setTimeout,clearTimeout,console
 });
 return {win,get downloads(){return downloads;},get stored(){return stored;}};
}
(async()=>{
 const s=setup(),doc={version:2,timebase:'beat',bpm:90,clips:{a:{id:'a',kind:'audio',name:'Song',audio:{assetRef:'localidb:missing',durationSec:3},meta:{cloudSourceAssetId:'owned-audio'}}},
  instances:[{id:'one',clipId:'a',startBeat:7,gainDb:-3,transpose:0}],tracks:[{id:'track'}]};
 const original=JSON.stringify({...doc,clips:{}});
 const restored=await s.win.H2S_RESTORE_CLOUD_AUDIO_REFERENCES(doc);
 assert.equal(restored.clips.a.audio.assetRef,'localidb:restored');assert.equal(s.downloads,1);assert.equal(s.stored,1);
 assert.equal(JSON.stringify({...restored,clips:{}}),original,'beat timing, tracks and placements are unchanged');
 restored.clips.a.audio.assetRef='localidb:exists';await s.win.H2S_RESTORE_CLOUD_AUDIO_REFERENCES(restored);assert.equal(s.downloads,1,'existing local audio is reused');
 const denied=setup(false);restored.clips.a.audio.assetRef='localidb:missing';
 await assert.rejects(()=>denied.win.H2S_RESTORE_CLOUD_AUDIO_REFERENCES(restored),/cloud_audio_unavailable/);assert.equal(denied.stored,0);
 assert.equal(restored.clips.a.audio.assetRef,'localidb:missing','an unavailable/foreign material is not substituted');
 console.log('PASS cloud audio recovery: missing/available/denied sources, immediate bridge response, exact timeline preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
