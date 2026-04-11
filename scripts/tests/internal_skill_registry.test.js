#!/usr/bin/env node
/* internal_skill_registry — first assistant skill slice + bounded pairing */
'use strict';

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

if (typeof globalThis.window === 'undefined') globalThis.window = {};

require(path.resolve(__dirname, '../../static/pianoroll/internal_action_registry.js'));
if (globalThis.window && globalThis.window.H2SInternalActionRegistry) {
  globalThis.H2SInternalActionRegistry = globalThis.window.H2SInternalActionRegistry;
}

require(path.resolve(__dirname, '../../static/pianoroll/internal_skill_registry.js'));
if (globalThis.window && globalThis.window.H2SInternalSkillRegistry) {
  globalThis.H2SInternalSkillRegistry = globalThis.window.H2SInternalSkillRegistry;
}

const R = globalThis.H2SInternalSkillRegistry;
const AR = globalThis.H2SInternalActionRegistry;

assert(R && typeof R.assistantSkillIds === 'function', 'registry exposes assistantSkillIds');
const ids = R.assistantSkillIds();
assert(JSON.stringify(ids) === JSON.stringify(['add_track', 'move_instance']), 'exactly two skills in first slice');

assert(R.isAssistantSkillEnabled('add_track') === true, 'add_track enabled');
assert(R.isAssistantSkillEnabled('move_instance') === true, 'move_instance enabled');
assert(R.isAssistantSkillEnabled('remove_instance') === true, 'bounded remove_instance enabled until listed in SKILLS');
assert(R.getSkill('add_track').phraseResolverId === 'assistant_add_track_v1', 'phraseResolverId add_track');
assert(R.getSkill('move_instance').target === R.TARGET.selected_instance, 'move target');

R._setSkillEnabledForTest('add_track', false);
assert(R.isAssistantSkillEnabled('add_track') === false, 'disabled add_track');
R._setSkillEnabledForTest('add_track', true);

assert(AR.isBounded('add_track') && AR.isBounded('move_instance'), 'skills map to bounded commands');

console.log('PASS internal_skill_registry.test.js');
