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
