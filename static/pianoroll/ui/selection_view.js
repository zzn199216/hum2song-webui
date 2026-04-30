/* Hum2Song Studio - selection_view.js
   Pure view helpers (no DOM) for the Inspector selection panel.
   - Browser: window.H2SSelectionView
   - Node tests: module.exports
*/
(function(){
  'use strict';

  function selectionBoxInnerHTML(opts){
    const clipName = opts.clipName || opts.clipId || '—';
    const startSec = Number(opts.startSec || 0);
    const transpose = Number(opts.transpose || 0);
    const fmtSec = opts.fmtSec || ((x)=>String(x));
    const escapeHtml = opts.escapeHtml || ((s)=>String(s));
    const isAudio = !!opts.isAudio;
    const convertLabel = (opts.convertLabel != null && String(opts.convertLabel)) ? String(opts.convertLabel) : 'Convert to editable';
    const addBassLabel = (opts.addBassLabel != null && String(opts.addBassLabel)) ? String(opts.addBassLabel) : 'Add Bass';
    const addAccompLabel = (opts.addAccompanimentLabel != null && String(opts.addAccompanimentLabel)) ? String(opts.addAccompanimentLabel) : 'Add accompaniment';
    const addAccompBadge = (opts.addAccompanimentBadgeLabel != null && String(opts.addAccompanimentBadgeLabel)) ? String(opts.addAccompanimentBadgeLabel) : 'Experimental';
    const editBtn = isAudio
      ? ''
      : `<button id="btnSelEdit" class="btn mini" data-act="edit">Edit</button>`;
    const audioConvertBtn = isAudio
      ? `<button id="btnSelConvertAudio" class="btn mini primary" type="button" data-act="convertAudioEditable" title="${escapeHtml(convertLabel)}">${escapeHtml(convertLabel)}</button>`
      : '';
    const addBassBtn = isAudio
      ? ''
      : `<button id="btnSelAddBass" class="btn mini" type="button" data-act="addBass">${escapeHtml(addBassLabel)}</button>`;
    const addAccompBtn = isAudio
      ? ''
      : `<button id="btnSelAddAccompaniment" class="btn mini" type="button" data-act="addAccompaniment">${escapeHtml(addAccompLabel)} <span class="badge" style="font-size:10px;opacity:.9;margin-left:4px;vertical-align:middle;">${escapeHtml(addAccompBadge)}</span></button>`;
    const showArrDet = !!opts.showArrangementDetails && !isAudio;
    const arrDetLabel = (opts.arrangementDetailsLabel != null && String(opts.arrangementDetailsLabel)) ? String(opts.arrangementDetailsLabel) : 'Arrangement Details';
    const arrangementDetailsRow = showArrDet
      ? `<div class="row" style="margin-top:8px; flex-wrap:wrap; gap:4px;"><button type="button" id="btnSelArrangementDetails" class="btn mini ghost lastOptDetailsBtn" data-act="arrangementDetails" data-i18n="arrange.detailsShort" style="font-size:10px !important;">${escapeHtml(arrDetLabel)}</button></div>`
      : '';

    return `
      <div class="kv"><b>Clip</b><span>${escapeHtml(clipName)}</span></div>
      <div class="kv"><b>Start</b><span>${fmtSec(startSec)}</span></div>
      <div class="kv"><b>Transpose</b><span>${transpose}</span></div>
      <div class="row" style="margin-top:10px;">
        ${editBtn}
        ${audioConvertBtn}
        ${addBassBtn}
        ${addAccompBtn}
        <button id="btnSelDup" class="btn mini" data-act="duplicate">Duplicate</button>
        <button id="btnSelDel" class="btn mini danger" data-act="remove">Remove</button>
      </div>
      ${arrangementDetailsRow}
    `;
  }

  const api = { selectionBoxInnerHTML };

  // Browser global
  if (typeof window !== 'undefined'){
    window.H2SSelectionView = api;
  }

  // Node export
  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
})();
