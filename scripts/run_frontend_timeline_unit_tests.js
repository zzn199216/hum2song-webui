/* Node-only unit tests for timeline math/runtime (no DOM). */
const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assert failed');
}

function pass(name){ console.log('PASS', name); }

(function main(){
  const math = require(path.join('..','static','pianoroll','core','timeline_math.js'));
  const rt = require(path.join('..','static','pianoroll','controllers','timeline_runtime.js'));

  assert(math && math.secToPx && math.pxToSec && math.snap, 'math exports missing');
  pass('timeline_math exports');

  assert(math.secToPx(2, 100) === 200, 'secToPx');
  assert(Math.abs(math.pxToSec(200, 100) - 2) < 1e-9, 'pxToSec');
  pass('sec<->px');

  assert(math.snap(1.01, 0.5) === 1.0, 'snap down');
  assert(math.snap(1.26, 0.5) === 1.5, 'snap up');
  pass('snap');

  const sess = rt.createDragSession({
    instId: 'i1',
    pointerId: 7,
    startClientX: 100,
    offsetX: 20,
    labelW: 120,
    pxPerSec: 200,
    thresholdPx: 4,
  });

  assert(sess.started === false, 'initial started');
  assert(sess.maybeStart(102) === false, 'below threshold should not start');
  assert(sess.maybeStart(120) === true, 'above threshold should start');
  pass('drag threshold');

  // Suppose tracks rectLeft=10, scrollLeft=0, clientX=210
  // contentX=(210-10)+0=200; left=200-20=180; startSec=(180-120)/200=0.3
  const out = sess.compute(210, 10, 0, 0, false);
  assert(Math.abs(out.startSec - 0.3) < 1e-9, 'compute startSec');
  assert(Math.abs(out.leftPx - (120 + 0.3*200)) < 1e-9, 'compute leftPx');
  pass('compute');

  // With snap grid 0.25 sec (no bypass): startSec 0.3 snaps to 0.25
  const out2 = sess.compute(210, 10, 0, 0.25, false);
  assert(Math.abs(out2.startSec - 0.25) < 1e-9, 'compute snapped');
  pass('compute snapped');


  // Timeline controller drag smoke (Node)
  require(path.join('..','scripts','tests','timeline_controller_drag_smoke.test.js'));
  pass('timeline_controller drag smoke');

  console.log('\nAll timeline unit tests passed.');
})();
