/* Minimal frontend contract tests (Node)
   - No DOM, no bundler, no dependencies.
   - Verifies that UI contracts we frequently regress remain stable.

   Usage:
     node scripts/run_frontend_contract_tests.js
*/
'use strict';

const fs = require('fs');
const path = require('path');

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
  // Optimize feedback contract: when meta.agent is present, card should show explicit result
  const dummyClip2 = { id:'clip_x', name:'test', meta:{ agent:{ appliedAt: 123, patchOps: 0, patchSummary:{ops:0} } } };
  const html2 = libView.clipCardInnerHTML(dummyClip2, dummyStats, fmtSec, escapeHtml);
  assert(/Optimize:\s*No changes/.test(html2), 'missing optimize noop feedback');

  const dummyClip3 = { id:'clip_x', name:'test', meta:{ agent:{ appliedAt: 123, patchOps: 3, patchSummary:{ops:3} } } };
  const html3 = libView.clipCardInnerHTML(dummyClip3, dummyStats, fmtSec, escapeHtml);
  assert(/Optimized/.test(html3) && /ops=3/.test(html3), 'missing optimize applied feedback');

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

  // Legacy classes must remain
  assert(/class=\"instTitle/.test(html), 'missing instTitle');
  assert(/class=\"instSub/.test(html), 'missing instSub');
  assert(/class=\"instRemove/.test(html), 'missing instRemove button');

  // R8 contract additions
  assert(/class=\"instBody/.test(html), 'missing instBody wrapper');
  assert(/data-act=\"remove\"/.test(html), 'missing data-act=remove');
  assert(/btn-inst-remove/.test(html), 'missing btn-inst-remove alias');

  assert(/Remove/.test(html), 'missing Remove label');
  assert(/×/.test(html), 'missing x glyph');
  pass('timeline view includes body + title/sub/remove');
})();

(function testTimelineControllerSourceContract(){
  // Source-level contract: controller should bind events to instBody if present.
  const p = path.join(__dirname, '..', 'static', 'pianoroll', 'timeline_controller.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes("querySelector('.instBody')") || src.includes('querySelector(\".instBody\")'), 'timeline_controller must query .instBody');
  assert(src.includes('data-act=\"remove\"') || src.includes('[data-act=\"remove\"]'), 'timeline_controller must handle [data-act="remove"]');
  pass('timeline controller binds to instBody + data-act remove');
})();

console.log('\nAll frontend contract tests passed.');
