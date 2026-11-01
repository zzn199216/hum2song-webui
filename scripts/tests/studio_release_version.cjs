'use strict';
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../static/pianoroll/studio_asset_version.js'),'utf8');
const match=source.match(/H2S_STUDIO_ASSET_VERSION\s*=\s*['"]([A-Za-z0-9._-]+)['"]/);
if(!match)throw Error('Studio must declare a nonempty safe asset cache version');
module.exports=match[1];
