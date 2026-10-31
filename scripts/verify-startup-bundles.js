'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(process.argv[2]);
const version=process.argv[3];
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const manifest=JSON.parse(read('STARTUP_BUNDLES.json'));
const html=read('static/pianoroll/index.html');
if(digest(html)!==manifest.htmlSha256)throw new Error('Bundled HTML mismatch');
if(!read('static/pianoroll/index.source.html').includes('app.js?v='+version))throw new Error('Unexpected source version');
for(const group of manifest.groups){
  const source=read(group.file);
  if(!html.includes('/'+group.file)||digest(source)!==group.sha256)throw new Error('Bundle integrity mismatch');
  new vm.Script(source);
  for(const file of group.sources)if(digest(read(file.slice(1)))!==group.sourceHashes[file])throw new Error('Stale bundled source: '+file);
}
for(const [file,entry] of Object.entries(manifest.resources?.files||{})) {
  if(digest(read(file))!==entry.sha256 || digest(read(entry.source))!==entry.sha256)throw new Error('Stale startup resource: '+file);
}
console.log('Verified startup HTML, script order manifest, bundles and all source hashes');
