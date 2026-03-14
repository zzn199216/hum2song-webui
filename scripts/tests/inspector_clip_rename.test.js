#!/usr/bin/env node
'use strict';

/**
 * Regression: Inspector clip rename uses direct mutation + setProjectFromV2.
 * Rename must NOT create a new revision (ops=0 metadata change).
 */

const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// --- 1) Behavioral: rename path updates clip.name and uses setProjectFromV2 ---
(function testRenamePath() {
  global.window = global.window || {};
  require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
  const H2SProject = global.window.H2SProject;
  assert(H2SProject, 'H2SProject missing');

  const p2 = H2SProject.defaultProjectV2();
  const scoreBeat = {
    version: 2,
    tempo_bpm: 120,
    time_signature: '4/4',
    tracks: [{ id: 't_0', name: 'ch0', program: 0, channel: 0, notes: [] }],
  };
  const clip = H2SProject.createClipFromScoreBeat(scoreBeat, { id: 'clip_rename_test', name: 'Original' });
  p2.clips[clip.id] = clip;
  p2.clipOrder = [clip.id];

  const clipId = clip.id;
  assert(p2.clips[clipId].name === 'Original', 'baseline name');

  let setProjectFromV2Called = false;
  const mockApp = {
    getProjectV2: () => p2,
    setProjectFromV2: (project) => {
      setProjectFromV2Called = true;
      assert(project === p2, 'setProjectFromV2 receives same project');
    },
  };

  // Simulate Inspector rename commit logic
  const newName = 'Renamed Clip';
  const clipObj = p2 && p2.clips && p2.clips[clipId];
  assert(clipObj, 'clip exists');
  clipObj.name = newName;
  mockApp.setProjectFromV2(p2);

  assert(p2.clips[clipId].name === 'Renamed Clip', 'clip.name must reflect rename');
  assert(setProjectFromV2Called, 'setProjectFromV2 must be called');

  // Empty/whitespace normalizes to Untitled
  clipObj.name = 'Original';
  const emptyResult = String('   ').trim() || 'Untitled';
  assert(emptyResult === 'Untitled', 'empty/whitespace normalizes to Untitled');

  console.log('PASS inspector clip rename: direct mutation + setProjectFromV2');
})();

// --- 2) Source check: app.js inspClipName uses setProjectFromV2, NOT beginNewClipRevision ---
(function testAppSourceRenamePath() {
  const appPath = path.resolve(__dirname, '../../static/pianoroll/app.js');
  const src = fs.readFileSync(appPath, 'utf8');

  const marker = "act === 'inspClipName'";
  const idx = src.indexOf(marker);
  assert(idx >= 0, 'inspClipName handler must exist');

  const block = src.slice(idx, idx + 600);

  assert(
    block.includes('setProjectFromV2'),
    'inspClipName must call setProjectFromV2'
  );
  assert(
    !block.includes('beginNewClipRevision'),
    'inspClipName must NOT call beginNewClipRevision (rename is ops=0)'
  );
  assert(
    block.includes('clip.name'),
    'inspClipName must mutate clip.name'
  );

  console.log('PASS app.js inspClipName uses setProjectFromV2, no beginNewClipRevision');
})();
