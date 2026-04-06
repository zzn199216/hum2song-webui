/* Hum2Song Studio — deterministic rhythm_tighten_loosen (Phase-1 slice)
   Conservative timing-only edits: setNote startBeat/durationBeat only (beats domain).

   capability_id: rhythm_tighten_loosen
*/
(function(root){
  'use strict';

  const CAPABILITY_ID = 'rhythm_tighten_loosen';
  /** Quarter-beat grid (1/16 note in beat space). */
  const GRID_BEAT = 0.25;
  const EPS_DUR = 1e-6;

  function nb(x){
    const n = Number(x);
    if (!isFinite(n)) return 0;
    return Math.round(n * 1e6) / 1e6;
  }

  function clampStart(sb){
    return Math.max(0, nb(sb));
  }

  function clampDur(db){
    let d = nb(db);
    if (!(d > 0)) d = EPS_DUR;
    return d;
  }

  function parseStrengthFromText(t){
    const s = String(t || '').toLowerCase();
    if (/\b(slight|slightly|a little|a bit|subtle)\b/.test(s)) return 'slight';
    if (/\b(strong|strongly|much|heavily)\b/.test(s)) return 'strong';
    return 'medium';
  }

  function alphaFromStrength(strength){
    if (strength === 'slight') return 0.12;
    if (strength === 'strong') return 0.42;
    return 0.25;
  }

  /**
   * @returns {{ capability_id: string, mode: string, strength: string } | null}
   */
  function narrowRhythmIntentFromText(text){
    if (!text || typeof text !== 'string') return null;
    const raw = String(text).toLowerCase().trim();
    if (!raw) return null;
    const strength = parseStrengthFromText(raw);

    if (/\b(make\s+this\s+more\s+even\s+rhythm(ically)?|even\s+rhythm(ically)?)\b/.test(raw)){
      return { capability_id: CAPABILITY_ID, mode: 'even', strength };
    }
    if (/\b(loosen\s+(the\s+)?rhythm|make\s+this\s+looser|looser\s+rhythm)\b/.test(raw) || /^\s*looser\s*$/.test(raw)){
      return { capability_id: CAPABILITY_ID, mode: 'loosen', strength };
    }
    if (/\b(tighten\s+(the\s+)?rhythm|make\s+this\s+tighter|tighter\s+rhythm)\b/.test(raw) || /^\s*tighter\s*$/.test(raw)){
      return { capability_id: CAPABILITY_ID, mode: 'tighten', strength };
    }
    if (/\bquantize\s+this\b/.test(raw)){
      return { capability_id: CAPABILITY_ID, mode: 'tighten', strength };
    }
    return null;
  }

  function snapGrid(x){
    return Math.round(x / GRID_BEAT) * GRID_BEAT;
  }

  function applyTighten(sb, db, a){
    const snapS = snapGrid(sb);
    const snapD = snapGrid(db);
    const newSb = sb + (snapS - sb) * a;
    const newDb = db + (snapD - db) * Math.min(1, a * 1.05);
    return { startBeat: newSb, durationBeat: newDb };
  }

  function applyLoosen(sb, db, a, idx){
    const snapS = snapGrid(sb);
    const snapD = snapGrid(db);
    const offS = sb - snapS;
    const offD = db - snapD;
    let newSb = sb;
    let newDb = db;
    if (Math.abs(offS) < 1e-5){
      newSb = sb + GRID_BEAT * a * 0.35 * ((idx % 2) === 0 ? 1 : -1);
    } else {
      newSb = sb + Math.sign(offS) * Math.min(Math.abs(offS), GRID_BEAT * a * 0.3);
    }
    if (Math.abs(offD) < 1e-5){
      newDb = db + GRID_BEAT * a * 0.25 * ((idx % 2) === 0 ? -1 : 1);
    } else {
      newDb = db + Math.sign(offD) * Math.min(Math.abs(offD), GRID_BEAT * a * 0.28);
    }
    return { startBeat: newSb, durationBeat: newDb };
  }

  function applyEven(sb, db, a, meanDur){
    const snapS = snapGrid(sb);
    const newSb = sb + (snapS - sb) * (a * 0.45);
    const newDb = db + (meanDur - db) * a;
    return { startBeat: newSb, durationBeat: newDb };
  }

  /**
   * @param {object} clip
   * @param {{ mode: string, strength?: string }} intent
   * @param {string[]|null} noteIdsFilter
   */
  function buildRhythmPatch(clip, intent, noteIdsFilter){
    const mode = intent && intent.mode ? String(intent.mode) : 'tighten';
    const strength = intent && intent.strength ? String(intent.strength) : 'medium';
    const a = alphaFromStrength(strength);
    const resolvedIntent = { capability_id: CAPABILITY_ID, mode, strength };

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
    let idx = 0;
    for (const tr of score.tracks){
      const notes = Array.isArray(tr.notes) ? tr.notes : [];
      for (const n of notes){
        if (!n || !n.id) continue;
        const nid = String(n.id);
        if (filterSet && !filterSet.has(nid)) continue;
        const pitch = Number(n.pitch);
        const sb = Number(n.startBeat);
        const db = Number(n.durationBeat);
        if (!isFinite(pitch) || !isFinite(sb) || !isFinite(db)) continue;
        if (pitch < 0 || pitch > 127 || sb < 0 || db <= 0) continue;
        candidates.push({ noteId: nid, startBeat: sb, durationBeat: db, idx: idx++ });
      }
    }

    const targetNoteCount = candidates.length;
    if (targetNoteCount === 0){
      return { patch: { version: 1, clipId: clip && clip.id, ops: [] }, examples: [], resolvedIntent, targetNoteCount: 0, effectiveNoteCount: 0 };
    }

    let meanDur = 0;
    for (const c of candidates){
      meanDur += c.durationBeat;
    }
    meanDur /= candidates.length;

    for (const c of candidates){
      const sb0 = c.startBeat;
      const db0 = c.durationBeat;
      let next;
      if (mode === 'loosen'){
        next = applyLoosen(sb0, db0, a, c.idx);
      } else if (mode === 'even'){
        next = applyEven(sb0, db0, a, meanDur);
      } else {
        next = applyTighten(sb0, db0, a);
      }
      const nsb = clampStart(next.startBeat);
      const ndb = clampDur(next.durationBeat);
      if (nb(nsb) === nb(sb0) && nb(ndb) === nb(db0)) continue;
      ops.push({
        op: 'setNote',
        noteId: c.noteId,
        startBeat: nsb,
        durationBeat: ndb,
      });
      examples.push({ noteId: c.noteId, oldStartBeat: sb0, newStartBeat: nsb, oldDurationBeat: db0, newDurationBeat: ndb });
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
    narrowRhythmIntentFromText,
    buildRhythmPatch,
    CAPABILITY_ID,
    GRID_BEAT,
  };

  root.H2SRhythmTightenLoosen = API;
  if (typeof module !== 'undefined' && module.exports){
    module.exports = API;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
