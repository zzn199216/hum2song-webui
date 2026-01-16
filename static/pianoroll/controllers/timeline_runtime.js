/* Hum2Song - timeline_runtime.js
   Pure logic for timeline dragging. Node-safe UMD export.
   This does NOT touch the DOM. Controller can use it to compute preview/commit startSec.
*/
(function(root, factory){
  if (typeof module !== 'undefined' && module.exports){
    module.exports = factory(require('../core/timeline_math.js'));
  } else {
    root.H2STimelineRuntime = factory(root.H2STimelineMath);
  }
})(typeof window !== 'undefined' ? window : globalThis, function(MathLib){
  'use strict';

  if (!MathLib){
    // In browser, timeline_math.js must be loaded before this file.
    // In Node, require path should resolve.
    MathLib = {
      pxToSec: (px, pps)=>px/pps,
      snapSec: (s)=>Math.max(0,s||0),
    };
  }

  // DragState stores pointer->instance offset.
  function beginDrag(opts){
    const pxPerSec = opts.pxPerSec;
    const pointerX = opts.pointerX;
    const instStartSec = opts.instStartSec;
    const offsetSec = MathLib.pxToSec(pointerX, pxPerSec) - instStartSec;
    return {
      pxPerSec,
      offsetSec,
      startedAt: opts.startedAt || Date.now(),
      originStartSec: instStartSec,
      lastPreviewStartSec: instStartSec,
    };
  }

  function updateDrag(state, opts){
    const pointerX = opts.pointerX;
    const gridSec = opts.gridSec || 0;
    const bypass = !!opts.bypass;
    const rawStart = MathLib.pxToSec(pointerX, state.pxPerSec) - state.offsetSec;
    const snapped = MathLib.snapSec(rawStart, gridSec, bypass);
    state.lastPreviewStartSec = snapped;
    return {
      previewStartSec: snapped,
      rawStartSec: rawStart,
    };
  }

  function endDrag(state){
    return {
      committedStartSec: state.lastPreviewStartSec,
      originStartSec: state.originStartSec,
      moved: Math.abs(state.lastPreviewStartSec - state.originStartSec) > 1e-9,
      elapsedMs: Date.now() - state.startedAt,
    };
  }

  return {
    beginDrag,
    updateDrag,
    endDrag,
  };
});
