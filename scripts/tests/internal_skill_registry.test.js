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
assert(JSON.stringify(ids) === JSON.stringify(['add_clip_to_timeline', 'add_track', 'move_instance', 'remove_instance']), 'four internal skills');

assert(R.isAssistantSkillEnabled('add_clip_to_timeline') === true, 'add_clip_to_timeline enabled when bounded');
assert(R.isAssistantSkillEnabled('add_track') === true, 'add_track enabled');
assert(R.isAssistantSkillEnabled('move_instance') === true, 'move_instance enabled');
assert(R.isAssistantSkillEnabled('remove_instance') === true, 'remove_instance enabled');
assert(R.getSkill('add_clip_to_timeline').phraseResolverId === 'assistant_add_clip_to_timeline_v1', 'phraseResolverId add_clip_to_timeline');
assert(R.getSkill('add_track').phraseResolverId === 'assistant_add_track_v1', 'phraseResolverId add_track');
assert(R.getSkill('move_instance').phraseResolverId === 'assistant_move_instance_v1', 'phraseResolverId move_instance');
assert(R.getSkill('move_instance').target === R.TARGET.selected_instance, 'move target');
assert(R.getSkill('remove_instance').phraseResolverId === 'assistant_remove_instance_v1', 'phraseResolverId remove_instance');
assert(R.getSkill('remove_instance').confirmPolicy === R.CONFIRM.assistant_remove_instance, 'remove confirmPolicy matches action slice');
assert(R.getSkill('remove_instance').target === R.TARGET.selected_instance, 'remove target');

R._setSkillEnabledForTest('add_track', false);
assert(R.isAssistantSkillEnabled('add_track') === false, 'disabled add_track');
R._setSkillEnabledForTest('add_track', true);

R._setSkillEnabledForTest('remove_instance', false);
assert(R.isAssistantSkillEnabled('remove_instance') === false, 'disabled remove_instance');
R._setSkillEnabledForTest('remove_instance', true);

assert(
  AR.isBounded('add_clip_to_timeline') && AR.isBounded('add_track') && AR.isBounded('move_instance') && AR.isBounded('remove_instance'),
  'skills map to bounded commands',
);

console.log('PASS internal_skill_registry.test.js');
