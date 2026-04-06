#!/usr/bin/env node
'use strict';

/**
 * Hardening: centralized Assistant narrow module vs inline fallback (same semantics).
 */
const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

function ensureWindowShim(){
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
}

function loadVelocityShape(){
  ensureWindowShim();
  if (globalThis.H2SVelocityShape) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/velocity_shape.js'));
  if (globalThis.window && globalThis.window.H2SVelocityShape) globalThis.H2SVelocityShape = globalThis.window.H2SVelocityShape;
}

function loadLocalTranspose(){
  ensureWindowShim();
  if (globalThis.H2SLocalTranspose) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/local_transpose.js'));
  if (globalThis.window && globalThis.window.H2SLocalTranspose) globalThis.H2SLocalTranspose = globalThis.window.H2SLocalTranspose;
}

function loadRhythm(){
  ensureWindowShim();
  if (globalThis.H2SRhythmTightenLoosen) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/rhythm_tighten_loosen.js'));
  if (globalThis.window && globalThis.window.H2SRhythmTightenLoosen) globalThis.H2SRhythmTightenLoosen = globalThis.window.H2SRhythmTightenLoosen;
}

function loadAssistantNarrow(){
  loadVelocityShape();
  loadLocalTranspose();
  loadRhythm();
  ensureWindowShim();
  if (globalThis.H2SPhase1AssistantNarrow) return;
  require(path.resolve(__dirname, '../../static/pianoroll/core/phase1_assistant_narrow.js'));
  if (globalThis.window && globalThis.window.H2SPhase1AssistantNarrow) globalThis.H2SPhase1AssistantNarrow = globalThis.window.H2SPhase1AssistantNarrow;
}

function sameResult(a, b){
  if (a == null && b == null) return true;
  if (!a || !b) return false;
  if (String(a.branch) !== String(b.branch)) return false;
  return JSON.stringify(a.intent) === JSON.stringify(b.intent);
}

function testResolveMatchesInline(){
  loadAssistantNarrow();
  const N = globalThis.H2SPhase1AssistantNarrow;
  const phrases = [
    'tighten the rhythm',
    'transpose up 1 semitone',
    'make this louder',
    'make this more even rhythmically',
    'no deterministic match at all xyz123',
  ];
  for (const p of phrases){
    const full = N.resolvePhase1AssistantIntentFromText(p);
    const inl = N.resolvePhase1AssistantIntentFromTextInline(globalThis, p);
    assert(sameResult(full, inl), 'resolve matches inline: ' + p);
  }
}

function testInlineWorksWithoutApiGlobal(){
  loadAssistantNarrow();
  const N = globalThis.H2SPhase1AssistantNarrow;
  const inline = N.resolvePhase1AssistantIntentFromTextInline;
  const saved = globalThis.H2SPhase1AssistantNarrow;
  delete globalThis.H2SPhase1AssistantNarrow;
  try {
    const a = inline(globalThis, 'tighten the rhythm');
    assert(a && a.branch === 'rhythm_tighten_loosen', 'inline without API global');
  } finally {
    globalThis.H2SPhase1AssistantNarrow = saved;
  }
}

function testAppFallbackMatchesInlineWhenApiMissing(){
  loadAssistantNarrow();
  const N = globalThis.H2SPhase1AssistantNarrow;
  const inline = N.resolvePhase1AssistantIntentFromTextInline;
  const saved = globalThis.H2SPhase1AssistantNarrow;
  delete globalThis.H2SPhase1AssistantNarrow;
  try {
    function appFallback(root, text){
      const R = root.H2SRhythmTightenLoosen;
      if (R && typeof R.narrowRhythmIntentFromText === 'function'){
        const n = R.narrowRhythmIntentFromText(text);
        if (n && n.mode) return { branch: 'rhythm_tighten_loosen', intent: n };
      }
      const LT = root.H2SLocalTranspose;
      if (LT && typeof LT.narrowLocalTransposeIntentFromText === 'function'){
        const n = LT.narrowLocalTransposeIntentFromText(text);
        if (n && isFinite(Number(n.semitone_delta))) return { branch: 'local_transpose', intent: n };
      }
      const VS = root.H2SVelocityShape;
      if (VS && typeof VS.narrowVelocityShapeIntentFromText === 'function'){
        const n = VS.narrowVelocityShapeIntentFromText(text);
        if (n && n.mode) return { branch: 'velocity_shape', intent: n };
      }
      return null;
    }
    const phrases = ['tighten the rhythm', 'transpose up 2 semitones', 'make this softer'];
    for (const p of phrases){
      assert(sameResult(inline(globalThis, p), appFallback(globalThis, p)), 'app fallback matches inline: ' + p);
    }
  } finally {
    globalThis.H2SPhase1AssistantNarrow = saved;
  }
}

function testBrokenApiFallsBackToInline(){
  loadAssistantNarrow();
  const N = globalThis.H2SPhase1AssistantNarrow;
  const saved = globalThis.H2SPhase1AssistantNarrow;
  globalThis.H2SPhase1AssistantNarrow = {
    resolvePhase1AssistantIntentFromText: function(){ throw new Error('fail'); },
    resolvePhase1AssistantIntentFromTextInline: saved.resolvePhase1AssistantIntentFromTextInline,
  };
  try {
    const root = globalThis;
    const api = root.H2SPhase1AssistantNarrow;
    let r = null;
    try {
      r = api.resolvePhase1AssistantIntentFromText('x');
    } catch (_e) { /* fall through */ }
    if (api && typeof api.resolvePhase1AssistantIntentFromTextInline === 'function'){
      try {
        r = api.resolvePhase1AssistantIntentFromTextInline(root, 'tighten the rhythm');
      } catch (_e2) { r = null; }
    }
    assert(r && r.branch === 'rhythm_tighten_loosen', 'simulate throw then inline');
  } finally {
    globalThis.H2SPhase1AssistantNarrow = saved;
  }
}

function main(){
  testResolveMatchesInline();
  testInlineWorksWithoutApiGlobal();
  testAppFallbackMatchesInlineWhenApiMissing();
  testBrokenApiFallsBackToInline();
  console.log('phase1_assistant_fallback.test.js: OK');
}

main();
