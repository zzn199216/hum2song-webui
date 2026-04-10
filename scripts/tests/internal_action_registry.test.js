#!/usr/bin/env node
/* internal_action_registry — bounded action ids + executeBounded guard */
'use strict';

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

if (typeof globalThis.window === 'undefined') globalThis.window = {};

require(path.resolve(__dirname, '../../static/pianoroll/internal_action_registry.js'));

const R = globalThis.H2SInternalActionRegistry;
assert(R && typeof R.isBounded === 'function', 'registry loaded');
assert(R.isBounded('add_track') === true, 'add_track is bounded');
assert(R.isBounded('optimize_clip') === false, 'optimize_clip not in bounded slice');

let threw = false;
try {
  R.executeBounded({ project: { clips: [], instances: [], tracks: [] }, state: {} }, 'not_a_command', {}, {});
} catch (e) {
  threw = /not a bounded internal action/.test(e && e.message);
}
assert(threw, 'executeBounded rejects unknown command id');

assert(typeof R.labelRunningKey === 'function' && R.labelRunningKey('add_track') === 'cmd.addTrack', 'labelRunningKey for add_track');

console.log('PASS internal_action_registry.test.js');
