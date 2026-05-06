/**
 * Cloud embed postMessage bridge (dev v0).
 * Loaded after app.js so H2SApp / APP is available.
 */
(function () {
  'use strict';

  var ALLOWED_CLOUD_ORIGINS = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3010',
    'http://127.0.0.1:3010',
    'http://localhost:3012',
    'http://127.0.0.1:3012',
  ]);

  function allowedOrigin(origin) {
    return typeof origin === 'string' && ALLOWED_CLOUD_ORIGINS.has(origin);
  }

  function getApp() {
    return window.H2SApp || window.APP || window.app || null;
  }

  function deepClone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  function postBack(origin, payload) {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage(payload, origin);
  }

  function isProjectDocLikely(projectDoc) {
    if (!projectDoc || typeof projectDoc !== 'object' || Array.isArray(projectDoc)) return false;
    if (projectDoc.version === 2) return true;
    if (projectDoc.timebase === 'beat') return true;
    return false;
  }

  window.addEventListener('message', function (event) {
    if (!allowedOrigin(event.origin)) return;

    var data = event.data;
    if (!data || typeof data !== 'object') return;

    var type = data.type;
    if (typeof type !== 'string') return;

    switch (type) {
      case 'H2S_CLOUD_PING':
        postBack(event.origin, {
          type: 'H2S_CLOUD_PONG',
          requestId: data.requestId,
          ok: true,
        });
        return;

      case 'H2S_CLOUD_REQUEST_PROJECT': {
        var app = getApp();
        if (!app || typeof app.getProjectV2 !== 'function') {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: 'studio_app_or_getProjectV2_unavailable',
          });
          return;
        }
        var raw;
        try {
          raw = app.getProjectV2();
        } catch (err) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: (err && (err.message || String(err))) || 'getProjectV2_failed',
          });
          return;
        }
        if (!raw || typeof raw !== 'object') {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: 'no_project',
          });
          return;
        }
        try {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: true,
            projectDoc: deepClone(raw),
          });
        } catch (err2) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: (err2 && (err2.message || String(err2))) || 'clone_failed',
          });
        }
        return;
      }

      case 'H2S_CLOUD_LOAD_PROJECT': {
        var appLoad = getApp();
        if (!appLoad || typeof appLoad.setProjectFromV2 !== 'function') {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: 'studio_app_or_setProjectFromV2_unavailable',
          });
          return;
        }
        var pd = data.projectDoc;
        if (!pd || typeof pd !== 'object' || Array.isArray(pd)) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: 'projectDoc_must_be_object',
          });
          return;
        }
        if (!isProjectDocLikely(pd)) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: 'projectDoc_must_be_version_2_or_beat_timebase',
          });
          return;
        }
        try {
          var res = appLoad.setProjectFromV2(pd);
          if (res && res.ok === false) {
            postBack(event.origin, {
              type: 'H2S_CLOUD_LOAD_RESULT',
              requestId: data.requestId,
              ok: false,
              error: (res.error && String(res.error)) || 'setProjectFromV2_rejected',
            });
            return;
          }
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: true,
          });
        } catch (errL) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: (errL && (errL.message || String(errL))) || 'setProjectFromV2_exception',
          });
        }
        return;
      }

      default:
        return;
    }
  });

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'H2S_STUDIO_BRIDGE_READY', version: 1 }, '*');
  }
})();
