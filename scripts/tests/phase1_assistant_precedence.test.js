#!/usr/bin/env node
'use strict';

/**
 * Regression: Assistant deterministic narrowing precedence (rhythm → transpose → velocity).
 * Must match static/pianoroll/core/phase1_assistant_narrow.js and app.js _aiAssistSend.
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

function resolve(text){
  loadAssistantNarrow();
  return globalThis.H2SPhase1AssistantNarrow.resolvePhase1AssistantIntentFromText(text);
}

function testOrderRhythmBeforeTranspose(){
  const r = resolve('tighten the rhythm');
  assert(r && r.branch === 'rhythm_tighten_loosen', 'rhythm phrase');
  const t = resolve('transpose up 1 semitone');
  assert(t && t.branch === 'local_transpose', 'transpose phrase');
}

function testOrderTransposeBeforeVelocity(){
  const t = resolve('transpose up 2 semitones');
  assert(t && t.branch === 'local_transpose', 'transpose wins over velocity');
  const v = resolve('make this louder');
  assert(v && v.branch === 'velocity_shape', 'velocity when no transpose match');
}

function testRhythmEvenBeatsVelocityMoreEven(){
  const r = resolve('make this more even rhythmically');
  assert(r && r.branch === 'rhythm_tighten_loosen' && r.intent.mode === 'even', 'explicit rhythm wording wins over velocity "more even" dynamics');
}

function testAmbiguousTighterIsRhythm(){
  const r = resolve('make this tighter');
  assert(r && r.branch === 'rhythm_tighten_loosen', 'tighter → rhythm (not transpose/velocity)');
}

function main(){
  testOrderRhythmBeforeTranspose();
  testOrderTransposeBeforeVelocity();
  testRhythmEvenBeatsVelocityMoreEven();
  testAmbiguousTighterIsRhythm();
  console.log('phase1_assistant_precedence.test.js: OK');
}

main();
