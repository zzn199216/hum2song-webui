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

  function _avgPitch(notes) {
    if (!Array.isArray(notes) || notes.length === 0) return 60;
    var sum = 0;
    var i;
    for (i = 0; i < notes.length; i++) {
      sum += Math.round(_num(notes[i] && notes[i].pitch));
    }
    return sum / notes.length;
  }

  function _mergeWeakExplodeTracks(parts, opts) {
    opts = opts || {};
    var weakMaxNotes =
      opts.weakFragmentMaxNotes != null ? Math.max(1, Math.floor(_num(opts.weakFragmentMaxNotes))) : 1;
    var weakRatio =
      opts.weakFragmentMaxRatio != null ? Math.max(0, _num(opts.weakFragmentMaxRatio)) : 0.34;
    var weakMaxNotesWhenPrimaryLarge =
      opts.weakFragmentMaxNotesWhenPrimaryLarge != null
        ? Math.max(1, Math.floor(_num(opts.weakFragmentMaxNotesWhenPrimaryLarge)))
        : 2;
    var primaryLargeMinNotes =
      opts.primaryLargeMinNotes != null ? Math.max(1, Math.floor(_num(opts.primaryLargeMinNotes))) : 4;

    if (!Array.isArray(parts) || parts.length <= 1) return parts;

    var i;
    var primaryIdx = 0;
    var primaryCount = -1;
    for (i = 0; i < parts.length; i++) {
      var c = parts[i].score.tracks[0].notes.length;
      if (c > primaryCount) {
        primaryCount = c;
        primaryIdx = i;
      }
    }
    if (primaryCount <= 0) return parts;

    var survivors = [];
    var weak = [];
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      var notes = p.score.tracks[0].notes;
      var nCount = notes.length;
      var isPrimary = i === primaryIdx;
      var weakBySingleton = !isPrimary && nCount <= weakMaxNotes;
      var weakByTinyRatio =
        !isPrimary &&
        nCount <= weakMaxNotesWhenPrimaryLarge &&
        primaryCount >= primaryLargeMinNotes &&
        nCount / Math.max(1, primaryCount) <= weakRatio;
      if (weakBySingleton || weakByTinyRatio) {
        weak.push(p);
      } else {
        survivors.push(p);
      }
    }

    if (weak.length === 0) return parts;
    if (survivors.length === 0) {
      survivors.push(parts[primaryIdx]);
      weak = parts.filter(function (_p, idx) {
        return idx !== primaryIdx;
      });
    }

    for (i = 0; i < weak.length; i++) {
      var w = weak[i];
      var wNotes = w.score.tracks[0].notes;
      if (!wNotes.length) continue;
      var wAvg = _avgPitch(wNotes);
      var bestIdx = 0;
      var bestDist = Infinity;
      var si;
      for (si = 0; si < survivors.length; si++) {
        var sNotes = survivors[si].score.tracks[0].notes;
        if (!sNotes.length) continue;
        var sAvg = _avgPitch(sNotes);
        var d = Math.abs(sAvg - wAvg);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = si;
        }
      }
      var target = survivors[bestIdx];
      var targetNotes = target.score.tracks[0].notes;
      var ni;
      for (ni = 0; ni < wNotes.length; ni++) {
        targetNotes.push(_cloneNote(wNotes[ni]));
      }
      _sortNotes(targetNotes);
    }

    return survivors;
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
  function explodeNonEmptyTracksToSingleTrackScores(scoreIn, opts) {
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
    opts = opts || {};
    if (opts.suppressWeakFragments) {
      return _mergeWeakExplodeTracks(out, opts);
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

  /**
   * Collect all notes from a seconds-based ScoreDoc into a flat list with source track index.
   * Sort key matches _sortNotes (start, pitch, id).
   */
  function _collectSortedNoteItems(scoreIn) {
    var src = scoreIn && typeof scoreIn === 'object' ? scoreIn : {};
    var tracksIn = Array.isArray(src.tracks) ? src.tracks : [];
    var items = [];
    var ti;
    var ni;
    for (ti = 0; ti < tracksIn.length; ti++) {
      var tr = tracksIn[ti];
      var notesIn = tr && Array.isArray(tr.notes) ? tr.notes : [];
      for (ni = 0; ni < notesIn.length; ni++) {
        var n = notesIn[ni];
        if (!n || typeof n !== 'object') continue;
        items.push({ ti: ti, n: _cloneNote(n) });
      }
    }
    items.sort(function (a, b) {
      var sa = _num(a.n.start);
      var sb = _num(b.n.start);
      if (sa !== sb) return sa - sb;
      var pa = Math.round(_num(a.n.pitch));
      var pb = Math.round(_num(b.n.pitch));
      if (pa !== pb) return pa - pb;
      var ia = a.n.id != null ? String(a.n.id) : '';
      var ib = b.n.id != null ? String(b.n.id) : '';
      if (ia !== ib) return ia < ib ? -1 : ia > ib ? 1 : 0;
      return 0;
    });
    return items;
  }

  function _maxNoteEndInRange(items, segStart, iInclusive) {
    var m = -Infinity;
    var k;
    for (k = segStart; k <= iInclusive; k++) {
      var n = items[k].n;
      m = Math.max(m, _num(n.start) + Math.max(1e-6, _num(n.duration)));
    }
    return m;
  }

  /**
   * Build one ScoreDoc segment from grouped items; notes rebased so segment tMin maps to 0.
   */
  function _buildSegmentScoreDoc(src, segmentItems, tMin, tMax) {
    var tracksIn = Array.isArray(src.tracks) ? src.tracks : [];
    var byTi = {};
    var ii;
    for (ii = 0; ii < segmentItems.length; ii++) {
      var it = segmentItems[ii];
      var c = _cloneNote(it.n);
      c.start = _num(it.n.start) - tMin;
      if (!byTi[it.ti]) byTi[it.ti] = [];
      byTi[it.ti].push(c);
    }
    var outTracks = [];
    var ti;
    for (ti = 0; ti < tracksIn.length; ti++) {
      var tr = tracksIn[ti];
      var trId = tr && tr.id != null ? String(tr.id) : 'trk_' + ti;
      var trName = tr && typeof tr.name === 'string' ? tr.name : String(tr.name || '');
      var arr = byTi[ti] ? _sortNotes(byTi[ti]) : [];
      outTracks.push({ id: trId, name: trName, notes: arr });
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
    return { score: outScore, tMin: tMin, tMax: tMax };
  }

  /**
   * Segment a seconds-based ScoreDoc into shorter clips using note-aware boundaries.
   *
   * Rules (conservative, deterministic):
   * - Never cuts through a note: each note stays in exactly one segment.
   * - Split before note i (i > 0) when either:
   *   (a) Gap split: (items[i].start - items[i-1].end) >= minGapSec (items are globally sorted by time).
   *   (b) Max span: including items[i] in the current segment would make
   *       (maxEnd in [segStart..i] - segmentStart) > maxDurationSec.
   * - If a single note is longer than maxDurationSec, it occupies one segment alone (segment may exceed the cap).
   * - Overlapping notes: gap may be negative; gap split does not fire; max-span still applies.
   *
   * Each output segment has clip-local times rebased so the earliest note in that segment starts at 0.
   * tMin / tMax are in the original score timebase (seconds): min start and max end of notes in the segment.
   * Absolute playback: instanceStartSec + tMin + rebasedNoteStart === instanceStartSec + originalNoteStart.
   *
   * @param {object} scoreIn - ScoreDoc-like (does not mutate)
   * @param {object} opts - { minGapSec: number, maxDurationSec: number } (use Infinity for maxDurationSec to only gap-split)
   * @returns {Array<{ score: object, tMin: number, tMax: number }>}
   */
  function segmentScoreDocByGapAndMaxDuration(scoreIn, opts) {
    opts = opts || {};
    var minGapSec = opts.minGapSec != null ? _num(opts.minGapSec) : 1;
    if (!isFinite(minGapSec) || minGapSec < 0) minGapSec = 0;
    var maxDurationSec =
      opts.maxDurationSec != null && isFinite(opts.maxDurationSec)
        ? _num(opts.maxDurationSec)
        : Number.POSITIVE_INFINITY;
    if (maxDurationSec <= 0) maxDurationSec = Number.POSITIVE_INFINITY;

    var src = scoreIn && typeof scoreIn === 'object' ? scoreIn : {};
    var items = _collectSortedNoteItems(src);
    if (items.length === 0) {
      var empty = _trimEmptyScoreShell(src);
      return [{ score: empty.score, tMin: 0, tMax: 0 }];
    }

    var segments = [];
    var segStart = 0;
    var i;
    for (i = 1; i < items.length; i++) {
      var prev = items[i - 1].n;
      var cur = items[i].n;
      var prevEnd = _num(prev.start) + Math.max(1e-6, _num(prev.duration));
      var gap = _num(cur.start) - prevEnd;
      var splitGap = gap >= minGapSec;
      var segT0 = _num(items[segStart].n.start);
      var maxEndThroughI = _maxNoteEndInRange(items, segStart, i);
      var spanIfIncludeCur = maxEndThroughI - segT0;
      var splitMax = spanIfIncludeCur > maxDurationSec;
      if (splitGap || splitMax) {
        segments.push(items.slice(segStart, i));
        segStart = i;
      }
    }
    segments.push(items.slice(segStart));

    var out = [];
    for (i = 0; i < segments.length; i++) {
      var segItems = segments[i];
      var tMin = Infinity;
      var tMax = -Infinity;
      var j;
      for (j = 0; j < segItems.length; j++) {
        var nn = segItems[j].n;
        var s0 = _num(nn.start);
        var e0 = s0 + Math.max(1e-6, _num(nn.duration));
        tMin = Math.min(tMin, s0);
        tMax = Math.max(tMax, e0);
      }
      if (!isFinite(tMin) || !isFinite(tMax)) {
        tMin = 0;
        tMax = 0;
      }
      out.push(_buildSegmentScoreDoc(src, segItems, tMin, tMax));
    }
    return out;
  }

  /** BPM for bar math: clamp to [30, 260]; fallback 120. */
  function _resolveBpmForBarSegmentation(src) {
    var t =
      typeof src.tempo_bpm === 'number' && isFinite(src.tempo_bpm)
        ? src.tempo_bpm
        : typeof src.bpm === 'number' && isFinite(src.bpm)
          ? src.bpm
          : 120;
    if (!isFinite(t) || t <= 0) t = 120;
    if (t < 30) t = 30;
    if (t > 260) t = 260;
    return t;
  }

  /**
   * Parse "N/M" time signature; numerator = beats per bar (quarter-note beats, matches project TIMEBASE).
   * Invalid / missing → 4/4.
   */
  function _parseBeatsPerBar(timeSignature) {
    if (typeof timeSignature !== 'string') return 4;
    var m = timeSignature.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) return 4;
    var num = parseInt(m[1], 10);
    var den = parseInt(m[2], 10);
    if (!isFinite(num) || num <= 0 || num > 64) return 4;
    if (!isFinite(den) || den <= 0) return 4;
    return num;
  }

  function _noteEnd(n) {
    return _num(n.start) + Math.max(1e-6, _num(n.duration));
  }

  /** True iff no note has start < T < end (strict interior). */
  function _isNoteSafeCut(T, items) {
    var i;
    for (i = 0; i < items.length; i++) {
      var n = items[i].n;
      var s = _num(n.start);
      var e = _noteEnd(n);
      if (s < T && T < e) return false;
    }
    return true;
  }

  /** Smallest k * secPerBar >= t (bar grid anchored at 0). */
  function _ceilBarBoundary(t, secPerBar) {
    if (!isFinite(secPerBar) || secPerBar <= 0) return t;
    var tt = _num(t);
    var k = Math.ceil(tt / secPerBar - 1e-12);
    return k * secPerBar;
  }

  /**
   * Gap score at boundary c: min distance to nearest note start/end (higher = more rest-like).
   * Deterministic tie-breaking uses smallest c elsewhere.
   */
  function _boundaryGapScore(c, items) {
    var best = Infinity;
    var i;
    for (i = 0; i < items.length; i++) {
      var n = items[i].n;
      var s = _num(n.start);
      var e = _noteEnd(n);
      var d = Math.min(Math.abs(c - s), Math.abs(c - e));
      if (d < best) best = d;
    }
    return isFinite(best) ? best : 0;
  }

  /** Count notes whose time interval intersects [c - halfW, c + halfW] (phrase "busyness" near c). */
  function _boundaryBandActivityCount(c, halfW, items) {
    var lo = c - halfW;
    var hi = c + halfW;
    var cnt = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      var n = items[i].n;
      var s = _num(n.start);
      var e = _noteEnd(n);
      if (e < lo - 1e-12 || s > hi + 1e-12) continue;
      cnt++;
    }
    return cnt;
  }

  /**
   * Higher = more phrase-like (deterministic). Note-safe boundaries only; sustained-note cuts excluded before call.
   * Combines large local gap with low note activity near the bar line.
   */
  function _boundaryPhraseScore(c, secPerBar, items) {
    var halfW = Math.min(secPerBar * 0.5, 0.35);
    var gap = _boundaryGapScore(c, items);
    var act = _boundaryBandActivityCount(c, halfW, items);
    return gap * 1000 - act * 40;
  }

  /**
   * Split any note crossing B into two notes (same pitch/vel); replaces one item with two in-place.
   * Returns true if list mutated.
   */
  function _splitItemsAtBoundary(items, B) {
    var changed = false;
    var out = [];
    var ii;
    for (ii = 0; ii < items.length; ii++) {
      var it = items[ii];
      var n = it.n;
      var s = _num(n.start);
      var e = _noteEnd(n);
      if (s < B && B < e) {
        changed = true;
        var left = _cloneNote(n);
        left.duration = Math.max(1e-6, B - s);
        var right = _cloneNote(n);
        right.start = B;
        right.duration = Math.max(1e-6, e - B);
        if (n.id != null) {
          left.id = String(n.id) + ':L';
          right.id = String(n.id) + ':R';
        }
        out.push({ ti: it.ti, n: left });
        out.push({ ti: it.ti, n: right });
      } else {
        out.push(it);
      }
    }
    if (!changed) return false;
    out.sort(function (a, b) {
      var sa = _num(a.n.start);
      var sb = _num(b.n.start);
      if (sa !== sb) return sa - sb;
      var pa = Math.round(_num(a.n.pitch));
      var pb = Math.round(_num(b.n.pitch));
      if (pa !== pb) return pa - pb;
      var ia = a.n.id != null ? String(a.n.id) : '';
      var ib = b.n.id != null ? String(b.n.id) : '';
      if (ia !== ib) return ia < ib ? -1 : ia > ib ? 1 : 0;
      return 0;
    });
    items.length = 0;
    for (ii = 0; ii < out.length; ii++) items.push(out[ii]);
    return true;
  }

  /**
   * Segment a full multi-track seconds-based ScoreDoc on shared bar boundaries (constant BPM).
   *
   * Rules (v1, conservative):
   * - Bar grid anchored at t=0: boundaries at k * secPerBar for k = 1,2,...
   * - secPerBar = (beatsPerBar * 60) / bpm; beatsPerBar from "N/M" (numerator only); invalid TS → 4/4.
   * - BPM from tempo_bpm or bpm; invalid/missing → 120; clamped to [30,260].
   * - If total span (max note end − min note start) ≤ maxBars * secPerBar, returns exactly one segment (no optional splits).
   * - Otherwise greedily cuts from left to right: each internal cut is on a bar boundary that is note-safe
   *   (no sustained note has start < T < end), except when max-bars cap forces a cut: then the cut is the
   *   smallest bar boundary ≥ (segmentStart + maxBars*secPerBar), and notes crossing that boundary are split
   *   into two notes (deterministic ids :L / :R when an id existed).
   * - Last segment ends at global max note end (not necessarily a bar line).
   * - Among multiple valid bar cuts in the allowed window (pos, min(pos+maxBars*secPerBar, globalTMax)],
   *   choose the best phrase-like boundary: higher _boundaryPhraseScore (larger gap, lower local band activity).
   *   Boundaries that would cut through a sustained note are excluded here; those use the forced cut path.
   *   Tie-break: higher score, then smaller cut time.
   *
   * Does not mutate scoreIn. Output segments preserve tempo_bpm / time_signature on each score slice.
   *
   * @param {object} scoreIn - ScoreDoc-like
   * @param {object} [opts]
   * @param {number} [opts.maxBars=32]  max segment length in bars before a cut is required
   * @returns {Array<{ score: object, tMin: number, tMax: number }>}
   */
  function segmentScoreDocByBarBoundaries(scoreIn, opts) {
    opts = opts || {};
    var maxBars =
      opts.maxBars != null && isFinite(opts.maxBars) ? _num(opts.maxBars) : 32;
    if (!isFinite(maxBars) || maxBars <= 0) maxBars = 32;

    var src = scoreIn && typeof scoreIn === 'object' ? scoreIn : {};
    var bpm = _resolveBpmForBarSegmentation(src);
    var beatsPerBar = _parseBeatsPerBar(
      typeof src.time_signature === 'string' ? src.time_signature : ''
    );
    var secPerBar = (beatsPerBar * 60) / bpm;

    var items = _collectSortedNoteItems(src);
    if (items.length === 0) {
      var empty = _trimEmptyScoreShell(src);
      return [{ score: empty.score, tMin: 0, tMax: 0 }];
    }

    function globalExtent() {
      var tMin = Infinity;
      var tMax = -Infinity;
      var i;
      for (i = 0; i < items.length; i++) {
        var n = items[i].n;
        var s = _num(n.start);
        var e = _noteEnd(n);
        tMin = Math.min(tMin, s);
        tMax = Math.max(tMax, e);
      }
      return { tMin: tMin, tMax: tMax };
    }

    var ext = globalExtent();
    var globalTMin = ext.tMin;
    var globalTMax = ext.tMax;
    if (!isFinite(globalTMin) || !isFinite(globalTMax)) {
      var empty2 = _trimEmptyScoreShell(src);
      return [{ score: empty2.score, tMin: 0, tMax: 0 }];
    }

    var maxSpanSec = maxBars * secPerBar;
    if (globalTMax - globalTMin <= maxSpanSec) {
      return [_buildSegmentScoreDoc(src, items, globalTMin, globalTMax)];
    }

    var cuts = [];
    var pos = globalTMin;
    cuts.push(pos);

    var guard = 0;
    while (pos < globalTMax - 1e-15) {
      guard++;
      if (guard > 100000) break;
      var maxEnd = pos + maxSpanSec;
      if (maxEnd > globalTMax) maxEnd = globalTMax;

      var candidates = [];
      var c = Math.ceil((pos + 1e-12) / secPerBar) * secPerBar;
      if (c <= pos + 1e-12) c += secPerBar;
      while (c <= maxEnd + 1e-12 && c <= globalTMax + 1e-12) {
        if (c > pos + 1e-12 && _isNoteSafeCut(c, items)) candidates.push(c);
        c += secPerBar;
      }

      var next;
      if (candidates.length > 0) {
        var bestScore = -Infinity;
        var bestC = null;
        var ci;
        for (ci = 0; ci < candidates.length; ci++) {
          var cand = candidates[ci];
          var ps = _boundaryPhraseScore(cand, secPerBar, items);
          if (ps > bestScore + 1e-9 || (Math.abs(ps - bestScore) <= 1e-9 && (bestC == null || cand < bestC))) {
            bestScore = ps;
            bestC = cand;
          }
        }
        next = bestC;
      } else if (maxEnd >= globalTMax - 1e-15) {
        next = globalTMax;
      } else {
        var forced = _ceilBarBoundary(maxEnd, secPerBar);
        if (forced <= pos + 1e-12) forced += secPerBar;
        if (forced > globalTMax) forced = globalTMax;
        if (!_isNoteSafeCut(forced, items)) {
          _splitItemsAtBoundary(items, forced);
        }
        next = forced;
      }

      if (next == null || next <= pos + 1e-15) {
        next = globalTMax;
      }

      cuts.push(next);
      pos = next;
    }

    var out = [];
    var ci2;
    for (ci2 = 0; ci2 < cuts.length - 1; ci2++) {
      var a = cuts[ci2];
      var b = cuts[ci2 + 1];
      var segItems = [];
      var j;
      for (j = 0; j < items.length; j++) {
        var it = items[j];
        var n = it.n;
        var s = _num(n.start);
        var e = _noteEnd(n);
        if (s + 1e-12 >= a && e <= b + 1e-12) segItems.push(it);
      }
      if (segItems.length === 0) continue;
      var tMinS = Infinity;
      var tMaxS = -Infinity;
      for (j = 0; j < segItems.length; j++) {
        var nn = segItems[j].n;
        tMinS = Math.min(tMinS, _num(nn.start));
        tMaxS = Math.max(tMaxS, _noteEnd(nn));
      }
      out.push(_buildSegmentScoreDoc(src, segItems, tMinS, tMaxS));
    }

    if (out.length === 0) {
      return [_buildSegmentScoreDoc(src, items, globalTMin, globalTMax)];
    }
    return out;
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
    segmentScoreDocByGapAndMaxDuration: segmentScoreDocByGapAndMaxDuration,
    segmentScoreDocByBarBoundaries: segmentScoreDocByBarBoundaries,
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
