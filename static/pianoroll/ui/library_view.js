/* Hum2Song Studio MVP - ui/library_view.js
   Plain script (no import/export). Exposes window.H2SLibraryView.

   This module is intentionally DOM-free so it can be used in Node tests.
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
    root.H2SLibraryView = api;
  }
})(
  (typeof window !== 'undefined') ? window :
  (typeof globalThis !== 'undefined') ? globalThis :
  null,
  function(){
    'use strict';

    function emptyMessage(){
      return 'No clips yet. Upload WAV to generate one.';
    }

    function clipCardInnerHTML(clip, stats, fmtSec, escapeHtml){
      const safeName = escapeHtml ? escapeHtml(clip && clip.name) : String((clip && clip.name) || '');
      const notes = (stats && typeof stats.count === 'number') ? stats.count : 0;
      const spanSec = (stats && typeof stats.spanSec === 'number') ? stats.spanSec : 0;
      const spanText = fmtSec ? fmtSec(spanSec) : String(spanSec);

      // IMPORTANT: keep these data-act values stable (contract tests depend on them)
      return `
        <div class="clipTitle">${safeName}</div>
        <div class="clipMeta"><span>${notes} notes</span><span>${spanText}</span></div>
        <div class="miniBtns">
          <button class="btn mini" data-act="play">Play</button>
          <button class="btn mini" data-act="add">Add</button>
          <button class="btn mini" data-act="edit">Edit</button>
          <button class="btn mini danger" data-act="remove">Remove</button>
        </div>
      `;
    }

    return {
      emptyMessage,
      clipCardInnerHTML,
    };
  }
);
