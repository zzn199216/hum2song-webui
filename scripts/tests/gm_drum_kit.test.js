#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const kit = require(path.resolve(__dirname, '../../static/pianoroll/core/gm_drum_kit.js'));

assert.strictEqual(kit.VERSION, 'gm_drum_kit_v1');
assert.strictEqual(kit.classifyMidiNote(36), 'kick');
assert.strictEqual(kit.classifyMidiNote(38), 'snare');
assert.strictEqual(kit.classifyMidiNote(42), 'hihatClosed');
assert.strictEqual(kit.classifyMidiNote(46), 'hihatOpen');
assert.strictEqual(kit.classifyMidiNote(41), 'tom');
assert.strictEqual(kit.classifyMidiNote(49), 'cymbal');
assert.strictEqual(kit.classifyMidiNote(56), 'percussion');
assert.strictEqual(kit.isDrumPresetId('drum'), true);
assert.strictEqual(kit.isDrumPresetId('drum:electronic'), true);
assert.strictEqual(kit.isDrumPresetId('bass'), false);
assert.strictEqual(kit.forcedGroupForPreset('drum:kick'), 'kick');
for (const presetId of [
  'drum:kick:electronic',
  'drum:kick:deep',
  'drum:kick:dance',
  'drum:kick:sub',
]) {
  assert.strictEqual(kit.forcedGroupForPreset(presetId), 'kick');
}

function makeVoiceType(name, registry){
  return class FakeVoice {
    constructor(options){
      this.name = name;
      this.options = options;
      this.calls = [];
      this.disposed = false;
      registry.push(this);
    }
    connect(destination){ this.destination = destination; return this; }
    triggerAttackRelease(){ this.calls.push(Array.from(arguments)); }
    dispose(){ this.disposed = true; }
  };
}

function makeFakeTone(){
  const voices = { membrane: [], noise: [], metal: [], synth: [] };
  class FakeVolume {
    constructor(db){ this.volume = { value: db }; this.mute = false; this.connected = false; }
    connect(destination){ this.destination = destination; return this; }
    toDestination(){ this.connected = true; return this; }
    dispose(){ this.disposed = true; }
  }
  function Frequency(value, unit){
    const midi = unit === 'midi' ? Number(value) : Number(value);
    return { value, unit, toMidi(){ return midi; } };
  }
  return {
    Tone: {
      Volume: FakeVolume,
      MembraneSynth: makeVoiceType('membrane', voices.membrane),
      NoiseSynth: makeVoiceType('noise', voices.noise),
      MetalSynth: makeVoiceType('metal', voices.metal),
      Synth: makeVoiceType('synth', voices.synth),
      Frequency,
    },
    voices,
  };
}

const fake = makeFakeTone();
const standard = kit.createToneDrumKit(fake.Tone, 'drum');
standard.toDestination();
standard.triggerAttackRelease(fake.Tone.Frequency(36, 'midi'), 0.25, 1, 0.8);
standard.triggerAttackRelease(fake.Tone.Frequency(38, 'midi'), 0.25, 2, 0.7);
standard.triggerAttackRelease(fake.Tone.Frequency(42, 'midi'), 0.1, 3, 0.6);
standard.triggerAttackRelease(fake.Tone.Frequency(46, 'midi'), 0.4, 4, 0.5);
standard.triggerAttackRelease(fake.Tone.Frequency(49, 'midi'), 0.8, 5, 0.9);
standard.triggerAttackRelease(fake.Tone.Frequency(45, 'midi'), 0.3, 6, 0.75);

assert.strictEqual(fake.voices.membrane[0].calls.length, 1, 'kick should use its membrane voice');
assert.strictEqual(fake.voices.membrane[1].calls.length, 1, 'tom should use a separate membrane voice');
assert.strictEqual(fake.voices.noise[0].calls.length, 1, 'snare should use noise synthesis');
assert.strictEqual(fake.voices.metal[0].calls.length, 1, 'closed hi-hat should use its metal voice');
assert.strictEqual(fake.voices.metal[1].calls.length, 1, 'open hi-hat should use a longer separate metal voice');
assert.strictEqual(fake.voices.metal[2].calls.length, 1, 'cymbal should use its own metal voice');
assert.strictEqual(standard.volume.value, -1, 'acoustic kit should expose track volume control');

standard.mute = true;
assert.strictEqual(standard.mute, true, 'kit should expose live mute control');
standard.dispose();
assert(fake.voices.membrane.every((voice) => voice.disposed), 'disposing a kit should dispose child voices');

const forcedFake = makeFakeTone();
const forcedKick = kit.createToneDrumKit(forcedFake.Tone, 'drum:kick');
forcedKick.triggerAttackRelease(forcedFake.Tone.Frequency(72, 'midi'), 0.2, 0, 1);
assert.strictEqual(forcedFake.voices.membrane[0].calls.length, 1, 'kick preset should render every pitch as kick');
assert.strictEqual(forcedFake.voices.metal.reduce((sum, voice) => sum + voice.calls.length, 0), 0, 'kick preset should not render cymbal voices');

const kickVariants = [
  ['drum:kick:electronic', 36, 7],
  ['drum:kick:deep', 32, 5],
  ['drum:kick:dance', 36, 8],
  ['drum:kick:sub', 24, 2],
];
for (const [presetId, expectedMidi, expectedOctaves] of kickVariants) {
  const presetFake = makeFakeTone();
  const preset = kit.createToneDrumKit(presetFake.Tone, presetId);
  preset.triggerAttackRelease(presetFake.Tone.Frequency(72, 'midi'), 1, 0, 1);
  const kickVoice = presetFake.voices.membrane[0];
  assert.strictEqual(preset.presetId, presetId);
  assert.strictEqual(kickVoice.options.octaves, expectedOctaves, `${presetId} should keep its own pitch sweep`);
  assert.strictEqual(kickVoice.calls[0][0].value, expectedMidi, `${presetId} should keep its own base pitch`);
  assert.strictEqual(presetFake.voices.metal.reduce((sum, voice) => sum + voice.calls.length, 0), 0, `${presetId} should only render kick voices`);
}

console.log('GM drum kit tests passed');
