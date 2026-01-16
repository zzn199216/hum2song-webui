/* Hum2Song Studio - core/math.js
   Pure helpers. Works in browser (window) and Node (globalThis).
*/
(function(root){
  'use strict';

  const H2S = root.H2S = root.H2S || {};
  const MathCore = H2S.MathCore = H2S.MathCore || {};

  function uid(prefix){
    const s = Math.random().toString(16).slice(2) + Date.now().toString(16);
    return (prefix || 'id_') + s.slice(0, 12);
  }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function midiToName(m){
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const n = ((m % 12) + 12) % 12;
    const o = Math.floor(m / 12) - 1;
    return names[n] + String(o);
  }

  MathCore.uid = uid;
  MathCore.deepClone = deepClone;
  MathCore.clamp = clamp;
  MathCore.midiToName = midiToName;

  // CommonJS export for Node tests
  if (typeof module !== 'undefined' && module.exports){
    module.exports = MathCore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
