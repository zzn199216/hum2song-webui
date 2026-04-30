#!/usr/bin/env node
'use strict';

const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

if (typeof globalThis.window === 'undefined') globalThis.window = {};

require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
const H2SProject = globalThis.window.H2SProject;
require(path.resolve(__dirname, '../../static/pianoroll/core/arrangement_patch_v0.js'));
const ArrangementPatch = require(path.resolve(__dirname, '../../static/pianoroll/core/arrangement_patch_v0.js'));
const ArrangementController = require(path.resolve(__dirname, '../../static/pianoroll/controllers/arrangement_controller.js'));

assert(H2SProject, 'H2SProject loaded');
assert(ArrangementPatch && ArrangementPatch.applyArrangementPatchV0ToProject, 'arrangement patch loaded');
assert(ArrangementController && ArrangementController.create, 'arrangement controller loaded');

function makeProjectWithMelody(){
  const p2 = H2SProject.defaultProjectV2();
  const melodyScore = {
    version: 2,
    time_signature: '4/4',
    tracks: [{
      id: 'mel_t0',
      name: 'Melody',
      notes: [
        { id: 'm0', pitch: 64, velocity: 90, startBeat: 0, durationBeat: 1 },
        { id: 'm1', pitch: 67, velocity: 90, startBeat: 1, durationBeat: 1 },
      ],
    }],
  };
  const melodyClip = H2SProject.createClipFromScoreBeat(melodyScore, { id: 'clip_melody', name: 'Melody' });
  p2.clips[melodyClip.id] = melodyClip;
  p2.clipOrder.push(melodyClip.id);
  const melodyInst = H2SProject.createInstanceV2(melodyClip.id, 8, p2.tracks[0].id);
  p2.instances.push(melodyInst);
  H2SProject.normalizeProjectV2(p2);
  return { p2, melodyClip, melodyInst };
}

function makeControllerHarness(seed){
  let project = seed.project;
  let commitCount = 0;
  let selectedClipId = seed.selectedClipId;
  let selectedInstanceId = seed.selectedInstanceId;
  const logs = [];
  const ctrl = ArrangementController.create({
    getProjectV2: () => project,
    setProjectFromV2: (next) => { commitCount += 1; project = next; },
    getSelectedClipId: () => selectedClipId,
    getSelectedInstanceId: () => selectedInstanceId,
    log: (m, d) => logs.push({ m, d }),
    H2SProject,
  });
  return {
    ctrl,
    getProject: () => project,
    getCommitCount: () => commitCount,
    setSelectedClipId: (v) => { selectedClipId = v; },
    setSelectedInstanceId: (v) => { selectedInstanceId = v; },
    logs,
  };
}

function setMockLlm(mock){
  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: () => ({
      baseUrl: mock.baseUrl || 'https://unit.test/v1',
      model: mock.model || 'unit-model',
      authToken: mock.authToken || 'secret-token',
    }),
  };
  globalThis.H2S_LLM_CLIENT = {
    callChatCompletions: mock.callChatCompletions,
    extractJsonObject: mock.extractJsonObject,
  };
}

async function testValidPatchOneCommit(){
  const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
  const harness = makeControllerHarness({ project: p2, selectedClipId: melodyClip.id, selectedInstanceId: melodyInst.id });
  let llmCalls = 0;
  const patch = {
    kind: 'arrangement_patch_v0',
    version: 1,
    ops: [
      { op: 'createTrack', trackId: 'trk_acc_1', name: 'Accompaniment', instrument: 'piano' },
      {
        op: 'createClip',
        clipId: 'clip_acc_1',
        name: 'Accompaniment Clip',
        scoreBeat: {
          version: 2,
          time_signature: '4/4',
          tracks: [{ id: 'acc_t0', notes: [{ id: 'a0', pitch: 52, velocity: 72, startBeat: 0, durationBeat: 1 }] }],
        },
      },
      { op: 'addInstance', instanceId: 'inst_acc_1', clipId: 'clip_acc_1', trackId: 'trk_acc_1', startBeat: 8 },
    ],
  };
  setMockLlm({
    callChatCompletions: async () => {
      llmCalls += 1;
      return { text: '```json\n' + JSON.stringify(patch) + '\n```' };
    },
    extractJsonObject: (txt) => {
      const m = String(txt || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  });

  const beforeMelody = JSON.stringify(p2.clips[melodyClip.id].score);
  const res = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0', userPrompt: 'add soft pad' });
  assert(res.ok === true, 'valid patch should succeed');
  assert(harness.getCommitCount() === 1, 'should commit once');
  assert(llmCalls === 1, 'one llm call by default');
  assert(Array.isArray(res.summary.createdTrackIds) && res.summary.createdTrackIds[0] === 'trk_acc_1', 'summary track ids');
  assert(JSON.stringify(harness.getProject().clips[melodyClip.id].score) === beforeMelody, 'melody clip remains unchanged');
}

async function testInvalidPatchNoCommit(){
  const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
  const harness = makeControllerHarness({ project: p2, selectedClipId: melodyClip.id, selectedInstanceId: melodyInst.id });
  let llmCalls = 0;
  const invalidPatch = { kind: 'arrangement_patch_v0', version: 1, ops: [{ op: 'deleteClip', clipId: melodyClip.id }] };
  setMockLlm({
    callChatCompletions: async () => {
      llmCalls += 1;
      return { text: '```json\n' + JSON.stringify(invalidPatch) + '\n```' };
    },
    extractJsonObject: (txt) => {
      const m = String(txt || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  });
  const res = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0' });
  assert(res.ok === false && res.reason === 'patch_validation_failed', 'invalid patch rejected');
  assert(harness.getCommitCount() === 0, 'no commit on invalid patch');
  assert(llmCalls === 1, 'still one call');
}

async function testMalformedNoJsonNoCommit(){
  const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
  const harness = makeControllerHarness({ project: p2, selectedClipId: melodyClip.id, selectedInstanceId: melodyInst.id });
  let llmCalls = 0;
  setMockLlm({
    callChatCompletions: async () => {
      llmCalls += 1;
      return { text: 'nonsense output' };
    },
    extractJsonObject: () => null,
  });
  const res = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0' });
  assert(res.ok === false && res.reason === 'llm_no_valid_json', 'no json rejected');
  assert(harness.getCommitCount() === 0, 'no commit when malformed');
  assert(llmCalls === 1, 'one call only');
}

async function testBeatsOnlyInvariantRejectsSeconds(){
  const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
  const harness = makeControllerHarness({ project: p2, selectedClipId: melodyClip.id, selectedInstanceId: melodyInst.id });
  const patchWithSeconds = {
    kind: 'arrangement_patch_v0',
    version: 1,
    ops: [
      { op: 'createTrack', trackId: 'trk_acc_s', name: 'Acc', instrument: 'piano' },
      {
        op: 'createClip',
        clipId: 'clip_acc_s',
        name: 'Acc',
        scoreBeat: {
          version: 2,
          tracks: [{ id: 't0', notes: [{ id: 'n0', pitch: 50, velocity: 70, startBeat: 0, durationBeat: 1, startSec: 0.1 }] }],
        },
      },
      { op: 'addInstance', instanceId: 'inst_acc_s', clipId: 'clip_acc_s', trackId: 'trk_acc_s', startBeat: 8 },
    ],
  };
  setMockLlm({
    callChatCompletions: async () => ({ text: '```json\n' + JSON.stringify(patchWithSeconds) + '\n```' }),
    extractJsonObject: (txt) => {
      const m = String(txt || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  });
  const res = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0' });
  assert(res.ok === false && res.reason === 'patch_validation_failed', 'seconds field should fail validation');
  assert(String(res.detail).indexOf('seconds_fields_forbidden') >= 0, 'seconds rejection detail');
  assert(harness.getCommitCount() === 0, 'no commit on seconds fields');
}

async function testPromptIncludesRequiredContext(){
  const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
  const harness = makeControllerHarness({ project: p2, selectedClipId: melodyClip.id, selectedInstanceId: melodyInst.id });
  const patch = { kind: 'arrangement_patch_v0', version: 1, ops: [] };
  setMockLlm({
    callChatCompletions: async () => ({ text: '```json\n' + JSON.stringify(patch) + '\n```' }),
    extractJsonObject: (txt) => {
      const m = String(txt || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  });
  const res = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0', userPrompt: 'simple chords' });
  assert(res.promptTrace && typeof res.promptTrace.userPrompt === 'string', 'prompt trace exists');
  const up = res.promptTrace.userPrompt;
  assert(up.indexOf('Allowed schema JSON') >= 0, 'schema included');
  assert(up.indexOf('melodyNoteTableBeat') >= 0, 'note table included');
  assert(up.indexOf('"bpm"') >= 0, 'bpm included');
  assert(up.indexOf('instanceStartBeat') >= 0, 'instance start beat included');
  const sp = res.promptTrace.systemPrompt;
  assert(sp.indexOf('beats-only') >= 0, 'beats-only constraint included');
  assert(sp.indexOf('no startSec/durationSec/spanSec') >= 0, 'no seconds constraint included');
  assert(sp.indexOf('additive-only') >= 0, 'additive-only constraint included');

  assert(up.indexOf('Strategy for add_accompaniment_v0:') >= 0, 'add_accompaniment_v0 strategy block header');
  assert(/\bbass-first\b/i.test(up), 'bass-first support guidance');
  assert(up.indexOf('Avoid pad-only') >= 0 || up.indexOf('block-chord-only') >= 0, 'discourages pad/block sustained default');
}

async function testRejectsMissingOrAudioSelection(){
  const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
  const harness = makeControllerHarness({ project: p2, selectedClipId: null, selectedInstanceId: melodyInst.id });
  setMockLlm({
    callChatCompletions: async () => ({ text: '' }),
    extractJsonObject: () => null,
  });
  const missingClip = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0' });
  assert(missingClip.ok === false && missingClip.reason === 'selected_clip_missing', 'missing clip rejected');

  const audioClip = H2SProject.createClipFromAudio({
    id: 'clip_audio_1',
    name: 'Audio',
    assetRef: 'asset://a.wav',
    durationSec: 2.0,
    bpm: 120,
  });
  p2.clips[audioClip.id] = audioClip;
  p2.clipOrder.push(audioClip.id);
  const audioInst = H2SProject.createInstanceV2(audioClip.id, 4, p2.tracks[0].id);
  p2.instances.push(audioInst);
  H2SProject.normalizeProjectV2(p2);
  harness.setSelectedClipId(audioClip.id);
  harness.setSelectedInstanceId(audioInst.id);
  const audioRes = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0' });
  assert(audioRes.ok === false && audioRes.reason === 'audio_clip_not_supported', 'audio clip rejected');
}

async function testPromptTraceSanitized(){
  const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
  const harness = makeControllerHarness({ project: p2, selectedClipId: melodyClip.id, selectedInstanceId: melodyInst.id });
  setMockLlm({
    authToken: 'TOP_SECRET',
    callChatCompletions: async () => ({ text: '```json\n{"kind":"arrangement_patch_v0","version":1,"ops":[]}\n```' }),
    extractJsonObject: (txt) => {
      const m = String(txt || '').match(/```json\s*([\s\S]*?)\s*```/);
      return m ? JSON.parse(m[1]) : null;
    },
  });
  const res = await harness.ctrl.runArrangementV0({ goal: 'add_accompaniment_v0' });
  assert(res.promptTrace, 'prompt trace returned');
  const allTrace = JSON.stringify(res.promptTrace);
  assert(allTrace.indexOf('TOP_SECRET') < 0, 'prompt trace must not include token');
  assert(res.llmDebug && res.llmDebug.baseUrl, 'safe llm debug fields present');
}

async function main(){
  await testValidPatchOneCommit();
  await testInvalidPatchNoCommit();
  await testMalformedNoJsonNoCommit();
  await testBeatsOnlyInvariantRejectsSeconds();
  await testPromptIncludesRequiredContext();
  await testRejectsMissingOrAudioSelection();
  await testPromptTraceSanitized();
  console.log('PASS arrangement_llm_v0.test.js');
}

main().catch(function(err){
  console.error(err);
  process.exit(1);
});
