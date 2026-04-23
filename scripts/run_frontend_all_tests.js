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
runOne('scripts/tests/velocity_shape.test.js');
runOne('scripts/tests/local_transpose.test.js');
runOne('scripts/tests/rhythm_tighten_loosen.test.js');
runOne('scripts/tests/phase1_assistant_precedence.test.js');
runOne('scripts/tests/phase1_assistant_fallback.test.js');
runOne('scripts/tests/phase1_deterministic_contract.test.js');
runOne('scripts/tests/phase1_freeze_e2e_smoke.test.js');
runOne('scripts/tests/llm_v0_optimize_hardening.test.js');
runOne('scripts/tests/regression_phaseB_invariants.test.js');
runOne('scripts/tests/regression_templates_directives.test.js');
runOne('scripts/tests/instrument_library_store.test.js');
runOne('scripts/tests/i18n.test.js');
runOne('scripts/tests/commands.test.js');
runOne('scripts/tests/run_command_mvp.test.js');
runOne('scripts/tests/internal_skill_registry.test.js');
runOne('scripts/tests/ai_assist_dock.test.js');
runOne('scripts/tests/selection_sync.test.js');
runOne('scripts/tests/score_heuristic_split.test.js');
runOne('scripts/tests/score_bar_segment.test.js');
runOne('scripts/tests/score_trim_note_extent.test.js');
runOne('scripts/tests/score_segment_gap_max.test.js');

console.log('\nAll frontend tests (contracts + editor + numeric invariants + timeline) passed.');
