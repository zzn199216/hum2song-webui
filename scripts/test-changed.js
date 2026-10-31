'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const fullSuite='scripts/run_frontend_all_tests.js';
function plan(files,{release=false,full=false}={}){
 const relevant=files.filter(f=>! /^(docs\/|README|CHANGELOG|AGENTS\.md$|\.gitignore$|output\/|\.playwright-cli\/|ARTIFACT_MANIFEST)/.test(f)&&!f.endsWith('.baiduyun.uploading.cfg'));
 const selected=new Set(),external=new Set();
 for(const f of relevant){
  if(f==='scripts/test-changed.js'||f==='scripts/tests/test_changed.test.js'){selected.add('scripts/tests/test_changed.test.js');continue;}
  if(/^static\/i18n\/locales\/[^/]+\.json$/.test(f)){selected.add('scripts/tests/i18n.test.js');external.add('Browser: affected languages, labels/tooltips and layout.');continue;}
  if(/^static\/.*\.css$/.test(f)){selected.add('scripts/tests/dark_select_styling.test.js');external.add('Browser: affected layouts, controls and keyboard interactions.');continue;}
  if(/^scripts\/tests\/[^/]+\.test\.js$/.test(f)&&fs.existsSync(path.join(root,f))){selected.add(f);continue;}
  selected.add(fullSuite);external.add('Browser short fixture: affected flow, source timing, duplicate action, save and explicit cloud reload.');
  if(! /^(static\/|scripts\/run_frontend|scripts\/deploy\/)/.test(f))external.add('Unknown/backend path: review backend Python tests and runbook; frontend suite alone is not complete acceptance.');
 }
 if(full||(release&&relevant.length))selected.add(fullSuite);
 return {files:relevant,ignoredCount:files.length-relevant.length,tests:selected.has(fullSuite)?[fullSuite]:[...selected].sort(),externalChecks:[...external],externalStatus:external.size?'NOT_RUN':'not-required-by-path-policy'};
}
function changes(base){
 const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
 const revision=git(['rev-parse','--verify','--end-of-options',base+'^{commit}']).trim();
 return {base:revision,files:[...new Set([...git(['diff','--no-renames','--name-only','-z',revision,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort()};
}
function main(){
 const args=process.argv.slice(2),action=args.shift()||'plan';let base='HEAD',release=false,full=false;
 if(action==='--help'){console.log('node scripts/test-changed.js plan|run --base COMMIT [--release] [--full]\nNo model/server/provider requests. Release keeps the complete frontend suite.');return;}
 if(!['plan','run'].includes(action))throw Error('Unknown action '+action);
 while(args.length){const flag=args.shift();if(flag==='--base'){base=args.shift();if(!base)throw Error('--base requires a commit');}else if(flag==='--release')release=true;else if(flag==='--full')full=true;else throw Error('Unknown option '+flag);}
 const diff=changes(base),result={base:diff.base,...plan(diff.files,{release,full})};
 if(action==='plan'){console.log(JSON.stringify(result,null,2));return;}
 const folder=path.join(root,'.verification-cache');fs.mkdirSync(folder,{recursive:true});
 const report={...result,localStatus:'running',steps:[],startedAt:new Date().toISOString()};
 const save=()=>fs.writeFileSync(path.join(folder,'last-run.json'),JSON.stringify(report,null,2));save();
 for(const file of result.tests){const start=Date.now();const r=spawnSync(process.execPath,[file],{cwd:root,stdio:'inherit',windowsHide:true});report.steps.push({file,seconds:(Date.now()-start)/1000,status:r.status===0?'passed':'failed'});if(r.status!==0){report.localStatus='failed';save();throw Error('Check failed: '+file);}save();}
 report.localStatus='passed';save();console.log('[test-changed] Local checks passed; external checks: '+result.externalStatus);for(const gate of result.externalChecks)console.log('[manual] '+gate);
 if(!result.tests.length)console.log('No runtime checks selected. For committed work pass --base <reviewed/deployed commit>.');
}
module.exports={plan,changes};
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
