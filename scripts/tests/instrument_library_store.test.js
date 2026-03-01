#!/usr/bin/env node
/* PR-INS2e: Unit test for parseNoteKeyFromFilename (pure function). */
'use strict';
const store = require('../../static/pianoroll/controllers/instrument_library_store.js');
const parse = store.parseNoteKeyFromFilename;

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

console.log('PASS instrument_library_store parseNoteKeyFromFilename');
