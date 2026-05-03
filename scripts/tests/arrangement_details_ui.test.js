#!/usr/bin/env node
/**
 * LLM Arrangement v0 — inspector details surface (snapshot, popup wiring, redaction rules).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');

/** Mirrors app.js _isSensitiveArrangementKey / _redactArrangementDeep for contract tests. */
function redactArrangementDeepLikeApp(value){
  const REDACT = '[REDACTED]';
  function isK(k){
    const s = String(k || '').toLowerCase();
    if (!s) return false;
    if (s === 'headers' || s === 'authorization' || s === 'password' || s === 'auth') return true;
    if (s === 'apikey' || s === 'api_key' || s.endsWith('apikey')) return true;
    if (s.includes('secret')) return true;
    if (s === 'token' || s.endsWith('_token') || s === 'authtoken' || s === 'accesstoken' || s === 'refreshtoken') return true;
    if (s.indexOf('authorization') >= 0) return true;
    return false;
  }
  function walk(v){
    if (v == null) return v;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object') return v;
    const out = {};
    for (const k of Object.keys(v)){
      if (isK(k)) out[k] = REDACT;
      else out[k] = walk(v[k]);
    }
    return out;
  }
  return walk(value);
}

(function testIndexHasArrangementPopup(){
  const html = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'index.html'), 'utf8');
  assert(html.includes('id="studioArrangementDetails"'), 'index must define arrangement details popover');
  assert(html.includes('id="studioArrangementDetailsBody"'), 'arrangement details body');
  assert(html.includes('id="btnArrangementDetailsClose"'), 'arrangement details close');
  assert(html.includes('id="lastOptDetailsHeading"'), 'optimize details heading unchanged');
  assert(html.includes('id="studioLastOptimizeDetails"'), 'optimize details pop unchanged');
  console.log('PASS arrangement details index.html shell');
})();

(function testAppSnapshotAndPopupMethods(){
  const src = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'app.js'), 'utf8');
  assert(src.includes('_lastArrangementSnapshot'), 'app keeps last arrangement snapshot');
  assert(src.includes('_commitArrangementSnapshot(result, goal, clipId, instId)'), 'success/failure path commits snapshot from run result');
  assert(src.includes('promptTrace'), 'snapshot includes promptTrace');
  assert(src.includes('rawPatch'), 'snapshot includes rawPatch');
  assert(src.includes('qualityReport'), 'snapshot includes qualityReport');
  assert(src.includes('arrange.detail.qualityWarnings'), 'details render wired for quality');
  assert(src.includes('_openArrangementDetails'), 'open arrangement details');
  assert(src.includes('_renderArrangementDetailsBody'), 'render arrangement details body');
  assert(src.includes('_redactArrangementDeep'), 'redact before storing snapshot');
  assert(src.includes('getHasArrangementDetails'), 'selection uses has-arrangement snapshot');
  assert(src.includes('_initArrangementDetails'), 'arrangement details init');
  assert(src.includes('studioArrangementDetails') && src.includes('btnSelArrangementDetails'), 'DOM ids wired');
  assert(src.includes('_renderLastOptimizeDetailsBody'), 'optimize details body render still present');
  console.log('PASS arrangement details app.js wiring');
})();

(function testRedactionSensitiveKeys(){
  const o = redactArrangementDeepLikeApp({
    ok: true,
    api_key: 'secret1',
    nested: { authorization: 'bearer x', password: 'p', client_secret: 'cs', authToken: 'at' },
    promptTrace: { systemPrompt: 'safe', userPrompt: 'also safe' },
    author: { name: 'keep' },
  });
  assert(o.api_key === '[REDACTED]');
  assert(o.nested.authorization === '[REDACTED]');
  assert(o.nested.password === '[REDACTED]');
  assert(o.nested.client_secret === '[REDACTED]');
  assert(o.nested.authToken === '[REDACTED]');
  assert(o.promptTrace.systemPrompt === 'safe');
  assert(o.author && o.author.name === 'keep', 'do not redact unrelated author object');
  console.log('PASS arrangement redaction helper');
})();

(function testSelectionViewArrangementDetailsNoteOnly(){
  const H2SSelectionView = require(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'selection_view.js'));
  const withDet = H2SSelectionView.selectionBoxInnerHTML({
    isAudio: false,
    clipName: 'M',
    startSec: 0,
    transpose: 0,
    showArrangementDetails: true,
    arrangementDetailsLabel: 'Details',
  });
  assert(withDet.includes('btnSelArrangementDetails') && withDet.includes('data-act="arrangementDetails"'), 'note + flag shows details entry');
  const audioWithDet = H2SSelectionView.selectionBoxInnerHTML({
    isAudio: true,
    clipName: 'A',
    startSec: 0,
    transpose: 0,
    convertLabel: 'C',
    showArrangementDetails: true,
    arrangementDetailsLabel: 'Details',
  });
  assert(!audioWithDet.includes('arrangementDetails'), 'audio: hide arrangement details row');
  console.log('PASS selection_view arrangement details note-only');
})();

(function testArrangementDetailI18nParity(){
  const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'static', 'i18n', 'locales', 'en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(repoRoot, 'static', 'i18n', 'locales', 'zh.json'), 'utf8'));
  const keys = [
    'arrange.detailsShort', 'arrange.detailTitle', 'arrange.detailsCloseAria',
    'arrange.detail.empty', 'arrange.detail.outcome', 'arrange.detail.copyTrace',
    'arrange.detail.copyUser', 'arrange.detail.copyPatch', 'arrange.detail.copyOk', 'arrange.detail.copyFail',
    'arrange.detail.qualityWarnings', 'arrange.detail.qualityNone', 'arrange.detail.qualityWarnList',
    'arrange.quality.short_coverage', 'arrange.quality.questionable_instrument',
  ];
  for (const k of keys){
    assert(typeof en[k] === 'string' && en[k], 'en ' + k);
    assert(typeof zh[k] === 'string' && zh[k], 'zh ' + k);
  }
  assert(en['arrange.addAccompanimentDone'].toLowerCase().indexOf('llm') >= 0, 'en success mentions LLM');
  console.log('PASS arrangement details i18n parity');
})();

(function testPersistDocNoArrangementSnapshot(){
  const p = path.join(repoRoot, 'static', 'pianoroll', 'project.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(!src.includes('_lastArrangementSnapshot'), 'project layer must not reference UI arrangement snapshot');
  console.log('PASS project.js does not persist arrangement snapshot');
})();
