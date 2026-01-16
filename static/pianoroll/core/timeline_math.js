/* Hum2Song Studio - core/timeline_math.js
   Small, framework-free utilities for timeline math.
   UMD-style so it can run in browser (window.H2STimelineMath) and in Node (require).
*/
(function(root, factory){
  if (typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    root.H2STimelineMath = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  const VERSION = 'timeline_math_v1';

  function clamp(v, a, b){
    v = Number(v);
    if (!isFinite(v)) v = 0;
    return Math.max(a, Math.min(b, v));
  }

  function roundTo(v, step){
    v = Number(v);
    step = Number(step);
    if (!isFinite(v) || !isFinite(step) || step <= 0) return v;
    return Math.round(v / step) * step;
  }

  function secToPx(sec, pxPerSec){
    sec = Number(sec); pxPerSec = Number(pxPerSec);
    if (!isFinite(sec)) sec = 0;
    if (!isFinite(pxPerSec) || pxPerSec <= 0) pxPerSec = 160;
    return sec * pxPerSec;
  }

  function pxToSec(px, pxPerSec){
    px = Number(px); pxPerSec = Number(pxPerSec);
    if (!isFinite(px)) px = 0;
    if (!isFinite(pxPerSec) || pxPerSec <= 0) pxPerSec = 160;
    return px / pxPerSec;
  }

  function snap(value, grid){
    value = Number(value); grid = Number(grid);
    if (!isFinite(value)) value = 0;
    if (!isFinite(grid) || grid <= 0) return value;
    return Math.round(value / grid) * grid;
  }

  function shouldStartDrag(dxPx, thresholdPx){
    dxPx = Math.abs(Number(dxPx || 0));
    thresholdPx = Number(thresholdPx || 4);
    return dxPx >= thresholdPx;
  }

  return {
    VERSION,
    clamp,
    roundTo,
    secToPx,
    pxToSec,
    snap,
    shouldStartDrag,
  };
});
