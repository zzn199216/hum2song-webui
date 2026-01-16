/* Hum2Song Studio - selection_controller.js
   Owns selection UI in the Inspector and related shortcuts.

   Design goals:
   - MUST NOT rebuild timeline DOM. Only touches Inspector root element.
   - UI markup comes from ui/selection_view.js to prevent regressions.
   - All mutations happen via injected callbacks (app remains the source of truth).
*/
(function(){
  'use strict';

  function isTypingTarget(el){
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function create(opts){
    const rootEl = opts.rootEl;
    const getProject = opts.getProject;
    const getState = opts.getState;
    const fmtSec = opts.fmtSec || ((x)=>String(x));
    const escapeHtml = opts.escapeHtml || ((s)=>String(s));
    const onEditClip = opts.onEditClip || function(){};
    const onDuplicateInstance = opts.onDuplicateInstance || function(){};
    const onRemoveInstance = opts.onRemoveInstance || function(){};
    const onLog = opts.onLog || null;

    const view = (window.H2SSelectionView && window.H2SSelectionView.selectionBoxInnerHTML)
      ? window.H2SSelectionView
      : null;

    function log(msg){
      if (onLog) try{ onLog(msg); }catch(e){}
    }

    function currentSelectedInstance(){
      const state = getState();
      const project = getProject();
      const id = state && state.selectedInstanceId;
      if (!id) return null;
      const inst = (project.instances || []).find(x => x.id === id) || null;
      if (!inst) return null;
      const clip = (project.clips || []).find(c => c.id === inst.clipId) || null;
      return { inst, clip };
    }

    function bindActions(){
      const btnEdit = rootEl.querySelector('[data-act="edit"]');
      const btnDup = rootEl.querySelector('[data-act="duplicate"]');
      const btnDel = rootEl.querySelector('[data-act="remove"]');

      const sel = currentSelectedInstance();
      const inst = sel ? sel.inst : null;
      if (!inst) return;

      if (btnEdit){
        btnEdit.addEventListener('click', (e) => {
          e.preventDefault();
          onEditClip(inst.clipId);
        });
      }
      if (btnDup){
        btnDup.addEventListener('click', (e) => {
          e.preventDefault();
          onDuplicateInstance(inst.id);
        });
      }
      if (btnDel){
        btnDel.addEventListener('click', (e) => {
          e.preventDefault();
          onRemoveInstance(inst.id);
        });
      }
    }

    function render(){
      const sel = currentSelectedInstance();
      if (!sel){
        rootEl.className = 'muted';
        rootEl.textContent = 'Select a clip instance on timeline.';
        return;
      }

      const inst = sel.inst;
      const clipName = sel.clip ? sel.clip.name : inst.clipId;
      rootEl.className = '';
      if (view){
        rootEl.innerHTML = view.selectionBoxInnerHTML({
          clipName,
          clipId: inst.clipId,
          startSec: inst.startSec,
          transpose: inst.transpose || 0,
          fmtSec,
          escapeHtml,
        });
      } else {
        // Fallback markup (should not happen in normal builds)
        rootEl.innerHTML = `
          <div class="kv"><b>Clip</b><span>${escapeHtml(clipName)}</span></div>
          <div class="kv"><b>Start</b><span>${fmtSec(inst.startSec)}</span></div>
          <div class="kv"><b>Transpose</b><span>${inst.transpose || 0}</span></div>
          <div class="row" style="margin-top:10px;">
            <button class="btn mini" data-act="edit">Edit</button>
            <button class="btn mini" data-act="duplicate">Duplicate</button>
            <button class="btn mini danger" data-act="remove">Remove</button>
          </div>
        `;
      }
      bindActions();
    }

    // Shortcut: Delete/Backspace removes selected instance (same as clicking ×)
    function onKeyDown(ev){
      const state = getState();
      if (!state) return;
      // Do not conflict with editor modal
      if (state.modal && state.modal.show) return;
      if (isTypingTarget(document.activeElement)) return;

      if (ev.key === 'Delete' || ev.key === 'Backspace'){
        const sel = currentSelectedInstance();
        if (!sel) return;
        ev.preventDefault();
        onRemoveInstance(sel.inst.id);
        log('Removed instance (Delete).');
      }
    }

    window.addEventListener('keydown', onKeyDown);

    return {
      render,
      destroy(){
        window.removeEventListener('keydown', onKeyDown);
      }
    };
  }

  const api = { create };
  window.H2SSelectionController = api;

  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
})();
