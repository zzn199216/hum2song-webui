/* Exercise the real app-to-waveform adapter without submitting a Worker job. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/app.js'), 'utf8');
const start = source.indexOf('    _ensureAudioWaveformEditor(){');
const end = source.indexOf('    async openAudioWaveformEditor(', start);
assert(start >= 0 && end > start);
let hooks;
const app = vm.runInNewContext('({' + source.slice(start, end) + '})', {
  window: { H2SAudioWaveformEditor: { createController(value) { hooks = value; return {}; } } },
  fmtSec: String, escapeHtml: String,
});
const calls = [];
app._ensureAudioSeparationSourceInstance = () => 'source-instance';
app._runAudioSeparationForClip = (id, options) => { calls.push({ id, options }); return { ok: true }; };
app._ensureAudioWaveformEditor();
for (const separatorOption of ['demucs', 'uvr5_ensemble_vocal_full']) {
  const onStatus = () => {};
  const result = hooks.runSeparation('source-clip', null, {
    separationPreset: 'vocals_instrumental', mode: 'separate_only', separatorOption, onStatus,
  });
  assert(result.ok);
  const call = calls.pop();
  assert.strictEqual(call.id, 'source-clip');
  assert.strictEqual(call.options.sourceAudioInstanceId, 'source-instance');
  assert.strictEqual(call.options.separatorOption, separatorOption, 'selected separator must reach the Worker client');
  assert.strictEqual(call.options.separationPreset, 'vocals_instrumental');
  assert.strictEqual(call.options.mode, 'separate_only');
  assert.strictEqual(call.options.onStatus, onStatus);
}
console.log('PASS waveform separation adapter preserves selected provider and callback');

app.splitAudioClipAtSilence = (clipId, instanceId) => ({ clipId, instanceId });
assert.deepStrictEqual(hooks.splitAudioAtSilence('split-clip', 'split-instance'), { clipId: 'split-clip', instanceId: 'split-instance' });
console.log('PASS waveform manual splitting targets only the selected timeline occurrence');
