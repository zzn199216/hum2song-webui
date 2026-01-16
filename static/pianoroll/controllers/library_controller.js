/* Hum2Song Studio MVP - controllers/library_controller.js
   Plain script (no import/export). Exposes window.H2SLibraryController.

   Responsibilities:
   - Render Clip Library list
   - Bind actions: Play / Add / Edit / Remove
   - Provide dragstart (text/plain = clipId)

   This is the first step of modularizing app.js WITHOUT changing business logic.
*/
(function(){
  'use strict';

  function create(opts){
    const rootEl = opts.rootEl;
    if (!rootEl) throw new Error('LibraryController: rootEl is required');

    const getProject = opts.getProject;
    const fmtSec = opts.fmtSec;
    const escapeHtml = opts.escapeHtml;

    const view = (window.H2SLibraryView) ? window.H2SLibraryView : null;

    function clear(){
      rootEl.innerHTML = '';
    }

    function render(){
      const project = (typeof getProject === 'function') ? getProject() : null;
      clear();

      const clips = (project && Array.isArray(project.clips)) ? project.clips : [];
      if (clips.length === 0){
        const d = document.createElement('div');
        d.className = 'muted';
        d.textContent = (view && view.emptyMessage) ? view.emptyMessage() : 'No clips yet.';
        rootEl.appendChild(d);
        return;
      }

      for (const clip of clips){
        const st = (window.H2SProject && window.H2SProject.scoreStats) ? window.H2SProject.scoreStats(clip.score) : {count:0, spanSec:0};

        const el = document.createElement('div');
        el.className = 'clipCard';
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
          try{
            e.dataTransfer.setData('text/plain', clip.id);
          }catch(err){
            // ignore
          }
        });

        // markup
        if (view && view.clipCardInnerHTML){
          el.innerHTML = view.clipCardInnerHTML(clip, st, fmtSec, escapeHtml);
        }else{
          // ultra-fallback (shouldn't happen)
          el.textContent = String(clip.name || 'Clip');
        }

        // bind actions
        const btnPlay = el.querySelector('[data-act="play"]');
        const btnAdd = el.querySelector('[data-act="add"]');
        const btnEdit = el.querySelector('[data-act="edit"]');
        const btnRemove = el.querySelector('[data-act="remove"]');

        if (btnPlay) btnPlay.addEventListener('click', (e) => { e.stopPropagation(); opts.onPlay && opts.onPlay(clip.id); });
        if (btnAdd) btnAdd.addEventListener('click', (e) => { e.stopPropagation(); opts.onAdd && opts.onAdd(clip.id); });
        if (btnEdit) btnEdit.addEventListener('click', (e) => { e.stopPropagation(); opts.onEdit && opts.onEdit(clip.id); });
        if (btnRemove) btnRemove.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemove && opts.onRemove(clip.id); });

        rootEl.appendChild(el);
      }
    }

    return {
      render,
      clear,
    };
  }

  window.H2SLibraryController = {
    create,
  };
})();
