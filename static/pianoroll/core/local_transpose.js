/* Hum2Song Studio — deterministic local_transpose (Phase-1 slice)
   Exposes root.H2SLocalTranspose. Beats-only; pitch-only setNote ops.

   capability_id: local_transpose
*/
(function(root){
  'use strict';

  const CAPABILITY_ID = 'local_transpose';
  const MAX_ABS_DELTA = 12;

  const WORD_TO_N = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
    'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
    'a': 1, 'an': 1,
  };

  function parseCountToken(tok){
    if (tok == null) return NaN;
    const t = String(tok).toLowerCase().trim();
    if (WORD_TO_N[t] != null) return WORD_TO_N[t];
    const n = parseInt(t, 10);
    return isFinite(n) ? n : NaN;
  }

  function clampDelta(d){
    const n = Math.round(Number(d));
    if (!isFinite(n)) return 0;
    if (n > MAX_ABS_DELTA) return MAX_ABS_DELTA;
    if (n < -MAX_ABS_DELTA) return -MAX_ABS_DELTA;
    return n;
  }

  /**
   * @returns {{ capability_id: string, semitone_delta: number } | null}
   */
  function narrowLocalTransposeIntentFromText(text){
    if (!text || typeof text !== 'string') return null;
    const raw = String(text).toLowerCase().trim();
    if (!raw) return null;

    if (/\bmake\s+(this|it)\s+higher\b/.test(raw)) return { capability_id: CAPABILITY_ID, semitone_delta: 1 };
    if (/\bmake\s+(this|it)\s+lower\b/.test(raw)) return { capability_id: CAPABILITY_ID, semitone_delta: -1 };

    let m;

    m = raw.match(/\bmove\s+(this|it)\s+up\s+a\s+half\s+step\b/);
    if (m) return { capability_id: CAPABILITY_ID, semitone_delta: 1 };
    m = raw.match(/\bmove\s+(this|it)\s+down\s+a\s+half\s+step\b/);
    if (m) return { capability_id: CAPABILITY_ID, semitone_delta: -1 };
    m = raw.match(/\bmove\s+(this|it)\s+up\s+a\s+whole\s+step\b/);
    if (m) return { capability_id: CAPABILITY_ID, semitone_delta: 2 };
    m = raw.match(/\bmove\s+(this|it)\s+down\s+a\s+whole\s+step\b/);
    if (m) return { capability_id: CAPABILITY_ID, semitone_delta: -2 };

    m = raw.match(/\btranspose\s+up\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+semitones?\b/);
    if (m){
      const n = parseCountToken(m[1]);
      if (isFinite(n) && n > 0) return { capability_id: CAPABILITY_ID, semitone_delta: clampDelta(n) };
    }
    m = raw.match(/\btranspose\s+down\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+semitones?\b/);
    if (m){
      const n = parseCountToken(m[1]);
      if (isFinite(n) && n > 0) return { capability_id: CAPABILITY_ID, semitone_delta: -clampDelta(n) };
    }

    m = raw.match(/\btranspose\s+up\s+(a|an|one)\s+semitone\b/);
    if (m) return { capability_id: CAPABILITY_ID, semitone_delta: 1 };
    m = raw.match(/\btranspose\s+down\s+(a|an|one)\s+semitone\b/);
    if (m) return { capability_id: CAPABILITY_ID, semitone_delta: -1 };

    m = raw.match(/\braise\s+(this|it)\s+by\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+semitones?\b/);
    if (m){
      const n = parseCountToken(m[2]);
      if (isFinite(n) && n > 0) return { capability_id: CAPABILITY_ID, semitone_delta: clampDelta(n) };
    }
    m = raw.match(/\blower\s+(this|it)\s+by\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+semitones?\b/);
    if (m){
      const n = parseCountToken(m[2]);
      if (isFinite(n) && n > 0) return { capability_id: CAPABILITY_ID, semitone_delta: -clampDelta(n) };
    }

    return null;
  }

  /**
   * @param {object} clip
   * @param {{ semitone_delta: number }} intent
   * @param {string[]|null} noteIdsFilter
   */
  function buildLocalTransposePatch(clip, intent, noteIdsFilter){
    const delta = clampDelta(intent && intent.semitone_delta != null ? intent.semitone_delta : 0);
    const resolvedIntent = { capability_id: CAPABILITY_ID, semitone_delta: delta };

    const filterSet = (noteIdsFilter && Array.isArray(noteIdsFilter) && noteIdsFilter.length > 0)
      ? new Set(noteIdsFilter.map(function(id){ return String(id); }))
      : null;

    const ops = [];
    const examples = [];
    const score = clip && clip.score;
    if (!score || !Array.isArray(score.tracks)){
      return { patch: { version: 1, clipId: clip && clip.id, ops: [] }, examples: [], resolvedIntent, targetNoteCount: 0, effectiveNoteCount: 0 };
    }

    const candidates = [];
    for (const tr of score.tracks){
      const notes = Array.isArray(tr.notes) ? tr.notes : [];
      for (const n of notes){
        if (!n || !n.id) continue;
        const nid = String(n.id);
        if (filterSet && !filterSet.has(nid)) continue;
        const pitch = Number(n.pitch);
        const startBeat = Number(n.startBeat);
        const durationBeat = Number(n.durationBeat);
        if (!isFinite(pitch) || !isFinite(startBeat) || !isFinite(durationBeat)) continue;
        if (pitch < 0 || pitch > 127 || startBeat < 0 || durationBeat <= 0) continue;
        candidates.push({ noteId: nid, oldPitch: Math.round(pitch) });
      }
    }

    const targetNoteCount = candidates.length;
    if (targetNoteCount === 0 || delta === 0){
      return { patch: { version: 1, clipId: clip && clip.id, ops: [] }, examples: [], resolvedIntent, targetNoteCount, effectiveNoteCount: 0 };
    }

    for (const c of candidates){
      const newPitch = Math.max(0, Math.min(127, c.oldPitch + delta));
      if (newPitch === c.oldPitch) continue;
      ops.push({ op: 'setNote', noteId: c.noteId, pitch: newPitch });
      examples.push({ noteId: c.noteId, oldPitch: c.oldPitch, newPitch });
    }

    return {
      patch: { version: 1, clipId: clip && clip.id, ops },
      examples,
      resolvedIntent,
      targetNoteCount,
      effectiveNoteCount: ops.length,
    };
  }

  const API = {
    narrowLocalTransposeIntentFromText,
    buildLocalTransposePatch,
    clampDelta,
    CAPABILITY_ID,
  };

  root.H2SLocalTranspose = API;
  if (typeof module !== 'undefined' && module.exports){
    module.exports = API;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
