#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const audioController = require(path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'audio_controller.js'));

function unrefTimeout(fn, ms){
  const timer = setTimeout(fn, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

function unrefInterval(fn, ms){
  const timer = setInterval(fn, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

async function main(){
  const scheduled = [];
  const audioStarts = [];
  const noteStarts = [];
  const alerts = [];
  const resolvedRefs = [];
  const statuses = [];
  let offlineDuration = null;
  let masterGainDb = null;
  let downloaded = false;
  let revoked = false;

  function button(){
    return {
      disabled: false,
      addEventListener(type, fn){ if (type === 'click') this.clickHandler = fn; },
    };
  }

  const exportButton = button();
  const cancelButton = button();
  const exportProjectButton = { parentNode: null };
  const elements = {
    btnExportWav: exportButton,
    btnCancelImport: cancelButton,
    btnExportProject: exportProjectButton,
  };
  const document = {
    readyState: 'complete',
    body: { appendChild(){} },
    getElementById(id){ return elements[id] || null; },
    createElement(tag){
      assert.strictEqual(tag, 'a');
      return {
        click(){ downloaded = true; },
        remove(){},
      };
    },
  };

  const project = {
    version: 2,
    timebase: 'beat',
    tracks: [
      { id: 'blue', instrument: 'default', gainDb: 0, muted: false },
      { id: 'green', instrument: 'audio', gainDb: -6, muted: false },
    ],
  };
  const flat = {
    tracks: [{ trackId: 'blue', notes: [{ pitch: 60, velocity: 100, startSec: 0, durationSec: 0.5 }] }],
    audioSegments: [{ trackId: 'green', startSec: 1, durationSec: 2, assetRef: 'localidb:green', instanceGainDb: 4 }],
  };

  function Synth(){
    this.volume = { value: 0 };
    this.toDestination = () => this;
    this.triggerAttackRelease = (_pitch, duration, time, velocity) => noteStarts.push({ duration, time, velocity });
  }
  function Player(options){
    this.volume = { value: 0 };
    this.toDestination = () => this;
    this.start = (time, offset, duration) => audioStarts.push({ time, offset, duration, gainDb: this.volume.value });
    this.dispose = () => {};
    queueMicrotask(() => options.onload());
  }
  const Tone = {
    Synth,
    PolySynth: Synth,
    MonoSynth: Synth,
    FMSynth: Synth,
    PluckSynth: Synth,
    Player,
    Frequency(value){ return value; },
    async Offline(render, duration){
      offlineDuration = duration;
      const ctx = {
        destination: { volume: { value: 0 } },
        transport: {
          schedule(fn, at){ scheduled.push({ fn, at }); },
          start(){
            masterGainDb = ctx.destination.volume.value;
            for (const event of scheduled) event.fn(event.at);
          },
        },
      };
      await render(ctx);
      return {
        numberOfChannels: 2,
        sampleRate: 44100,
        length: 4,
        getChannelData(){ return new Float32Array(4); },
      };
    },
  };

  const window = {
    Tone,
    H2SProject: { flatten(){ return flat; } },
    H2SAudioController: {
      computeAudioPlaybackSchedule: audioController.computeAudioPlaybackSchedule,
      async resolveAssetRefForTone(assetRef){
        resolvedRefs.push(assetRef);
        return { url: 'blob:green', revoke(){ revoked = true; } };
      },
    },
    H2SApp: {
      _masterGainDb: -9,
      getProjectV2(){ return project; },
      setImportStatus(text){ statuses.push(text); },
    },
  };

  const context = vm.createContext({
    window,
    document,
    localStorage: { getItem(){ return null; } },
    Blob,
    URL: {
      createObjectURL(){ return 'blob:export'; },
      revokeObjectURL(){ revoked = true; },
    },
    alert(message){ alerts.push(String(message)); },
    console,
    Map,
    Number,
    Promise,
    queueMicrotask,
    setTimeout: unrefTimeout,
    clearTimeout,
    setInterval: unrefInterval,
    clearInterval,
  });
  const source = fs.readFileSync(path.join(repoRoot, 'static', 'pianoroll', 'controllers', 'export_wav_controller.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'export_wav_controller.js' });

  assert.strictEqual(typeof exportButton.clickHandler, 'function', 'Export WAV click handler should be bound');
  await exportButton.clickHandler();

  assert.deepStrictEqual(resolvedRefs, ['localidb:green'], 'green audio should resolve through the playback asset resolver');
  assert.strictEqual(noteStarts.length, 1, 'blue MIDI should still render');
  assert.deepStrictEqual(audioStarts, [{ time: 1, offset: 0, duration: 2, gainDb: -2 }], 'WAV export should combine track and per-instance gain');
  assert.strictEqual(offlineDuration, 4.5, 'WAV duration should include the audio tail, not only MIDI notes');
  assert.strictEqual(masterGainDb, -9, 'offline render should use the same master gain as P playback');
  assert.strictEqual(downloaded, true, 'mixed WAV should be downloaded');
  assert.strictEqual(revoked, true, 'temporary playback/download URLs should be revoked');
  assert.deepStrictEqual(alerts, [], 'successful mixed export should not alert');
  assert.ok(statuses.some((value) => value === 'WAV exported.'), 'success status should be reported');
  console.log('export_wav_mixed_audio.test.js: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
