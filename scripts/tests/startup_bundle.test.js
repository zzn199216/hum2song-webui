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
  const content=fs.readFileSync(path.join(output,group.file),'utf8'); let last=-1;
  for(const source of group.sources){const at=content.indexOf('/* '+source+' */');assert(at>last);last=at;}
}
assert.deepEqual(build(root,output),result,'same source creates identical content-hashed assets');
console.log('startup_bundle: execution order, inline configuration, watchdog isolation and deterministic hashes passed');
