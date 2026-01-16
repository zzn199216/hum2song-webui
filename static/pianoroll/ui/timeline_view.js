/* Hum2Song Studio MVP - ui/timeline_view.js
   Plain script (no import/export). Exposes window.H2STimelineView.

   DOM-free view helpers for Timeline so we can:
   - keep markup stable (avoid regressions like missing Remove button)
   - test contracts in Node without a browser
*/
(function(root, factory){
  'use strict';
  const api = factory();
  // Node (tests)
  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
  // Browser
  if (root){
    root.H2STimelineView = api;
  }
})(typeof window !== 'undefined' ? window : null, function(){
  'use strict';

  function instanceInnerHTML(args){
    args = args || {};
    const escapeHtml = args.escapeHtml || ((s)=>String(s||''));
    const fmtSec = args.fmtSec || ((x)=>String(x||0));
    const clipName = escapeHtml(args.clipName || '');
    const startSec = (typeof args.startSec === 'number') ? args.startSec : 0;
    const noteCount = (typeof args.noteCount === 'number') ? args.noteCount : 0;

    return `
      <div class="instTitle">${clipName}</div>
      <div class="instSub"><span>${fmtSec(startSec)}</span><span>${noteCount} notes</span></div>
      <button class="instRemove" data-act="remove" title="Remove">×</button>
    `;
  }

  return {
    VERSION: 'timeline_view_v1',
    instanceInnerHTML,
  };
});
