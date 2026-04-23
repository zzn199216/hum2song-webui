/* Hum2Song Studio — deterministic velocity_shape (Phase-1 slice)
   Plain script. Exposes root.H2SVelocityShape for browser; Node tests use module.exports.

   capability_id: velocity_shape
   - narrowVelocityShapeIntentFromText(text)
   - buildVelocityShapePatch(clip, intent, noteIdsFilter)
*/
(function(root){
  'use strict';

  const CAPABILITY_ID = 'velocity_shape';

  function clampInt(v, lo, hi){
    const n = Math.round(Number(v));
    if (!isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  /** @returns {'slight'|'medium'|'strong'} */
  function parseStrengthFromText(t){
    const s = String(t || '').toLowerCase();
    if (/\b(slight|slightly|gentle|subtle|a little|a bit|little)\b/.test(s)) return 'slight';
    if (/\b(strong|strongly|heavy|much|a lot|lot)\b/.test(s)) return 'strong';
    return 'medium';
  }

  function strengthStep(strength){
    if (strength === 'slight') return 5;
    if (strength === 'strong') return 18;
    return 10;
  }

  function blendFactor(strength){
    if (strength === 'slight') return 0.35;
    if (strength === 'strong') return 0.65;
    return 0.5;
  }

  function smoothBlendFactor(strength){
    if (strength === 'slight') return 0.55;
    if (strength === 'strong') return 0.88;
    return 0.75;
  }

  function dynamicScale(strength){
    if (strength === 'slight') return 1.25;
    if (strength === 'strong') return 1.75;
    return 1.5;
  }

  function medianSorted(arr){
    if (!arr.length) return 0;
    const a = arr.slice().sort((x,y)=>x-y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }

  /**
   * Map free text to structured intent. Returns null if no velocity-shape phrase matched.
   * @returns {{ capability_id: string, mode: string, strength: string } | null}
   */
  function narrowVelocityShapeIntentFromText(text){
    if (!text || typeof text !== 'string') return null;
    const raw = String(text).toLowerCase().trim();
    if (!raw) return null;
    const strength = parseStrengthFromText(raw);

    const rules = [
      { mode: 'louder', patterns: [/\b(make\s+(this|it)\s+louder|make\s+louder|louder|boost\s+volume|turn\s+up|increase\s+volume|raise\s+volume|音量\s*大|大声)\b/] },
      { mode: 'softer', patterns: [/\b(make\s+(this|it)\s+softer|make\s+softer|softer|quieter|reduce\s+volume|turn\s+down|lower\s+volume|轻|小声)\b/] },
      { mode: 'more_dynamic', patterns: [/\b(more\s+dynamic|more\s+dynamics|increase\s+dynamic|dynamic\s+range|对比|动态)\b/] },
      { mode: 'more_even', patterns: [/\b(more\s+even|even\s+out|even\s+volume|level\s+out|flatten\s+dynamics|uniform|均衡)\b/] },
      { mode: 'accent', patterns: [/\b(stronger\s+accents?|accent(s)?|emphasize|punch|突出)\b/] },
      { mode: 'smooth', patterns: [/\b(smooth\s+out(\s+the)?\s+dynamics?|smooth\s+dynamics|compress\s+dynamics|平滑)\b/] },
    ];

    for (const r of rules){
      for (const re of r.patterns){
        if (re.test(raw)){
          return { capability_id: CAPABILITY_ID, mode: r.mode, strength };
        }
      }
    }
    return null;
  }

  /**
   * @param {object} clip
   * @param {{ mode: string, strength?: string }} intent
   * @param {string[]|null} noteIdsFilter — null = all notes in clip; non-empty = restrict
   * @returns {{ patch: object, examples: array, resolvedIntent: object, targetNoteCount: number, effectiveNoteCount: number }}
   */
  function buildVelocityShapePatch(clip, intent, noteIdsFilter){
    const mode = intent && intent.mode ? String(intent.mode) : 'more_even';
    const strength = intent && intent.strength ? String(intent.strength) : 'medium';
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
        const oldVel = (typeof n.velocity === 'number' && isFinite(n.velocity)) ? Math.round(n.velocity) : 90;
        candidates.push({ noteId: nid, pitch, startBeat, durationBeat, oldVel });
      }
    }

    const targetNoteCount = candidates.length;
    if (targetNoteCount === 0){
      return { patch: { version: 1, clipId: clip && clip.id, ops: [] }, examples: [], resolvedIntent, targetNoteCount: 0, effectiveNoteCount: 0 };
    }

    const velocities = candidates.map(function(c){ return c.oldVel; });
    const mean = velocities.reduce(function(a,b){ return a + b; }, 0) / velocities.length;
    const med = medianSorted(velocities);
    const step = strengthStep(strength);
    const bf = blendFactor(strength);
    const sbf = smoothBlendFactor(strength);
    const dscale = dynamicScale(strength);

    function computeNewVel(oldVel){
      let nv = oldVel;
      if (mode === 'louder'){
        nv = oldVel + step;
      } else if (mode === 'softer'){
        nv = oldVel - step;
      } else if (mode === 'more_even'){
        nv = Math.round(oldVel + (mean - oldVel) * bf);
      } else if (mode === 'smooth'){
        nv = Math.round(oldVel + (mean - oldVel) * sbf);
      } else if (mode === 'more_dynamic'){
        nv = Math.round(mean + (oldVel - mean) * dscale);
      } else if (mode === 'accent'){
        if (oldVel >= med) nv = Math.min(127, oldVel + Math.max(4, Math.round(step * 0.55)));
        else nv = Math.max(1, oldVel - Math.max(2, Math.round(step * 0.35)));
      } else {
        nv = oldVel;
      }
      return clampInt(nv, 1, 127);
    }

    for (const c of candidates){
      const newVel = computeNewVel(c.oldVel);
      if (newVel === c.oldVel) continue;
      ops.push({
        op: 'setNote',
        noteId: c.noteId,
        velocity: newVel,
      });
      examples.push({ noteId: c.noteId, oldVel: c.oldVel, newVel });
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
    narrowVelocityShapeIntentFromText,
    buildVelocityShapePatch,
    CAPABILITY_ID,
  };

  root.H2SVelocityShape = API;
  if (typeof module !== 'undefined' && module.exports){
    module.exports = API;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
