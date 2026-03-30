/**
 * Heuristic multi-track split for seconds-based transcription scores (ScoreDoc-like).
 * Pure, deterministic, no browser-only APIs at load time.
 *
 * Heuristic: fixed MIDI pitch boundaries (partition — each note in exactly one bucket).
 * - 3 tracks (default): High (pitch > MID_MAX), Mid (LOW_MAX < pitch <= MID_MAX), Low (pitch <= LOW_MAX)
 *   Defaults: LOW_MAX=41, MID_MAX=83 → ranges ~0–41, 42–83, 84–127
 * - 2 tracks: High (pitch > MID_MAX) vs Rest (pitch <= MID_MAX)
 *
 * Output track order (stable): index 0 = High (primary / melody-line candidate for editors that use tracks[0]),
 * then Mid (or merged), then Low.
 */
(function (root) {
  'use strict';

  var DEFAULT_LOW_MAX = 41;
  var DEFAULT_MID_MAX = 83;

  function _num(p) {
    var n = Number(p);
    return isFinite(n) ? n : 0;
  }

  /** Which output track index (0..numTracks-1) for this pitch. */
  function _bucketIndex(pitch, numTracks, lowMax, midMax) {
    var p = Math.round(_num(pitch));
    if (p < 0) p = 0;
    if (p > 127) p = 127;
    if (numTracks === 2) {
      return p > midMax ? 0 : 1;
    }
    if (p <= lowMax) return 2;
    if (p <= midMax) return 1;
    return 0;
  }

  function _trackNames(numTracks) {
    if (numTracks === 2) return ['High', 'Low+Mid'];
    return ['High', 'Mid', 'Low'];
  }

  function _trackIds(numTracks) {
    if (numTracks === 2) return ['trk_split_high', 'trk_split_lowmid'];
    return ['trk_split_high', 'trk_split_mid', 'trk_split_low'];
  }

  /** Stable sort: start, then pitch, then id string. */
  function _sortNotes(notes) {
    notes.sort(function (a, b) {
      var sa = _num(a.start);
      var sb = _num(b.start);
      if (sa !== sb) return sa - sb;
      var pa = Math.round(_num(a.pitch));
      var pb = Math.round(_num(b.pitch));
      if (pa !== pb) return pa - pb;
      var ia = a.id != null ? String(a.id) : '';
      var ib = b.id != null ? String(b.id) : '';
      if (ia !== ib) return ia < ib ? -1 : ia > ib ? 1 : 0;
      return 0;
    });
    return notes;
  }

  function _cloneNote(n) {
    var vel = n.velocity != null ? Math.round(_num(n.velocity)) : 64;
    if (vel < 1) vel = 1;
    if (vel > 127) vel = 127;
    var o = {
      pitch: Math.round(_num(n.pitch)),
      start: _num(n.start),
      duration: Math.max(1e-6, _num(n.duration)),
      velocity: vel,
    };
    if (n.id != null) o.id = String(n.id);
    return o;
  }

  /**
   * @param {object} scoreIn - ScoreDoc-like: { version?, tempo_bpm?, bpm?, time_signature?, tracks?: [{ notes? }] }
   * @param {object} [opts]
   * @param {2|3} [opts.numTracks=3]
   * @param {number} [opts.lowMax=41]  inclusive upper bound for low bucket (3-track mode)
   * @param {number} [opts.midMax=83]  inclusive upper bound for mid bucket; above → high (3-track); 2-track split high vs rest
   * @returns {object} new score-like object; does not mutate scoreIn
   */
  function splitScoreDocByPitchBuckets(scoreIn, opts) {
    opts = opts || {};
    var numTracks = opts.numTracks === 2 ? 2 : 3;
    var lowMax = opts.lowMax != null ? _num(opts.lowMax) : DEFAULT_LOW_MAX;
    var midMax = opts.midMax != null ? _num(opts.midMax) : DEFAULT_MID_MAX;

    var src = scoreIn && typeof scoreIn === 'object' ? scoreIn : {};
    var merged = [];
    var tracksIn = Array.isArray(src.tracks) ? src.tracks : [];
    for (var ti = 0; ti < tracksIn.length; ti++) {
      var tr = tracksIn[ti];
      var notes = tr && Array.isArray(tr.notes) ? tr.notes : [];
      for (var ni = 0; ni < notes.length; ni++) {
        var n = notes[ni];
        if (!n || typeof n !== 'object') continue;
        merged.push(_cloneNote(n));
      }
    }

    var buckets = [];
    for (var b = 0; b < numTracks; b++) buckets[b] = [];

    for (var i = 0; i < merged.length; i++) {
      var note = merged[i];
      var idx = _bucketIndex(note.pitch, numTracks, lowMax, midMax);
      buckets[idx].push(note);
    }

    var names = _trackNames(numTracks);
    var ids = _trackIds(numTracks);
    var outTracks = [];
    for (var t = 0; t < numTracks; t++) {
      outTracks.push({
        id: ids[t],
        name: names[t],
        notes: _sortNotes(buckets[t]),
      });
    }

    var tempo =
      typeof src.tempo_bpm === 'number' && isFinite(src.tempo_bpm)
        ? src.tempo_bpm
        : typeof src.bpm === 'number' && isFinite(src.bpm)
          ? src.bpm
          : 120;
    var out = {
      version: typeof src.version === 'number' ? src.version : 1,
      tempo_bpm: tempo,
      time_signature:
        typeof src.time_signature === 'string' ? src.time_signature : '4/4',
      tracks: outTracks,
    };
    if (typeof src.bpm === 'number' && isFinite(src.bpm)) out.bpm = src.bpm;
    return out;
  }

  var API = { splitScoreDocByPitchBuckets: splitScoreDocByPitchBuckets };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.H2SScoreHeuristicSplit = API;
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : this
);
