'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../static/pianoroll/cloud_boot.js'),'utf8');
function fixture(search) {
  const window={location:{search}}; vm.runInNewContext(source,{window,URLSearchParams}); return window;
}
for (const bindFirst of [false,true]) {
  const w=fixture('?cloudMode=1&hostSession=pending');let restored=0;
  const restore=()=>{assert.equal(w.H2S_CLOUD_HOST_SESSION_KEY,'user-existing');restored++;};
  if(bindFirst) w.H2SCloudBoot.bind('user-existing');
  w.H2SCloudBoot.run(restore);
  assert.equal(restored,bindFirst?1:0,'unverified boot must not access persisted projects');
  assert.equal(w.H2SCloudBoot.bind('pending'),false);
  assert.equal(w.H2SCloudBoot.bind('user-existing'),true);
  assert.equal(w.H2SCloudBoot.bind('user-other'),false,'cannot rebind a running frame');
  assert.equal(restored,1,'repeated handshake must not reset or reinitialize work');
}
for(const query of ['', '?cloudMode=1&hostSession=user-existing']){
 const w=fixture(query);let count=0;w.H2SCloudBoot.run(()=>count++);assert.equal(count,1,'standalone and previous hosts still boot');
}
console.log('cloud_boot: identity gate, ordering, duplicate bind and legacy host passed');

// A network failure can remove the bundle containing the gate while app.js still
// executes. Exercise the actual DOM-ready entrypoint: no initialization may read
// or clear a persisted project under the unverified "pending" identity.
const appSource=fs.readFileSync(require('node:path').join(__dirname,'../../static/pianoroll/app.js'),'utf8');
const bootSource=appSource.slice(appSource.indexOf('  function bootAppWhenDomReady(){'),appSource.lastIndexOf('  bootAppWhenDomReady();'));
for(const session of ['pending','user-existing','']){
 let initialized=0;
 vm.runInNewContext(bootSource+'\nbootAppWhenDomReady();',{
  window:{},document:{readyState:'complete'},setTimeout:fn=>fn(),
  _cloudHostSessionKeyFromLocation:()=>session,app:{init(){initialized++;}}
 });
 assert.equal(initialized,session==='pending'?0:1,'missing identity gate must fail closed');
}
console.log('cloud_boot: missing bundle cannot initialize or reset an unverified draft');
