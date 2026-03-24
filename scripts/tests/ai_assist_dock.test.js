#!/usr/bin/env node
/* PR-UX7a: AI Assistant dock tests — Send behavior, card creation, Run => runCommand */
'use strict';

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Stub I18N
const I18N = { t: (k) => { const m = { 'aiAssist.selectClipFirst': 'Select a clip first.', 'aiAssist.run': 'Run', 'aiAssist.openOptimize': 'Open Optimize', 'aiAssist.undo': 'Undo', 'aiAssist.noClip': 'No clip selected', 'aiAssist.clipPrefix': 'Clip: ', 'aiAssist.trackPrefix': 'Track ' }; return m[k] || k; } };

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
  const doc = createStubDocument();
  const setOptimizeOptionsCalls = [];
  const runCommandCalls = [];
  const app = {
    state: { selectedClipId: null },
    project: { clips: [{ id: 'clip-1', name: 'Test Clip', parentRevisionId: 'rev-0' }] },
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
            optimizeResult: { ok: true, ops: 1, patchSummary: { executedPreset: 'llm_v0' } },
          },
        });
      }
      if (cmd === 'rollback_clip') {
        return Promise.resolve({
          ok: true,
          data: { clipId: cid, rollbackResult: { ok: true, changed: true } },
        });
      }
      return Promise.resolve({ ok: true });
    },
    getProjectV2() {
      return { clips: { 'clip-1': { name: 'Test Clip', parentRevisionId: 'rev-0' } } };
    },
    render: () => {},
  };
  app._t = I18N.t.bind(I18N);
  app._aiAssistSend = function () {
    const inp = doc.getElementById('aiAssistInput');
    const text = String(inp ? inp.value : '').trim();
    if (!text) return;
    if (inp) inp.value = '';
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
    const text = (promptText !== '' && promptText !== null) ? promptText : (card.promptText || '');
    const opts = { userPrompt: text, requestedPresetId: 'llm_v0' };
    if (card.templateId && card.intent) {
      opts.templateId = card.templateId;
      opts.intent = card.intent;
    }
    if (card.plan && typeof card.plan === 'object' && Array.isArray(card.plan.planLines) && card.plan.planLines.length >= 1 && (card.plan.planTitle || card.plan.planKind)) {
      opts.plan = { planKind: card.plan.planKind || null, planTitle: (card.plan.planTitle && String(card.plan.planTitle).trim()) ? String(card.plan.planTitle).trim() : '', planLines: card.plan.planLines.slice(0, 6).filter(function(l){ return typeof l === 'string'; }) };
    }
    this.setOptimizeOptions(clipId, opts);
    card.runState = 'running';
    card.resultKind = null;
    card.usedPresetId = null;
    card.lastError = null;
    if (btnEl) btnEl.disabled = true;
    this.render();
    try {
      const res = await this.runCommand('optimize_clip', { clipId });
      if (btnEl) btnEl.disabled = false;
      if (!res || !res.ok) {
        card.runState = 'failed';
        card.lastError = (res && res.message) ? String(res.message).slice(0, 80) : 'Optimize failed';
        if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, null, false, card.runState, card.resultKind, card.lastError);
        this.render();
        return;
      }
      const optRes = (res.data && res.data.optimizeResult) ? res.data.optimizeResult : null;
      if (!optRes || !optRes.ok) {
        card.runState = 'failed';
        card.lastError = (optRes && (optRes.reason || optRes.detail || optRes.message)) ? String(optRes.reason || optRes.detail || optRes.message).slice(0, 80) : 'Optimize failed';
        if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, optRes && optRes.patchSummary ? optRes.patchSummary : null, false, card.runState, card.resultKind, card.lastError);
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
    } catch (err) {
      if (btnEl) btnEl.disabled = false;
      card.runState = 'failed';
      card.lastError = (err && err.message) ? String(err.message).slice(0, 80) : 'Optimize failed';
      if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, null, false, card.runState, card.resultKind, card.lastError);
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
    assert(!('plan' in setOptimizeOptionsCalls[0].opts) || setOptimizeOptionsCalls[0].opts.plan == null, 'PR3: no plan when card has no plan');
    console.log('PASS PR3 Run without plan does not pass plan');
  });
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
    console.log('PASS PR2 Run enriches reasoningLog with result info');
  });
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
      optimizeResult: { ok: true, ops: 2, patchSummary: { executedPreset: 'llm_v0', hasPitchChange: true } },
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
