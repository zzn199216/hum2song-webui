'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
global.window={};require('../../static/pianoroll/project.js');
const P=window.H2SProject,source=fs.readFileSync(require('path').join(__dirname,'../../static/pianoroll/app.js'),'utf8');
const begin=source.indexOf('    async _commitNativeAudioFile('),end=source.indexOf('    async importAudioFileAsNativeClip(',begin);
assert(begin>0&&end>begin);
function setup(){
 let project=P.defaultProjectV2(),stored=0,analysis;
 project.bpm=90;project.ui.playheadBeat=7;
 const app=vm.runInNewContext('({'+source.slice(begin,end)+'})',{window:{H2SProject:P,H2SLocalAudioAssets:{
  storeImportedAudioFile:async()=>({assetRef:'localidb:fixture-'+(++stored)})}},Blob,File,console,log(){},
  _isProjectV2:p=>p.version===2,_projectV1ToV2:()=>project});
 Object.assign(app,{state:{activeTrackIndex:0},getProjectV2:()=>project,setProjectFromV2:p=>{project=p;},setImportStatus(){},
  _analyzeAudioFileForTimeline:async()=>analysis?analysis():({durationSec:3,waveform:null})});
 return {app,get project(){return project;},get stored(){return stored;},delay(fn){analysis=fn;},reload(){project=P.normalizeProjectV2(JSON.parse(JSON.stringify(project)));}};
}
(async()=>{
 const fixture=new File(['fixture'],'Song.mp3',{type:'audio/mpeg'});
 const options={baseName:'My song',sourceMetadata:{cloudSourceAssetId:'owned-material'},deduplicateCloudSource:true};
 const s=setup();const first=await s.app._commitNativeAudioFile(fixture,options);
 assert(first.ok);assert.equal(s.project.instances.length,1);assert.equal(s.project.instances[0].startBeat,7);
 assert.equal(s.project.bpm,90);assert.equal(s.project.clips[first.clipId].name,'My song');
 s.reload();const replay=await s.app._commitNativeAudioFile(fixture,options);
 assert(replay.alreadyImported);assert.equal(s.project.instances.length,1);assert.equal(s.stored,1);
 const other=await s.app._commitNativeAudioFile(fixture,{...options,sourceMetadata:{cloudSourceAssetId:'another-material'}});
 assert(other.ok);assert.equal(s.project.instances.length,2);
 const interrupted=setup();let finish;
 interrupted.delay(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=interrupted.app._commitNativeAudioFile(fixture,options);
 interrupted.app._nativeAudioImportEpoch=1;finish({durationSec:3});
 assert.equal((await pending).reason,'session_changed');assert.equal(interrupted.stored,0);assert.equal(interrupted.project.instances.length,0);
 console.log('PASS direct cloud audio: native timing, name, persisted duplicate prevention and session change during decode');
})().catch(error=>{console.error(error);process.exitCode=1;});
