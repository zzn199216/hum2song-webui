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
// Exercise the actual waveform dispatch and pricing functions, including the new intent selector.
(async () => {
  const waveform = fs.readFileSync(path.join(__dirname, '../../static/pianoroll/ui/audio_waveform_editor.js'), 'utf8');
  const from = waveform.indexOf('    async function startSeparation()');
  const to = waveform.indexOf('    function setFallbackVisible', from);
  const values = {wfSeparationPreset:{value:'four_stem'},wfSeparationMode:{value:'separate_and_transcribe'},wfSeparatorOption:{value:'demucs'},wfSeparationIntent:{value:'multitrack'},wfSeparationCost:{textContent:''}};
  let selected, sunoCalls = 0;
  const sandbox = {panel:{querySelector:s=>values[s.match(/"([^"]+)"/)[1]]}, separationBusy:false,silenceSplitBusy:false,_isConvertBusy:()=>false,openCtx:{clipId:'c',instanceId:'i'},
    hooks:{runSeparation:async(c,i,opts)=>{selected=opts;return {ok:true};}},startAdvancedStemSeparation:async()=>{sunoCalls++;},updateConvertButtons:()=>{},statusEl:null,t:(k,f)=>f,applyI18nLabels:()=>{}};
  const dispatch = vm.runInNewContext('('+waveform.slice(from,to).trim()+')',sandbox);
  await dispatch();
  assert.strictEqual(selected.mode,'separate_and_transcribe');
  assert.strictEqual(selected.separationIntent,'multitrack');
  values.wfSeparatorOption.value='advanced_stems'; await dispatch(); assert.strictEqual(sunoCalls,1,'Suno must not be forced into the ordinary provider');
  const costStart=waveform.indexOf('    function updateSeparationCost()'),costEnd=waveform.indexOf('    async function startSilenceSplit',costStart);
  const price=vm.runInNewContext('('+waveform.slice(costStart,costEnd).trim()+')',sandbox);
  price(); assert(values.wfSeparationCost.textContent.includes('30'));
  values.wfSeparatorOption.value='demucs'; price(); assert(values.wfSeparationCost.textContent.includes('2'));
  values.wfSeparationMode.value='separate_only'; price(); assert(values.wfSeparationCost.textContent.includes('1'));
  console.log('PASS waveform new-intent combined dispatch, Suno dispatch and 1/2/30 pricing');
})().catch(e=>{console.error(e);process.exitCode=1;});
