/* Hum2Song Studio - Export MIDI Controller (plain script)
   - Wires btnExportMidi: flatten -> POST /export/midi -> download
   - Resilient to inspector re-renders (re-binds if button present)
   - No imports/exports; no eval; safe for CSP.
*/
(function(){
  'use strict';

  var LS_V2 = 'hum2song_studio_project_v2';
  var LS_V1 = 'hum2song_studio_project_v1';

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

  function setStatus(text){
    var app = window.H2SApp;
    if (app && typeof app.setImportStatus === 'function'){
      app.setImportStatus(text, false);
    }
  }

  async function exportMidi(){
    var btn = document.getElementById('btnExportMidi');
    var H = window.H2SProject;
    if (!H || typeof H.flatten !== 'function'){
      alert('Export MIDI: H2SProject.flatten not available (project.js not loaded?)');
      return;
    }
    // PR-F1.3: Prefer in-memory project from running app; fallback to localStorage.
    var APP = window.H2SApp || window.APP || window.app;
    var p2 = (APP && typeof APP.getProjectV2 === 'function') ? APP.getProjectV2() : null;
    if (!p2 && APP && typeof APP.getProject === 'function'){
      var p = APP.getProject();
      if (p) p2 = ensureProjectV2(p);
    }
    if (!p2){
      var any = loadProjectAny();
      if (!any){
        alert('No project found. Save or create a project first.');
        return;
      }
      p2 = ensureProjectV2(any);
    }
    if (!p2){
      alert('Export MIDI: could not migrate project to v2 (beats).');
      return;
    }

    if (btn){
      btn.disabled = true;
    }
    setStatus('Exporting MIDI...');

    try {
      var flat = H.flatten(p2);
      var r = await fetch('/export/midi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flat)
      });

      if (!r.ok){
        var errText = '';
        try {
          var errJson = await r.json();
          errText = (errJson && errJson.detail) ? String(errJson.detail) : r.statusText;
        } catch(_e){
          errText = r.statusText || 'Request failed';
        }
        setStatus('');
        alert('Export MIDI failed: ' + errText);
        return;
      }

      var blob = await r.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'hum2song.mid';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
      setStatus('MIDI exported.');
      setTimeout(function(){ setStatus(''); }, 2000);
    } catch(e){
      setStatus('');
      alert('Export MIDI failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (btn){
        btn.disabled = false;
      }
    }
  }

  function bindOnce(btn){
    if (!btn) return;
    if (btn.__h2sExportMidiBound) return;
    btn.addEventListener('click', function(){ exportMidi(); });
    btn.__h2sExportMidiBound = true;
  }

  function ensureButton(){
    var btn = document.getElementById('btnExportMidi');
    if (!btn) return false;
    bindOnce(btn);
    return true;
  }

  function start(){
    ensureButton();
    var tries = 0;
    var t = setInterval(function(){
      tries++;
      var ok = ensureButton();
      if (ok || tries >= 80){ clearInterval(t); }
    }, 250);

    var parent = document.getElementById('btnExportProject') && document.getElementById('btnExportProject').parentNode;
    if (parent && window.MutationObserver){
      try {
        var mo = new MutationObserver(function(){ ensureButton(); });
        mo.observe(parent, { childList: true });
      } catch(_e){}
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
