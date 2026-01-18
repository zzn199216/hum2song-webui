/* Hum2Song Studio - Export Flatten Controller (plain script)
   - Injects an "Export Flatten JSON" button near the existing Export Project button
   - Resilient to inspector re-renders (keeps the button present)
   - Exports a bundle: {project(v2 beats), flatten(sec events)}
   - No imports/exports; no eval; safe for CSP.
*/
(function(){
  'use strict';

  var LS_V2 = 'hum2song_studio_project_v2';
  var LS_V1 = 'hum2song_studio_project_v1';

  function downloadText(filename, text){
    var blob = new Blob([text], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
  }

  function safeParse(raw){
    try { return JSON.parse(raw); } catch(_e){ return null; }
  }

  function loadProjectAny(){
    var rawV2 = localStorage.getItem(LS_V2);
    if (rawV2){
      var p2 = safeParse(rawV2);
      if (p2) return p2;
    }
    var rawV1 = localStorage.getItem(LS_V1);
    if (rawV1){
      var p1 = safeParse(rawV1);
      if (p1) return p1;
    }
    return null;
  }

  function ensureProjectV2(project){
    if (!project) return null;
    if (project.version === 2 && project.timebase === 'beat') return project;
    var H = window.H2SProject;
    if (H && typeof H.migrateProjectV1toV2 === 'function'){
      return H.migrateProjectV1toV2(project);
    }
    return null;
  }

  function exportFlatten(){
    var H = window.H2SProject;
    if (!H || typeof H.flatten !== 'function'){
      alert('Export Flatten: H2SProject.flatten not available (project.js not loaded?)');
      return;
    }
    var any = loadProjectAny();
    if (!any){
      alert('No project found in localStorage. Save or create a project first.');
      return;
    }
    var p2 = ensureProjectV2(any);
    if (!p2){
      alert('Export Flatten: could not migrate project to v2 (beats).');
      return;
    }
    var flat = H.flatten(p2);
    var bundle = {
      kind: 'hum2song_flatten_bundle',
      version: 1,
      exportedAt: Date.now(),
      project: p2,
      flatten: flat
    };
    downloadText('hum2song_flatten_' + Date.now() + '.json', JSON.stringify(bundle, null, 2));
  }

  function bindOnce(btn){
    if (!btn) return;
    if (btn.__h2sExportFlattenBound) return;
    btn.addEventListener('click', exportFlatten);
    btn.__h2sExportFlattenBound = true;
  }

  function ensureButton(){
    var exportProjectBtn = document.getElementById('btnExportProject');
    if (!exportProjectBtn) return false;

    var existing = document.getElementById('btnExportFlatten');
    if (!existing){
      var btn = document.createElement('button');
      btn.id = 'btnExportFlatten';
      btn.className = exportProjectBtn.className || 'btn';
      btn.textContent = 'Export Flatten JSON';

      // Insert right after Export Project button.
      var parent = exportProjectBtn.parentNode;
      if (!parent) return false;
      parent.insertBefore(btn, exportProjectBtn.nextSibling);
      existing = btn;
    }

    bindOnce(existing);
    return true;
  }

  function startResilientInjection(){
    // 1) Try now
    ensureButton();

    // 2) Retry for a while, because app.js may re-render inspector later.
    var tries = 0;
    var maxTries = 80; // ~20s at 250ms
    var t = setInterval(function(){
      tries++;
      var ok = ensureButton();
      if (ok || tries >= maxTries){
        clearInterval(t);
      }
    }, 250);

    // 3) Also observe the Actions container if present; re-inject if removed.
    var exportProjectBtn = document.getElementById('btnExportProject');
    if (exportProjectBtn && exportProjectBtn.parentNode && window.MutationObserver){
      var parent = exportProjectBtn.parentNode;
      try {
        var mo = new MutationObserver(function(){
          ensureButton();
        });
        mo.observe(parent, {childList:true});
      } catch(_e){
        // ignore
      }
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', startResilientInjection);
  } else {
    startResilientInjection();
  }
})();
