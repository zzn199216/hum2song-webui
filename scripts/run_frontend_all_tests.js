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
runOne('scripts/run_frontend_numeric_invariants_tests.js');
runOne('scripts/run_frontend_bpm_invariants_tests.js');
runOne('scripts/run_frontend_timeline_unit_tests.js');

runOne('scripts/tests/agent_patchsummary_smoke.test.js');
runOne('scripts/tests/regression_phaseB_invariants.test.js');
runOne('scripts/tests/regression_templates_directives.test.js');
runOne('scripts/tests/instrument_library_store.test.js');
runOne('scripts/tests/i18n.test.js');
runOne('scripts/tests/commands.test.js');
runOne('scripts/tests/ai_assist_dock.test.js');

console.log('\nAll frontend tests (contracts + editor + numeric invariants + timeline) passed.');
