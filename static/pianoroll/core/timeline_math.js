/* Hum2Song - timeline_math.js
   Plain script + Node-safe UMD export.
   Purpose: provide pure math helpers for Timeline interactions (sec<->px, snap).
*/
(function(root, factory){
  if (typeof module !== 'undefined' && module.exports){
    module.exports = factory();
  } else {
    root.H2STimelineMath = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function roundTo(v, step){
    const s = (step && step > 0) ? step : 1e-9;
    return Math.round(v / s) * s;
  }

  function secToPx(sec, pxPerSec){ return sec * pxPerSec; }
  function pxToSec(px, pxPerSec){ return px / pxPerSec; }

  // Snap valueSec to gridSec. If bypass=true, no snapping (but still clamps >=0).
  function snapSec(valueSec, gridSec, bypass){
    const v = Math.max(0, valueSec || 0);
    if (bypass) return v;
    const g = (gridSec && gridSec > 0) ? gridSec : 0;
    if (!g) return v;
    return roundTo(v, g);
  }

  // Convert a musical grid expressed in beats (e.g. 1/16 note) to seconds.
  // gridBeats: e.g. 0.25 for 1/4 beat, 0.0625 for 1/16 beat
  function beatsToSec(beats, bpm){
    const b = beats || 0;
    const tempo = (bpm && bpm > 0) ? bpm : 120;
    return (60.0 / tempo) * b;
  }

  return {
    clamp,
    roundTo,
    secToPx,
    pxToSec,
    snapSec,
    beatsToSec,
  };
});
