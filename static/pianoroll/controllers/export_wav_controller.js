/* Hum2Song Studio - Export WAV Controller (plain script)
   - PR-F2a: Offline render current project audio with Tone.Offline, download .wav
   - Respects track mute (via flatten)
   - Prefers in-memory project (like Export MIDI)
*/
(function(){
  'use strict';

  var LS_V2 = 'hum2song_studio_project_v2';
  var LS_V1 = 'hum2song_studio_project_v1';
  var TAIL_SEC = 1.5;

  function safeParse(raw){
    try { return JSON.parse(raw); } catch(_e){ return null; }
  }

  function loadProjectAny(){
    var rawV2 = localStorage.getItem(LS_V2);
    if (rawV2){ var p2 = safeParse(rawV2); if (p2) return p2; }
    var rawV1 = localStorage.getItem(LS_V1);
    if (rawV1){ var p1 = safeParse(rawV1); if (p1) return p1; }
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

  function clamp(v, lo, hi){
    v = Number(v);
    if (!isFinite(v)) v = lo;
    return Math.max(lo, Math.min(hi, v));
  }

  function makeSynthByInstrument(Tone, name){
    switch (String(name || 'default')){
      case 'bass': return new Tone.MonoSynth();
      case 'lead': return new Tone.Synth();
      case 'pad': return new Tone.FMSynth();
      case 'pluck': return new Tone.PluckSynth();
      case 'drum': return new Tone.MembraneSynth();
      default: return new Tone.PolySynth(Tone.Synth);
    }
  }

  function audioBufferToWav(ab){
    var buf = (ab && ab.buffer) ? ab.buffer : ab;
    if (!buf || typeof buf.getChannelData !== 'function') return null;
    var numChannels = buf.numberOfChannels;
    var sampleRate = buf.sampleRate;
    var len = buf.length;
    var blockAlign = numChannels * 2;
    var dataLength = len * blockAlign;
    var size = 44 + dataLength;
    var arr = new ArrayBuffer(size);
    var view = new DataView(arr);
    var o = 0;
    function u8(v){ view.setUint8(o, v); o += 1; }
    function u16(v){ view.setUint16(o, v, true); o += 2; }
    function u32(v){ view.setUint32(o, v, true); o += 4; }
    'RIFF'.split('').forEach(function(c){ u8(c.charCodeAt(0)); });
    u32(size - 8);
    'WAVE'.split('').forEach(function(c){ u8(c.charCodeAt(0)); });
    'fmt '.split('').forEach(function(c){ u8(c.charCodeAt(0)); });
    u32(16);
    u16(1);
    u16(numChannels);
    u32(sampleRate);
    u32(sampleRate * blockAlign);
    u16(blockAlign);
    u16(16);
    'data'.split('').forEach(function(c){ u8(c.charCodeAt(0)); });
    u32(dataLength);
    var ch0 = buf.getChannelData(0);
    if (numChannels === 1){
      for (var i = 0; i < len; i++){
        var s = Math.max(-1, Math.min(1, ch0[i])) * 32767;
        view.setInt16(o, s, true); o += 2;
      }
    } else {
      var ch1 = buf.getChannelData(1);
      for (var i = 0; i < len; i++){
        var L = Math.max(-1, Math.min(1, ch0[i])) * 32767;
        var R = Math.max(-1, Math.min(1, ch1[i])) * 32767;
        view.setInt16(o, L, true); o += 2;
        view.setInt16(o, R, true); o += 2;
      }
    }
    return new Blob([arr], { type: 'audio/wav' });
  }

  async function exportWav(){
    var btn = document.getElementById('btnExportWav');
    var H = window.H2SProject;
    var Tone = window.Tone;
    if (!H || typeof H.flatten !== 'function'){
      alert('Export WAV: H2SProject.flatten not available (project.js not loaded?).');
      return;
    }
    if (!Tone || typeof Tone.Offline !== 'function'){
      alert(
        'Export WAV: Tone.js not available or Tone.Offline missing.\n\n' +
        'Ensure Tone.js is loaded from /static/pianoroll/vendor/tone/Tone.js and that the page has run at least once (e.g. click Play).'
      );
      return;
    }

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
      alert('Export WAV: could not migrate project to v2 (beats).');
      return;
    }

    var flat = H.flatten(p2);
    var endSec = 0;
    for (var ti = 0; ti < (flat.tracks || []).length; ti++){
      var tr = flat.tracks[ti];
      var notes = tr && tr.notes ? tr.notes : [];
      for (var ni = 0; ni < notes.length; ni++){
        var n = notes[ni];
        var s = Number(n.startSec || 0);
        var d = Number(n.durationSec || 0.01);
        if (s + d > endSec) endSec = s + d;
      }
    }
    var totalSec = Math.max(0.5, endSec + TAIL_SEC);

    if (btn){ btn.disabled = true; }
    setStatus('Rendering WAV...');

    try {
      var metaByTrackId = {};
      for (var i = 0; i < (p2.tracks || []).length; i++){
        var t = p2.tracks[i];
        if (!t) continue;
        var tid = t.trackId || t.id;
        if (tid) metaByTrackId[tid] = { instrument: t.instrument || 'default', muted: !!t.muted, gainDb: Number.isFinite(Number(t.gainDb)) ? Number(t.gainDb) : 0 };
      }

      var result = await Tone.Offline(function(ctx){
        var transport = ctx.transport;
        var synthByTid = {};
        function getSynth(trackId){
          if (synthByTid[trackId]) return synthByTid[trackId];
          var meta = metaByTrackId[trackId] || { instrument: 'default', muted: false, gainDb: 0 };
          if (meta.muted) return null;
          var s = makeSynthByInstrument(Tone, meta.instrument).toDestination();
          try{ if (s.volume && isFinite(meta.gainDb)) s.volume.value = meta.gainDb; }catch(e){}
          synthByTid[trackId] = s;
          return s;
        }
        for (var ti = 0; ti < (flat.tracks || []).length; ti++){
          var tr = flat.tracks[ti];
          var tid = tr && (tr.trackId || tr.id);
          if (!tid) continue;
          var syn = getSynth(tid);
          if (!syn) continue;
          var notes = tr.notes || [];
          for (var ni = 0; ni < notes.length; ni++){
            var n = notes[ni];
            var time = Number(n.startSec || 0);
            var dur = Math.max(0.01, Number(n.durationSec || 0.1));
            var vel = (n.velocity == null) ? 0.8 : Number(n.velocity);
            if (vel > 1.01) vel = clamp(Math.round(vel), 1, 127) / 127;
            else vel = clamp(vel, 0.01, 1);
            var pitch = n.pitch;
            var when = time;
            (function(pt, d, v, at){
              transport.schedule(function(t){
                try{ syn.triggerAttackRelease(Tone.Frequency(pt, 'midi'), d, t, v); }catch(e){}
              }, at);
            })(pitch, dur, vel, when);
          }
        }
        transport.start(0);
      }, totalSec);

      var buf = (result && result.buffer) ? result.buffer : result;
      var blob = audioBufferToWav(buf);
      if (!blob){
        setStatus('');
        alert('Export WAV: failed to encode audio buffer.');
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'hum2song.wav';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
      setStatus('WAV exported.');
      setTimeout(function(){ setStatus(''); }, 2000);
    } catch(e){
      setStatus('');
      alert('Export WAV failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (btn){ btn.disabled = false; }
    }
  }

  function bindOnce(btn){
    if (!btn) return;
    if (btn.__h2sExportWavBound) return;
    btn.addEventListener('click', function(){ exportWav(); });
    btn.__h2sExportWavBound = true;
  }

  function ensureButton(){
    var btn = document.getElementById('btnExportWav');
    if (!btn) return false;
    bindOnce(btn);
    return true;
  }

  function start(){
    ensureButton();
    var tries = 0;
    var t = setInterval(function(){
      tries++;
      if (ensureButton() || tries >= 80){ clearInterval(t); }
    }, 250);
    var parent = document.getElementById('btnExportProject') && document.getElementById('btnExportProject').parentNode;
    if (parent && window.MutationObserver){
      try{
        var mo = new MutationObserver(function(){ ensureButton(); });
        mo.observe(parent, { childList: true });
      }catch(_e){}
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
