/* Hum2Song Studio - selection_view.js
   Pure view helpers (no DOM) for the Inspector selection panel.
   - Browser: window.H2SSelectionView
   - Node tests: module.exports
*/
(function(){
  'use strict';

  function audioSegmentPanelHTML(opts){
    const escapeHtml = opts.escapeHtml || ((s)=>String(s));
    const fmtSec = opts.fmtSec || ((x)=>String(x));
    const audioDur = Number(opts.audioDurationSec || 0);
    const startSec = Number(opts.segmentStartSec || 0);
    const durationSec = Number(opts.segmentDurationSec || 30);
    const endSec = startSec + durationSec;
    const audioDurLabel = (opts.audioDurationLabel != null) ? String(opts.audioDurationLabel) : fmtSec(audioDur);
    const startLabel = (opts.segmentStartLabel != null) ? String(opts.segmentStartLabel) : 'Start';
    const lenLabel = (opts.segmentLengthLabel != null) ? String(opts.segmentLengthLabel) : 'Length';
    const endLabel = (opts.segmentEndLabel != null) ? String(opts.segmentEndLabel) : 'End';
    const atPlayheadLabel = (opts.atPlayheadLabel != null) ? String(opts.atPlayheadLabel) : 'Start at playhead';
    const preset15 = (opts.preset15Label != null) ? String(opts.preset15Label) : '15s';
    const preset30 = (opts.preset30Label != null) ? String(opts.preset30Label) : '30s';
    const preset60 = (opts.preset60Label != null) ? String(opts.preset60Label) : '60s';
    const convertActive = !!opts.convertActive;
    const convertLabel = (opts.convertLabel != null) ? String(opts.convertLabel) : 'Convert selected segment';
    const advancedTitle = (opts.advancedSegmentTitle != null) ? String(opts.advancedSegmentTitle) : 'Advanced segment settings';
    const transcriptionSettingsLabel = String(opts.transcriptionSettingsLabel || 'Transcription settings');
    const autoSeparationLabel = String(opts.autoSeparationLabel || 'AI 自动分轨');
    const inner =
        `<div class="kv"><b>${escapeHtml((opts.audioDurationTitle != null) ? opts.audioDurationTitle : 'Audio')}</b><span>${escapeHtml(audioDurLabel)}</span></div>` +
        `<div class="kv"><b>${escapeHtml(startLabel)}</b><span data-role="segStart">${escapeHtml(fmtSec(startSec))}</span></div>` +
        `<div class="kv"><b>${escapeHtml(lenLabel)}</b><span data-role="segLen">${escapeHtml(fmtSec(durationSec))}</span></div>` +
        `<div class="kv"><b>${escapeHtml(endLabel)}</b><span data-role="segEnd">${escapeHtml(fmtSec(endSec))}</span></div>` +
        `<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px;">` +
          `<button type="button" class="btn mini" data-act="segAtPlayhead"${convertActive ? ' disabled' : ''}>${escapeHtml(atPlayheadLabel)}</button>` +
          `<button type="button" class="btn mini" data-act="segLen15" data-len="15"${convertActive ? ' disabled' : ''}>${escapeHtml(preset15)}</button>` +
          `<button type="button" class="btn mini" data-act="segLen30" data-len="30"${convertActive ? ' disabled' : ''}>${escapeHtml(preset30)}</button>` +
          `<button type="button" class="btn mini" data-act="segLen60" data-len="60"${convertActive ? ' disabled' : ''}>${escapeHtml(preset60)}</button>` +
        `</div>` +
        `<div class="row" style="margin-top:8px;">` +
          `<button id="btnSelConvertAudio" class="btn mini" type="button" data-act="convertAudioEditable" title="${escapeHtml(convertLabel)}"${convertActive ? ' disabled' : ''}>${escapeHtml(convertLabel)}</button>` +
          `<button class="btn mini primary" type="button" data-act="audioSeparation"${convertActive ? ' disabled' : ''}>${escapeHtml(autoSeparationLabel)}</button>` +
          `<button class="btn mini" type="button" data-act="transcriptionSettings"${convertActive ? ' disabled' : ''}>${escapeHtml(transcriptionSettingsLabel)}</button>` +
        `</div>`;
    return (
      `<details class="h2s-audio-segment-advanced" style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;">` +
        `<summary style="cursor:pointer;user-select:none;color:var(--muted);font-weight:500;">${escapeHtml(advancedTitle)}</summary>` +
        `<div class="h2s-audio-segment-panel" style="margin-top:8px;">${inner}</div>` +
      `</details>`
    );
  }

  function selectionBoxInnerHTML(opts){
    const clipName = opts.clipName || opts.clipId || '—';
    const startSec = Number(opts.startSec || 0);
    const transpose = Number(opts.transpose || 0);
    const fmtSec = opts.fmtSec || ((x)=>String(x));
    const escapeHtml = opts.escapeHtml || ((s)=>String(s));
    const isAudio = !!opts.isAudio;
    const convertLabel = (opts.convertLabel != null && String(opts.convertLabel)) ? String(opts.convertLabel) : 'Convert selected segment';
    const showAudioSegment = !!opts.showAudioSegment;
    const instanceGainDb = Math.max(-60, Math.min(24, Number(opts.instanceGainDb) || 0));
    const instanceVolumeLabel = String(opts.instanceVolumeLabel || 'Clip volume');
    const addBassLabel = (opts.addBassLabel != null && String(opts.addBassLabel)) ? String(opts.addBassLabel) : 'Add Bass';
    const addAccompLabel = (opts.addAccompanimentLabel != null && String(opts.addAccompanimentLabel)) ? String(opts.addAccompanimentLabel) : 'Add accompaniment';
    const addAccompBadge = (opts.addAccompanimentBadgeLabel != null && String(opts.addAccompanimentBadgeLabel)) ? String(opts.addAccompanimentBadgeLabel) : 'Experimental';
    const editBtn = isAudio
      ? ''
      : `<button id="btnSelEdit" class="btn mini" data-act="edit">Edit</button>`;
    const audioConvertBtn = (isAudio && !showAudioSegment)
      ? `<button id="btnSelConvertAudio" class="btn mini" type="button" data-act="convertAudioEditable" title="${escapeHtml(convertLabel)}">${escapeHtml(convertLabel)}</button>`
      : '';
    const audioSeparationBtn = (isAudio && !showAudioSegment)
      ? `<button class="btn mini primary" type="button" data-act="audioSeparation">${escapeHtml(String(opts.autoSeparationLabel || 'AI 自动分轨'))}</button>`
      : '';
    const audioSegmentBlock = (isAudio && showAudioSegment && typeof audioSegmentPanelHTML === 'function')
      ? audioSegmentPanelHTML({
          escapeHtml,
          fmtSec,
          audioDurationSec: opts.audioDurationSec,
          segmentStartSec: opts.segmentStartSec,
          segmentDurationSec: opts.segmentDurationSec,
          audioDurationTitle: opts.audioDurationTitle,
          audioDurationLabel: opts.audioDurationLabel,
          segmentStartLabel: opts.segmentStartLabel,
          segmentLengthLabel: opts.segmentLengthLabel,
          segmentEndLabel: opts.segmentEndLabel,
          atPlayheadLabel: opts.atPlayheadLabel,
          preset15Label: opts.preset15Label,
          preset30Label: opts.preset30Label,
          preset60Label: opts.preset60Label,
          convertLabel,
          convertActive: opts.convertActive,
          advancedSegmentTitle: opts.advancedSegmentTitle,
          transcriptionSettingsLabel: opts.transcriptionSettingsLabel,
          autoSeparationLabel: opts.autoSeparationLabel,
        })
      : '';
    const addBassBtn = isAudio
      ? ''
      : `<button id="btnSelAddBass" class="btn mini" type="button" data-act="addBass">${escapeHtml(addBassLabel)}</button>`;
    const addAccompBtn = isAudio
      ? ''
      : `<button id="btnSelAddAccompaniment" class="btn mini" type="button" data-act="addAccompaniment">${escapeHtml(addAccompLabel)} <span class="badge" style="font-size:10px;opacity:.9;margin-left:4px;vertical-align:middle;">${escapeHtml(addAccompBadge)}</span></button>`;
    const moreInstrSummary = (opts.addAccompanimentMoreInstructionsLabel != null && String(opts.addAccompanimentMoreInstructionsLabel))
      ? String(opts.addAccompanimentMoreInstructionsLabel)
      : 'More instructions (optional)';
    const addAccompInstrBlock = isAudio
      ? ''
      : `<details class="h2s-add-accomp-hint" style="margin-top:8px;font-size:11px;opacity:.9;">
        <summary style="cursor:pointer;user-select:none;color:var(--muted);font-weight:500;" data-i18n="arrange.addAccompanimentMoreInstructions">${escapeHtml(moreInstrSummary)}</summary>
        <textarea id="txtSelAddAccompInstr" data-field="addAccompUserPrompt" rows="2" data-i18n-placeholder="arrange.addAccompanimentInstructionPlaceholder" placeholder="" style="width:100%;box-sizing:border-box;margin-top:6px;font-size:11px;resize:vertical;min-height:40px;max-height:120px;padding:4px 6px;border-radius:4px;border:1px solid var(--hairline, rgba(128,128,128,.35));background:var(--panel, transparent);color:inherit;"></textarea>
      </details>`;
    const showArrDet = !!opts.showArrangementDetails && !isAudio;
    const arrDetLabel = (opts.arrangementDetailsLabel != null && String(opts.arrangementDetailsLabel)) ? String(opts.arrangementDetailsLabel) : 'Arrangement Details';
    const arrangementDetailsRow = showArrDet
      ? `<div class="row" style="margin-top:8px; flex-wrap:wrap; gap:4px;"><button type="button" id="btnSelArrangementDetails" class="btn mini ghost lastOptDetailsBtn" data-act="arrangementDetails" data-i18n="arrange.detailsShort" style="font-size:10px !important;">${escapeHtml(arrDetLabel)}</button></div>`
      : '';
    const instanceGainRow =
      `<div class="kv"><b>${escapeHtml(instanceVolumeLabel)}</b><span style="display:flex;align-items:center;gap:6px;min-width:150px;">` +
          `<input type="range" min="-60" max="24" step="0.1" value="${instanceGainDb}" data-field="instanceGainDb" style="width:105px;" />` +
          `<output data-role="instanceGainDbValue">${instanceGainDb.toFixed(1)} dB</output>` +
        `</span></div>`;

    return `
      <div class="kv"><b>Clip</b><span>${escapeHtml(clipName)}</span></div>
      <div class="kv"><b>Start</b><span>${fmtSec(startSec)}</span></div>
      <div class="kv"><b>Transpose</b><span>${transpose}</span></div>
      ${instanceGainRow}
      <div class="row" style="margin-top:10px;">
        ${editBtn}
        ${audioConvertBtn}
        ${audioSeparationBtn}
        ${addBassBtn}
        ${addAccompBtn}
        <button id="btnSelDup" class="btn mini" data-act="duplicate">Duplicate</button>
        <button id="btnSelDel" class="btn mini danger" data-act="remove">Remove</button>
      </div>
      ${addAccompInstrBlock}
      ${arrangementDetailsRow}
      ${audioSegmentBlock}
    `;
  }

  const api = { selectionBoxInnerHTML, audioSegmentPanelHTML };

  // Browser global
  if (typeof window !== 'undefined'){
    window.H2SSelectionView = api;
  }

  // Node export
  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
})();
