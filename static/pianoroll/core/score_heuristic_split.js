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

  /**
   * Build one ScoreDoc-like object per non-empty input track (single internal track each).
   * Order matches source `tracks` (e.g. High, Mid, Low). Skips tracks with no notes.
   * Used after pitch-bucket split to place each bucket on its own clip / timeline track.
   */
  function explodeNonEmptyTracksToSingleTrackScores(scoreIn) {
    var src = scoreIn && typeof scoreIn === 'object' ? scoreIn : {};
    var tracks = Array.isArray(src.tracks) ? src.tracks : [];
    var tempo =
      typeof src.tempo_bpm === 'number' && isFinite(src.tempo_bpm)
        ? src.tempo_bpm
        : typeof src.bpm === 'number' && isFinite(src.bpm)
          ? src.bpm
          : 120;
    var ts = typeof src.time_signature === 'string' ? src.time_signature : '4/4';
    var ver = typeof src.version === 'number' ? src.version : 1;
    var out = [];
    for (var i = 0; i < tracks.length; i++) {
      var tr = tracks[i];
      var notes = tr && Array.isArray(tr.notes) ? tr.notes : [];
      if (notes.length === 0) continue;
      var singleNotes = [];
      for (var j = 0; j < notes.length; j++) {
        singleNotes.push(_cloneNote(notes[j]));
      }
      _sortNotes(singleNotes);
      var trName = tr && typeof tr.name === 'string' ? tr.name : String(tr.name || '');
      var trId = tr && tr.id != null ? String(tr.id) : 'trk_' + i;
      var score = {
        version: ver,
        tempo_bpm: tempo,
        time_signature: ts,
        tracks: [{ id: trId, name: trName, notes: singleNotes }],
      };
      if (typeof src.bpm === 'number' && isFinite(src.bpm)) score.bpm = src.bpm;
      out.push({ score: score, splitIndex: i, trackName: trName });
    }
    return out;
  }

  /**
   * Trim a seconds-based ScoreDoc to the union of all note extents and rebase starts so the earliest note begins at 0.
   * Does not mutate scoreIn. Deterministic.
   *
   * @param {object} scoreIn - ScoreDoc-like: { version?, tempo_bpm?, bpm?, time_signature?, tracks?: [{ id?, name?, notes? }] }
   * @returns {{ score: object, tMin: number, tMax: number }}
   *   tMin / tMax are in the original timebase (seconds): min start and max (start+duration) across all notes.
   *   If there are no notes, tMin and tMax are both 0 and score preserves top-level metadata with empty note lists.
   */
  function trimScoreDocToNoteExtent(scoreIn) {
    var src = scoreIn && typeof scoreIn === 'object' ? scoreIn : {};
    var tracksIn = Array.isArray(src.tracks) ? src.tracks : [];
    var tMin = Infinity;
    var tMax = -Infinity;
    var ti;
    var ni;
    for (ti = 0; ti < tracksIn.length; ti++) {
      var tr0 = tracksIn[ti];
      var notes0 = tr0 && Array.isArray(tr0.notes) ? tr0.notes : [];
      for (ni = 0; ni < notes0.length; ni++) {
        var n0 = notes0[ni];
        if (!n0 || typeof n0 !== 'object') continue;
        var s0 = _num(n0.start);
        var d0 = Math.max(1e-6, _num(n0.duration));
        tMin = Math.min(tMin, s0);
        tMax = Math.max(tMax, s0 + d0);
      }
    }
    if (!isFinite(tMin) || !isFinite(tMax)) {
      return _trimEmptyScoreShell(src);
    }
    var tempo =
      typeof src.tempo_bpm === 'number' && isFinite(src.tempo_bpm)
        ? src.tempo_bpm
        : typeof src.bpm === 'number' && isFinite(src.bpm)
          ? src.bpm
          : 120;
    var ts =
      typeof src.time_signature === 'string' ? src.time_signature : '4/4';
    var ver = typeof src.version === 'number' ? src.version : 1;
    var outTracks = [];
    for (ti = 0; ti < tracksIn.length; ti++) {
      var tr = tracksIn[ti];
      var notesIn = tr && Array.isArray(tr.notes) ? tr.notes : [];
      var outNotes = [];
      for (ni = 0; ni < notesIn.length; ni++) {
        var n = notesIn[ni];
        if (!n || typeof n !== 'object') continue;
        var c = _cloneNote(n);
        c.start = _num(n.start) - tMin;
        outNotes.push(c);
      }
      _sortNotes(outNotes);
      var trId = tr && tr.id != null ? String(tr.id) : 'trk_' + ti;
      var trName = tr && typeof tr.name === 'string' ? tr.name : String(tr.name || '');
      outTracks.push({ id: trId, name: trName, notes: outNotes });
    }
    var outScore = {
      version: ver,
      tempo_bpm: tempo,
      time_signature: ts,
      tracks: outTracks,
    };
    if (typeof src.bpm === 'number' && isFinite(src.bpm)) outScore.bpm = src.bpm;
    return { score: outScore, tMin: tMin, tMax: tMax };
  }

  /** No notes: deterministic shell with tMin/tMax 0. */
  function _trimEmptyScoreShell(src) {
    var tracksIn = Array.isArray(src.tracks) ? src.tracks : [];
    var outTracks = [];
    for (var ti = 0; ti < tracksIn.length; ti++) {
      var tr = tracksIn[ti];
      var trId = tr && tr.id != null ? String(tr.id) : 'trk_' + ti;
      var trName = tr && typeof tr.name === 'string' ? tr.name : String(tr.name || '');
      outTracks.push({ id: trId, name: trName, notes: [] });
    }
    var tempo =
      typeof src.tempo_bpm === 'number' && isFinite(src.tempo_bpm)
        ? src.tempo_bpm
        : typeof src.bpm === 'number' && isFinite(src.bpm)
          ? src.bpm
          : 120;
    var ts =
      typeof src.time_signature === 'string' ? src.time_signature : '4/4';
    var ver = typeof src.version === 'number' ? src.version : 1;
    var outScore = {
      version: ver,
      tempo_bpm: tempo,
      time_signature: ts,
      tracks: outTracks,
    };
    if (typeof src.bpm === 'number' && isFinite(src.bpm)) outScore.bpm = src.bpm;
    return { score: outScore, tMin: 0, tMax: 0 };
  }

  /**
   * Integration helper: when enabled is false, returns input unchanged (applied: false).
   * When true, runs splitScoreDocByPitchBuckets. Safe for wiring from app (caller passes flag from localStorage).
   */
  function applyTranscriptionPitchSplitIfEnabled(scoreIn, enabled) {
    if (!enabled) return { score: scoreIn, applied: false };
    try {
      return { score: splitScoreDocByPitchBuckets(scoreIn), applied: true };
    } catch (e) {
      return { score: scoreIn, applied: false };
    }
  }

  var API = {
    splitScoreDocByPitchBuckets: splitScoreDocByPitchBuckets,
    explodeNonEmptyTracksToSingleTrackScores: explodeNonEmptyTracksToSingleTrackScores,
    trimScoreDocToNoteExtent: trimScoreDocToNoteExtent,
    applyTranscriptionPitchSplitIfEnabled: applyTranscriptionPitchSplitIfEnabled,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.H2SScoreHeuristicSplit = API;
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : this
);
