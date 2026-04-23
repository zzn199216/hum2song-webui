#!/usr/bin/env node
/* PR-INS2e/INS2f/INS2g: Unit tests for parseNoteKeyFromFilename and parsePackAndNoteFromRelativePath. */
'use strict';
const store = require('../../static/pianoroll/controllers/instrument_library_store.js');
const parse = store.parseNoteKeyFromFilename;
const parsePath = store.parsePackAndNoteFromRelativePath;

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'Assertion failed');
}

assert(parse('A1.mp3') === 'A1', 'A1.mp3 -> A1');
assert(parse('a2.wav') === 'A2', 'a2.wav -> A2');
assert(parse('A3.MP3') === 'A3', 'A3.MP3 -> A3');
assert(parse('A6.wav') === 'A6', 'A6.wav -> A6');

assert(parse('C3.mp3') === 'C3', 'C3 scientific pitch');
assert(parse('Ds4.mp3') === 'D#4', 'Ds4 -> D#4 (s=sharp)');
assert(parse('F#2.wav') === 'F#2', 'F#2 sharp');
assert(parse('Bb3.mp3') === 'Bb3', 'Bb3 flat');
assert(parse('Cs5.mp3') === 'C#5', 'Cs5 -> C#5');
assert(parse('Gs2.ogg') === 'G#2', 'Gs2 -> G#2');

assert(parse('H3.mp3') === null, 'H invalid note letter');
assert(parse('A0.mp3') === 'A0', 'A0 valid scientific pitch');
assert(parse('') === null, 'empty string');
assert(parse('nofile') === null, 'no extension');

var subdirMap = { piano: 'tonejs:piano', strings: 'tonejs:strings', 'guitar-acoustic': 'tonejs:guitar-acoustic' };
var r = parsePath('piano/A1.mp3', subdirMap);
assert(r && r.packId === 'tonejs:piano' && r.noteKey === 'A1', 'piano/A1.mp3');
r = parsePath('piano/C3.mp3', subdirMap);
assert(r && r.packId === 'tonejs:piano' && r.noteKey === 'C3', 'piano/C3.mp3');
r = parsePath('guitar-acoustic/Ds4.mp3', subdirMap);
assert(r && r.packId === 'tonejs:guitar-acoustic' && r.noteKey === 'D#4', 'guitar-acoustic/Ds4.mp3');
assert(parsePath('unknown/A1.mp3', subdirMap) === null, 'unknown subdir');

console.log('PASS instrument_library_store parseNoteKeyFromFilename + parsePackAndNoteFromRelativePath');
