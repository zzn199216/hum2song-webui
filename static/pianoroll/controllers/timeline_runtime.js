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

  /**
   * Pick a lane index based on pointer Y.
   *
   * This is the only place that should convert Y -> lane index.
   * Controllers should NOT scatter Y math.
   *
   * opts:
   * - clientY: number
   * - rectTop: tracks.getBoundingClientRect().top
   * - scrollTop: tracks.scrollTop
   * - laneHeight: px per lane (>0)
   * - trackCount: number of tracks
   * - currentIndex: current lane index (for hysteresis)
   * - hysteresisPx: dead-zone around boundaries (default laneHeight*0.2)
   */
  function pickLaneIndexByY(opts){
    opts = opts || {};
    const trackCount = Math.max(0, Number(opts.trackCount || 0));
    if (trackCount <= 0) return 0;
    const laneH = Number(opts.laneHeight || 0);
    if (!(laneH > 0)) return Math.min(trackCount - 1, Math.max(0, Number(opts.currentIndex || 0)));

    const rectTop = Number(opts.rectTop || 0);
    const scrollTop = Number(opts.scrollTop || 0);
    const clientY = Number(opts.clientY || 0);
    const contentY = (clientY - rectTop) + scrollTop;

    let idx = Math.floor(contentY / laneH);
    if (!isFinite(idx)) idx = 0;
    idx = Math.max(0, Math.min(trackCount - 1, idx));

    // Hysteresis: avoid rapid lane flipping near boundaries.
    const cur = Math.max(0, Math.min(trackCount - 1, Number(opts.currentIndex || idx)));
    if (idx === cur) return idx;

    const dead = (typeof opts.hysteresisPx === 'number') ? Number(opts.hysteresisPx) : (laneH * 0.2);
    const boundaryTop = cur * laneH;
    const boundaryBottom = (cur + 1) * laneH;

    if (idx > cur){
      // Moving down: require pointer to go below boundary + dead
      if (contentY < (boundaryBottom + dead)) return cur;
      return idx;
    }
    // Moving up: require pointer to go above boundary - dead
    if (contentY > (boundaryTop - dead)) return cur;
    return idx;
  }

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
    pickLaneIndexByY,
  };
});
