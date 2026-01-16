(function(global){
  'use strict';
  const root = global && (global.H2S = global.H2S || {}) || {};

  // Pure DOM accessors for the editor modal. Keeping all selectors here reduces coupling.
  const EditorView = {
    sel: {
      modal: '#clipEditorModal',
      canvas: '#pianoRollCanvas',
      insertBtn: '#insertNoteBtn',
      saveBtn: '#saveClipBtn',
      cancelBtn: '#cancelClipBtn',
      playBtn: '#clipPlayBtn',
      stopBtn: '#clipStopBtn',
      gridLabel: '#gridLabel',
    },
    getModal(){ return document.querySelector(this.sel.modal); },
    getCanvas(){ return document.querySelector(this.sel.canvas); },
    getInsertBtn(){ return document.querySelector(this.sel.insertBtn); },
    getSaveBtn(){ return document.querySelector(this.sel.saveBtn); },
    getCancelBtn(){ return document.querySelector(this.sel.cancelBtn); },
    getPlayBtn(){ return document.querySelector(this.sel.playBtn); },
    getStopBtn(){ return document.querySelector(this.sel.stopBtn); },
    setGridLabel(text){
      const el = document.querySelector(this.sel.gridLabel);
      if(el) el.textContent = text;
    }
  };

  root.EditorView = EditorView;

  if(typeof module !== 'undefined' && module.exports){
    module.exports = { EditorView };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
