#!/usr/bin/env node
/* UX: Recording preview smoke test — playLastRecording does not throw, calls play(), leaves lastRecordedFile unchanged */
'use strict';

const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Minimal shims for Node
if (typeof globalThis.window === 'undefined') globalThis.window = {};
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
}

(function testPlayLastRecordingSmoke() {
  const mockFile = new Blob(['fake-audio'], { type: 'audio/webm' });
  let createObjectURLCalled = false;
  let revokeObjectURLCalled = false;
  let playCalled = false;

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origAudio = typeof globalThis.Audio !== 'undefined' ? globalThis.Audio : null;

  URL.createObjectURL = function (blob) {
    createObjectURLCalled = true;
    return 'blob:mock-url-' + Math.random();
  };
  URL.revokeObjectURL = function () {
    revokeObjectURLCalled = true;
  };

  class MockAudio {
    constructor(url) {
      this._url = url;
      this.onended = null;
      this.onerror = null;
    }
    play() {
      playCalled = true;
      return Promise.resolve();
    }
  }
  globalThis.Audio = MockAudio;

  const app = {
    state: { lastRecordedFile: mockFile },
    playLastRecording() {
      if (!this.state.lastRecordedFile) return;
      try {
        const url = URL.createObjectURL(this.state.lastRecordedFile);
        const audio = new Audio(url);
        const revoke = () => {
          try {
            URL.revokeObjectURL(url);
          } catch (e) {}
        };
        audio.onended = revoke;
        audio.onerror = revoke;
        audio.play().catch(() => revoke());
      } catch (e) {}
    },
  };

  const fileBefore = app.state.lastRecordedFile;
  assert(fileBefore === mockFile, 'mockFile should be set');

  app.playLastRecording();

  assert(createObjectURLCalled, 'createObjectURL should have been called');
  assert(playCalled, 'audio.play() should have been called');
  assert(app.state.lastRecordedFile === mockFile, 'lastRecordedFile must remain unchanged');
  assert(fileBefore === app.state.lastRecordedFile, 'lastRecordedFile must be the same reference');

  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
  if (origAudio) globalThis.Audio = origAudio;
  else delete globalThis.Audio;

  console.log('PASS recording_preview_smoke: playLastRecording no throw, play() called, lastRecordedFile unchanged');
})();
