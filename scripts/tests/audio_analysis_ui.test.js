const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../../static/pianoroll/core/audio_analysis.js');
const controllerApi = require('../../static/pianoroll/controllers/audio_analysis_controller.js');

assert.strictEqual(controllerApi.isAudioClip({ kind: 'audio' }), true);
assert.strictEqual(controllerApi.isAudioClip({ kind: 'note' }), false);
assert.ok(controllerApi.resultHTML(engine.analyzeChannels([new Float32Array([0, 1])], 2), (_key, fallback) => fallback).includes('暂不可用'));
const instrumentDisplay = engine.analyzeChannels([new Float32Array([0, 1])], 2);
instrumentDisplay.instruments = {
  status: 'ok',
  items: [
    { id: 'below', name: '低置信度', confidence: 0.08 },
    { id: 'above', name: '超过阈值', confidence: 0.081 },
  ],
};
const instrumentDisplayHtml = controllerApi.resultHTML(instrumentDisplay, (_key, fallback) => fallback);
assert.ok(instrumentDisplayHtml.includes('超过阈值 8%'));
assert.ok(!instrumentDisplayHtml.includes('低置信度'));
assert.notStrictEqual(controllerApi.cacheKeyFor({ id: 'c1', audio: { assetRef: 'localidb:a' } }), controllerApi.cacheKeyFor({ id: 'c1', audio: { assetRef: 'localidb:b' } }));

function makeModal(){
  const content = { innerHTML: '', setAttribute() {} };
  const title = { textContent: '' };
  const closeButton = { textContent: '', addEventListener(fn){ this.handler = fn; } };
  const backdrop = { addEventListener(fn){ this.handler = fn; } };
  return {
    hidden: true,
    setAttribute() {},
    addEventListener(event, fn){ this.handlers = this.handlers || {}; this.handlers[event] = fn; },
    querySelector(selector){
      if (selector === '[data-role="content"]') return content;
      if (selector === '[data-role="title"]') return title;
      if (selector.indexOf('data-act="close"') >= 0) return closeButton;
      return null;
    },
    querySelectorAll(selector){ return selector.indexOf('data-act="close"') >= 0 ? [closeButton, backdrop] : []; },
    _content: content,
    _title: title,
    _closeButton: closeButton,
  };
}

(async function(){
  const clip = { id: 'audio-1', kind: 'audio', name: 'Test', audio: { assetRef: 'localidb:test', durationSec: 1 } };
  const modal = makeModal();
  let decodeCount = 0;
  const controller = controllerApi.create({
    modalEl: modal,
    getClip: (id) => id === clip.id ? clip : { id, kind: 'note' },
    resolveAudioFile: async () => ({ name: 'test.wav' }),
    decoder: { decodeAudioFile: async () => { decodeCount += 1; return { numberOfChannels: 1, sampleRate: 4, duration: 1, getChannelData: () => new Float32Array([0, 1, 0, -1]) }; } },
    engine,
    t: (_key, fallback) => fallback,
  });

  const midi = await controller.open('midi-1');
  assert.strictEqual(midi.reason, 'not_audio_clip');
  const first = await controller.open(clip.id);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.cached, false);
  assert.strictEqual(decodeCount, 1);
  assert.ok(modal._content.innerHTML.includes('时长'));
  controller.close();
  assert.strictEqual(modal.hidden, true);
  const second = await controller.open(clip.id);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(decodeCount, 1);
  assert.strictEqual(modal.hidden, false);

  const instrumentModal = makeModal();
  const instrumentController = controllerApi.create({
    modalEl: instrumentModal,
    getClip: () => clip,
    resolveAudioFile: async () => ({ name: 'test.wav' }),
    decoder: { decodeAudioFile: async () => ({ numberOfChannels: 1, sampleRate: 4, duration: 1, getChannelData: () => new Float32Array([0, 1, 0, -1]) }) },
    instrumentAnalyzer: async () => ({ status: 'ok', items: [{ id: 'piano', name: '钢琴', confidence: 0.84 }] }),
    engine,
    t: (_key, fallback) => fallback,
  });
  const instrumentResult = await instrumentController.open(clip.id);
  assert.strictEqual(instrumentResult.ok, true);
  assert.ok(instrumentModal._content.innerHTML.includes('钢琴 84%'));

  const failingModal = makeModal();
  const failing = controllerApi.create({
    modalEl: failingModal,
    getClip: () => clip,
    resolveAudioFile: async () => null,
    decoder: { decodeAudioFile: async () => { throw new Error('should_not_decode'); } },
    engine,
    t: (_key, fallback) => fallback,
  });
  const failure = await failing.open(clip.id);
  assert.strictEqual(failure.ok, false);
  assert.ok(failingModal._content.innerHTML.includes('音频无法分析'));

  const appSource = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/app.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/controllers/audio_analysis_controller.js'), 'utf8');
  assert.ok(appSource.includes('data-act="audioAnalysis"'), 'audio clips expose the analysis entry');
  assert.ok(appSource.includes('P.clipKind(clip) === \'audio\''), 'analysis entry is context-sensitive to audio clips');
  assert.ok(controllerSource.includes('正在分析'), 'loading state is present in the controller');
  assert.ok(appSource.includes('openAudioAnalysis'), 'app wires the selected clip action');
  console.log('audio_analysis_ui.test.js: all passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
