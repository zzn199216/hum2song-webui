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
  console.log('PASS selection_view instance convert markup');
})();

(function testSelectionControllerWiring(){
  const p = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'selection_controller.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('onConvertAudioToEditable'), 'controller accepts convert callback');
  assert(src.includes('convertAudioEditable') && src.includes('onConvertAudioToEditable(inst.clipId, inst.id)'), 'convert passes clip + instance id');
  assert(src.includes("P.clipKind(sel.clip) === 'audio'"), 'audio detection uses clipKind');
  console.log('PASS selection_controller wiring');
})();

(function testLibraryConvertUnchanged(){
  const p = path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'library_controller.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(/fn\(clipId\)/.test(src) && src.includes('convertToEditable'), 'library still invokes convert with clip id only');
  console.log('PASS library controller clip-only convert');
})();
