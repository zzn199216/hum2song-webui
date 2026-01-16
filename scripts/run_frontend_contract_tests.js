/* Minimal frontend contract tests (Node)
   - No DOM, no bundler, no dependencies.
   - Verifies that UI contracts we frequently regress remain stable.

   Usage:
     node scripts/run_frontend_contract_tests.js
*/
'use strict';

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

function pass(name){
  console.log('PASS ', name);
}

// Library view contract: buttons must exist with stable data-act values
const libView = require('../static/pianoroll/ui/library_view.js');

(function testLibraryView(){
  const dummyClip = { id:'clip_x', name:'test' };
  const dummyStats = { count: 12, spanSec: 3.21 };
  const fmtSec = (x) => String(x) + 's';
  const escapeHtml = (s) => String(s);

  const html = libView.clipCardInnerHTML(dummyClip, dummyStats, fmtSec, escapeHtml);
  assert(/data-act="play"/.test(html), 'missing play button');
  assert(/data-act="add"/.test(html), 'missing add button');
  assert(/data-act="edit"/.test(html), 'missing edit button');
  assert(/data-act="remove"/.test(html), 'missing remove button');
  assert(/Remove/.test(html), 'remove label missing');
  pass('library view includes play/add/edit/remove');
})();


(function testTimelineViewContracts(){
  const timelineView = require('../static/pianoroll/ui/timeline_view.js');
  const fmtSec = (x)=> String(x) + 's';
  const escapeHtml = (s)=> String(s);

  const html = timelineView.instanceInnerHTML({
    clipName: 'Test Clip',
    startSec: 1.25,
    noteCount: 7,
    fmtSec,
    escapeHtml,
  });

  assert(/class="instTitle"/.test(html), 'missing instTitle');
  assert(/class="instSub"/.test(html), 'missing instSub');
  assert(/class="instRemove"/.test(html), 'missing instRemove button');
  assert(/Remove/.test(html), 'missing Remove label');
  assert(/×/.test(html), 'missing × glyph');
  pass('timeline view includes title/sub/remove');
})();


(function testSelectionViewContracts(){
  const selView = require('../static/pianoroll/ui/selection_view.js');
  const fmtSec = (x)=> String(x) + 's';
  const escapeHtml = (s)=> String(s);
  const html = selView.selectionBoxInnerHTML({
    clipName: 'Test Clip',
    clipId: 'clip_x',
    startSec: 2.5,
    transpose: 0,
    fmtSec,
    escapeHtml,
  });

  assert(/data-act="edit"/.test(html), 'missing edit action');
  assert(/data-act="duplicate"/.test(html), 'missing duplicate action');
  assert(/data-act="remove"/.test(html), 'missing remove action');
  assert(/Remove/.test(html), 'missing Remove label');
  pass('selection view includes edit/duplicate/remove');
})();


(function testAudioFlatten(){
  const audio = require('../static/pianoroll/controllers/audio_controller.js');
  if (!audio || typeof audio.flattenProjectToEvents !== 'function'){
    throw new Error('audio_controller.js must export flattenProjectToEvents');
  }

  const project = {
    bpm: 120,
    ui: { playheadSec: 0 },
    clips: [
      { id: 'c1', name: 'Clip1', score: { tracks: [ { notes: [ { start: 0, duration: 1, pitch: 60, velocity: 100 } ] } ] } }
    ],
    instances: [
      { id: 'i1', clipId: 'c1', startSec: 2, transpose: 12 }
    ]
  };

  const out = audio.flattenProjectToEvents(project, 0);
  if (!out || !Array.isArray(out.events)) throw new Error('flattenProjectToEvents must return {events,maxT}');
  if (out.events.length !== 1) throw new Error('expected 1 event');
  const ev = out.events[0];
  if (Math.abs(ev.t - 2) > 1e-9) throw new Error('event time wrong');
  if (ev.pitch !== 72) throw new Error('transpose pitch wrong');
  if (Math.abs(out.maxT - 3) > 1e-9) throw new Error('maxT wrong');
  pass('audio flattenProjectToEvents works');
})();

console.log('\nAll frontend contract tests passed.');
