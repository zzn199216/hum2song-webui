#!/usr/bin/env node
/* Editor / Quick Optimize must not inherit stale AI Assistant PLAN fields (mirrors app.js getOptimizeOptions fallback). */
'use strict';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/** Mirrors App#getOptimizeOptions when clip has no per-clip row (must stay in sync with app.js). */
function getOptimizeOptionsFallbackLikeApp(clipId, optByClipId, lastOptimizeOptions) {
  if (clipId && optByClipId && optByClipId[clipId] != null) return optByClipId[clipId];
  const last = lastOptimizeOptions || null;
  if (!last) return null;
  if (!clipId) return last;
  const copy = Object.assign({}, last);
  delete copy.plan;
  delete copy._assistantExecutionPlanSnapshot;
  return copy;
}

(function testFallbackStripsPlanForNewClipId() {
  const last = {
    requestedPresetId: 'llm_v0',
    userPrompt: 'from clip A',
    intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true },
    templateId: 'clean_outliers_v1',
    plan: { planKind: 'clean-outliers', planTitle: 'A', planLines: ['Goal: leak.'] },
    _assistantExecutionPlanSnapshot: { planKind: 'clean-outliers', planTitle: 'A', planLines: ['Goal: leak.'] },
  };
  const out = getOptimizeOptionsFallbackLikeApp('clip-b-new', {}, last);
  assert(out.requestedPresetId === 'llm_v0', 'preset can still flow from last');
  assert(out.plan === undefined, 'plan must not leak via _lastOptimizeOptions fallback');
  assert(out._assistantExecutionPlanSnapshot === undefined, 'snapshot must not leak via fallback');
  console.log('PASS getOptimizeOptions fallback strips assistant plan for unknown clipId');
})();

(function testPerClipRowUnchanged() {
  const row = { requestedPresetId: 'llm_v0', plan: { planTitle: 'X', planLines: ['a'], planKind: 'generic' } };
  const out = getOptimizeOptionsFallbackLikeApp('clip-x', { 'clip-x': row }, { plan: { planTitle: 'Stale' } });
  assert(out === row && out.plan.planTitle === 'X', 'explicit per-clip map entry is returned verbatim');
  console.log('PASS per-clip optimize row not sanitized');
})();
