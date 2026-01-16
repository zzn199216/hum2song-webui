#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');

function runOne(script){
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if(r.status !== 0){
    process.exit(r.status || 1);
  }
}

runOne('scripts/run_frontend_contract_tests.js');
runOne('scripts/run_frontend_editor_contract_tests.js');

console.log('\nAll frontend tests (contracts + editor) passed.');
