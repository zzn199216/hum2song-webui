(function(global){
  'use strict';
  // Works in browser (window) and Node (global).
  const root = global && (global.H2S = global.H2S || {}) || {};
  const LOG_PREFIX = '[EditorController]';

  function log(...args){ try { console.log(LOG_PREFIX, ...args); } catch(e){} }

  function isTextInput(el){
    if(!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
  }

  // The controller is an "edge" layer: it creates a stable boundary for editor open/close,
  // without changing any existing editor behavior yet.
  class EditorController {
    constructor(opts){
      this.getApp = opts.getApp; // () => window.H2SApp
      this.onOpen = opts.onOpen || null;   // optional hook
      this.onClose = opts.onClose || null; // optional hook
      this._patched = false;
      this._orig = {};
    }

    patch(){
      if(this._patched) return true;
      const app = this.getApp && this.getApp();
      if(!app){
        log('No app found yet; patch deferred.');
        return false;
      }

      // We patch only if the methods exist (non-breaking).
      const canOpen = typeof app.openClipEditor === 'function';
      const canClose = typeof app.closeModal === 'function' || typeof app.closeEditorModal === 'function';
      if(!canOpen){
        log('app.openClipEditor not found; patch skipped.');
      }
      if(!canClose){
        log('app.closeModal / app.closeEditorModal not found; patch skipped.');
      }

      if(canOpen){
        this._orig.openClipEditor = app.openClipEditor.bind(app);
        const self = this;
        app.openClipEditor = function(clipId){
          self._activeClipId = String(clipId);
          if(self.onOpen) { try { self.onOpen(clipId); } catch(e){} }
          return self._orig.openClipEditor(clipId);
        };
      }

      if(typeof app.closeModal === 'function'){
        this._orig.closeModal = app.closeModal.bind(app);
        const self = this;
        app.closeModal = function(save){
          // T3-1 safety: before overwriting clip data, snapshot current head into revision history.
          try {
            if(!!save && self._activeClipId && typeof global.H2SProject !== 'undefined' && global.H2SProject && typeof global.H2SProject.beginNewClipRevision === 'function'){
              const appNow = self.getApp ? self.getApp() : null;
              const proj = appNow && appNow.project;
              if(proj){ global.H2SProject.beginNewClipRevision(proj, self._activeClipId, { reason: 'editor_save' }); }
            }
          } catch(e){}
          if(self.onClose) { try { self.onClose(!!save); } catch(e){} }
          return self._orig.closeModal(save);
        };
      } else if(typeof app.closeEditorModal === 'function'){
        this._orig.closeEditorModal = app.closeEditorModal.bind(app);
        const self = this;
        app.closeEditorModal = function(save){
          // T3-1 safety: before overwriting clip data, snapshot current head into revision history.
          try {
            if(!!save && self._activeClipId && typeof global.H2SProject !== 'undefined' && global.H2SProject && typeof global.H2SProject.beginNewClipRevision === 'function'){
              const appNow = self.getApp ? self.getApp() : null;
              const proj = appNow && appNow.project;
              if(proj){ global.H2SProject.beginNewClipRevision(proj, self._activeClipId, { reason: 'editor_save' }); }
            }
          } catch(e){}
          if(self.onClose) { try { self.onClose(!!save); } catch(e){} }
          return self._orig.closeEditorModal(save);
        };
      }

      // A tiny safety: if user is typing, don't intercept editor-bound shortcuts here.
      // (In future, editor runtime will own keyboard logic; for now, we do nothing.)
      this._patched = true;
      log('Patched app editor open/close successfully.');
      return true;
    }
  }

  function autoInstall(){
    // Create a singleton controller if app exists; otherwise retry a few times.
    const controller = new EditorController({
      getApp: () => global.H2SApp,
      onOpen: (clipId) => log('open', clipId),
      onClose: (save) => log('close', save ? 'save' : 'cancel')
    });
    root.EditorController = controller;

    // Try immediately + a few delayed retries (no tight loops).
    const tryPatch = () => controller.patch();
    tryPatch();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const ok = tryPatch();
      if(ok || attempts >= 30) clearInterval(timer);
    }, 100);
  }

  // Export
  root.createEditorController = function(opts){ return new EditorController(opts); };

  // Auto-install in browser contexts.
  // Auto-install in browser contexts (skip in Node tests where document is undefined).
  if(typeof window !== 'undefined' && global === window && typeof document !== 'undefined'){
    // Defer until DOM is ready to ensure app.js had a chance to run.
    // Defer until DOM is ready to ensure app.js had a chance to run.
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', autoInstall);
    } else {
      autoInstall();
    }
  }

  if(typeof module !== 'undefined' && module.exports){
    module.exports = { EditorController, createEditorController: root.createEditorController };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
