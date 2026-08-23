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
runOne('scripts/tests/clip_thumbnail_math.test.js');
runOne('scripts/tests/waveform_peaks.test.js');
runOne('scripts/tests/audio_analysis_engine.test.js');
runOne('scripts/tests/audio_analysis_ui.test.js');
runOne('scripts/tests/audio_worker_analysis_client.test.js');
runOne('scripts/tests/audio_instrument_web.test.js');
runOne('scripts/tests/yamnet_preprocessing_golden.test.js');

runOne('scripts/tests/agent_patchsummary_smoke.test.js');
runOne('scripts/tests/velocity_shape.test.js');
runOne('scripts/tests/local_transpose.test.js');
runOne('scripts/tests/rhythm_tighten_loosen.test.js');
runOne('scripts/tests/phase1_assistant_precedence.test.js');
runOne('scripts/tests/phase1_assistant_fallback.test.js');
runOne('scripts/tests/phase1_deterministic_contract.test.js');
runOne('scripts/tests/phase1_freeze_e2e_smoke.test.js');
runOne('scripts/tests/llm_v0_optimize_hardening.test.js');
runOne('scripts/tests/editor_optimize_autoplay.test.js');
runOne('scripts/tests/regression_phaseB_invariants.test.js');
runOne('scripts/tests/regression_templates_directives.test.js');
runOne('scripts/tests/instrument_library_store.test.js');
runOne('scripts/tests/instrument_manifest.test.js');
runOne('scripts/tests/gm_drum_kit.test.js');
runOne('scripts/tests/i18n.test.js');
runOne('scripts/tests/commands.test.js');
runOne('scripts/tests/run_command_mvp.test.js');
runOne('scripts/tests/internal_skill_registry.test.js');
runOne('scripts/tests/cloud_parent_origins_runtime.test.js');
runOne('scripts/tests/cloud_embed_release_guard.test.js');
runOne('scripts/tests/cloud_ai_mode.test.js');
runOne('scripts/tests/cloud_ai_settings_drawer.test.js');
runOne('scripts/tests/studio_cloud_ai_runtime.test.js');
runOne('scripts/tests/studio_startup_perf.test.js');
runOne('scripts/tests/cloud_materials_panel.test.js');
runOne('scripts/tests/humming_music_mvp_contract.test.js');
runOne('scripts/tests/audio_convert_status.test.js');
runOne('scripts/tests/audio_convert_segment.test.js');
runOne('scripts/tests/audio_transcription_controls.test.js');
runOne('scripts/tests/audio_separation_v0.test.js');
runOne('scripts/tests/ui_audio_waveform_editor.test.js');
runOne('scripts/tests/dark_select_styling.test.js');
runOne('scripts/tests/ai_assist_dock.test.js');
runOne('scripts/tests/selection_sync.test.js');
runOne('scripts/tests/selection_instance_convert.test.js');
runOne('scripts/tests/arrangement_details_ui.test.js');
runOne('scripts/tests/add_bass_v0.test.js');
runOne('scripts/tests/arrangement_patch_v0.test.js');
runOne('scripts/tests/arrangement_quality_v0.test.js');
runOne('scripts/tests/arrangement_llm_v0.test.js');
runOne('scripts/tests/score_heuristic_split.test.js');
runOne('scripts/tests/score_bar_segment.test.js');
runOne('scripts/tests/score_trim_note_extent.test.js');
runOne('scripts/tests/score_segment_gap_max.test.js');

console.log('\nAll frontend tests (contracts + editor + numeric invariants + timeline) passed.');
