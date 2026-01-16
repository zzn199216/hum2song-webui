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

    return `
      <div class="kv"><b>Clip</b><span>${escapeHtml(clipName)}</span></div>
      <div class="kv"><b>Start</b><span>${fmtSec(startSec)}</span></div>
      <div class="kv"><b>Transpose</b><span>${transpose}</span></div>
      <div class="row" style="margin-top:10px;">
        <button id="btnSelEdit" class="btn mini" data-act="edit">Edit</button>
        <button id="btnSelDup" class="btn mini" data-act="duplicate">Duplicate</button>
        <button id="btnSelDel" class="btn mini danger" data-act="remove">Remove</button>
      </div>
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
