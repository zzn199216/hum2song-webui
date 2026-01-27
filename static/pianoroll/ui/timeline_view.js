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


function _snapSelectOptionsHTML(){
  // Values are parsed by TimelineController.setSnapFromValue:
  // - "off"
  // - "1" (1 beat)
  // - "1/2" ... "1/32"
  return [
    ['off', 'Off'],
    ['1', '1'],
    ['1/2', '1/2'],
    ['1/4', '1/4'],
    ['1/8', '1/8'],
    ['1/16', '1/16'],
    ['1/32', '1/32'],
  ].map(([v,label]) => `<option value="${v}">${label}</option>`).join('');
}

/**
 * Ensure the Timeline snap dropdown exists in DOM (view responsibility).
 *
 * This is intentionally a view-layer DOM creation helper so controllers can
 * reliably bind without having to "inject UI".
 *
 * It will insert <select id="selTimelineSnap"> next to #inpBpm (if present).
 * Safe in Node tests (no document).
 */
function ensureTimelineSnapSelect(args){
  args = args || {};
  if (typeof document === 'undefined') return { ok:false, reason:'no_document' };

  const existing = document.getElementById('selTimelineSnap');
  if (existing) return { ok:true, reason:'exists', el: existing };

  const bpmEl = document.getElementById('inpBpm');
  if (!bpmEl) return { ok:false, reason:'no_inpBpm' };

  const sel = document.createElement('select');
  sel.id = 'selTimelineSnap';
  sel.className = (args.className || 'inp');
  sel.title = 'Timeline Snap';
  sel.setAttribute('aria-label', 'Timeline Snap');
  sel.innerHTML = _snapSelectOptionsHTML();

  // Default value: 1/16 (common DAW default). Controller may override.
  sel.value = (args.defaultValue != null ? String(args.defaultValue) : '1/16');

  // Insert right after BPM input.
  const parent = bpmEl.parentElement;
  if (parent){
    if (bpmEl.nextSibling){
      parent.insertBefore(sel, bpmEl.nextSibling);
    } else {
      parent.appendChild(sel);
    }
    sel.style.marginLeft = sel.style.marginLeft || '6px';
    return { ok:true, reason:'inserted', el: sel };
  }

  document.body.appendChild(sel);
  return { ok:true, reason:'appended_body', el: sel };
}

  return {
    VERSION: 'timeline_view_v2_r8',
    instanceInnerHTML,
    ensureTimelineSnapSelect,
  };
});
