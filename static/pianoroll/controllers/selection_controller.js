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
    const onUndoTimeline = opts.onUndoTimeline || function(){ return false; };
    const onAddBass = opts.onAddBass || function(){};
    const onAddAccompaniment = opts.onAddAccompaniment || function(){};
    const onArrangementDetails = opts.onArrangementDetails || function(){};
    const getHasArrangementDetails = opts.getHasArrangementDetails || function(){ return false; };
    const getConvertLabel = opts.getConvertLabel || function(){ return 'Convert to editable'; };
    const getInstanceVolumeLabel = opts.getInstanceVolumeLabel || function(){ return 'Clip volume'; };
    const onSetInstanceGainDb = opts.onSetInstanceGainDb || function(){};
    const getAddBassLabel = opts.getAddBassLabel || function(){ return 'Add Bass'; };
    const getAddAccompanimentLabel = opts.getAddAccompanimentLabel || function(){ return 'Add accompaniment'; };
    const getAddAccompanimentMoreInstructionsLabel = opts.getAddAccompanimentMoreInstructionsLabel || function(){ return 'More instructions (optional)'; };
    const getAddAccompanimentBadgeLabel = opts.getAddAccompanimentBadgeLabel || function(){ return 'Experimental'; };
    const getArrangementDetailsLabel = opts.getArrangementDetailsLabel || function(){ return 'Arrangement Details'; };
    const onConvertAudioToEditable = opts.onConvertAudioToEditable || function(){};
    const getAudioSegmentPanelOpts = opts.getAudioSegmentPanelOpts || function(){ return null; };
    const onSegmentAtPlayhead = opts.onSegmentAtPlayhead || function(){};
    const onSegmentLength = opts.onSegmentLength || opts.onSegmentSetLength || function(){};
    const onOpenTranscriptionSettings = opts.onOpenTranscriptionSettings || function(){};
    const onOpenAudioSeparation = opts.onOpenAudioSeparation || function(){};
    const getAutoSeparationLabel = opts.getAutoSeparationLabel || function(){ return 'AI 自动分轨'; };
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
      const btnConv = rootEl.querySelector('[data-act="convertAudioEditable"]');
      const btnAddBass = rootEl.querySelector('[data-act="addBass"]');
      const btnAddAccomp = rootEl.querySelector('[data-act="addAccompaniment"]');
      const btnDup = rootEl.querySelector('[data-act="duplicate"]');
      const btnDel = rootEl.querySelector('[data-act="remove"]');
      const btnArrDet = rootEl.querySelector('[data-act="arrangementDetails"]');
      const btnTranscriptionSettings = rootEl.querySelector('[data-act="transcriptionSettings"]');
      const btnAudioSeparation = rootEl.querySelector('[data-act="audioSeparation"]');
      const instanceGainInput = rootEl.querySelector('[data-field="instanceGainDb"]');

      const sel = currentSelectedInstance();
      const inst = sel ? sel.inst : null;
      if (!inst) return;

      if (instanceGainInput){
        const output = rootEl.querySelector('[data-role="instanceGainDbValue"]');
        instanceGainInput.addEventListener('input', () => {
          if (output) output.textContent = Number(instanceGainInput.value || 0).toFixed(1) + ' dB';
        });
        instanceGainInput.addEventListener('change', () => {
          onSetInstanceGainDb(inst.id, Number(instanceGainInput.value || 0));
        });
      }

      if (btnEdit){
        btnEdit.addEventListener('click', (e) => {
          e.preventDefault();
          onEditClip(inst.clipId);
        });
      }
      if (btnConv){
        btnConv.addEventListener('click', (e) => {
          e.preventDefault();
          onConvertAudioToEditable(inst.clipId, inst.id);
        });
      }
      if (btnTranscriptionSettings){
        btnTranscriptionSettings.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenTranscriptionSettings(inst.clipId, btnTranscriptionSettings);
        });
      }
      if (btnAudioSeparation){
        btnAudioSeparation.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenAudioSeparation(inst.clipId, inst.id, btnAudioSeparation);
        });
      }
      const btnSegPlayhead = rootEl.querySelector('[data-act="segAtPlayhead"]');
      if (btnSegPlayhead){
        btnSegPlayhead.addEventListener('click', (e) => {
          e.preventDefault();
          onSegmentAtPlayhead(inst.clipId, inst.id);
        });
      }
      rootEl.querySelectorAll('[data-act^="segLen"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const len = Number(btn.getAttribute('data-len') || btn.getAttribute('data-act').replace('segLen', ''));
          if (Number.isFinite(len) && len > 0) onSegmentLength(inst.clipId, len);
        });
      });
      if (btnAddBass){
        btnAddBass.addEventListener('click', (e) => {
          e.preventDefault();
          onAddBass(inst.id);
        });
      }
      if (btnAddAccomp){
        btnAddAccomp.addEventListener('click', (e) => {
          e.preventDefault();
          const ta = rootEl.querySelector('[data-field="addAccompUserPrompt"]');
          let extra = {};
          if (ta && typeof ta.value === 'string'){
            const t = ta.value.trim();
            if (t) extra = { userPrompt: t };
          }
          onAddAccompaniment(inst.id, extra);
        });
      }
      if (btnArrDet){
        btnArrDet.addEventListener('click', (e) => {
          e.preventDefault();
          onArrangementDetails();
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
      const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
      const isAudio = !!(sel.clip && P && typeof P.clipKind === 'function' && P.clipKind(sel.clip) === 'audio');
      rootEl.className = '';
      if (view){
        const segOpts = isAudio && typeof getAudioSegmentPanelOpts === 'function'
          ? (getAudioSegmentPanelOpts(inst) || {})
          : {};
        rootEl.innerHTML = view.selectionBoxInnerHTML(Object.assign({
          clipName,
          clipId: inst.clipId,
          startSec: inst.startSec,
          transpose: inst.transpose || 0,
          instanceGainDb: inst.gainDb || 0,
          instanceVolumeLabel: getInstanceVolumeLabel(),
          fmtSec,
          escapeHtml,
          isAudio,
          convertLabel: getConvertLabel(),
          autoSeparationLabel: getAutoSeparationLabel(),
          addBassLabel: getAddBassLabel(),
          addAccompanimentLabel: getAddAccompanimentLabel(),
          addAccompanimentMoreInstructionsLabel: getAddAccompanimentMoreInstructionsLabel(),
          addAccompanimentBadgeLabel: getAddAccompanimentBadgeLabel(),
          showArrangementDetails: !!getHasArrangementDetails(),
          arrangementDetailsLabel: getArrangementDetailsLabel(),
        }, segOpts));
      } else {
        // Fallback markup (should not happen in normal builds)
        const editOrConv = isAudio
          ? `<button class="btn mini primary" type="button" data-act="convertAudioEditable">${escapeHtml(getConvertLabel())}</button>`
          : `<button class="btn mini" data-act="edit">Edit</button>`;
        rootEl.innerHTML = `
          <div class="kv"><b>Clip</b><span>${escapeHtml(clipName)}</span></div>
          <div class="kv"><b>Start</b><span>${fmtSec(inst.startSec)}</span></div>
          <div class="kv"><b>Transpose</b><span>${inst.transpose || 0}</span></div>
          <div class="row" style="margin-top:10px;">
            ${editOrConv}
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

      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')){
        ev.preventDefault();
        onUndoTimeline();
        return;
      }

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
