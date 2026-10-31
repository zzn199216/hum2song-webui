'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/pianoroll/startup_ui.js'), 'utf8');
function fixture() {
  const panel = { hidden: false }, label = {}, retry = { hidden: true }, root = { lang: 'zh', dataset: {} };
  const messages = [], frames = [];
  let timer, reloaded = false;
  const context = {
    URLSearchParams,
    location: { search: '?hostLocale=zh', reload() { reloaded = true; } },
    document: { documentElement: root, getElementById(id) { return { studioStartup: panel, studioStartupLabel: label, studioStartupRetry: retry }[id]; } },
    window: { parent: { postMessage(m) { messages.push(m); } } },
    setTimeout(fn) { timer = fn; return 1; }, clearTimeout() {}, requestAnimationFrame(fn) { frames.push(fn); },
  };
  vm.runInNewContext(source, context);
  return { ui: context.window.H2SStudioUi, panel, label, retry, root, messages, tick() { frames.splice(0).forEach(fn => fn()); }, timeout() { timer(); }, didReload() { return reloaded; } };
}
for (const first of ['runtimeReady', 'languageReady']) {
  const f = fixture();
  f.ui[first]('zh'); f.tick(); assert.equal(f.panel.hidden, false);
  f.ui[first === 'runtimeReady' ? 'languageReady' : 'runtimeReady']('zh');
  assert.equal(f.panel.hidden, false); f.tick();
  assert.equal(f.panel.hidden, true); assert.equal(f.root.dataset.studioUiState, 'ready');
  assert.equal(f.messages.at(-1).locale, 'zh');
  f.ui.fail(); assert.equal(f.root.dataset.studioUiState, 'ready', 'later errors must not cover existing work');
  f.ui.notify(); assert.equal(f.messages.at(-1).state, 'ready', 'late parent ping receives current ready state');
}
{
  const f = fixture(); f.ui.runtimeReady(); f.timeout();
  assert.equal(f.panel.hidden, false); assert.equal(f.retry.hidden, false); assert.equal(f.root.dataset.studioUiState, 'error');
  f.retry.onclick(); assert.equal(f.didReload(), true);
  f.ui.languageReady('zh'); f.tick(); assert.equal(f.panel.hidden, true, 'late successful resources recover from timeout');
}
console.log('startup_ui: readiness ordering, paint boundary, error, retry and recovery passed');
