(function(root, factory){
  if (typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    root.H2SAddBassV0 = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  var BASS_LOW = 36;   // C2
  var BASS_HIGH = 48;  // C3
  var GROUP_BEAT = 2;  // strong-beat groups in 4/4
  var BASE_VELOCITY = 78;

  function _isFiniteNumber(x){
    return typeof x === 'number' && isFinite(x);
  }

  function _normBeat(P, x){
    if (P && typeof P.normalizeBeat === 'function') return P.normalizeBeat(Number(x || 0));
    var n = Number(x || 0);
    if (!isFinite(n)) return 0;
    return Math.round(n * 1000000) / 1000000;
  }

  function _clampInt(v, lo, hi){
    var n = Math.round(Number(v || 0));
    if (!isFinite(n)) n = lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function _foldPitchToBassRange(midi){
    var p = _clampInt(midi, 0, 127);
    while (p > BASS_HIGH) p -= 12;
    while (p < BASS_LOW) p += 12;
    if (p > BASS_HIGH) p = BASS_HIGH;
    if (p < BASS_LOW) p = BASS_LOW;
    return p;
  }

  function _collectMelodyNotes(clip){
    var out = [];
    if (!clip || !clip.score || !Array.isArray(clip.score.tracks)) return out;
    for (var ti = 0; ti < clip.score.tracks.length; ti++){
      var tr = clip.score.tracks[ti];
      var notes = (tr && Array.isArray(tr.notes)) ? tr.notes : [];
      for (var ni = 0; ni < notes.length; ni++){
        var n = notes[ni];
        if (!n) continue;
        var sb = Number(n.startBeat);
        var db = Number(n.durationBeat);
        var pitch = Number(n.pitch);
        if (!isFinite(sb) || !isFinite(db) || db <= 0 || !isFinite(pitch)) continue;
        out.push({
          id: n.id ? String(n.id) : ('m_' + ti + '_' + ni),
          startBeat: sb,
          durationBeat: db,
          endBeat: sb + db,
          pitch: _clampInt(pitch, 0, 127)
        });
      }
    }
    out.sort(function(a, b){
      if (a.startBeat !== b.startBeat) return a.startBeat - b.startBeat;
      if (a.pitch !== b.pitch) return a.pitch - b.pitch;
      return String(a.id).localeCompare(String(b.id));
    });
    return out;
  }

  function buildBassScoreFromMelodyClip(clip, opts){
    opts = opts || {};
    var P = opts.H2SProject || (typeof window !== 'undefined' ? window.H2SProject : null);
    var melody = _collectMelodyNotes(clip);
    if (!melody.length){
      return { ok: false, reason: 'no_melody_notes' };
    }
    var spanBeat = 0;
    if (clip && clip.meta && _isFiniteNumber(clip.meta.spanBeat)) spanBeat = Number(clip.meta.spanBeat);
    if (!(spanBeat > 0)){
      for (var i = 0; i < melody.length; i++) if (melody[i].endBeat > spanBeat) spanBeat = melody[i].endBeat;
    }
    if (!(spanBeat > 0)) return { ok: false, reason: 'empty_span' };

    var notesOut = [];
    var gStart = 0;
    while (gStart < spanBeat){
      var gEnd = Math.min(spanBeat, gStart + GROUP_BEAT);
      var candidates = [];
      for (var j = 0; j < melody.length; j++){
        var mn = melody[j];
        if (mn.startBeat < gEnd && mn.endBeat > gStart) candidates.push(mn);
      }
      if (candidates.length){
        var picked = candidates[0];
        for (var k = 1; k < candidates.length; k++){
          var c = candidates[k];
          if (c.pitch < picked.pitch) picked = c;
        }
        var dur = Math.min(2, gEnd - gStart);
        if (dur > 0){
          notesOut.push({
            id: (P && typeof P.uid === 'function') ? P.uid('n_') : ('n_' + notesOut.length),
            pitch: _foldPitchToBassRange(picked.pitch),
            velocity: BASE_VELOCITY,
            startBeat: _normBeat(P, gStart),
            durationBeat: _normBeat(P, dur)
          });
        }
      }
      gStart += GROUP_BEAT;
    }

    if (!notesOut.length){
      return { ok: false, reason: 'no_bass_notes' };
    }

    return {
      ok: true,
      scoreBeat: {
        version: 2,
        tempo_bpm: null,
        time_signature: (clip && clip.score && clip.score.time_signature) ? clip.score.time_signature : null,
        tracks: [{
          id: (P && typeof P.uid === 'function') ? P.uid('trk_') : 'trk_bass',
          name: 'Bass',
          notes: notesOut
        }]
      }
    };
  }

  function findOrCreateBassTrack(projectV2, opts){
    opts = opts || {};
    var P = opts.H2SProject || (typeof window !== 'undefined' ? window.H2SProject : null);
    if (!projectV2 || !Array.isArray(projectV2.tracks)) return { ok: false, reason: 'bad_project' };
    for (var i = 0; i < projectV2.tracks.length; i++){
      var t = projectV2.tracks[i];
      var nm = (t && typeof t.name === 'string') ? t.name.trim().toLowerCase() : '';
      if (nm === 'bass'){
        if (typeof t.instrument !== 'string' || !t.instrument) t.instrument = 'bass';
        return { ok: true, trackId: String(t.trackId || t.id), created: false };
      }
    }
    var tid = (P && typeof P.uid === 'function') ? P.uid('trk_') : ('trk_bass_' + Date.now());
    projectV2.tracks.push({ id: tid, trackId: tid, name: 'Bass', instrument: 'bass', gainDb: 0, muted: false });
    return { ok: true, trackId: tid, created: true };
  }

  return {
    buildBassScoreFromMelodyClip: buildBassScoreFromMelodyClip,
    findOrCreateBassTrack: findOrCreateBassTrack
  };
});
