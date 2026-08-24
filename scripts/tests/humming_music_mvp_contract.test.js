'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const appSrc = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'index.html'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(root, 'static', 'pianoroll', 'cloud_project_bridge.js'), 'utf8');
const studioSrc = `${htmlSrc}\n${appSrc}`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

assert(studioSrc.includes('id="h2sHummingMusicPanel"'), 'humming music panel should render in the Clip editor');
const leftPanelStart = htmlSrc.indexOf('<div class="panelHeader">');
const leftPanelEnd = htmlSrc.indexOf('<label class="row"', leftPanelStart);
const leftRecordingPanel = htmlSrc.slice(leftPanelStart, leftPanelEnd);
assert(!leftRecordingPanel.includes('id="h2sHummingMusicPanel"'), 'left recording/import panel must not expose the primary humming music action');
const modalStart = htmlSrc.indexOf('<div id="modal" class="modal"');
const hummingPanelIndex = htmlSrc.indexOf('id="h2sHummingMusicPanel"');
const quickOptimizeIndex = htmlSrc.indexOf('id="editorQuickOptimizePreset"');
assert(hummingPanelIndex > modalStart && hummingPanelIndex > quickOptimizeIndex, 'humming music action should live inside the Clip editor action area');

assert(studioSrc.includes('data-h2s-hum-group="instruments"'), 'instrument chips group missing');
assert(studioSrc.includes('data-h2s-hum-group="style"'), 'style chips group missing');
assert(studioSrc.includes('data-h2s-hum-group="mood"'), 'mood chips group missing');
assert(studioSrc.includes('data-h2s-hum-group="arrangement"'), 'arrangement chips group missing');
assert(studioSrc.includes('id="h2sHummingCustomKeywords"'), 'custom keyword input missing');
assert(appSrc.includes('_composeHummingMusicStyleHint'), 'styleHint composer missing');
assert(appSrc.includes('_requestHummingMusicJob'), 'humming job request method missing');
assert(appSrc.includes('_resolveHummingMusicSourceClip'), 'humming source resolver missing');
assert(appSrc.includes('this.editorRt.state.modal.draftScore'), 'humming generation should read the currently opened Clip editor draft score');
const resolverStart = appSrc.indexOf('_resolveHummingMusicSourceClip(opts)');
const resolverEnd = appSrc.indexOf('_postHummingMusicBridgeRequest', resolverStart);
const resolverSrc = appSrc.slice(resolverStart, resolverEnd);
assert(!resolverSrc.includes('_lastHummingScoreDoc'), 'humming generation must not fall back to the last recording/conversion score');
assert(appSrc.includes('this._hummingMusicGenerating'), 'generate button must guard duplicate requests');
assert(appSrc.includes('H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE'), 'Studio must request humming music job through Cloud bridge');
assert(appSrc.includes('H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE_RESPONSE'), 'Studio must handle humming create response');
assert(appSrc.includes('H2S_CLOUD_HUMMING_MUSIC_JOB_STATUS'), 'Studio must poll humming music job through Cloud bridge');
assert(appSrc.includes('H2S_CLOUD_HUMMING_MUSIC_JOB_STATUS_RESPONSE'), 'Studio must handle humming status response');
assert(appSrc.includes('window.H2S_REQUEST_CLOUD_MATERIALS_LIST'), 'completion should refresh Cloud Materials');
assert(appSrc.includes('_autoImportCompletedHummingMusicJob'), 'completed humming jobs should auto-import generated audio into Studio');
assert(appSrc.includes('_hummingMusicImportedJobIds'), 'auto-import should guard duplicate completed job polling');
assert(appSrc.includes('window.H2S_REQUEST_CLOUD_MATERIAL_CONTENT'), 'auto-import should reuse Cloud Materials content bridge');
assert(appSrc.includes('h2s-cloud-material-content'), 'auto-import should wait for Cloud material content response');
assert(appSrc.includes('statusDoneKey: \'hummingMusic.autoImportDone\''), 'auto-import should use a clear generated-music completion status');
assert(appSrc.includes('sourceMetadata: { cloudSourceAssetId: assetId }'), 'auto-import should preserve the provider-backed Cloud asset identity');
assert(appSrc.includes('_resolveHummingMusicInsertPlacement'), 'auto-import should place generated audio near the source clip');
assert(appSrc.includes('humming_music_auto_import_failed'), 'auto-import failure should fall back to Cloud Materials message');
assert(studioSrc.includes('完整音乐是生成音频素材') || studioSrc.includes('瀹屾暣闊充箰鏄'), 'UI must not imply generated audio is MIDI-editable');
assert(appSrc.includes('请选择一个可编辑旋律片段。') || appSrc.includes('请先选择一个可编辑旋律片段。') || appSrc.includes('璇峰厛閫夋嫨涓€涓彲缂栬緫鏃嬪緥鐗囨'), 'no-source state should ask the user to select an editable clip');
assert(appSrc.includes('_assistantIsHummingFullMusicIntent'), 'assistant should recognize full-music-from-current-clip requests');
assert(appSrc.includes('_assistantDispatchHummingMusicFlow'), 'assistant should route full-music requests through the same Studio bridge flow');
assert(appSrc.includes('_recordHummingMusicPromptTraceDetails'), 'full-music generation should record a last-optimize details prompt trace');
assert(appSrc.includes('_updateHummingMusicPromptTraceStatus'), 'full-music generation should update prompt trace status as the job changes');
assert(appSrc.includes('humming_full_music'), 'prompt trace should identify the operation as humming_full_music');
assert(appSrc.includes('生成完整音乐'), 'prompt trace details should expose the operation type in user-facing text');
assert(appSrc.includes('sourceClipName'), 'prompt trace should include source clip name');
assert(appSrc.includes('notesCount'), 'prompt trace should include source notes count');
assert(appSrc.includes('sourceDurationSec'), 'prompt trace should include source duration when available');
assert(appSrc.includes('melodyPrompt'), 'prompt trace should include the melodyPrompt returned by Cloud');
assert(appSrc.includes('derivedPrompt'), 'prompt trace should include the final derived prompt when available');
assert(appSrc.includes('compactNotesText'), 'prompt trace should include compact source notes text returned by Cloud');
assert(appSrc.includes('compactNotes'), 'prompt trace should include compact source notes returned by Cloud');
assert(appSrc.includes('copySourceNotes'), 'prompt trace should expose a copy action for source notes');
assert(appSrc.includes('_lastOptimizePromptTraceOpenKeys'), 'prompt trace details should preserve expanded subsections across re-render');
assert(appSrc.includes('_captureLastOptimizePromptTraceOpenKeys'), 'prompt trace details should capture expanded subsection state before re-render');
assert(appSrc.includes('_restoreLastOptimizePromptTraceOpenKeys'), 'prompt trace details should restore expanded subsection state after re-render');
assert(appSrc.includes('data-prompt-trace-key'), 'prompt trace subsections should have stable keys for expansion state');
assert(appSrc.includes('ev.stopPropagation();'), 'prompt trace expand/copy controls should stop outer close/toggle propagation');
assert(appSrc.includes('humming_music_auto_insert_failed'), 'details should record auto-insert fallback when generated music is only saved to Cloud Materials');
assert(appSrc.includes('_redactLastOptimizePromptTrace'), 'full-music prompt trace should reuse last-optimize redaction');

const createMessageIndex = appSrc.indexOf('H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE');
const createMessageSlice = appSrc.slice(Math.max(0, createMessageIndex - 1200), createMessageIndex + 2400);
assert(!/bearer|authorization|accessToken|token/i.test(createMessageSlice), 'Studio humming bridge payload must not include tokens');

assert(bridgeSrc.includes('H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE_RESPONSE'), 'cloud bridge should store humming create response');
assert(bridgeSrc.includes('h2s-cloud-humming-music-job-create'), 'cloud bridge should dispatch humming create event');
assert(bridgeSrc.includes('H2S_CLOUD_HUMMING_MUSIC_JOB_STATUS_RESPONSE'), 'cloud bridge should store humming status response');
assert(bridgeSrc.includes('h2s-cloud-humming-music-job-status'), 'cloud bridge should dispatch humming status event');

console.log('PASS humming music MVP Studio contract');
