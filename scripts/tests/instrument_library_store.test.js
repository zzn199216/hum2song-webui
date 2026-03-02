#!/usr/bin/env node
/* PR-INS2e/INS2f: Unit tests for parseNoteKeyFromFilename and parsePackAndNoteFromRelativePath. */
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
assert(parse('A4.ogg') === 'A4', 'A4.ogg -> A4');
assert(parse('A5.mp3') === 'A5', 'A5.mp3 -> A5');
assert(parse('A6.wav') === 'A6', 'A6.wav -> A6');

assert(parse('B1.mp3') === null, 'B1 not in valid keys');
assert(parse('A0.mp3') === null, 'A0 not in valid keys');
assert(parse('A7.mp3') === null, 'A7 not in valid keys');
assert(parse('C4.mp3') === null, 'C4 not in valid keys');
assert(parse('') === null, 'empty string');
assert(parse('nofile') === null, 'no extension');

var subdirMap = { piano: 'tonejs:piano', strings: 'tonejs:strings', 'guitar-acoustic': 'tonejs:guitar-acoustic' };
var r = parsePath('piano/A1.mp3', subdirMap);
assert(r && r.packId === 'tonejs:piano' && r.noteKey === 'A1', 'piano/A1.mp3');
r = parsePath('strings/A3.wav', subdirMap);
assert(r && r.packId === 'tonejs:strings' && r.noteKey === 'A3', 'strings/A3.wav');
r = parsePath('guitar-acoustic/A6.mp3', subdirMap);
assert(r && r.packId === 'tonejs:guitar-acoustic' && r.noteKey === 'A6', 'guitar-acoustic/A6.mp3');
assert(parsePath('unknown/A1.mp3', subdirMap) === null, 'unknown subdir');
assert(parsePath('piano/C4.mp3', subdirMap) === null, 'invalid filename in known subdir');

console.log('PASS instrument_library_store parseNoteKeyFromFilename + parsePackAndNoteFromRelativePath');
