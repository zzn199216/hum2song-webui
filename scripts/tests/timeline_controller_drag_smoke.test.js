/**
 * Timeline controller drag smoke test (Node-only)
 * Purpose:
 * - Ensure create() works with minimal DOM stubs
 * - Ensure instancePointerDown / onPointerMove / onPointerUp do not throw
 * - Ensure drag commits via onPersistAndRender (if hooks available)
 *
 * This is NOT a CSS rendering test.
 */
(function(){
  function assert(cond, msg){ if(!cond) throw new Error(msg||'assertion failed'); }

  // --- Minimal DOM stubs expected by timeline_controller.js ---
  const tracksEl = {
    id: 'timelineTracks',
    className: 'tracks',
    style: {},
    scrollLeft: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 300 }),
  };

  const instBodyEl = {
    className: 'instBody',
    dataset: { id: 'inst_0' },
    style: { left: '0px' },
    isConnected: true,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    closest: (sel) => (sel === '.instBody' ? instBodyEl : null),
    getBoundingClientRect: () => ({ left: 100, top: 40, width: 200, height: 40 }),
  };

  const rootEl = {
    querySelector: (sel) => {
      if (sel === '.instBody') return instBodyEl;
      return null;
    },
    querySelectorAll: (sel) => (sel === '.instBody' ? [instBodyEl] : []),
  };

  global.document = {
    querySelector: (sel) => (sel === '.instBody' ? instBodyEl : null),
    querySelectorAll: (sel) => (sel === '.instBody' ? [instBodyEl] : []),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  global.window = global.window || {};
  window.addEventListener = window.addEventListener || (()=>{});
  window.removeEventListener = window.removeEventListener || (()=>{});
  window.getComputedStyle = window.getComputedStyle || (()=>({}));
  window.__H2S_TIMELINE_SNAP_BEAT = 0.25; // default 1/16

  // --- Minimal project/state stubs ---
  const projectView = {
    bpm: 120,
    tracks: [{ id: 'trk_0', name: 'Track 1' }, { id: 'trk_1', name: 'Track 2' }],
    instances: [{ id: 'inst_0', clipId: 'clip_0', trackId: 'trk_0', startSec: 0, transpose: 0 }],
    ui: { pxPerSec: 160, pxPerBeat: 80, playheadSec: 0, playheadBeat: 0 },
  };
  const state = { dragCandidate: null, draggingInstance: null };

  // Load controller
  const mod = require(process.cwd() + '/static/pianoroll/timeline_controller.js');
  const TimelineController = (mod && typeof mod.create === 'function') ? mod : (global.H2STimelineController || globalThis.H2STimelineController);
  assert(TimelineController && typeof TimelineController.create === 'function', 'H2STimelineController.create must exist');

  let persisted = 0;
  const ctrl = TimelineController.create({
    root: rootEl,
    tracksEl,               // <-- critical: controller relies on config.tracksEl
    getProject: () => projectView,
    getState: () => state,
    onSelectInstance: () => {},
    onPersistAndRender: () => { persisted += 1; },
  });

  assert(ctrl, 'controller should be created');

  const hooks = ctrl.__testHooks || null;
  if (hooks && typeof hooks.instancePointerDown === 'function') {
    // In controller, instancePointerDown(ev, instId, el)
    hooks.instancePointerDown({ pointerId: 1, clientX: 140, clientY: 60, altKey: false, preventDefault: ()=>{}, stopPropagation: ()=>{} }, 'inst_0', instBodyEl);

    // Move enough pixels to pass drag threshold and trigger move logic
    hooks.onPointerMove({ pointerId: 1, clientX: 220, clientY: 60, altKey: false, preventDefault: ()=>{}, stopPropagation: ()=>{} });

    hooks.onPointerUp({ pointerId: 1, clientX: 220, clientY: 60, altKey: false, preventDefault: ()=>{}, stopPropagation: ()=>{} });

    assert(persisted >= 1, 'drag should commit via onPersistAndRender');
    assert(typeof projectView.instances[0].startSec === 'number' && projectView.instances[0].startSec >= 0, 'startSec should be >=0 after drag');
  }

  console.log('PASS timeline_controller drag smoke');
})();
