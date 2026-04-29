#!/usr/bin/env node
/**
 * Timeline selection inspector: audio instance shows convert; note instance does not.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');

(function testSelectionViewMarkup(){
  const p = path.join(repoRoot, 'static', 'pianoroll', 'ui', 'selection_view.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('isAudio'), 'selection view branches on isAudio');
  assert(/data-act="convertAudioEditable"/.test(src), 'audio path exposes convert action');
  assert(/const editBtn = isAudio/.test(src) && /data-act="edit"/.test(src), 'note path keeps Edit; audio uses convert branch');
  assert(/data-act="addAccompaniment"/.test(src), 'note path exposes add accompaniment');
  assert(/addAccompBtn = isAudio\s*\?\s*''/.test(src), 'add accompaniment hidden for audio like bass');
  console.log('PASS selection_view instance convert markup');
})();

(function testSelectionViewAddAccompanimentRuntime(){
  const H2SSelectionView = require(path.join(repoRoot, 'static', 'pianoroll', 'ui', 'selection_view.js'));
  const htmlNote = H2SSelectionView.selectionBoxInnerHTML({
    isAudio: false,
    clipName: 'Melody',
    startSec: 0,
    transpose: 0,
    addBassLabel: 'Bass',
    addAccompanimentLabel: 'Add accompaniment',
    addAccompanimentBadgeLabel: 'Experimental',
  });
  assert(htmlNote.includes('data-act="addAccompaniment"') && htmlNote.includes('btnSelAddAccompaniment'), 'note clip renders accompaniment button');
  assert(htmlNote.includes('data-act="addBass"'), 'note clip still renders add bass');
  const htmlAudio = H2SSelectionView.selectionBoxInnerHTML({
    isAudio: true,
    clipName: 'Rec',
    startSec: 0,
    transpose: 0,
    convertLabel: 'Convert',
  });
  assert(!htmlAudio.includes('addAccompaniment'), 'audio clip must not render accompaniment control');
  assert(!htmlAudio.includes('addBass'), 'audio clip must not render add bass');
  console.log('PASS selection_view add accompaniment runtime');
})();

(function testSelectionControllerWiring(){
  const p = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'selection_controller.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('onConvertAudioToEditable'), 'controller accepts convert callback');
  assert(src.includes('convertAudioEditable') && src.includes('onConvertAudioToEditable(inst.clipId, inst.id)'), 'convert passes clip + instance id');
  assert(src.includes("P.clipKind(sel.clip) === 'audio'"), 'audio detection uses clipKind');
  assert(src.includes('onAddAccompaniment') && /onAddAccompaniment\(inst\.id\)/.test(src), 'add accompaniment forwards instance id');
  assert(src.includes('btnAddAccomp') && src.includes('addAccompaniment'), 'controller binds add accompaniment action');
  console.log('PASS selection_controller wiring');
})();

(function testAppArrangementUi(){
  const p = path.join(repoRoot, 'static', 'pianoroll', 'app.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(/\brunArrangementV0\s*\(\s*\{\s*goal:\s*['"]add_accompaniment_v0['"]\s*\}\s*\)/.test(src), 'app calls runArrangementV0 with add_accompaniment_v0');
  assert(src.includes('onAddAccompaniment:'), 'selection wiring includes onAddAccompaniment');
  assert(src.includes('addAccompanimentFromSelected'), 'app implements addAccompanimentFromSelected');
  assert(src.includes('addBassFromSelected'), 'add bass handler preserved');
  console.log('PASS app arrangement ui wiring');
})();

(function testArrangeAccompanimentI18nKeys(){
  const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'static', 'i18n', 'locales', 'en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(repoRoot, 'static', 'i18n', 'locales', 'zh.json'), 'utf8'));
  const keys = [
    'arrange.addAccompaniment',
    'arrange.addAccompanimentBadge',
    'arrange.addAccompanimentRunning',
    'arrange.addAccompanimentDone',
    'arrange.addAccompanimentFail.generic',
    'arrange.addAccompanimentFail.unavailable',
    'arrange.addAccompanimentFail.audioClip',
    'arrange.addAccompanimentFail.llmConfig',
    'arrange.addAccompanimentFail.llmRequest',
    'arrange.addAccompanimentFail.invalidOutput',
    'arrange.addAccompanimentFail.validation',
    'arrange.addAccompanimentFail.apply',
  ];
  for (const k of keys){
    assert(typeof en[k] === 'string' && en[k], 'en missing ' + k);
    assert(typeof zh[k] === 'string' && zh[k], 'zh missing ' + k);
  }
  console.log('PASS arrange accompaniment i18n keys');
})();

(function testLibraryConvertUnchanged(){
  const p = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'library_controller.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(/fn\(clipId\)/.test(src) && src.includes('convertToEditable'), 'library still invokes convert with clip id only');
  console.log('PASS library controller clip-only convert');
})();
