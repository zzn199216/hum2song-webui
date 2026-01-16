/* Hum2Song Studio MVP - ui/timeline_view.js
   Plain script (no ES modules). Node-safe via UMD export.

   R8: Timeline view contract hardening
   - Keep legacy class names: instTitle / instSub / instRemove
   - Add stable wrapper: instBody (for drag + dblclick hit area)
   - Add canonical aliases: inst-title / inst-sub / btn-inst-remove
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

  function _defaultEscapeHtml(s){
    s = String(s == null ? '' : s);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function instanceInnerHTML(args){
    args = args || {};
    const escapeHtml = args.escapeHtml || _defaultEscapeHtml;
    const fmtSec = args.fmtSec || ((x)=> (Number(x||0).toFixed(2) + 's'));

    const clipName = escapeHtml(args.clipName || '');
    const startSec = (typeof args.startSec === 'number') ? args.startSec : 0;
    const noteCount = (typeof args.noteCount === 'number') ? args.noteCount : 0;

    // NOTE: instBody is the intended hit area for drag + dblclick.
    // Keep legacy class names for compatibility.
    return `
      <div class="instBody inst-body" data-role="inst-body">
        <div class="instTitle inst-title">${clipName}</div>
        <div class="instSub inst-sub"><span>${fmtSec(startSec)}</span><span>${noteCount} notes</span></div>
      </div>
      <button class="instRemove btn-inst-remove" type="button" data-act="remove" title="Remove" aria-label="Remove">×</button>
    `;
  }

  return {
    VERSION: 'timeline_view_v2_r8',
    instanceInnerHTML,
  };
});
