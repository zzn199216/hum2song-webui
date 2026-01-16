/* Hum2Song Studio - controllers/timeline_runtime.js
   Pure-ish runtime helpers for timeline drag behavior.
   - No DOM dependencies; caller provides track geometry.
   UMD-style: window.H2STimelineRuntime + Node require().
*/
(function(root, factory){
  if (typeof module === 'object' && module.exports){
    module.exports = factory(require('../core/timeline_math.js'));
  } else {
    root.H2STimelineRuntime = factory(root.H2STimelineMath);
  }
})(typeof window !== 'undefined' ? window : globalThis, function(MathUtil){
  'use strict';

  const VERSION = 'timeline_runtime_v1';

  function _requireMath(){
    if (!MathUtil) throw new Error('H2STimelineMath is required');
    return MathUtil;
  }

  /**
   * Create a drag session.
   * All units are in seconds + pixels (we will convert).
   */
  function createDragSession(opts){
    opts = opts || {};
    const M = _requireMath();

    const session = {
      instId: String(opts.instId || ''),
      pointerId: opts.pointerId,
      startClientX: Number(opts.startClientX || 0),
      offsetX: Number(opts.offsetX || 0),
      labelW: Number(opts.labelW || 120),
      pxPerSec: Number(opts.pxPerSec || 160),
      thresholdPx: Number(opts.thresholdPx || 4),
      started: false,

      /** Decide whether we should enter drag mode based on current clientX. */
      maybeStart(clientX){
        const dx = Number(clientX || 0) - session.startClientX;
        if (!session.started && M.shouldStartDrag(dx, session.thresholdPx)){
          session.started = true;
          return true;
        }
        return session.started;
      },

      /**
       * Compute startSec from pointer position.
       * Caller provides:
       * - rectLeft: tracks.getBoundingClientRect().left
       * - scrollLeft: tracks.scrollLeft
       * Optional:
       * - gridSec: snap grid in seconds (<=0 means no snap)
       * - bypassSnap: boolean
       */
      compute(clientX, rectLeft, scrollLeft, gridSec, bypassSnap){
        const M2 = _requireMath();
        const cx = Number(clientX || 0);
        const rl = Number(rectLeft || 0);
        const sl = Number(scrollLeft || 0);
        const contentX = (cx - rl) + sl;
        const left = contentX - session.offsetX;
        let startSec = Math.max(0, (left - session.labelW) / session.pxPerSec);
        if (!bypassSnap && isFinite(gridSec) && Number(gridSec) > 0){
          startSec = Math.max(0, M2.snap(startSec, Number(gridSec)));
        }
        const leftPx = session.labelW + startSec * session.pxPerSec;
        return { startSec, leftPx };
      },
    };

    return session;
  }

  return {
    VERSION,
    createDragSession,
  };
});
