// scripts/run_frontend_timeline_unit_tests.js
// Node-only unit tests for timeline_math + timeline_runtime.
const assert = require('assert');

const MathLib = require('../static/pianoroll/core/timeline_math.js');
const Rt = require('../static/pianoroll/controllers/timeline_runtime.js');

function nearly(a,b,eps=1e-9){ return Math.abs(a-b) <= eps; }

(function test_snap(){
  assert.strictEqual(MathLib.snapSec(-1, 0.5, false), 0);
  assert.ok(nearly(MathLib.snapSec(0.49, 0.5, false), 0.5));
  assert.ok(nearly(MathLib.snapSec(1.01, 0.5, false), 1.0));
  assert.ok(nearly(MathLib.snapSec(1.01, 0.5, true), 1.01)); // bypass
})();

(function test_drag(){
  const pxPerSec = 100; // 100px == 1sec
  const instStartSec = 2.0;
  const st = Rt.beginDrag({ pxPerSec, pointerX: 250, instStartSec }); 
  // pointerX 250 => 2.5sec, offset 0.5
  assert.ok(nearly(st.offsetSec, 0.5));

  let u = Rt.updateDrag(st, { pointerX: 350, gridSec: 0.25, bypass: false }); // 3.5-0.5=3.0 => snap 3.0
  assert.ok(nearly(u.previewStartSec, 3.0));

  u = Rt.updateDrag(st, { pointerX: 333, gridSec: 0.25, bypass: false }); // 3.33-0.5=2.83 => snap 2.75
  assert.ok(nearly(u.previewStartSec, 2.75));

  u = Rt.updateDrag(st, { pointerX: 333, gridSec: 0.25, bypass: true }); // bypass
  assert.ok(nearly(u.previewStartSec, 2.83));

  const e = Rt.endDrag(st);
  assert.ok(nearly(e.committedStartSec, 2.83));
})();

console.log('PASS timeline_math + timeline_runtime unit tests');
