#!/usr/bin/env node
/* PR-UX7a: AI Assistant dock tests — Send behavior, card creation, Run => runCommand */
'use strict';

const path = require('path');

require(path.resolve(__dirname, '../../static/pianoroll/internal_action_registry.js'));
if (globalThis.window && globalThis.window.H2SInternalActionRegistry) {
  globalThis.H2SInternalActionRegistry = globalThis.window.H2SInternalActionRegistry;
}
require(path.resolve(__dirname, '../../static/pianoroll/internal_skill_registry.js'));
if (globalThis.window && globalThis.window.H2SInternalSkillRegistry) {
  globalThis.H2SInternalSkillRegistry = globalThis.window.H2SInternalSkillRegistry;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Stub I18N
const I18N = { t: (k) => { const m = { 'aiAssist.selectClipFirst': 'Select a clip first.', 'aiAssist.selectedClipStale': 'That clip is no longer in the project.', 'aiAssist.skillDisabled': 'That assistant action is unavailable.', 'aiAssist.addClipToTimelineRunning': 'Adding clip to timeline…', 'aiAssist.addClipToTimelineOk': 'Added clip to timeline.', 'aiAssist.addClipToTimelineFail': 'Could not add clip to timeline', 'aiAssist.addClipToTimelineTrackOutOfRange': 'Track {n} is out of range (1-{max}).', 'aiAssist.addTrackRunning': 'Adding track…', 'aiAssist.addTrackOk': 'Added track {n}.', 'aiAssist.addTrackFail': 'Could not add track', 'aiAssist.selectInstanceFirst': 'Select a timeline instance first.', 'aiAssist.moveInstanceStale': 'That instance is no longer in the project.', 'aiAssist.moveInstanceRunning': 'Moving instance…', 'aiAssist.moveInstanceFail': 'Could not move instance', 'aiAssist.moveInstanceOk': 'Moved {dir} by {delta} beats.', 'aiAssist.moveInstanceClamped': '(Start clamped to beat 0.)', 'aiAssist.removeInstanceConfirm': 'Remove ({name})?', 'aiAssist.removeInstanceCancelled': 'Remove cancelled.', 'aiAssist.removeInstanceRunning': 'Removing instance…', 'aiAssist.removeInstanceOk': 'Removed timeline instance.', 'aiAssist.removeInstanceFail': 'Could not remove instance', 'aiAssist.dirLeft': 'left', 'aiAssist.dirRight': 'right', 'aiAssist.run': 'Run', 'aiAssist.openOptimize': 'Open Optimize', 'aiAssist.undo': 'Undo', 'aiAssist.noClip': 'No clip selected', 'aiAssist.clipPrefix': 'Clip: ', 'aiAssist.trackPrefix': 'Track ' }; return m[k] || k; } };

// UX7b: Minimal INSPECTOR_TEMPLATES + mapper stub (matches app.js behavior)
const INSPECTOR_TEMPLATES = {
  fix_pitch_v1: { label: 'Fix Pitch', intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false } },
  tighten_rhythm_v1: { label: 'Tighten Rhythm', intent: { fixPitch: false, tightenRhythm: true, reduceOutliers: false } },
  clean_outliers_v1: { label: 'Clean Outliers', intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true } },
  bluesy_v1: { label: 'Bluesy', intent: { fixPitch: false, tightenRhythm: true, reduceOutliers: false } },
};
function mapAiAssistTextToTemplate(text) {
  if (!text || typeof text !== 'string') return { templateId: null, templateLabel: '', intent: null };
  const t = String(text).toLowerCase().trim();
  const rules = [
    { id: 'bluesy_v1', keywords: ['blues', 'bluesy', 'more blues', '蓝调'] },
    { id: 'fix_pitch_v1', keywords: ['pitch', 'out of tune', 'off pitch', '跑调', '音准', '音不准'] },
    { id: 'tighten_rhythm_v1', keywords: ['rhythm', 'tighter rhythm', 'timing', 'more steady', '节奏', '更稳', '紧一点'] },
    { id: 'clean_outliers_v1', keywords: ['outlier', 'weird notes', 'stray notes', 'noisy notes', '杂音', '异常音', '怪音'] },
  ];
  for (const r of rules) {
    for (const kw of r.keywords) {
      if (t.indexOf(kw) >= 0) {
        const tm = INSPECTOR_TEMPLATES[r.id];
        if (tm) {
          const intent = tm.intent && typeof tm.intent === 'object'
            ? { fixPitch: !!tm.intent.fixPitch, tightenRhythm: !!tm.intent.tightenRhythm, reduceOutliers: !!tm.intent.reduceOutliers }
            : null;
          return { templateId: r.id, templateLabel: tm.label || r.id, intent };
        }
      }
    }
  }
  return { templateId: null, templateLabel: '', intent: null };
}

/** Mirror static/pianoroll/app.js `_resolveAssistantAddClipToTimelineIntentFromText` (keep in sync). */
function resolveAssistantAddClipToTimelineIntentFromText(text) {
  if (!text || typeof text !== 'string') return null;
  let s = String(text).toLowerCase().trim();
  s = s.replace(/^please\s+/, '');
  s = s.replace(/\s+please\s*$/g, '').trim();
  s = s.replace(/[.!?]+$/g, '').trim();
  const phrases = [
    'add this clip',
    'insert this clip',
    'put this clip on the timeline',
  ];
  if (phrases.indexOf(s) >= 0) return { trackIndex: null, trackNumber: null };
  const m = s.match(/^(?:add|insert|put)\s+this\s+clip\s+(?:to|on)\s+track\s+([1-9]\d*)$/);
  if (!m) return null;
  const trackNumber = Number(m[1]);
  if (!isFinite(trackNumber) || trackNumber <= 0) return null;
  return { trackIndex: trackNumber - 1, trackNumber: trackNumber };
}

/** Mirror static/pianoroll/app.js `_resolveAssistantAddTrackIntentFromText` (keep in sync). */
function resolveAssistantAddTrackIntentFromText(text) {
  if (!text || typeof text !== 'string') return false;
  let s = String(text).toLowerCase().trim();
  s = s.replace(/^please\s+/, '');
  s = s.replace(/[.!?]+$/g, '').trim();
  const phrases = [
    'add a track',
    'add track',
    'create a new track',
    'create new track',
    'new track',
  ];
  return phrases.indexOf(s) >= 0;
}

/** Mirror static/pianoroll/app.js `_resolveAssistantMoveInstanceIntentFromText` (keep in sync). */
function resolveAssistantMoveInstanceIntentFromText(text) {
  if (!text || typeof text !== 'string') return null;
  let s = String(text).toLowerCase().trim();
  s = s.replace(/^please\s+/, '');
  s = s.replace(/\s+please\s*$/g, '').trim();
  s = s.replace(/[.!?]+$/g, '').trim();
  const re = /^move\s+(?:this|(?:the\s+)?selected\s+instance|(?:the\s+)?selected\s+block)\s+(left|right)\s+(\d+(?:\.\d+)?)\s*(?:beat|beats)?$/;
  const m = s.match(re);
  if (!m) return null;
  const dir = m[1];
  const num = Number(m[2]);
  if (!isFinite(num) || num <= 0) return null;
  const MAX_DELTA = 64;
  if (num > MAX_DELTA) return null;
  return { direction: (dir === 'left') ? 'left' : 'right', deltaBeats: num };
}

/** Mirror static/pianoroll/app.js `_resolveAssistantRemoveInstanceIntentFromText` (keep in sync). */
function resolveAssistantRemoveInstanceIntentFromText(text) {
  if (!text || typeof text !== 'string') return false;
  let s = String(text).toLowerCase().trim();
  s = s.replace(/^please\s+/, '');
  s = s.replace(/\s+please\s*$/g, '').trim();
  s = s.replace(/[.!?]+$/g, '').trim();
  const phrases = [
    'remove this',
    'delete this',
    'remove selected instance',
    'delete selected instance',
    'remove selected block',
    'delete selected block',
  ];
  return phrases.indexOf(s) >= 0;
}

function templateExecutionFieldsFromPlanKind(planKind) {
  if (planKind == null || typeof planKind !== 'string') return null;
  const k = String(planKind).trim().toLowerCase();
  if (k === 'generic' || k === '') return null;
  const idByKind = {
    'clean-outliers': 'clean_outliers_v1',
    'fix-pitch': 'fix_pitch_v1',
    'tighten-rhythm': 'tighten_rhythm_v1',
    bluesy: 'bluesy_v1',
  };
  const templateId = idByKind[k];
  if (!templateId) return null;
  const tm = INSPECTOR_TEMPLATES[templateId];
  if (!tm) return null;
  const intent = tm.intent && typeof tm.intent === 'object'
    ? { fixPitch: !!tm.intent.fixPitch, tightenRhythm: !!tm.intent.tightenRhythm, reduceOutliers: !!tm.intent.reduceOutliers }
    : null;
  if (!intent) return null;
  return { templateId, templateLabel: (tm.label != null && String(tm.label).trim()) ? String(tm.label).trim() : templateId, intent };
}

function syncAssistantCardTemplateFromPlan(card) {
  if (!card || typeof card !== 'object') return;
  const plan = card.plan;
  if (!plan || typeof plan !== 'object') return;
  const pk = (plan.planKind != null && String(plan.planKind).trim()) ? String(plan.planKind).trim() : '';
  if (!pk) return;
  const fields = templateExecutionFieldsFromPlanKind(plan.planKind);
  if (!fields || !fields.templateId || !fields.intent) return;
  if (card.templateId != null && String(card.templateId).trim() !== '') return;
  card.templateId = fields.templateId;
  card.templateLabel = fields.templateLabel;
  card.intent = fields.intent;
  if (card.reasoningLog && typeof card.reasoningLog === 'object') {
    card.reasoningLog.templateId = fields.templateId;
    card.reasoningLog.intent = { fixPitch: !!fields.intent.fixPitch, tightenRhythm: !!fields.intent.tightenRhythm, reduceOutliers: !!fields.intent.reduceOutliers };
  }
}

function _buildAiAssistPlan(templateId, intent, promptText) {
  const tid = (templateId != null && String(templateId).trim()) ? String(templateId).trim() : null;
  const plans = {
    fix_pitch_v1: { planTitle: 'Fix Pitch', planKind: 'fix-pitch', planLines: ['Goal: correct clearly out-of-tune notes.', 'Strategy: prioritize sustained notes; keep rhythm mostly stable.', 'Note: if the original humming is unstable, correction may be limited.'] },
    tighten_rhythm_v1: { planTitle: 'Tighten Rhythm', planKind: 'tighten-rhythm', planLines: ['Goal: align timing to a steadier groove.', 'Strategy: adjust note starts and durations; keep pitches unchanged.', 'Note: small timing tweaks preserve the feel.'] },
    clean_outliers_v1: { planTitle: 'Clean Outliers', planKind: 'clean-outliers', planLines: ['Goal: smooth extreme values and reduce stray notes.', 'Strategy: target velocity and short outliers without rewriting melody.', 'Note: preserves overall character while reducing noise.'] },
    bluesy_v1: { planTitle: 'Bluesy', planKind: 'bluesy', planLines: ['Goal: add subtle blues inflection to timing and dynamics.', 'Strategy: align to groove with blues feel; keep melody recognizable.', 'Note: small adjustments for a more expressive result.'] },
  };
  if (tid && plans[tid]) return plans[tid];
  return { planTitle: 'Optimize', planKind: 'generic', planLines: ['Goal: apply optimization based on your description.', 'Strategy: use your prompt to guide pitch, timing, or dynamics changes.', 'Note: results depend on the clarity of the source material.'] };
}

function _enrichReasoningLogFromRun(log, patchSummary, accepted, runState, resultKind, rejectionReason) {
  if (!log || typeof log !== 'object') return;
  log.runState = runState;
  log.resultKind = resultKind != null ? resultKind : null;
  log.accepted = !!accepted;
  if (rejectionReason != null && String(rejectionReason).trim()) log.rejectionReason = String(rejectionReason).trim().slice(0, 120);
  else log.rejectionReason = null;
  if (patchSummary && typeof patchSummary === 'object') {
    log.executedPreset = (patchSummary.executedPreset != null && String(patchSummary.executedPreset).trim()) ? String(patchSummary.executedPreset).trim() : null;
    log.executedSource = (patchSummary.executedSource != null && String(patchSummary.executedSource).trim()) ? String(patchSummary.executedSource).trim() : null;
    log.promptVersion = (patchSummary.promptMeta && patchSummary.promptMeta.promptVersion != null && String(patchSummary.promptMeta.promptVersion).trim()) ? String(patchSummary.promptMeta.promptVersion).trim() : null;
    log.patchSummary = { ops: typeof patchSummary.ops === 'number' ? patchSummary.ops : null, status: (patchSummary.status != null && String(patchSummary.status).trim()) ? String(patchSummary.status).trim() : null, reason: (patchSummary.reason != null && String(patchSummary.reason).trim()) ? String(patchSummary.reason).trim().slice(0, 80) : null };
  } else {
    log.executedPreset = null;
    log.executedSource = null;
    log.promptVersion = null;
    log.patchSummary = null;
  }
}

function _sanitizeLlmPromptTraceForAssistantTrace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const MAX = 24000;
  function trunc(s) {
    if (typeof s !== 'string') return '';
    return s.length > MAX ? s.slice(0, MAX) + '\n...[truncated]...' : s;
  }
  const out = {};
  if (raw.attemptIndex != null && isFinite(Number(raw.attemptIndex))) out.attemptIndex = Number(raw.attemptIndex);
  if (typeof raw.finalSystemPrompt === 'string') out.finalSystemPrompt = trunc(raw.finalSystemPrompt);
  if (typeof raw.finalUserPrompt === 'string') out.finalUserPrompt = trunc(raw.finalUserPrompt);
  if (raw.blocks && typeof raw.blocks === 'object') {
    const b = raw.blocks;
    const bo = {};
    if (b.resolvedTemplateId != null && String(b.resolvedTemplateId).trim()) bo.resolvedTemplateId = String(b.resolvedTemplateId).trim().slice(0, 80);
    else bo.resolvedTemplateId = null;
    if (b.resolvedIntent && typeof b.resolvedIntent === 'object') {
      bo.resolvedIntent = {
        fixPitch: !!b.resolvedIntent.fixPitch,
        tightenRhythm: !!b.resolvedIntent.tightenRhythm,
        reduceOutliers: !!b.resolvedIntent.reduceOutliers,
      };
    }
    if (b.promptVersion != null && String(b.promptVersion).trim()) bo.promptVersion = String(b.promptVersion).trim().slice(0, 80);
    if (typeof b.planBlock === 'string') bo.planBlock = trunc(b.planBlock);
    if (typeof b.directivesBlock === 'string') bo.directivesBlock = trunc(b.directivesBlock);
    if (typeof b.userBody === 'string') bo.userBody = trunc(b.userBody);
    out.blocks = bo;
  }
  if (!out.finalSystemPrompt && !out.finalUserPrompt && !out.blocks) return null;
  return out;
}

function _sanitizeLlmDebugForAssistantTrace(llmDebug) {
  if (!llmDebug || typeof llmDebug !== 'object') return null;
  const out = {};
  if (llmDebug.attemptCount != null && isFinite(Number(llmDebug.attemptCount))) out.attemptCount = Number(llmDebug.attemptCount);
  if (llmDebug.totalAttempts != null && isFinite(Number(llmDebug.totalAttempts))) out.totalAttempts = Number(llmDebug.totalAttempts);
  if (llmDebug.finalAttemptIndex != null && isFinite(Number(llmDebug.finalAttemptIndex))) out.finalAttemptIndex = Number(llmDebug.finalAttemptIndex);
  if (llmDebug.preRequestExit === true) out.preRequestExit = true;
  if (typeof llmDebug.safeModeResolved === 'boolean') out.safeModeResolved = llmDebug.safeModeResolved;
  if (llmDebug.reason != null && typeof llmDebug.reason === 'string') out.reason = llmDebug.reason.slice(0, 120);
  if (Array.isArray(llmDebug.errors) && llmDebug.errors.length) {
    const joined = llmDebug.errors.slice(0, 3).map(function (e) { return String(e).slice(0, 80); }).join(' | ');
    out.errorSummary = joined.length > 200 ? joined.slice(0, 197) + '...' : joined;
  }
  if (Array.isArray(llmDebug.attemptSummaries) && llmDebug.attemptSummaries.length) {
    out.attemptSummaries = llmDebug.attemptSummaries.slice(0, 4).map(function (row) {
      if (!row || typeof row !== 'object') return { attemptIndex: null, reason: '', outcome: null };
      return {
        attemptIndex: (row.attemptIndex != null && isFinite(Number(row.attemptIndex))) ? Number(row.attemptIndex) : null,
        reason: (row.reason != null && typeof row.reason === 'string') ? row.reason.slice(0, 120) : '',
        outcome: (row.outcome != null && typeof row.outcome === 'string') ? row.outcome.slice(0, 48) : null,
      };
    });
  }
  return Object.keys(out).length ? out : null;
}

function _compactPatchSummaryForExecutionTrace(ps) {
  if (!ps || typeof ps !== 'object') return null;
  const out = {};
  if (typeof ps.ops === 'number' && isFinite(ps.ops)) out.ops = ps.ops;
  if (ps.status != null && String(ps.status).trim()) out.status = String(ps.status).trim().slice(0, 40);
  if (ps.reason != null && String(ps.reason).trim()) out.reason = String(ps.reason).trim().slice(0, 80);
  if (ps.noChanges === true) out.noChanges = true;
  return Object.keys(out).length ? out : null;
}

function _normalizeAssistantPlanForExecution(plan) {
  if (!plan || typeof plan !== 'object') return null;
  if (!Array.isArray(plan.planLines) || plan.planLines.length < 1) return null;
  if (!plan.planTitle && !plan.planKind) return null;
  const lines = plan.planLines.slice(0, 6).map(function (l) {
    return (typeof l === 'string') ? l : (l != null ? String(l) : '');
  }).filter(function (l) { return typeof l === 'string' && l.trim(); });
  if (lines.length < 1) return null;
  return {
    planKind: plan.planKind || null,
    planTitle: (plan.planTitle != null && String(plan.planTitle).trim()) ? String(plan.planTitle).trim() : '',
    planLines: lines,
  };
}

/** Mirrors agent_controller buildPlanBlock for PLAN string assertions. */
function buildPlanBlockForTest(plan) {
  if (!plan || typeof plan !== 'object') return '';
  const lines = Array.isArray(plan.planLines) ? plan.planLines.filter(function (l) { return typeof l === 'string' && l.trim(); }) : [];
  if (lines.length < 1) return '';
  const kind = (plan.planKind != null && String(plan.planKind).trim()) ? String(plan.planKind).trim() : '';
  const title = (plan.planTitle != null && String(plan.planTitle).trim()) ? String(plan.planTitle).trim() : '';
  const header = (kind || title) ? ('PLAN: ' + (title || kind)) : 'PLAN:';
  return header + '\n' + lines.slice(0, 6).map(function (l) { return '- ' + String(l).trim().slice(0, 120); }).join('\n');
}

/** Mirrors app setOptimizeOptions plan resolution (Assistant snapshot carry-forward + merge). */
function mergePlanForSetOptimizeOptionsLikeApp(opts, existingOpts) {
  const rawPlan = opts && opts.plan;
  let assistantExecutionPlanSnapshot;
  if (!opts || !Object.prototype.hasOwnProperty.call(opts, '_assistantExecutionPlanSnapshot')) {
    assistantExecutionPlanSnapshot = existingOpts && existingOpts._assistantExecutionPlanSnapshot;
  } else {
    assistantExecutionPlanSnapshot = opts._assistantExecutionPlanSnapshot;
  }
  let plan = null;
  if (assistantExecutionPlanSnapshot != null && typeof assistantExecutionPlanSnapshot === 'object') {
    plan = _normalizeAssistantPlanForExecution(assistantExecutionPlanSnapshot);
  } else {
    plan = (rawPlan && typeof rawPlan === 'object' && Array.isArray(rawPlan.planLines) && rawPlan.planLines.length >= 1 && (rawPlan.planTitle || rawPlan.planKind))
      ? { planKind: rawPlan.planKind || null, planTitle: (rawPlan.planTitle && String(rawPlan.planTitle).trim()) ? String(rawPlan.planTitle).trim() : '', planLines: rawPlan.planLines.slice(0, 6).filter(function (l) { return typeof l === 'string'; }) }
      : (existingOpts && existingOpts.plan && typeof existingOpts.plan === 'object') ? existingOpts.plan : null;
  }
  return plan || null;
}

/** Mirrors app optimizeClip merge of stored + optOverride (intent from override only). */
function resolveOptimizeClipOptionsLikeApp(stored, optOverride) {
  if (!optOverride || typeof optOverride !== 'object') return optOverride;
  const merged = {};
  if (stored && typeof stored === 'object') {
    for (const k in stored) {
      if (Object.prototype.hasOwnProperty.call(stored, k)) merged[k] = stored[k];
    }
  }
  for (const k in optOverride) {
    if (Object.prototype.hasOwnProperty.call(optOverride, k) && optOverride[k] !== undefined) {
      merged[k] = optOverride[k];
    }
  }
  const preset = merged.requestedPresetId != null ? merged.requestedPresetId : merged.presetId != null ? merged.presetId : merged.preset;
  const intent = optOverride.intent && typeof optOverride.intent === 'object'
    ? { fixPitch: !!optOverride.intent.fixPitch, tightenRhythm: !!optOverride.intent.tightenRhythm, reduceOutliers: !!optOverride.intent.reduceOutliers }
    : { fixPitch: false, tightenRhythm: false, reduceOutliers: false };
  const out = {
    requestedPresetId: (preset != null && preset !== '') ? String(preset) : null,
    userPrompt: merged.userPrompt != null ? merged.userPrompt : null,
    intent,
  };
  if (merged.templateId != null && String(merged.templateId).trim()) {
    out.templateId = String(merged.templateId).trim();
  }
  if (merged.plan && typeof merged.plan === 'object') {
    out.plan = merged.plan;
  }
  if (Object.prototype.hasOwnProperty.call(merged, '_assistantExecutionPlanSnapshot')) {
    out._assistantExecutionPlanSnapshot = merged._assistantExecutionPlanSnapshot;
  }
  return out;
}

function _buildAssistantRunExecutionSnapshot(card) {
  const usedRequestedPresetId = 'llm_v0';
  const usedPlan = _normalizeAssistantPlanForExecution(card && card.plan && typeof card.plan === 'object' ? card.plan : null);
  let usedTemplateId = (card && card.templateId != null && String(card.templateId).trim()) ? String(card.templateId).trim() : null;
  let usedIntent = null;
  if (card && card.intent && typeof card.intent === 'object') {
    usedIntent = {
      fixPitch: !!card.intent.fixPitch,
      tightenRhythm: !!card.intent.tightenRhythm,
      reduceOutliers: !!card.intent.reduceOutliers,
    };
  }
  if (!usedTemplateId || !usedIntent) {
    usedTemplateId = null;
    usedIntent = null;
  }
  return {
    usedRequestedPresetId: usedRequestedPresetId,
    usedPlan: usedPlan,
    usedTemplateId: usedTemplateId,
    usedIntent: usedIntent,
  };
}

function _buildAiAssistExecutionTrace(card, optRes, runSnapshot) {
  const trace = {};
  const rl = card && card.reasoningLog && typeof card.reasoningLog === 'object' ? card.reasoningLog : null;
  try {
    if (optRes && typeof optRes === 'object' && optRes.executionPath != null && String(optRes.executionPath).trim() !== '') {
      trace.executionPath = String(optRes.executionPath).trim();
    }
    if (runSnapshot && typeof runSnapshot === 'object') {
      if (runSnapshot.usedTemplateId != null && String(runSnapshot.usedTemplateId).trim() !== '') {
        trace.templateId = String(runSnapshot.usedTemplateId).trim();
      }
      if (runSnapshot.usedIntent && typeof runSnapshot.usedIntent === 'object') {
        trace.intent = {
          fixPitch: !!runSnapshot.usedIntent.fixPitch,
          tightenRhythm: !!runSnapshot.usedIntent.tightenRhythm,
          reduceOutliers: !!runSnapshot.usedIntent.reduceOutliers,
        };
      }
      if (runSnapshot.usedRequestedPresetId != null) trace.requestedPresetId = runSnapshot.usedRequestedPresetId;
      if (runSnapshot.usedPlan && runSnapshot.usedPlan.planTitle) {
        trace.planSummary = String(runSnapshot.usedPlan.planTitle).slice(0, 200);
      }
      trace.executionSnapshot = {
        usedPlan: runSnapshot.usedPlan,
        usedTemplateId: runSnapshot.usedTemplateId,
        usedIntent: runSnapshot.usedIntent ? {
          fixPitch: !!runSnapshot.usedIntent.fixPitch,
          tightenRhythm: !!runSnapshot.usedIntent.tightenRhythm,
          reduceOutliers: !!runSnapshot.usedIntent.reduceOutliers,
        } : null,
        usedRequestedPresetId: runSnapshot.usedRequestedPresetId,
      };
    } else {
      if (card && card.templateId != null && String(card.templateId).trim() !== '') trace.templateId = String(card.templateId).trim();
      if (card && card.intent && typeof card.intent === 'object') {
        trace.intent = { fixPitch: !!card.intent.fixPitch, tightenRhythm: !!card.intent.tightenRhythm, reduceOutliers: !!card.intent.reduceOutliers };
      }
      if (rl && rl.planSummary != null) trace.planSummary = String(rl.planSummary).slice(0, 200);
      if (rl && rl.requestedPresetId != null) trace.requestedPresetId = rl.requestedPresetId;
    }
    if (!trace.planSummary && rl && rl.planSummary != null) trace.planSummary = String(rl.planSummary).slice(0, 200);
    if (!trace.requestedPresetId && rl && rl.requestedPresetId != null) trace.requestedPresetId = rl.requestedPresetId;
    const ps = (optRes && optRes.patchSummary && typeof optRes.patchSummary === 'object') ? optRes.patchSummary : null;
    if (ps) {
      if (ps.executedPreset != null) trace.executedPreset = String(ps.executedPreset).trim();
      if (ps.executedSource != null) trace.executedSource = String(ps.executedSource).trim();
      if (ps.promptMeta && ps.promptMeta.promptVersion != null) trace.promptVersion = String(ps.promptMeta.promptVersion).trim();
    }
    if (!trace.promptVersion && rl && rl.promptVersion != null && String(rl.promptVersion).trim() !== '') {
      trace.promptVersion = String(rl.promptVersion).trim();
    }
    trace.patchSummary = _compactPatchSummaryForExecutionTrace(ps);
    if (rl && typeof rl.accepted === 'boolean') trace.accepted = rl.accepted;
    if (rl && rl.runState != null && String(rl.runState).trim() !== '') trace.runState = String(rl.runState).trim();
    if (rl && rl.resultKind != null) trace.resultKind = rl.resultKind;
    if (rl && rl.rejectionReason != null && String(rl.rejectionReason).trim()) trace.rejectionReason = String(rl.rejectionReason).trim().slice(0, 120);
    if (optRes && optRes.llmDebug) {
      const s = _sanitizeLlmDebugForAssistantTrace(optRes.llmDebug);
      if (s) trace.llmDebugSummary = s;
    }
    if (optRes && optRes.executionPath === 'llm' && optRes.llmPromptTrace) {
      const pt = _sanitizeLlmPromptTraceForAssistantTrace(optRes.llmPromptTrace);
      if (pt) trace.llmPromptTrace = pt;
    }
  } catch (_e) { /* keep partial trace */ }
  return trace;
}

if (typeof globalThis.window === 'undefined') globalThis.window = {};
globalThis.window.I18N = I18N;

// Minimal DOM for dock
function createStubElement(id) {
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    placeholder: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    style: {},
    addEventListener: () => {},
    getAttribute: (a) => (a === 'data-act' ? el._dataAct : a === 'data-clip-id' ? el._dataClipId : a === 'data-prompt' ? el._dataPrompt : null),
    setAttribute: () => {},
    disabled: false,
    _dataAct: null,
    _dataClipId: null,
    _dataPrompt: null,
  };
  return el;
}

function createStubDocument() {
  const els = {};
  ['aiAssistDock', 'aiAssistHeader', 'aiAssistBody', 'aiAssistMessages', 'aiAssistInput', 'aiAssistSend'].forEach(id => {
    els[id] = createStubElement(id);
  });
  return {
    getElementById: (id) => els[id] || null,
    createElement: () => createStubElement(''),
    addEventListener: () => {},
  };
}

// Minimal APP implementing AI assist dock behavior
// opts.tryGenerateAiPlan: (text, templateId, intent) => Promise<plan|null> — PR1: injectable for tests
function createFakeApp(opts) {
  opts = opts || {};
  const tryGenerateAiPlan = opts.tryGenerateAiPlan || (() => Promise.resolve(null));
  const confirmImpl = (typeof opts.confirmImpl === 'function') ? opts.confirmImpl : function () { return true; };
  const doc = createStubDocument();
  const setOptimizeOptionsCalls = [];
  const runCommandCalls = [];
  const app = {
    state: { selectedClipId: null, selectedInstanceId: null },
    project: { bpm: 120, clips: [{ id: 'clip-1', name: 'Test Clip', parentRevisionId: 'rev-0' }], instances: [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }], tracks: [{ id: 'tr0' }] },
    _aiAssistItems: [],
    _aiAssistBound: false,
    setOptimizeOptions(cid, opts) {
      setOptimizeOptionsCalls.push({ clipId: cid, opts });
    },
    runCommand(cmd, payload) {
      runCommandCalls.push({ command: cmd, payload: payload || {} });
      const cid = payload && payload.clipId;
      if (cmd === 'optimize_clip') {
        return Promise.resolve({
          ok: true,
          data: {
            clipId: cid,
            optimizeResult: { ok: true, ops: 1, executionPath: 'llm', patchSummary: { executedPreset: 'llm_v0', executedSource: 'llm_v0' } },
          },
        });
      }
      if (cmd === 'rollback_clip') {
        return Promise.resolve({
          ok: true,
          data: { clipId: cid, rollbackResult: { ok: true, changed: true } },
        });
      }
      if (cmd === 'add_clip_to_timeline') {
        return Promise.resolve({ ok: true, data: { clipId: payload.clipId } });
      }
      if (cmd === 'add_track') {
        return Promise.resolve({ ok: true, data: { trackIndex: 2, trackId: 't-new' } });
      }
      if (cmd === 'move_instance') {
        return Promise.resolve({ ok: true, data: { instanceId: payload.instanceId, startBeat: payload.startBeat } });
      }
      if (cmd === 'remove_instance') {
        return Promise.resolve({ ok: true, data: { instanceId: payload.instanceId } });
      }
      return Promise.resolve({ ok: true });
    },
    getProjectV2() {
      return { clips: { 'clip-1': { name: 'Test Clip', parentRevisionId: 'rev-0' } } };
    },
    render: () => {},
  };
  app._t = I18N.t.bind(I18N);
  function _getInternalSkillRegistry() {
    return (typeof globalThis !== 'undefined' && globalThis.H2SInternalSkillRegistry) ? globalThis.H2SInternalSkillRegistry : null;
  }
  function _isAssistantBoundedSkillEnabled(commandId) {
    const R = _getInternalSkillRegistry();
    if (!R || typeof R.isAssistantSkillEnabled !== 'function') return true;
    return R.isAssistantSkillEnabled(commandId);
  }
  function _assistantSkillDisabledKey(commandId) {
    const R = _getInternalSkillRegistry();
    const sk = R && R.getSkill ? R.getSkill(commandId) : null;
    return (sk && sk.i18n && sk.i18n.skillDisabled) ? sk.i18n.skillDisabled : 'aiAssist.skillDisabled';
  }
  function _assistantSkillI18nAddClipToTimeline() {
    const R = _getInternalSkillRegistry();
    const sk = R && R.getSkill ? R.getSkill('add_clip_to_timeline') : null;
    return (sk && sk.i18n) ? sk.i18n : { running: 'aiAssist.addClipToTimelineRunning', ok: 'aiAssist.addClipToTimelineOk', fail: 'aiAssist.addClipToTimelineFail', skillDisabled: 'aiAssist.skillDisabled' };
  }
  function _assistantSkillI18nAddTrack() {
    const R = _getInternalSkillRegistry();
    const sk = R && R.getSkill ? R.getSkill('add_track') : null;
    return (sk && sk.i18n) ? sk.i18n : { running: 'aiAssist.addTrackRunning', ok: 'aiAssist.addTrackOk', fail: 'aiAssist.addTrackFail', skillDisabled: 'aiAssist.skillDisabled' };
  }
  function _assistantSkillI18nMoveInstance() {
    const R = _getInternalSkillRegistry();
    const sk = R && R.getSkill ? R.getSkill('move_instance') : null;
    return (sk && sk.i18n) ? sk.i18n : { running: 'aiAssist.moveInstanceRunning', ok: 'aiAssist.moveInstanceOk', fail: 'aiAssist.moveInstanceFail', clamp: 'aiAssist.moveInstanceClamped', dirLeft: 'aiAssist.dirLeft', dirRight: 'aiAssist.dirRight', skillDisabled: 'aiAssist.skillDisabled' };
  }
  function _assistantSkillI18nRemoveInstance() {
    const R = _getInternalSkillRegistry();
    const sk = R && R.getSkill ? R.getSkill('remove_instance') : null;
    return (sk && sk.i18n) ? sk.i18n : { running: 'aiAssist.removeInstanceRunning', ok: 'aiAssist.removeInstanceOk', fail: 'aiAssist.removeInstanceFail', skillDisabled: 'aiAssist.skillDisabled' };
  }
  /** Mirror static/pianoroll/app.js bounded dispatch (phraseResolverId → resolver; same order). */
  const ASSISTANT_BOUNDED_SKILL_ORDER = Object.freeze(['add_clip_to_timeline', 'add_track', 'move_instance', 'remove_instance']);
  const ASSISTANT_BOUNDED_RESOLVER_BY_PHRASE_ID = Object.freeze({
    assistant_add_clip_to_timeline_v1: resolveAssistantAddClipToTimelineIntentFromText,
    assistant_add_track_v1: resolveAssistantAddTrackIntentFromText,
    assistant_move_instance_v1: resolveAssistantMoveInstanceIntentFromText,
    assistant_remove_instance_v1: resolveAssistantRemoveInstanceIntentFromText,
  });
  const ASSISTANT_BOUNDED_PHRASE_ID_FALLBACK = Object.freeze({
    add_clip_to_timeline: 'assistant_add_clip_to_timeline_v1',
    add_track: 'assistant_add_track_v1',
    move_instance: 'assistant_move_instance_v1',
    remove_instance: 'assistant_remove_instance_v1',
  });
  function _tryAssistantBoundedSkillDispatchMirror(self, text, _t) {
    const R = _getInternalSkillRegistry();
    for (let si = 0; si < ASSISTANT_BOUNDED_SKILL_ORDER.length; si++) {
      const skillId = ASSISTANT_BOUNDED_SKILL_ORDER[si];
      const sk = R && R.getSkill ? R.getSkill(skillId) : null;
      const phraseId = (sk && sk.phraseResolverId) ? sk.phraseResolverId : ASSISTANT_BOUNDED_PHRASE_ID_FALLBACK[skillId];
      if (!phraseId) continue;
      const resolveFn = ASSISTANT_BOUNDED_RESOLVER_BY_PHRASE_ID[phraseId];
      if (typeof resolveFn !== 'function') continue;
      let moveIntent = null;
      let addClipIntent = null;
      if (skillId === 'move_instance') {
        moveIntent = resolveFn(text);
        if (!moveIntent) continue;
      } else if (skillId === 'add_clip_to_timeline') {
        addClipIntent = resolveFn(text);
        if (!addClipIntent) continue;
      } else {
        if (!resolveFn(text)) continue;
      }
      if (!_isAssistantBoundedSkillEnabled(skillId)) {
        self._aiAssistItems = self._aiAssistItems || [];
        self._aiAssistItems.push({ type: 'sys', text: _t(_assistantSkillDisabledKey(skillId)) });
        self.render();
        return Promise.resolve();
      }
      if (skillId === 'add_clip_to_timeline') {
        const kiAc = _assistantSkillI18nAddClipToTimeline();
        self._aiAssistItems = self._aiAssistItems || [];
        const clipIdSel = self.state && self.state.selectedClipId;
        if (!clipIdSel) {
          self._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.selectClipFirst') });
          self.render();
          return Promise.resolve();
        }
        const clipOk = (self.project.clips || []).some(function (c) { return c && c.id === clipIdSel; });
        if (!clipOk) {
          self._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.selectedClipStale') });
          self.render();
          return Promise.resolve();
        }
        const cmdPayload = { clipId: clipIdSel };
        if (addClipIntent && addClipIntent.trackIndex != null) {
          const tiReq = Number(addClipIntent.trackIndex);
          const trackCount = Array.isArray(self.project && self.project.tracks) ? self.project.tracks.length : 0;
          if (!isFinite(tiReq) || tiReq < 0 || Math.floor(tiReq) !== tiReq || tiReq >= trackCount) {
            const reqNum = Number.isFinite(Number(addClipIntent.trackNumber)) ? Math.round(Number(addClipIntent.trackNumber)) : (tiReq + 1);
            const maxNum = Math.max(0, trackCount);
            self._aiAssistItems.push({
              type: 'sys',
              text: _t('aiAssist.addClipToTimelineTrackOutOfRange').replace(/\{n\}/g, String(reqNum)).replace(/\{max\}/g, String(maxNum)),
            });
            self.render();
            return Promise.resolve();
          }
          cmdPayload.trackIndex = tiReq;
        }
        const pendingAc = { type: 'sys', text: _t(kiAc.running), _pendingAddClipToTimeline: true };
        self._aiAssistItems.push(pendingAc);
        self.render();
        return Promise.resolve(self.runCommand('add_clip_to_timeline', cmdPayload)).then(function (res) {
          const idx = (self._aiAssistItems || []).indexOf(pendingAc);
          if (idx >= 0) {
            if (res && res.ok) {
              self._aiAssistItems[idx] = { type: 'sys', text: _t(kiAc.ok) };
            } else {
              const msg = (res && res.message) ? String(res.message).slice(0, 120) : '';
              self._aiAssistItems[idx] = { type: 'sys', text: _t(kiAc.fail) + (msg ? ': ' + msg : '') };
            }
          }
          self.render();
        });
      }
      if (skillId === 'add_track') {
        const kiAdd = _assistantSkillI18nAddTrack();
        self._aiAssistItems = self._aiAssistItems || [];
        const pending = { type: 'sys', text: _t(kiAdd.running), _pendingAddTrack: true };
        self._aiAssistItems.push(pending);
        self.render();
        return Promise.resolve(self.runCommand('add_track', {})).then(function (res) {
          const idx = (self._aiAssistItems || []).indexOf(pending);
          if (idx >= 0) {
            if (res && res.ok) {
              const d = res.data || {};
              const ti = (typeof d.trackIndex === 'number' && isFinite(d.trackIndex)) ? d.trackIndex : null;
              const num = (ti != null) ? String(ti + 1) : '?';
              self._aiAssistItems[idx] = { type: 'sys', text: _t(kiAdd.ok).replace(/\{n\}/g, num) };
            } else {
              const msg = (res && res.message) ? String(res.message).slice(0, 120) : '';
              self._aiAssistItems[idx] = { type: 'sys', text: _t(kiAdd.fail) + (msg ? ': ' + msg : '') };
            }
          }
          self.render();
        });
      }
      if (skillId === 'move_instance') {
        const kiMv = _assistantSkillI18nMoveInstance();
        self._aiAssistItems = self._aiAssistItems || [];
        if (!self.state.selectedInstanceId) {
          self._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.selectInstanceFirst') });
          self.render();
          return Promise.resolve();
        }
        const instId = self.state.selectedInstanceId;
        const inst = (self.project.instances || []).find(function (x) { return x && x.id === instId; });
        if (!inst) {
          self._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.moveInstanceStale') });
          self.render();
          return Promise.resolve();
        }
        const bpm = (self.project && self.project.bpm) || 120;
        const curBeat = (Number(inst.startSec) || 0) * bpm / 60;
        const delta = (moveIntent.direction === 'right') ? moveIntent.deltaBeats : -moveIntent.deltaBeats;
        const rawNext = curBeat + delta;
        const clamped = rawNext < 0;
        let nextBeat = clamped ? 0 : rawNext;
        const pending = { type: 'sys', text: _t(kiMv.running), _pendingMoveInstance: true };
        self._aiAssistItems.push(pending);
        self.render();
        const dirWord = _t(moveIntent.direction === 'left' ? kiMv.dirLeft : kiMv.dirRight);
        return Promise.resolve(self.runCommand('move_instance', { instanceId: inst.id, startBeat: nextBeat })).then(function (res) {
          const idx = (self._aiAssistItems || []).indexOf(pending);
          if (idx >= 0) {
            if (res && res.ok) {
              let msg = _t(kiMv.ok).replace(/\{dir\}/g, dirWord).replace(/\{delta\}/g, String(moveIntent.deltaBeats));
              if (clamped) msg += ' ' + _t(kiMv.clamp);
              self._aiAssistItems[idx] = { type: 'sys', text: msg };
            } else {
              const errMsg = (res && res.message) ? String(res.message).slice(0, 120) : '';
              self._aiAssistItems[idx] = { type: 'sys', text: _t(kiMv.fail) + (errMsg ? ': ' + errMsg : '') };
            }
          }
          self.render();
        });
      }
      if (skillId === 'remove_instance') {
        self._aiAssistItems = self._aiAssistItems || [];
        if (!self.state.selectedInstanceId) {
          self._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.selectInstanceFirst') });
          self.render();
          return Promise.resolve();
        }
        const instIdRm = self.state.selectedInstanceId;
        const instRm = (self.project.instances || []).find(function (x) { return x && x.id === instIdRm; });
        if (!instRm) {
          self._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.moveInstanceStale') });
          self.render();
          return Promise.resolve();
        }
        const clipRm = (self.project.clips || []).find(function (c) { return c && c.id === instRm.clipId; });
        const confirmLabel = (clipRm && clipRm.name) ? String(clipRm.name).slice(0, 80) : String(instRm.clipId || instIdRm).slice(0, 80);
        const confirmMsg = _t('aiAssist.removeInstanceConfirm').replace(/\{name\}/g, confirmLabel);
        const ActReg = (typeof globalThis !== 'undefined' && globalThis.H2SInternalActionRegistry) ? globalThis.H2SInternalActionRegistry : null;
        const needAssistantConfirm = (!ActReg || typeof ActReg.requiresAssistantConfirmBeforeRun !== 'function')
          ? true
          : ActReg.requiresAssistantConfirmBeforeRun('remove_instance');
        if (needAssistantConfirm && !confirmImpl(confirmMsg)) {
          self._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.removeInstanceCancelled') });
          self.render();
          return Promise.resolve();
        }
        const kiRm = _assistantSkillI18nRemoveInstance();
        const pendingRm = { type: 'sys', text: _t(kiRm.running), _pendingRemoveInstance: true };
        self._aiAssistItems.push(pendingRm);
        self.render();
        return Promise.resolve(self.runCommand('remove_instance', { instanceId: instIdRm })).then(function (res) {
          const idx = (self._aiAssistItems || []).indexOf(pendingRm);
          if (idx >= 0) {
            if (res && res.ok) {
              self._aiAssistItems[idx] = { type: 'sys', text: _t(kiRm.ok) };
            } else {
              const errMsg = (res && res.message) ? String(res.message).slice(0, 120) : '';
              self._aiAssistItems[idx] = { type: 'sys', text: _t(kiRm.fail) + (errMsg ? ': ' + errMsg : '') };
            }
          }
          self.render();
        });
      }
    }
    return false;
  }
  app._aiAssistSend = function () {
    const inp = doc.getElementById('aiAssistInput');
    const text = String(inp ? inp.value : '').trim();
    if (!text) return;
    if (inp) inp.value = '';
    const d = _tryAssistantBoundedSkillDispatchMirror(this, text, this._t);
    if (d !== false) return d;
    const clipId = this.state.selectedClipId;
    if (!clipId) {
      this._aiAssistItems.push({ type: 'sys', text: this._t('aiAssist.selectClipFirst') });
      this.render();
      return Promise.resolve();
    }
    const mapped = mapAiAssistTextToTemplate(text);
    const card = { type: 'card', clipId, promptText: text, createdAt: Date.now(), runState: 'idle', usedPresetId: null, resultKind: null, lastError: null };
    if (mapped.templateId && mapped.intent) {
      card.templateId = mapped.templateId;
      card.templateLabel = mapped.templateLabel;
      card.intent = mapped.intent;
    }
    card.plan = _buildAiAssistPlan(card.templateId || null, card.intent || null, text);
    card.reasoningLog = {
      userPrompt: text.slice(0, 200),
      templateId: card.templateId || null,
      intent: card.intent && typeof card.intent === 'object' ? { fixPitch: !!card.intent.fixPitch, tightenRhythm: !!card.intent.tightenRhythm, reduceOutliers: !!card.intent.reduceOutliers } : null,
      planSummary: (card.plan && card.plan.planTitle) ? String(card.plan.planTitle) : 'Optimize',
      requestedPresetId: 'llm_v0',
      planSource: 'rule',
      createdAt: card.createdAt,
    };
    this._aiAssistItems.push(card);
    const p = tryGenerateAiPlan(text, card.templateId || null, card.intent || null).then((plan) => {
      if (plan) {
        card.plan = plan;
        if (card.reasoningLog) {
          card.reasoningLog.planSummary = (plan.planTitle && String(plan.planTitle).trim()) ? String(plan.planTitle).trim() : card.reasoningLog.planSummary;
          card.reasoningLog.planSource = 'ai';
        }
        syncAssistantCardTemplateFromPlan(card);
      }
      this.render();
    }).catch(() => {});
    this.render();
    return p;
  };
  app._aiAssistRun = async function (clipId, btnEl) {
    if (!clipId) return;
    const promptText = (btnEl && btnEl.getAttribute && btnEl.getAttribute('data-prompt')) || '';
    const card = (this._aiAssistItems || []).find(x => x.type === 'card' && String(x.clipId) === String(clipId) && (!promptText || x.promptText === promptText));
    if (!card) return;
    syncAssistantCardTemplateFromPlan(card);
    const text = (promptText !== '' && promptText !== null) ? promptText : (card.promptText || '');
    const runSnapshot = _buildAssistantRunExecutionSnapshot(card);
    card._assistantRunSnapshot = runSnapshot;
    if (card.reasoningLog && typeof card.reasoningLog === 'object') {
      card.reasoningLog.templateId = runSnapshot.usedTemplateId;
      card.reasoningLog.intent = runSnapshot.usedIntent ? {
        fixPitch: !!runSnapshot.usedIntent.fixPitch,
        tightenRhythm: !!runSnapshot.usedIntent.tightenRhythm,
        reduceOutliers: !!runSnapshot.usedIntent.reduceOutliers,
      } : null;
      if (runSnapshot.usedPlan && runSnapshot.usedPlan.planTitle) {
        card.reasoningLog.planSummary = String(runSnapshot.usedPlan.planTitle).slice(0, 200);
      }
    }
    const opts = { userPrompt: text, requestedPresetId: runSnapshot.usedRequestedPresetId };
    if (runSnapshot.usedTemplateId && runSnapshot.usedIntent) {
      opts.templateId = runSnapshot.usedTemplateId;
      opts.intent = runSnapshot.usedIntent;
    }
    if (runSnapshot.usedPlan) {
      opts.plan = runSnapshot.usedPlan;
    }
    opts._assistantExecutionPlanSnapshot = runSnapshot.usedPlan;
    this.setOptimizeOptions(clipId, opts);
    card.runState = 'running';
    card.resultKind = null;
    card.usedPresetId = null;
    card.lastError = null;
    card.executionTrace = null;
    if (btnEl) btnEl.disabled = true;
    this.render();
    try {
      const res = await this.runCommand('optimize_clip', { clipId });
      if (btnEl) btnEl.disabled = false;
      if (!res || !res.ok) {
        card.runState = 'failed';
        card.lastError = (res && res.message) ? String(res.message).slice(0, 80) : 'Optimize failed';
        if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, null, false, card.runState, card.resultKind, card.lastError);
        try { card.executionTrace = _buildAiAssistExecutionTrace(card, null, runSnapshot); } catch (_e) {}
        this.render();
        return;
      }
      const optRes = (res.data && res.data.optimizeResult) ? res.data.optimizeResult : null;
      if (!optRes || !optRes.ok) {
        card.runState = 'failed';
        card.lastError = (optRes && (optRes.reason || optRes.detail || optRes.message)) ? String(optRes.reason || optRes.detail || optRes.message).slice(0, 80) : 'Optimize failed';
        if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, optRes && optRes.patchSummary ? optRes.patchSummary : null, false, card.runState, card.resultKind, card.lastError);
        try { card.executionTrace = _buildAiAssistExecutionTrace(card, optRes, runSnapshot); } catch (_e) {}
        this.render();
        return;
      }
      let ps = (optRes && optRes.patchSummary) ? optRes.patchSummary : null;
      if (!ps && optRes.ok && optRes.ops > 0) {
        const p2 = this.getProjectV2();
        const c = p2 && p2.clips && p2.clips[clipId];
        ps = (c && c.meta && c.meta.agent && c.meta.agent.patchSummary) ? c.meta.agent.patchSummary : null;
      }
      card.usedPresetId = (ps && ps.executedPreset) ? String(ps.executedPreset) : 'llm_v0';
      if (optRes.ops === 0 || (ps && ps.noChanges === true)) card.resultKind = 'no-op';
      else if (ps && ps.isVelocityOnly === true) card.resultKind = 'velocity-only';
      else if (ps && (ps.hasPitchChange === true || ps.hasTimingChange === true)) card.resultKind = 'pitch/timing';
      else if (ps && ps.hasStructuralChange === true) card.resultKind = 'structure';
      else card.resultKind = 'updated';
      card.runState = 'done';
      if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, ps, true, card.runState, card.resultKind, null);
      try { card.executionTrace = _buildAiAssistExecutionTrace(card, optRes, runSnapshot); } catch (_e) {}
    } catch (err) {
      if (btnEl) btnEl.disabled = false;
      card.runState = 'failed';
      card.lastError = (err && err.message) ? String(err.message).slice(0, 80) : 'Optimize failed';
      if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, null, false, card.runState, card.resultKind, card.lastError);
      try { card.executionTrace = _buildAiAssistExecutionTrace(card, null, runSnapshot); } catch (_e) {}
    }
    this.render();
  };
  app._aiAssistUndo = async function (clipId) {
    if (!clipId) return;
    const res = await this.runCommand('rollback_clip', { clipId });
    const rb = (res && res.data && res.data.rollbackResult) ? res.data.rollbackResult : null;
    if (rb && rb.ok && rb.changed) {
      const items = this._aiAssistItems || [];
      for (const it of items) {
        if (it.type === 'card' && String(it.clipId) === String(clipId) && it.runState === 'done') it.runState = 'undone';
      }
    }
    this.render();
  };
  const fmtSec = (x) => (Number(x || 0).toFixed(2) + 's');
  app._getAiAssistTargetSummary = function () {
    const _t = I18N.t.bind(I18N);
    const instId = this.state.selectedInstanceId;
    const clipId = this.state.selectedClipId;
    const clip = clipId ? (this.project.clips || []).find(c => c && String(c.id) === String(clipId)) : null;
    const clipName = clip ? (clip.name || clipId) : (clipId || '');
    const prefix = _t('aiAssist.clipPrefix');
    if (!clipId) return _t('aiAssist.noClip');
    if (instId) {
      const inst = (this.project.instances || []).find(i => i && String(i.id) === String(instId));
      if (inst && String(inst.clipId || '') === String(clipId || '')) {
        const trackNum = (typeof inst.trackIndex === 'number' ? inst.trackIndex : 0) + 1;
        const startStr = fmtSec(inst.startSec);
        const trackPrefix = _t('aiAssist.trackPrefix');
        return prefix + clipName + ' · ' + trackPrefix + trackNum + ' · ' + startStr;
      }
    }
    return prefix + clipName;
  };
  return { app, setOptimizeOptionsCalls, runCommandCalls, doc };
}

(function testDockElementsExist() {
  const { doc } = createFakeApp();
  assert(doc.getElementById('aiAssistDock'), 'aiAssistDock should exist');
  assert(doc.getElementById('aiAssistMessages'), 'aiAssistMessages should exist');
  assert(doc.getElementById('aiAssistSend'), 'aiAssistSend should exist');
  console.log('PASS dock elements exist');
})();

(function testSendNoClipShowsSelectClipFirst() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = null;
  const inp = doc.getElementById('aiAssistInput');
  inp.value = 'make it louder';
  app._aiAssistSend();
  assert(app._aiAssistItems.length === 1, 'should have one item');
  assert(app._aiAssistItems[0].type === 'sys', 'should be sys');
  assert(app._aiAssistItems[0].text === 'Select a clip first.', 'should show selectClipFirst');
  console.log('PASS Send with no clip => selectClipFirst');
})();

(function testResolveAddTrackIntentNarrow() {
  assert(resolveAssistantAddTrackIntentFromText('add a track') === true);
  assert(resolveAssistantAddTrackIntentFromText('Add A Track.') === true);
  assert(resolveAssistantAddTrackIntentFromText('please add a track') === true);
  assert(resolveAssistantAddTrackIntentFromText('create new track') === true);
  assert(resolveAssistantAddTrackIntentFromText('new track') === true);
  assert(resolveAssistantAddTrackIntentFromText('add this clip') === false, 'add_track must not steal add-clip phrases');
  assert(resolveAssistantAddTrackIntentFromText('add more dynamics') === false);
  assert(resolveAssistantAddTrackIntentFromText('the pitch is off') === false);
  assert(resolveAssistantAddTrackIntentFromText('create a new melody') === false);
  console.log('PASS add-track intent phrases narrow');
})();

(function testResolveAddClipToTimelineIntentNarrow() {
  const base = resolveAssistantAddClipToTimelineIntentFromText('add this clip');
  assert(base && base.trackIndex == null, 'plain phrase resolved with no track');
  assert(resolveAssistantAddClipToTimelineIntentFromText('Insert This Clip.') != null);
  assert(resolveAssistantAddClipToTimelineIntentFromText('please put this clip on the timeline') != null);
  const tr2 = resolveAssistantAddClipToTimelineIntentFromText('add this clip to track 2');
  assert(tr2 && tr2.trackIndex === 1, 'track 2 -> trackIndex 1');
  const tr1 = resolveAssistantAddClipToTimelineIntentFromText('insert this clip on track 1');
  assert(tr1 && tr1.trackIndex === 0, 'track 1 -> trackIndex 0');
  assert(resolveAssistantAddClipToTimelineIntentFromText('add a track') === null, 'no collision with add_track');
  assert(resolveAssistantAddClipToTimelineIntentFromText('new track') === null);
  assert(resolveAssistantAddClipToTimelineIntentFromText('add clip named melody') === null);
  assert(resolveAssistantAddClipToTimelineIntentFromText('place chorus on track 3') === null);
  console.log('PASS add-clip-to-timeline intent phrases narrow');
})();

(function testResolveMoveInstanceIntentNarrow() {
  const a = resolveAssistantMoveInstanceIntentFromText('move this right 1 beat');
  assert(a && a.direction === 'right' && a.deltaBeats === 1);
  const b = resolveAssistantMoveInstanceIntentFromText('move selected instance left 2 beats');
  assert(b && b.direction === 'left' && b.deltaBeats === 2);
  const c = resolveAssistantMoveInstanceIntentFromText('move selected block left 0.5 beat');
  assert(c && c.direction === 'left' && c.deltaBeats === 0.5);
  assert(resolveAssistantMoveInstanceIntentFromText('shift it later') === null);
  assert(resolveAssistantMoveInstanceIntentFromText('move this right 1 bar') === null);
  assert(resolveAssistantMoveInstanceIntentFromText('move this right 100 beats') === null);
  console.log('PASS move-instance intent phrases narrow');
})();

(function testResolveRemoveInstanceIntentNarrow() {
  assert(resolveAssistantRemoveInstanceIntentFromText('remove this') === true);
  assert(resolveAssistantRemoveInstanceIntentFromText('Delete This.') === true);
  assert(resolveAssistantRemoveInstanceIntentFromText('please remove selected block') === true);
  assert(resolveAssistantRemoveInstanceIntentFromText('delete selected instance') === true);
  assert(resolveAssistantRemoveInstanceIntentFromText('remove selected instance') === true);
  assert(resolveAssistantRemoveInstanceIntentFromText('clean this up') === false);
  assert(resolveAssistantRemoveInstanceIntentFromText('delete the clip') === false);
  assert(resolveAssistantRemoveInstanceIntentFromText('remove the chorus') === false);
  console.log('PASS remove-instance intent phrases narrow');
})();

(function testSendRemoveInstanceNoSelectionRefuses() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app.state.selectedInstanceId = null;
  doc.getElementById('aiAssistInput').value = 'remove this';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand without selected instance');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text.indexOf('timeline instance') >= 0);
  console.log('PASS remove instance without selection => refuse');
})();

(function testSendRemoveInstanceStaleRefuses() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedInstanceId = 'ghost-id';
  app.project.instances = [];
  doc.getElementById('aiAssistInput').value = 'delete this';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0);
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text.indexOf('no longer') >= 0);
  console.log('PASS remove instance stale selection => refuse');
})();

(function testSendRemoveInstanceConfirmFalseSkipsRunCommand() {
  const { app, doc, runCommandCalls } = createFakeApp({ confirmImpl: () => false });
  app.state.selectedInstanceId = 'inst-1';
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }];
  doc.getElementById('aiAssistInput').value = 'remove this';
  return app._aiAssistSend().then(function () {
    assert(runCommandCalls.length === 0, 'remove_instance must not run when confirm declines');
    assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'Remove cancelled.');
  });
})().then(function () { console.log('PASS remove instance confirm false => no runCommand'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendRemoveInstanceConfirmTrueCallsRemoveInstance() {
  let seenMsg = '';
  const { app, doc, runCommandCalls } = createFakeApp({
    confirmImpl: (msg) => { seenMsg = msg; return true; },
  });
  app.state.selectedInstanceId = 'inst-1';
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }];
  doc.getElementById('aiAssistInput').value = 'delete selected block';
  return app._aiAssistSend().then(function () {
    assert(seenMsg.indexOf('Test Clip') >= 0, 'confirm should name the clip');
    assert(runCommandCalls.length === 1 && runCommandCalls[0].command === 'remove_instance');
    assert(runCommandCalls[0].payload.instanceId === 'inst-1');
    assert(Object.keys(runCommandCalls[0].payload).length === 1, 'payload shape: instanceId only');
    assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'Removed timeline instance.');
  });
})().then(function () { console.log('PASS remove instance confirm true => runCommand remove_instance'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendRemoveInstanceRegistryNeverSkipsAssistantConfirm() {
  const R = globalThis.H2SInternalActionRegistry;
  const orig = R._BOUNDED.remove_instance.confirm;
  R._BOUNDED.remove_instance.confirm = R.CONFIRM.never;
  let confirmCalls = 0;
  const { app, doc, runCommandCalls } = createFakeApp({
    confirmImpl: () => { confirmCalls++; return false; },
  });
  app.state.selectedInstanceId = 'inst-1';
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }];
  doc.getElementById('aiAssistInput').value = 'remove this';
  return app._aiAssistSend().then(function () {
    assert(confirmCalls === 0, 'confirm must not run when registry policy is never');
    assert(runCommandCalls.length === 1 && runCommandCalls[0].command === 'remove_instance', 'remove_instance runs without assistant confirm');
  }).finally(function () {
    R._BOUNDED.remove_instance.confirm = orig;
  });
})().then(function () { console.log('PASS remove instance registry never => no confirmImpl, runCommand'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendVagueCleanupNotRemoveInstance() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app.state.selectedInstanceId = 'inst-1';
  doc.getElementById('aiAssistInput').value = 'clean this up';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'vague phrase must not call runCommand on send');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].type === 'card', 'optimize card path');
  console.log('PASS vague cleanup => card not remove_instance');
})();

(function testSendMoveInstanceNoSelectionRefuses() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app.state.selectedInstanceId = null;
  doc.getElementById('aiAssistInput').value = 'move this right 1 beat';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text.indexOf('timeline instance') >= 0);
  console.log('PASS move instance without selection => refuse');
})();

(function testSendMoveInstanceNoClipCallsRunCommand() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = null;
  app.state.selectedInstanceId = 'inst-1';
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }];
  doc.getElementById('aiAssistInput').value = 'move this right 1 beat';
  return app._aiAssistSend().then(function () {
    assert(runCommandCalls.length === 1 && runCommandCalls[0].command === 'move_instance');
    assert(runCommandCalls[0].payload.instanceId === 'inst-1');
    assert(runCommandCalls[0].payload.startBeat === 1);
    assert(runCommandCalls[0].payload.trackIndex === undefined);
    assert(app._aiAssistItems[0].text.indexOf('Moved') >= 0 && app._aiAssistItems[0].text.indexOf('1') >= 0);
  });
})().then(function () { console.log('PASS move instance without clip => move_instance'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendMoveInstanceClampLeft() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedInstanceId = 'inst-1';
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }];
  doc.getElementById('aiAssistInput').value = 'move this left 1 beat';
  return app._aiAssistSend().then(function () {
    assert(runCommandCalls[0].payload.startBeat === 0);
    assert(app._aiAssistItems[0].text.indexOf('clamped') >= 0 || app._aiAssistItems[0].text.indexOf('beat 0') >= 0);
  });
})().then(function () { console.log('PASS move left clamps to beat 0'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendAddTrackNoClipCallsRunCommand() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = null;
  doc.getElementById('aiAssistInput').value = 'add a track';
  const p = app._aiAssistSend();
  assert(runCommandCalls.length === 1, 'runCommand once');
  assert(runCommandCalls[0].command === 'add_track', 'command add_track');
  assert(JSON.stringify(runCommandCalls[0].payload || {}) === '{}', 'empty payload');
  return p.then(function () {
    assert(app._aiAssistItems.length === 1, 'one sys line after done');
    assert(app._aiAssistItems[0].text === 'Added track 3.', '1-based track label from trackIndex 2');
  });
})().then(function () { console.log('PASS Send add a track => runCommand add_track'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendAddTrackWithClipSelectedDoesNotCreateOptimizeCard() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'add a track';
  const p = app._aiAssistSend();
  assert(runCommandCalls.length === 1 && runCommandCalls[0].command === 'add_track', 'add_track not optimize');
  return p.then(function () {
    assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].type === 'sys', 'sys result not optimize card');
    assert(!runCommandCalls.some(function (c) { return c.command === 'optimize_clip'; }), 'no optimize on send');
  });
})().then(function () { console.log('PASS add track with clip selected still command add_track only'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendAddClipToTimelineNoClipRefuses() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = null;
  doc.getElementById('aiAssistInput').value = 'add this clip';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand without selected clip');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'Select a clip first.');
  console.log('PASS add clip to timeline without selection => selectClipFirst');
})();

(function testSendAddClipToTimelineStaleRefuses() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'missing-clip-id';
  app.project.clips = [{ id: 'clip-1', name: 'Test Clip' }];
  doc.getElementById('aiAssistInput').value = 'insert this clip';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0);
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text.indexOf('no longer') >= 0);
  console.log('PASS add clip to timeline stale selection => refuse');
})();

(function testSendAddClipToTimelineCallsRunCommandClipIdOnly() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'put this clip on the timeline';
  const p = app._aiAssistSend();
  assert(runCommandCalls.length === 1 && runCommandCalls[0].command === 'add_clip_to_timeline');
  assert(runCommandCalls[0].payload.clipId === 'clip-1');
  assert(Object.keys(runCommandCalls[0].payload).length === 1, 'payload shape: clipId only');
  return p.then(function () {
    assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'Added clip to timeline.');
  });
})().then(function () { console.log('PASS add clip to timeline => runCommand add_clip_to_timeline { clipId }'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendAddClipToTimelineWithTrackCallsRunCommandClipIdAndTrackIndex() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app.project.tracks = [{ id: 't-1' }, { id: 't-2' }, { id: 't-3' }];
  doc.getElementById('aiAssistInput').value = 'add this clip to track 2';
  const p = app._aiAssistSend();
  assert(runCommandCalls.length === 1 && runCommandCalls[0].command === 'add_clip_to_timeline');
  assert(runCommandCalls[0].payload.clipId === 'clip-1');
  assert(runCommandCalls[0].payload.trackIndex === 1, '1-based track wording converted to 0-based payload');
  assert(Object.keys(runCommandCalls[0].payload).length === 2, 'payload shape: clipId + trackIndex');
  return p.then(function () {
    assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'Added clip to timeline.');
  });
})().then(function () { console.log('PASS add clip to timeline track phrase => runCommand add_clip_to_timeline { clipId, trackIndex }'); }).catch(function (e) { console.error(e); process.exit(1); });

(function testSendAddClipToTimelineTrackOutOfRangeRefuses() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app.project.tracks = [{ id: 't-1' }, { id: 't-2' }];
  doc.getElementById('aiAssistInput').value = 'put this clip on track 3';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand for out-of-range track request');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'Track 3 is out of range (1-2).');
  console.log('PASS add clip to timeline out-of-range track => refuse');
})();

(function testSendAddClipToTimelineWhenSkillDisabledSkipsRunCommand() {
  const R = globalThis.H2SInternalSkillRegistry;
  const { app, doc, runCommandCalls } = createFakeApp();
  R._setSkillEnabledForTest('add_clip_to_timeline', false);
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'add this clip';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand when add_clip_to_timeline skill disabled');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'That assistant action is unavailable.');
  R._setSkillEnabledForTest('add_clip_to_timeline', true);
  console.log('PASS add clip to timeline skill disabled => no runCommand');
})();

(function testSendAddTrackWhenSkillDisabledSkipsRunCommand() {
  const R = globalThis.H2SInternalSkillRegistry;
  const { app, doc, runCommandCalls } = createFakeApp();
  R._setSkillEnabledForTest('add_track', false);
  app.state.selectedClipId = null;
  doc.getElementById('aiAssistInput').value = 'add a track';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand when add_track skill disabled');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'That assistant action is unavailable.');
  R._setSkillEnabledForTest('add_track', true);
  console.log('PASS add track skill disabled => no runCommand');
})();

(function testSendMoveInstanceWhenSkillDisabledSkipsRunCommand() {
  const R = globalThis.H2SInternalSkillRegistry;
  const { app, doc, runCommandCalls } = createFakeApp();
  R._setSkillEnabledForTest('move_instance', false);
  app.state.selectedInstanceId = 'inst-1';
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }];
  doc.getElementById('aiAssistInput').value = 'move this right 1 beat';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand when move_instance skill disabled');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'That assistant action is unavailable.');
  R._setSkillEnabledForTest('move_instance', true);
  console.log('PASS move instance skill disabled => no runCommand');
})();

(function testSendRemoveInstanceWhenSkillDisabledSkipsRunCommand() {
  const R = globalThis.H2SInternalSkillRegistry;
  const { app, doc, runCommandCalls } = createFakeApp({ confirmImpl: () => true });
  R._setSkillEnabledForTest('remove_instance', false);
  app.state.selectedInstanceId = 'inst-1';
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', startSec: 0, trackIndex: 0 }];
  doc.getElementById('aiAssistInput').value = 'remove this';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no runCommand when remove_instance skill disabled');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].text === 'That assistant action is unavailable.');
  R._setSkillEnabledForTest('remove_instance', true);
  console.log('PASS remove instance skill disabled => no runCommand');
})();

(function testPhraseResolverIdsMatchBoundedDispatchSet() {
  const R = globalThis.H2SInternalSkillRegistry;
  const expected = new Set(['assistant_add_clip_to_timeline_v1', 'assistant_add_track_v1', 'assistant_move_instance_v1', 'assistant_remove_instance_v1']);
  for (const sid of ['add_clip_to_timeline', 'add_track', 'move_instance', 'remove_instance']) {
    const pid = R.getSkill(sid).phraseResolverId;
    assert(expected.has(pid), 'phraseResolverId for ' + sid + ': ' + pid);
  }
  console.log('PASS phraseResolverIds are the bounded assistant v1 ids');
})();

(function testAppJsBoundedResolverRegistryAndOrder() {
  const fs = require('fs');
  const appPath = path.join(__dirname, '../../static/pianoroll/app.js');
  const s = fs.readFileSync(appPath, 'utf8');
  assert(s.includes("Object.freeze(['add_clip_to_timeline', 'add_track', 'move_instance', 'remove_instance'])"), 'bounded dispatch order clip → track → move → remove');
  assert(s.includes('assistant_add_clip_to_timeline_v1: _resolveAssistantAddClipToTimelineIntentFromText'), 'resolver registry add_clip_to_timeline');
  assert(s.includes('assistant_add_track_v1: _resolveAssistantAddTrackIntentFromText'), 'resolver registry add_track');
  assert(s.includes('assistant_move_instance_v1: _resolveAssistantMoveInstanceIntentFromText'), 'resolver registry move_instance');
  assert(s.includes('assistant_remove_instance_v1: _resolveAssistantRemoveInstanceIntentFromText'), 'resolver registry remove_instance');
  assert(s.includes('_tryAssistantBoundedSkillDispatch(this, text, _t)'), '_aiAssistSend calls bounded dispatch');
  console.log('PASS app.js bounded resolver registry + dispatch hook');
})();

(function testNonMatchingBoundedTextFallsThroughToOptimizeCard() {
  const { app, doc, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'add more dynamics';
  app._aiAssistSend();
  assert(runCommandCalls.length === 0, 'no bounded runCommand for non-matching phrase');
  assert(app._aiAssistItems.length === 1 && app._aiAssistItems[0].type === 'card', 'optimize card path');
  console.log('PASS non-bounded phrase with clip still creates optimize card');
})();

(function testSendWithClipCreatesCard() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  const inp = doc.getElementById('aiAssistInput');
  inp.value = 'add more dynamics';
  app._aiAssistSend();
  assert(app._aiAssistItems.length === 1, 'should have one item');
  assert(app._aiAssistItems[0].type === 'card', 'should be card');
  assert(app._aiAssistItems[0].clipId === 'clip-1', 'card should have clipId');
  assert(app._aiAssistItems[0].promptText === 'add more dynamics', 'card should contain prompt text');
  console.log('PASS Send with clip => card with prompt');
})();

(function testRunCallsRunCommand() {
  const { app, setOptimizeOptionsCalls, runCommandCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app._aiAssistItems.push({ type: 'card', clipId: 'clip-1', promptText: 'fix pitch', createdAt: 1 });
  const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'fix pitch' : null), disabled: false };
  app._aiAssistRun('clip-1', btnEl);
  assert(setOptimizeOptionsCalls.length === 1, 'setOptimizeOptions should be called once');
  assert(setOptimizeOptionsCalls[0].clipId === 'clip-1', 'clipId should match');
  assert(setOptimizeOptionsCalls[0].opts.requestedPresetId === 'llm_v0', 'preset should be llm_v0');
  assert(setOptimizeOptionsCalls[0].opts.userPrompt === 'fix pitch', 'userPrompt should match');
  assert(runCommandCalls.length === 1, 'runCommand should be called once');
  assert(runCommandCalls[0].command === 'optimize_clip', 'command should be optimize_clip');
  assert(runCommandCalls[0].payload.clipId === 'clip-1', 'payload should have correct clipId');
  console.log('PASS Run on card => runCommand optimize_clip');
})();

(function testUx7bMatchedMappingStoresTemplateIdOnCard() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  const inp = doc.getElementById('aiAssistInput');
  inp.value = 'the pitch is off';
  app._aiAssistSend();
  assert(app._aiAssistItems.length === 1, 'should have one card');
  const card = app._aiAssistItems[0];
  assert(card.type === 'card', 'should be card');
  assert(card.templateId === 'fix_pitch_v1', 'card should store templateId fix_pitch_v1');
  assert(card.templateLabel === 'Fix Pitch', 'card should store templateLabel');
  assert(card.intent && card.intent.fixPitch === true, 'card should store intent with fixPitch');
  assert(card.promptText === 'the pitch is off', 'userPrompt preserved as original text');
  console.log('PASS UX7b matched mapping => card stores templateId, templateLabel, intent');
})();

(function testUx7bRunPassesTemplateIdAndIntent() {
  const { app, doc, setOptimizeOptionsCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  app._aiAssistSend();
  const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'the pitch is off' : null), disabled: false };
  app._aiAssistRun('clip-1', btnEl);
  assert(setOptimizeOptionsCalls.length === 1, 'setOptimizeOptions should be called');
  assert(setOptimizeOptionsCalls[0].opts.templateId === 'fix_pitch_v1', 'Run should pass templateId');
  assert(setOptimizeOptionsCalls[0].opts.intent && setOptimizeOptionsCalls[0].opts.intent.fixPitch === true, 'Run should pass intent');
  assert(setOptimizeOptionsCalls[0].opts.userPrompt === 'the pitch is off', 'userPrompt preserved');
  assert(setOptimizeOptionsCalls[0].opts.requestedPresetId === 'llm_v0', 'preset preserved');
  console.log('PASS UX7b Run writes templateId + intent through setOptimizeOptions');
})();

(function testUx7bUnmatchedMappingNoTemplateId() {
  const { app, doc, setOptimizeOptionsCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'add more dynamics';
  app._aiAssistSend();
  assert(app._aiAssistItems[0].templateId == null, 'unmatched card should have no templateId');
  const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'add more dynamics' : null), disabled: false };
  app._aiAssistRun('clip-1', btnEl);
  assert(setOptimizeOptionsCalls[0].opts.userPrompt === 'add more dynamics', 'userPrompt preserved');
  assert(setOptimizeOptionsCalls[0].opts.requestedPresetId === 'llm_v0', 'preset preserved');
  assert(!('templateId' in setOptimizeOptionsCalls[0].opts) || setOptimizeOptionsCalls[0].opts.templateId == null, 'no templateId injected');
  assert(!('intent' in setOptimizeOptionsCalls[0].opts) || setOptimizeOptionsCalls[0].opts.intent == null, 'no intent injected');
  console.log('PASS UX7b unmatched prompt => Run writes only userPrompt + requestedPresetId');
})();

(function testUx7bChinesePhraseMatch() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = '跑调';
  app._aiAssistSend();
  assert(app._aiAssistItems[0].templateId === 'fix_pitch_v1', '跑调 should map to fix_pitch_v1');
  doc.getElementById('aiAssistInput').value = '节奏更稳';
  app._aiAssistSend();
  assert(app._aiAssistItems[1].templateId === 'tighten_rhythm_v1', '节奏更稳 should map to tighten_rhythm_v1');
  console.log('PASS UX7b Chinese phrases 跑调, 节奏更稳 map correctly');
})();

(function testPlanMappedPromptProducesPlanOnCard() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  app._aiAssistSend();
  const card = app._aiAssistItems[0];
  assert(card.type === 'card' && card.plan, 'mapped card should have plan');
  assert(card.plan.planTitle === 'Fix Pitch', 'plan should have Fix Pitch title');
  assert(card.plan.planKind === 'fix-pitch', 'plan kind should be fix-pitch');
  assert(Array.isArray(card.plan.planLines) && card.plan.planLines.length >= 2, 'plan should have planLines');
  assert(card.plan.planLines.some(l => l.indexOf('out-of-tune') >= 0 || l.indexOf('pitch') >= 0), 'plan should mention pitch goal');
  console.log('PASS mapped prompt produces plan on card');
})();

(function testPlanFallbackProducesGenericPlan() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'add more dynamics';
  app._aiAssistSend();
  const card = app._aiAssistItems[0];
  assert(card.type === 'card' && card.plan, 'fallback card should have plan');
  assert(card.plan.planTitle === 'Optimize', 'fallback plan should have Optimize title');
  assert(card.plan.planKind === 'generic', 'fallback plan kind should be generic');
  assert(Array.isArray(card.plan.planLines) && card.plan.planLines.length >= 2, 'fallback plan should have planLines');
  assert(card.plan.planLines.some(l => l.indexOf('Goal:') >= 0 || l.indexOf('Strategy:') >= 0), 'fallback plan should have Goal/Strategy');
  console.log('PASS fallback prompt produces reasonable generic plan');
})();

(function testPR1AiPlanAttachedWhenAiReturnsPlan() {
  const aiPlan = { planKind: 'fix-pitch', planTitle: 'Fix Pitch (AI)', planLines: ['Goal: correct out-of-tune notes.', 'Strategy: prioritize sustained notes.'] };
  const { app, doc } = createFakeApp({ tryGenerateAiPlan: () => Promise.resolve(aiPlan) });
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  return app._aiAssistSend().then(() => {
    const card = app._aiAssistItems[0];
    assert(card.type === 'card' && card.plan, 'card should have plan');
    assert(card.plan.planTitle === 'Fix Pitch (AI)', 'AI plan should replace rule-based');
    assert(card.plan.planKind === 'fix-pitch', 'planKind should match');
    assert(Array.isArray(card.plan.planLines) && card.plan.planLines.length >= 2, 'planLines should exist');
    console.log('PASS PR1 AI-generated plan attached to card');
  });
})();

(function testPR1FallbackToRuleBasedWhenAiFails() {
  const { app, doc } = createFakeApp({ tryGenerateAiPlan: () => Promise.resolve(null) });
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  return app._aiAssistSend().then(() => {
    const card = app._aiAssistItems[0];
    assert(card.type === 'card' && card.plan, 'card should have plan');
    assert(card.plan.planTitle === 'Fix Pitch', 'rule-based plan used when AI returns null');
    assert(card.plan.planKind === 'fix-pitch', 'planKind from rule-based');
    console.log('PASS PR1 fallback to rule-based plan when AI returns null');
  });
})();

(function testPR1RunBehaviorUnchangedWithAiPlan() {
  const aiPlan = { planKind: 'fix-pitch', planTitle: 'Fix Pitch (AI)', planLines: ['Goal: correct pitch.'] };
  const { app, doc, setOptimizeOptionsCalls } = createFakeApp({ tryGenerateAiPlan: () => Promise.resolve(aiPlan) });
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  return app._aiAssistSend().then(() => {
    const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'the pitch is off' : null), disabled: false };
    return app._aiAssistRun('clip-1', btnEl);
  }).then(() => {
    assert(setOptimizeOptionsCalls.length === 1, 'Run should call setOptimizeOptions once');
    assert(setOptimizeOptionsCalls[0].opts.userPrompt === 'the pitch is off', 'userPrompt unchanged');
    assert(setOptimizeOptionsCalls[0].opts.templateId === 'fix_pitch_v1', 'templateId unchanged');
    assert(setOptimizeOptionsCalls[0].opts.intent && setOptimizeOptionsCalls[0].opts.intent.fixPitch === true, 'intent unchanged');
    assert(setOptimizeOptionsCalls[0].opts.plan && setOptimizeOptionsCalls[0].opts.plan.planTitle === 'Fix Pitch (AI)', 'PR3: Run passes plan when card has plan');
    console.log('PASS PR1/PR3 Run passes plan when card has plan');
  });
})();

(function testPR3RunWithoutPlanNoPlanInOpts() {
  const { app, setOptimizeOptionsCalls } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app._aiAssistItems.push({ type: 'card', clipId: 'clip-1', promptText: 'custom', createdAt: 1, runState: 'idle', plan: null });
  const btnEl = { getAttribute: () => null, disabled: false };
  app._aiAssistRun('clip-1', btnEl);
  return new Promise((r) => setImmediate(r)).then(() => {
    assert(setOptimizeOptionsCalls.length === 1, 'Run should call setOptimizeOptions once');
    assert(setOptimizeOptionsCalls[0].opts.userPrompt === 'custom', 'userPrompt passed');
    assert(setOptimizeOptionsCalls[0].opts._assistantExecutionPlanSnapshot === null, 'PR3: explicit null snapshot when no plan');
    assert(!('plan' in setOptimizeOptionsCalls[0].opts) || setOptimizeOptionsCalls[0].opts.plan == null, 'PR3: no plan when card has no plan');
    console.log('PASS PR3 Run without plan does not pass plan');
  });
})();

(function testAiCleanOutliersPlanBackfillsTemplateWhenKeywordsMiss() {
  const aiPlan = {
    planKind: 'clean-outliers',
    planTitle: '移除离群高音',
    planLines: [
      'Goal: remove isolated high outlier notes.',
      'Strategy: target only obvious outliers; keep the main melody cluster.',
    ],
  };
  const { app, doc, setOptimizeOptionsCalls } = createFakeApp({ tryGenerateAiPlan: () => Promise.resolve(aiPlan) });
  const origRun = app.runCommand.bind(app);
  app.runCommand = (cmd, payload) => {
    if (cmd === 'optimize_clip') {
      return Promise.resolve({
        ok: true,
        data: {
          clipId: payload.clipId,
          optimizeResult: {
            ok: true,
            ops: 1,
            executionPath: 'llm',
            patchSummary: {
              executedPreset: 'llm_v0',
              executedSource: 'llm_v0',
              ops: 1,
              status: 'ok',
              promptMeta: { templateId: 'clean_outliers_v1', promptVersion: 'tmpl_v1.clean_outliers' },
            },
            llmPromptTrace: {
              attemptIndex: 1,
              blocks: {
                resolvedTemplateId: 'clean_outliers_v1',
                resolvedIntent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true },
                promptVersion: 'tmpl_v1.clean_outliers',
                planBlock: 'PLAN: x',
                directivesBlock: 'DIRECTIVES:',
                userBody: 'user',
              },
            },
          },
        },
      });
    }
    return origRun(cmd, payload);
  };
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = '离群高音 note cluster xyz unmatched';
  return app._aiAssistSend().then(() => {
    const card = app._aiAssistItems[0];
    assert(card.templateId === 'clean_outliers_v1', 'AI clean-outliers plan should backfill templateId');
    assert(card.intent && card.intent.reduceOutliers === true, 'intent should be reduceOutliers');
    assert(card.plan && card.plan.planKind === 'clean-outliers', 'planKind preserved');
    const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? '离群高音 note cluster xyz unmatched' : null), disabled: false };
    return app._aiAssistRun('clip-1', btnEl);
  }).then(() => {
    assert(setOptimizeOptionsCalls.length === 1, 'Run should call setOptimizeOptions once');
    assert(setOptimizeOptionsCalls[0].opts.templateId === 'clean_outliers_v1', 'Run must pass clean_outliers_v1 for execution');
    assert(setOptimizeOptionsCalls[0].opts.intent && setOptimizeOptionsCalls[0].opts.intent.reduceOutliers === true, 'Run must pass reduceOutliers intent');
    assert(setOptimizeOptionsCalls[0].opts.plan && setOptimizeOptionsCalls[0].opts.plan.planKind === 'clean-outliers', 'Run must pass AI plan snapshot');
    assert(setOptimizeOptionsCalls[0].opts._assistantExecutionPlanSnapshot && setOptimizeOptionsCalls[0].opts._assistantExecutionPlanSnapshot.planTitle === '移除离群高音', 'Run must pass assistant execution plan snapshot');
    const snap = setOptimizeOptionsCalls[0].opts._assistantExecutionPlanSnapshot;
    const pb = buildPlanBlockForTest(snap);
    assert(pb.indexOf('PLAN: 移除离群高音') >= 0, 'PLAN block must use AI plan title, not generic Optimize');
    assert(pb.indexOf('PLAN: Optimize') < 0, 'must not emit generic Optimize PLAN header for AI plan');
    const staleMerged = mergePlanForSetOptimizeOptionsLikeApp(setOptimizeOptionsCalls[0].opts, {
      plan: { planKind: 'generic', planTitle: 'Optimize', planLines: ['Goal: stale generic.', 'Strategy: stale.', 'Note: stale.'] },
    });
    assert(staleMerged && staleMerged.planTitle === '移除离群高音', 'merge must prefer assistant snapshot over stale generic plan');
    const card = app._aiAssistItems[0];
    assert(card.executionTrace && card.executionTrace.templateId === 'clean_outliers_v1', 'executionTrace.templateId matches run snapshot');
    assert(card.executionTrace.intent && card.executionTrace.intent.reduceOutliers === true, 'executionTrace.intent matches run snapshot');
    assert(card.executionTrace.executionSnapshot && card.executionTrace.executionSnapshot.usedTemplateId === 'clean_outliers_v1', 'executionSnapshot.usedTemplateId');
    assert(card.executionTrace.promptVersion === 'tmpl_v1.clean_outliers', 'executionTrace.promptVersion from agent result (not manual_v0)');
    const pt = card.executionTrace.llmPromptTrace;
    assert(pt && pt.blocks && pt.blocks.promptVersion === 'tmpl_v1.clean_outliers', 'llmPromptTrace.blocks.promptVersion aligned');
    assert(pt.blocks.resolvedTemplateId === 'clean_outliers_v1', 'llmPromptTrace resolvedTemplateId aligned');
    console.log('PASS AI clean-outliers plan backfills template when keywords miss');
  });
})();

(function testAssistantSnapshotOverridesStaleGenericPlanMerge() {
  const stale = { plan: { planKind: 'generic', planTitle: 'Optimize', planLines: ['Goal: apply optimization based on your description.', 'Strategy: x', 'Note: y'] } };
  const aiSnap = {
    planKind: 'clean-outliers',
    planTitle: '移除离群高音',
    planLines: ['Goal: remove outliers.', 'Strategy: conservative edits.'],
  };
  const opts = { userPrompt: 'x', requestedPresetId: 'llm_v0', _assistantExecutionPlanSnapshot: aiSnap };
  const merged = mergePlanForSetOptimizeOptionsLikeApp(opts, stale);
  assert(merged && merged.planTitle === '移除离群高音', 'snapshot must replace stale generic plan');
  const pb = buildPlanBlockForTest(aiSnap);
  assert(pb.indexOf('PLAN: 移除离群高音') >= 0, 'PLAN block uses AI title');
  assert(pb.indexOf('PLAN: Optimize') < 0, 'no generic Optimize header');
  console.log('PASS Assistant snapshot overrides stale generic plan in merge');
})();

(function testPartialSetOptimizeOptionsCarriesForwardSnapshot() {
  const stale = {
    plan: { planKind: 'generic', planTitle: 'Optimize', planLines: ['Goal: apply optimization based on your description.', 'Strategy: x', 'Note: y'] },
    _assistantExecutionPlanSnapshot: {
      planKind: 'clean-outliers',
      planTitle: '移除离群高音',
      planLines: ['Goal: remove outliers.', 'Strategy: conservative edits.'],
    },
  };
  const partial = { userPrompt: 'y', requestedPresetId: 'llm_v0' };
  const merged = mergePlanForSetOptimizeOptionsLikeApp(partial, stale);
  assert(merged && merged.planTitle === '移除离群高音', 'partial update must not drop snapshot; plan follows snapshot');
  assert(buildPlanBlockForTest(merged).indexOf('PLAN: Optimize') < 0, 'must not fall back to stale generic plan');
  console.log('PASS partial setOptimizeOptions carries forward _assistantExecutionPlanSnapshot');
})();

(function testExplicitNullClearsSnapshotForPlanFallback() {
  const stale = {
    plan: { planKind: 'generic', planTitle: 'Optimize', planLines: ['Goal: apply optimization based on your description.', 'Strategy: x', 'Note: y'] },
    _assistantExecutionPlanSnapshot: {
      planKind: 'clean-outliers',
      planTitle: '移除离群高音',
      planLines: ['Goal: remove outliers.', 'Strategy: conservative edits.'],
    },
  };
  const cleared = mergePlanForSetOptimizeOptionsLikeApp({ _assistantExecutionPlanSnapshot: null, userPrompt: 'z' }, stale);
  assert(cleared && cleared.planTitle === 'Optimize', 'explicit null snapshot => plan from stale existingOpts.plan');
  console.log('PASS explicit null clears assistant snapshot for plan fallback');
})();

(function testOptimizeClipMergePreservesPlanTemplateSnapshot() {
  const snapPlan = {
    planKind: 'clean-outliers',
    planTitle: '移除离群高音',
    planLines: ['Goal: remove outliers.', 'Strategy: conservative edits.'],
  };
  const stored = {
    requestedPresetId: 'llm_v0',
    userPrompt: 'stored prompt',
    intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true },
    templateId: 'clean_outliers_v1',
    plan: snapPlan,
    _assistantExecutionPlanSnapshot: snapPlan,
  };
  const ui = { requestedPresetId: 'llm_v0', userPrompt: 'from ui', intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true } };
  const out = resolveOptimizeClipOptionsLikeApp(stored, ui);
  assert(out.templateId === 'clean_outliers_v1', 'merge preserves templateId from stored');
  assert(out.plan && out.plan.planTitle === '移除离群高音', 'merge preserves plan aligned with snapshot');
  assert(out._assistantExecutionPlanSnapshot && out._assistantExecutionPlanSnapshot.planTitle === '移除离群高音', 'merge preserves _assistantExecutionPlanSnapshot');
  assert(out.intent && out.intent.reduceOutliers === true && out.intent.fixPitch === false, 'intent from override only (not merged stored intent)');
  console.log('PASS optimizeClip merge preserves planTemplateId snapshot');
})();

(function testGenericPlanBlockWhenRuleBasedPlanOnly() {
  const card = {
    plan: {
      planTitle: 'Optimize',
      planKind: 'generic',
      planLines: [
        'Goal: apply optimization based on your description.',
        'Strategy: use your prompt to guide pitch, timing, or dynamics changes.',
        'Note: results depend on the clarity of the source material.',
      ],
    },
  };
  const snap = _buildAssistantRunExecutionSnapshot(card);
  assert(snap.usedPlan != null && snap.usedPlan.planTitle === 'Optimize', 'rule-based generic plan is valid snapshot');
  const pb = buildPlanBlockForTest(snap.usedPlan);
  assert(pb.indexOf('PLAN: Optimize') >= 0, 'generic PLAN header still valid');
  console.log('PASS generic PLAN block when rule-based plan only');
})();

(function testNoValidPlanEmptyPlanBlock() {
  const card = { plan: null };
  const snap = _buildAssistantRunExecutionSnapshot(card);
  assert(snap.usedPlan == null, 'no usedPlan');
  const opts = { userPrompt: 'x', requestedPresetId: 'llm_v0', _assistantExecutionPlanSnapshot: snap.usedPlan };
  const merged = mergePlanForSetOptimizeOptionsLikeApp(opts, null);
  assert(merged == null, 'explicit null snapshot => no merged plan');
  assert(buildPlanBlockForTest(merged) === '', 'empty PLAN block when no plan');
  console.log('PASS no valid plan => empty buildPlanBlock');
})();

(function testPR2CardGetsReasoningLogOnSend() {
  const { app, doc } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'fix the pitch';
  app._aiAssistSend();
  const card = app._aiAssistItems[0];
  assert(card.type === 'card' && card.reasoningLog, 'card should have reasoningLog');
  assert(card.reasoningLog.userPrompt === 'fix the pitch', 'userPrompt in log');
  assert(card.reasoningLog.templateId === 'fix_pitch_v1', 'templateId in log');
  assert(card.reasoningLog.intent && card.reasoningLog.intent.fixPitch === true, 'intent in log');
  assert(card.reasoningLog.planSummary === 'Fix Pitch', 'planSummary from rule-based');
  assert(card.reasoningLog.requestedPresetId === 'llm_v0', 'requestedPresetId');
  assert(card.reasoningLog.planSource === 'rule', 'planSource rule');
  assert(typeof card.reasoningLog.createdAt === 'number', 'createdAt in log');
  console.log('PASS PR2 card gets reasoningLog on Send');
})();

(function testPR2AiPlanSuccessUpdatesReasoningLog() {
  const aiPlan = { planKind: 'fix-pitch', planTitle: 'Custom Pitch Fix (AI)', planLines: ['Goal: correct pitch.', 'Strategy: minimal edits.'] };
  const { app, doc } = createFakeApp({ tryGenerateAiPlan: () => Promise.resolve(aiPlan) });
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  return app._aiAssistSend().then(() => {
    const card = app._aiAssistItems[0];
    assert(card.reasoningLog, 'card should have reasoningLog');
    assert(card.reasoningLog.planSource === 'ai', 'planSource updated to ai');
    assert(card.reasoningLog.planSummary === 'Custom Pitch Fix (AI)', 'planSummary updated from AI plan');
    console.log('PASS PR2 AI plan success updates reasoningLog');
  });
})();

(function testPR2RunEnrichesReasoningLog() {
  const { app, doc } = createFakeApp();
  app.runCommand = (cmd, payload) => {
    if (cmd === 'optimize_clip') {
      return Promise.resolve({
        ok: true,
        data: {
          clipId: payload.clipId,
          optimizeResult: {
            ok: true,
            ops: 2,
            executionPath: 'llm',
            patchSummary: {
              executedPreset: 'llm_v0',
              executedSource: 'llm_v0',
              ops: 2,
              status: 'ok',
              hasPitchChange: true,
              promptMeta: { promptVersion: 'tmpl_v1.fix_pitch.r1' },
            },
          },
        },
      });
    }
    return Promise.resolve({ ok: true });
  };
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  return app._aiAssistSend().then(() => {
    const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'the pitch is off' : null), disabled: false };
    return app._aiAssistRun('clip-1', btnEl);
  }).then(() => {
    const card = app._aiAssistItems[0];
    assert(card.reasoningLog, 'card should have reasoningLog');
    assert(card.reasoningLog.accepted === true, 'accepted true');
    assert(card.reasoningLog.runState === 'done', 'runState done');
    assert(card.reasoningLog.resultKind === 'pitch/timing', 'resultKind pitch/timing');
    assert(card.reasoningLog.executedPreset === 'llm_v0', 'executedPreset');
    assert(card.reasoningLog.executedSource === 'llm_v0', 'executedSource');
    assert(card.reasoningLog.promptVersion === 'tmpl_v1.fix_pitch.r1', 'promptVersion');
    assert(card.reasoningLog.patchSummary && card.reasoningLog.patchSummary.ops === 2, 'patchSummary.ops');
    assert(card.reasoningLog.patchSummary.status === 'ok', 'patchSummary.status');
    assert(card.executionTrace && card.executionTrace.executionPath === 'llm', 'executionTrace.executionPath');
    assert(card.executionTrace.promptVersion === 'tmpl_v1.fix_pitch.r1', 'executionTrace.promptVersion');
    assert(card.executionTrace.accepted === true, 'executionTrace.accepted');
    assert(card.executionTrace.runState === 'done', 'executionTrace.runState');
    assert(card.executionTrace.resultKind === 'pitch/timing', 'executionTrace.resultKind');
    assert(card.executionTrace.patchSummary && card.executionTrace.patchSummary.ops === 2, 'executionTrace.patchSummary.ops');
    console.log('PASS PR2 Run enriches reasoningLog with result info');
  });
})();

(function testDebugPR1ExecutionTraceSanitizesLlmDebug() {
  const { app, doc } = createFakeApp();
  app.runCommand = (cmd, payload) => {
    if (cmd === 'optimize_clip') {
      return Promise.resolve({
        ok: true,
        data: {
          clipId: payload.clipId,
          optimizeResult: {
            ok: true,
            ops: 1,
            executionPath: 'llm',
            patchSummary: { executedPreset: 'llm_v0', executedSource: 'llm_v0', ops: 1, status: 'ok' },
            llmDebug: {
              attemptCount: 2,
              safeModeResolved: false,
              reason: 'ok',
              rawText: 'SECRET_MODEL_OUTPUT',
              extractedJson: '{ "secret": true }',
              authToken: 'sk-bad',
              errors: ['patch_rejected', 'x'],
            },
          },
        },
      });
    }
    return Promise.resolve({ ok: true });
  };
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  return app._aiAssistSend().then(() => {
    const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'the pitch is off' : null), disabled: false };
    return app._aiAssistRun('clip-1', btnEl);
  }).then(() => {
    const card = app._aiAssistItems[0];
    assert(card.executionTrace, 'card should have executionTrace');
    const s = JSON.stringify(card.executionTrace);
    assert(s.indexOf('SECRET_MODEL_OUTPUT') < 0, 'must not leak rawText');
    assert(s.indexOf('sk-bad') < 0, 'must not leak authToken');
    assert(s.indexOf('extractedJson') < 0, 'must not include extractedJson key');
    assert(card.executionTrace.llmDebugSummary && card.executionTrace.llmDebugSummary.attemptCount === 2, 'safe attemptCount');
    assert(card.executionTrace.llmDebugSummary.safeModeResolved === false, 'safe safeModeResolved');
    assert(card.executionTrace.llmDebugSummary.errorSummary && card.executionTrace.llmDebugSummary.errorSummary.indexOf('patch_rejected') >= 0, 'errorSummary');
    console.log('PASS Debug PR1 executionTrace sanitizes llmDebug');
  });
})();

(function testDebugPR1ExecutionTraceWithoutOptionalFields() {
  const { app, doc } = createFakeApp();
  app.runCommand = (cmd, payload) => {
    if (cmd === 'optimize_clip') {
      return Promise.resolve({
        ok: true,
        data: {
          clipId: payload.clipId,
          optimizeResult: { ok: true, ops: 0, patchSummary: { executedPreset: 'llm_v0', noChanges: true, status: 'ok', ops: 0, reason: 'empty_ops' } },
        },
      });
    }
    return Promise.resolve({ ok: true });
  };
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'hello';
  app._aiAssistSend();
  const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'hello' : null), disabled: false };
  return app._aiAssistRun('clip-1', btnEl).then(() => {
    const card = app._aiAssistItems[0];
    assert(card.executionTrace && typeof card.executionTrace === 'object', 'executionTrace object exists');
    assert(card.runState === 'done', 'run still completes');
    console.log('PASS Debug PR1 executionTrace without executionPath / llmDebug');
  });
})();

(function testDebugPR3LlmPromptTraceAttachedForLlmPath() {
  const rawTrace = {
    attemptIndex: 1,
    finalSystemPrompt: 'You are a music patch generator.',
    finalUserPrompt: 'PLAN: x\n\nDIRECTIVES:\n---\n\nClip context',
    blocks: {
      resolvedTemplateId: 'fix_pitch_v1',
      resolvedIntent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
      promptVersion: 'tmpl_v1.fix_pitch.r1',
      planBlock: 'PLAN: test',
      directivesBlock: 'DIRECTIVES:\n- Goals:',
      userBody: 'fix the melody',
    },
    authToken: 'sk-should-not-appear',
    headers: { Authorization: 'Bearer x' },
  };
  const { app, doc } = createFakeApp();
  app.runCommand = (cmd, payload) => {
    if (cmd === 'optimize_clip') {
      return Promise.resolve({
        ok: true,
        data: {
          clipId: payload.clipId,
          optimizeResult: {
            ok: true,
            ops: 1,
            executionPath: 'llm',
            llmPromptTrace: rawTrace,
            patchSummary: { executedPreset: 'llm_v0', executedSource: 'llm_v0', ops: 1, status: 'ok' },
          },
        },
      });
    }
    return Promise.resolve({ ok: true });
  };
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'the pitch is off';
  return app._aiAssistSend().then(() => {
    const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'the pitch is off' : null), disabled: false };
    return app._aiAssistRun('clip-1', btnEl);
  }).then(() => {
    const card = app._aiAssistItems[0];
    assert(card.executionTrace && card.executionTrace.llmPromptTrace, 'executionTrace.llmPromptTrace');
    const pt = card.executionTrace.llmPromptTrace;
    const s = JSON.stringify(card.executionTrace);
    assert(s.indexOf('sk-should-not-appear') < 0, 'must not leak authToken from llmPromptTrace');
    assert(s.indexOf('Authorization') < 0, 'must not leak headers');
    assert(pt.finalSystemPrompt && pt.finalSystemPrompt.indexOf('music patch') >= 0, 'finalSystemPrompt preserved');
    assert(pt.finalUserPrompt && pt.finalUserPrompt.indexOf('DIRECTIVES') >= 0, 'finalUserPrompt preserved');
    assert(pt.blocks && pt.blocks.resolvedTemplateId === 'fix_pitch_v1', 'blocks.resolvedTemplateId');
    assert(pt.blocks && pt.blocks.promptVersion === 'tmpl_v1.fix_pitch.r1', 'blocks.promptVersion');
    assert(pt.blocks && pt.blocks.directivesBlock && pt.blocks.directivesBlock.indexOf('DIRECTIVES') >= 0, 'blocks.directivesBlock');
    assert(pt.blocks && pt.blocks.userBody === 'fix the melody', 'blocks.userBody');
    console.log('PASS Debug PR3 llmPromptTrace attached and sanitized for llm path');
  });
})();

(function testDebugPR3NoLlmPromptTraceWhenNotLlmPath() {
  const { app, doc } = createFakeApp();
  app.runCommand = (cmd, payload) => {
    if (cmd === 'optimize_clip') {
      return Promise.resolve({
        ok: true,
        data: {
          clipId: payload.clipId,
          optimizeResult: {
            ok: true,
            ops: 1,
            executionPath: 'preset',
            llmPromptTrace: { finalUserPrompt: 'should not attach', blocks: { userBody: 'x' } },
            patchSummary: { executedPreset: 'dynamics_accent', executedSource: 'safe_preset', ops: 1, status: 'ok' },
          },
        },
      });
    }
    return Promise.resolve({ ok: true });
  };
  app.state.selectedClipId = 'clip-1';
  doc.getElementById('aiAssistInput').value = 'hello';
  app._aiAssistSend();
  const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'hello' : null), disabled: false };
  return app._aiAssistRun('clip-1', btnEl).then(() => {
    const card = app._aiAssistItems[0];
    assert(card.executionTrace && card.executionTrace.executionPath === 'preset', 'preset path');
    assert(!card.executionTrace.llmPromptTrace, 'llmPromptTrace omitted when executionPath is not llm');
    console.log('PASS Debug PR3 llmPromptTrace omitted for non-llm executionPath');
  });
})();

(function testDebugPR2HtmlIncludesFinalPromptWhenTraceHasLlmPromptTrace() {
  const card = {
    reasoningLog: { planSummary: 'P', requestedPresetId: 'llm_v0' },
    executionTrace: {
      executionPath: 'llm',
      llmPromptTrace: {
        attemptIndex: 2,
        finalSystemPrompt: 'SYS',
        finalUserPrompt: 'USER with DIRECTIVES block',
        blocks: {
          resolvedTemplateId: 'clean_outliers_v1',
          resolvedIntent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true },
          promptVersion: 'v9',
          planBlock: '',
          directivesBlock: 'DIRECTIVES:\n- Goals:',
          userBody: 'clean',
        },
      },
    },
  };
  const html = buildAiAssistDebugHtmlTest(card, escapeHtmlForDbg, mockLs(true));
  assert(html.indexOf('Final LLM prompt') >= 0, 'summary for final prompt');
  assert(html.indexOf('DIRECTIVES') >= 0, 'user payload visible');
  assert(html.indexOf('clean_outliers_v1') >= 0, 'resolvedTemplateId in blocks JSON');
  console.log('PASS Debug PR2 trace HTML includes Final LLM prompt subsection');
})();

(function testTargetSummaryInstanceVsClip() {
  const { app } = createFakeApp();
  app.project.instances = [{ id: 'inst-1', clipId: 'clip-1', trackIndex: 0, startSec: 2.5 }];
  app.state.selectedClipId = null;
  app.state.selectedInstanceId = null;
  assert(app._getAiAssistTargetSummary() === 'No clip selected', 'no selection => noClip');
  app.state.selectedClipId = 'clip-1';
  assert(app._getAiAssistTargetSummary() === 'Clip: Test Clip', 'clip only => clip name');
  app.state.selectedInstanceId = 'inst-1';
  assert(/Clip: Test Clip.*Track 1.*2\.50s/.test(app._getAiAssistTargetSummary()), 'instance => clip + track + start');
  // Mismatch: selectedInstanceId points to inst for clip-1, but user selected clip-2 from library
  app.project.clips.push({ id: 'clip-2', name: 'Other Clip' });
  app.state.selectedClipId = 'clip-2';
  assert(app._getAiAssistTargetSummary() === 'Clip: Other Clip', 'instance/clip mismatch => clip-only, no stale track');
  console.log('PASS target summary: noClip, clip-only, instance, mismatch');
})();

(function testEmptyInputNotSent() {
  const { app, doc } = createFakeApp();
  const inp = doc.getElementById('aiAssistInput');
  inp.value = '   ';
  app._aiAssistSend();
  assert(app._aiAssistItems.length === 0, 'whitespace-only should not add item');
  inp.value = '';
  app._aiAssistSend();
  assert(app._aiAssistItems.length === 0, 'empty should not add item');
  console.log('PASS empty/whitespace input not sent');
})();

(function testUx7cSuccessfulRunCardBecomesDone() {
  const { app } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app._aiAssistItems.push({ type: 'card', clipId: 'clip-1', promptText: 'fix pitch', createdAt: 1, runState: 'idle' });
  const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'fix pitch' : null), disabled: false };
  app.runCommand = (cmd, payload) => Promise.resolve({
    ok: true,
    data: {
      clipId: payload.clipId,
      optimizeResult: { ok: true, ops: 2, executionPath: 'llm', patchSummary: { executedPreset: 'llm_v0', hasPitchChange: true } },
    },
  });
  return app._aiAssistRun('clip-1', btnEl).then(() => {
    assert(app._aiAssistItems[0].runState === 'done', 'card should be done');
    assert(app._aiAssistItems[0].resultKind === 'pitch/timing', 'resultKind should be pitch/timing');
    assert(app._aiAssistItems[0].usedPresetId === 'llm_v0', 'usedPresetId should be set');
    console.log('PASS UX7c successful run => card done + resultKind');
  });
})();

(function testUx7cFailedRunCardBecomesFailed() {
  const { app } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app._aiAssistItems.push({ type: 'card', clipId: 'clip-1', promptText: 'fix pitch', createdAt: 1, runState: 'idle' });
  const btnEl = { getAttribute: (a) => (a === 'data-prompt' ? 'fix pitch' : null), disabled: false };
  app.runCommand = () => Promise.resolve({ ok: false, message: 'Agent failed' });
  return app._aiAssistRun('clip-1', btnEl).then(() => {
    assert(app._aiAssistItems[0].runState === 'failed', 'card should be failed');
    assert(app._aiAssistItems[0].lastError && app._aiAssistItems[0].lastError.indexOf('Agent failed') >= 0, 'lastError should contain message');
    console.log('PASS UX7c failed run => card failed + lastError');
  });
})();

(function testUx7cUndoMarksDoneCardUndone() {
  const { app } = createFakeApp();
  app.state.selectedClipId = 'clip-1';
  app._aiAssistItems.push({ type: 'card', clipId: 'clip-1', promptText: 'fix pitch', createdAt: 1, runState: 'done', resultKind: 'pitch/timing' });
  app.runCommand = (cmd, payload) => Promise.resolve({
    ok: true,
    data: { clipId: payload.clipId, rollbackResult: { ok: true, changed: true } },
  });
  return app._aiAssistUndo('clip-1').then(() => {
    assert(app._aiAssistItems[0].runState === 'undone', 'card should be undone');
    console.log('PASS UX7c undo => done card becomes undone');
  });
})();

// --- Debug PR2: mirror app.js _buildAiAssistDebugHtml (whitelist only) for regression tests ---
function escapeHtmlForDbg(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAiAssistDebugHtmlTest(it, escapeHtml, ls) {
  try {
    if (!ls || ls.getItem('h2s_debug') !== '1') return '';
  } catch (_e) {
    return '';
  }
  const rl = it && it.reasoningLog && typeof it.reasoningLog === 'object' ? it.reasoningLog : null;
  const et = it && it.executionTrace && typeof it.executionTrace === 'object' ? it.executionTrace : null;
  if (!rl && !et) return '';
  const merged = {};
  function set(k, v) {
    if (v === undefined || v === null) return;
    if (typeof v === 'boolean') merged[k] = v ? 'true' : 'false';
    else if (typeof v === 'object') merged[k] = JSON.stringify(v);
    else merged[k] = String(v);
  }
  if (rl) {
    if (rl.templateId != null) set('templateId', rl.templateId);
    if (rl.intent && typeof rl.intent === 'object') set('intent', rl.intent);
    if (rl.planSource != null) set('planSource', rl.planSource);
    if (rl.planSummary != null) set('planSummary', rl.planSummary);
    if (rl.requestedPresetId != null) set('requestedPresetId', rl.requestedPresetId);
    if (rl.userPrompt != null) set('userPrompt', rl.userPrompt);
    if (rl.promptVersion != null) set('promptVersion', rl.promptVersion);
    if (rl.runState != null) set('runState', rl.runState);
    if (rl.resultKind != null) set('resultKind', rl.resultKind);
    if (typeof rl.accepted === 'boolean') set('accepted', rl.accepted);
    if (rl.rejectionReason != null) set('rejectionReason', rl.rejectionReason);
    if (rl.patchSummary && typeof rl.patchSummary === 'object') {
      if (rl.patchSummary.ops != null) set('patchSummary.ops', rl.patchSummary.ops);
      if (rl.patchSummary.status != null) set('patchSummary.status', rl.patchSummary.status);
      if (rl.patchSummary.reason != null) set('patchSummary.reason', rl.patchSummary.reason);
    }
  }
  if (et) {
    if (et.executionPath != null) set('executionPath', et.executionPath);
    if (et.executedPreset != null) set('executedPreset', et.executedPreset);
    if (et.executedSource != null) set('executedSource', et.executedSource);
    if (et.promptVersion != null) set('promptVersion', et.promptVersion);
    if (et.runState != null) set('runState', et.runState);
    if (et.resultKind != null) set('resultKind', et.resultKind);
    if (typeof et.accepted === 'boolean') set('accepted', et.accepted);
    if (et.rejectionReason != null) set('rejectionReason', et.rejectionReason);
    if (et.patchSummary && typeof et.patchSummary === 'object') {
      if (et.patchSummary.ops != null) set('patchSummary.ops', et.patchSummary.ops);
      if (et.patchSummary.status != null) set('patchSummary.status', et.patchSummary.status);
      if (et.patchSummary.reason != null) set('patchSummary.reason', et.patchSummary.reason);
    }
    const lds = et.llmDebugSummary;
    if (lds && typeof lds === 'object') {
      if (lds.attemptCount != null) set('llmDebugSummary.attemptCount', lds.attemptCount);
      if (typeof lds.safeModeResolved === 'boolean') set('llmDebugSummary.safeModeResolved', lds.safeModeResolved);
      if (lds.reason != null) set('llmDebugSummary.reason', lds.reason);
      if (lds.errorSummary != null) set('llmDebugSummary.errorSummary', lds.errorSummary);
    }
  }
  const order = [
    'templateId', 'intent', 'planSource', 'planSummary', 'requestedPresetId', 'userPrompt',
    'executionPath', 'executedPreset', 'executedSource', 'promptVersion',
    'runState', 'resultKind', 'accepted', 'rejectionReason',
    'patchSummary.ops', 'patchSummary.status', 'patchSummary.reason',
    'llmDebugSummary.attemptCount', 'llmDebugSummary.safeModeResolved', 'llmDebugSummary.reason', 'llmDebugSummary.errorSummary',
  ];
  const rows = [];
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    if (!Object.prototype.hasOwnProperty.call(merged, k)) continue;
    let v = merged[k];
    if (v.length > 400) v = v.slice(0, 397) + '...';
    rows.push('<div class="aiAssistDbgRow"><span class="aiAssistDbgK">' + escapeHtml(k) + '</span><span class="aiAssistDbgV">' + escapeHtml(v) + '</span></div>');
  }
  if (!rows.length && !(et && et.llmPromptTrace && typeof et.llmPromptTrace === 'object')) return '';
  let body = rows.length ? '<div class="aiAssistDbgBody">' + rows.join('') + '</div>' : '';
  const pt = et && et.llmPromptTrace && typeof et.llmPromptTrace === 'object' ? et.llmPromptTrace : null;
  if (pt) {
    const blk = pt.blocks && typeof pt.blocks === 'object' ? pt.blocks : null;
    const blkObj = blk ? {
      resolvedTemplateId: blk.resolvedTemplateId,
      resolvedIntent: blk.resolvedIntent,
      promptVersion: blk.promptVersion,
      planBlock: blk.planBlock,
      directivesBlock: blk.directivesBlock,
      userBody: blk.userBody,
    } : {};
    let blkJson = '';
    try { blkJson = JSON.stringify(blkObj, null, 2); } catch (_e) { blkJson = '{}'; }
    if (blkJson.length > 32000) blkJson = blkJson.slice(0, 32000) + '\n...[truncated]...';
    const sys = typeof pt.finalSystemPrompt === 'string' ? pt.finalSystemPrompt : '';
    const usr = typeof pt.finalUserPrompt === 'string' ? pt.finalUserPrompt : '';
    const preStyle = 'white-space:pre-wrap;word-break:break-word;margin:4px 0;font-size:10px;line-height:1.35;max-height:200px;overflow:auto;';
    body += '<details class="aiAssistDbgPrompt" style="margin-top:6px;font-size:10px;"><summary style="cursor:pointer;">Final LLM prompt</summary>';
    if (pt.attemptIndex != null) body += '<div style="margin-top:4px;color:var(--muted);">attemptIndex: ' + escapeHtml(String(pt.attemptIndex)) + '</div>';
    body += '<div style="margin-top:6px;font-weight:600;">Blocks</div><pre style="' + preStyle + '">' + escapeHtml(blkJson) + '</pre>';
    body += '<div style="margin-top:6px;font-weight:600;">system</div><pre style="' + preStyle + '">' + escapeHtml(sys.length > 32000 ? sys.slice(0, 32000) + '\n...[truncated]...' : sys) + '</pre>';
    body += '<div style="margin-top:6px;font-weight:600;">user</div><pre style="' + preStyle + '">' + escapeHtml(usr.length > 32000 ? usr.slice(0, 32000) + '\n...[truncated]...' : usr) + '</pre>';
    body += '</details>';
  }
  return body;
}

function mockLs(debugOn) {
  const map = { h2s_debug: debugOn ? '1' : '0' };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: () => {},
    removeItem: () => {},
  };
}

(function testDebugPR2TraceHtmlHiddenWhenDebugOff() {
  const card = {
    reasoningLog: { planSummary: 'X', requestedPresetId: 'llm_v0' },
    executionTrace: { executionPath: 'llm', promptVersion: 'v1' },
  };
  const html = buildAiAssistDebugHtmlTest(card, escapeHtmlForDbg, mockLs(false));
  assert(html === '', 'no debug HTML when h2s_debug is not 1');
  console.log('PASS Debug PR2 trace HTML hidden when debug mode off');
})();

(function testDebugPR2TraceHtmlShowsSafeFieldsWhenDebugOn() {
  const card = {
    reasoningLog: {
      templateId: 'fix_pitch_v1',
      intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
      planSource: 'rule',
      planSummary: 'Fix Pitch',
      requestedPresetId: 'llm_v0',
    },
    executionTrace: {
      executionPath: 'llm',
      promptVersion: 'tmpl_v1.fix_pitch.r1',
      runState: 'done',
      resultKind: 'pitch/timing',
      accepted: true,
      patchSummary: { ops: 2, status: 'ok', reason: 'ok' },
      llmDebugSummary: { attemptCount: 1, safeModeResolved: false, reason: 'ok' },
    },
  };
  const html = buildAiAssistDebugHtmlTest(card, escapeHtmlForDbg, mockLs(true));
  assert(html.indexOf('executionPath') >= 0 && html.indexOf('llm') >= 0, 'executionPath visible');
  assert(html.indexOf('promptVersion') >= 0 && html.indexOf('tmpl_v1') >= 0, 'promptVersion visible');
  assert(html.indexOf('patchSummary.ops') >= 0, 'patchSummary.ops visible');
  assert(html.indexOf('llmDebugSummary.attemptCount') >= 0, 'llmDebugSummary visible');
  console.log('PASS Debug PR2 trace HTML shows safe fields when debug on');
})();

(function testDebugPR2TraceHtmlDoesNotLeakForbiddenFields() {
  const card = {
    reasoningLog: { planSummary: 'P', requestedPresetId: 'llm_v0' },
    executionTrace: {
      executionPath: 'llm',
      rawText: 'MODEL_SECRET_OUTPUT',
      extractedJson: '{ "secret": 1 }',
      authToken: 'sk-evil-token',
      llmDebugSummary: { attemptCount: 1, reason: 'ok' },
    },
  };
  const html = buildAiAssistDebugHtmlTest(card, escapeHtmlForDbg, mockLs(true));
  assert(html.indexOf('MODEL_SECRET_OUTPUT') < 0, 'no rawText');
  assert(html.indexOf('sk-evil') < 0, 'no authToken');
  assert(html.indexOf('extractedJson') < 0, 'no extractedJson key');
  assert(html.indexOf('{ &quot;secret&quot;: 1 }') < 0 && html.indexOf('extractedJson') < 0, 'no raw JSON blob');
  assert(html.indexOf('executionPath') >= 0, 'still has safe field');
  console.log('PASS Debug PR2 trace HTML does not leak forbidden fields');
})();
