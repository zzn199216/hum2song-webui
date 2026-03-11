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
function createFakeApp() {
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
    } else {
      const mapped = mapAiAssistTextToTemplate(text);
      const card = { type: 'card', clipId, promptText: text, createdAt: Date.now() };
      if (mapped.templateId && mapped.intent) {
        card.templateId = mapped.templateId;
        card.templateLabel = mapped.templateLabel;
        card.intent = mapped.intent;
      }
      this._aiAssistItems.push(card);
    }
    this.render();
  };
  app._aiAssistRun = async function (clipId, btnEl) {
    if (!clipId) return;
    const promptText = (btnEl && btnEl.getAttribute && btnEl.getAttribute('data-prompt')) || '';
    const card = (this._aiAssistItems || []).find(x => x.type === 'card' && String(x.clipId) === String(clipId) && (!promptText || x.promptText === promptText));
    const text = (promptText !== '' && promptText !== null) ? promptText : (card ? card.promptText : '');
    const opts = { userPrompt: text, requestedPresetId: 'llm_v0' };
    if (card && card.templateId && card.intent) {
      opts.templateId = card.templateId;
      opts.intent = card.intent;
    }
    this.setOptimizeOptions(clipId, opts);
    if (btnEl) btnEl.disabled = true;
    await this.runCommand('optimize_clip', { clipId });
    if (btnEl) btnEl.disabled = false;
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
