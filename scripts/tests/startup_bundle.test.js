'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {build} = require('../build-startup-bundles');
const root = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'h2s-startup-bundle-'));
const result = build(root, output);
const html = fs.readFileSync(path.join(output,'static/pianoroll/index.html'),'utf8');
assert(result.scriptsBefore > 60 && result.scriptsAfter === 2);
assert(html.includes('/startup_ui.js?'), 'watchdog remains independent of runtime bundle');
assert(html.indexOf(result.groups[0].file) < html.indexOf('function localCloudParentOrigins()'));
assert(html.indexOf(result.groups[1].file) > html.indexOf('function localCloudParentOrigins()'), 'host config executes before app');
for (const group of result.groups) {
  const content=fs.readFileSync(path.join(output,group.file),'utf8');
  new (require('node:vm').Script)(content);
  assert(Buffer.byteLength(content)<group.rawBytes,'release assets must be minified');
}
assert.deepEqual(build(root,output),result,'same source creates identical content-hashed assets');
// Execute compiled scripts, including cross-file globals and the inline boundary.
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'h2s-bundle-order-'));
fs.mkdirSync(path.join(fixture,'static/pianoroll'),{recursive:true});
const files={a:'var sharedValue=3; globalThis.steps=[sharedValue];',b:'steps.push(++sharedValue);',c:'steps.push(hostValue+sharedValue);',d:'steps.push(sharedValue*2);'};
for(const [name,code] of Object.entries(files))fs.writeFileSync(path.join(fixture,'static',name+'.js'),code);
fs.writeFileSync(path.join(fixture,'static/pianoroll/index.html'),'<script src="/static/a.js"></script><script src="/static/b.js"></script><script>var hostValue=10;</script><script src="/static/c.js"></script><script src="/static/d.js"></script>');
const compiled=build(fixture,fixture),vm=require('node:vm'),ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(fixture,compiled.groups[0].file),'utf8'),ctx);
vm.runInContext('var hostValue=10;',ctx);
vm.runInContext(fs.readFileSync(path.join(fixture,compiled.groups[1].file),'utf8'),ctx);
assert.deepEqual(Array.from(ctx.steps),[3,4,14,8]);
console.log('startup_bundle: execution order, inline configuration, watchdog isolation and deterministic hashes passed');
