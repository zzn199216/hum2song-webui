/* Hum2Song Studio MVP - core/agent_patch.js (v1)
   Plain script (no import/export). Exposes root.H2SAgentPatch.

   Purpose (T3-2):
   - Define an auditable, deterministic "AgentPatch" format over beats-domain ScoreBeat.
   - validatePatch(patch, clip) : structural + basic numeric legality checks
   - applyPatchToClip(clip, patch) : pure-ish (returns a NEW clip), enforces normalizeBeat+clamp
   - invertAppliedPatch(appliedPatch) : generates inverse patch from appliedPatch.ops[*].before/after

   Notes:
   - This is NOT "music optimization". It only applies edits safely.
   - No seconds fields are introduced.
*/
(function(){
  'use strict';

  const ROOT = (typeof window !== 'undefined') ? window :
               (typeof globalThis !== 'undefined') ? globalThis :
               (typeof global !== 'undefined') ? global : {};

  function has(obj, k){ return Object.prototype.hasOwnProperty.call(obj, k); }

  function deepClone(obj){
    try { return JSON.parse(JSON.stringify(obj)); } catch(e){ return obj; }
  }

  function isFiniteNumber(x){ return typeof x === 'number' && isFinite(x); }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function getProjectApi(){
    return ROOT.H2SProject || null;
  }

  function coercePitch(x){
    const n = Number(x);
    if (!isFinite(n)) return 60;
    return clamp(Math.round(n), 0, 127);
  }

  function coerceVelocity(x){
    const n = Number(x);
    if (!isFinite(n)) return 100;
    return clamp(Math.round(n), 1, 127);
  }

  function coerceBeat(x, api){
    const n = Number(x);
    if (!isFinite(n)) return 0;
    if (api && typeof api.normalizeBeat === 'function') return api.normalizeBeat(n);
    // fallback: round to 1e-6
    return Math.round(n * 1e6) / 1e6;
  }

  function coerceDurationBeat(x, api){
    let d = coerceBeat(x, api);
    if (!(d > 0)) d = (api && api.TIMEBASE && api.TIMEBASE.EPS_BEAT_TINY) ? api.TIMEBASE.EPS_BEAT_TINY : 1e-6;
    return d;
  }


  // -------------------- T3-3 Semantic Sanity Gate (front-end circuit breaker) --------------------

  const SEMANTIC_LIMITS = {
    // Hard safety caps (browser / project safety)
    MAX_OPS: 5000,
    MAX_TOTAL_NOTES: 5000,

    // If a patch deletes too much, it's probably hallucination.
    MAX_DELETE_RATIO: 0.90,

    // Density gate: prevent "one beat with 50+ notes".
    MAX_NOTES_PER_BEAT: 50,

    // Span growth guard. Allow some growth but reject "blow up".
    SPAN_GROWTH_MULT: 8.0,
    SPAN_GROWTH_ADD_BEAT: 16,
    SPAN_ABS_MAX: 4096,

    // Tiny duration explosion guard
    TINY_DUR_BEAT: 0.001,
    TINY_DUR_RATIO: 0.70,
    TINY_DUR_MIN_NOTES: 200,
  };

  function _semanticStatsFromScore(scoreBeat){
    const st = {
      noteCount: 0,
      spanBeat: 0,
      maxNotesPerBeat: 0,
      tinyDurCount: 0,
    };

    const buckets = Object.create(null);
    const tracks = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
    for (const t of tracks){
      const notes = (t && Array.isArray(t.notes)) ? t.notes : [];
      for (const n of notes){
        st.noteCount += 1;
        const sb = Number(n && (n.startBeat !== undefined ? n.startBeat : n.start)) || 0;
        const db = Number(n && (n.durationBeat !== undefined ? n.durationBeat : n.duration)) || 0;
        const end = sb + db;
        if (isFinite(end)) st.spanBeat = Math.max(st.spanBeat, end);

        const bin = Math.floor(sb);
        const k = String(isFinite(bin) ? bin : 0);
        buckets[k] = (buckets[k] || 0) + 1;
        st.maxNotesPerBeat = Math.max(st.maxNotesPerBeat, buckets[k]);

        if (isFinite(db) && db > 0 && db < SEMANTIC_LIMITS.TINY_DUR_BEAT) st.tinyDurCount += 1;
      }
    }

    // normalize numeric safety
    if (!isFinite(st.spanBeat)) st.spanBeat = 0;
    return st;
  }

  function semanticSanityGate(beforeClip, afterClip, patch){
    const errors = [];
    const warnings = [];

    const allowUnsafe = !!(patch && patch.meta && patch.meta.allowUnsafe === true);
    if (allowUnsafe){
      warnings.push('semantic_allowUnsafe_true');
      return { ok:true, errors, warnings };
    }

    const ops = (patch && Array.isArray(patch.ops)) ? patch.ops : [];
    if (ops.length > SEMANTIC_LIMITS.MAX_OPS){
      errors.push('semantic_ops_excess:' + ops.length);
    }

    const before = _semanticStatsFromScore(beforeClip && beforeClip.score);
    const after = _semanticStatsFromScore(afterClip && afterClip.score);

    if (after.noteCount > SEMANTIC_LIMITS.MAX_TOTAL_NOTES){
      errors.push('semantic_total_notes_excess:' + after.noteCount);
    }

    // delete ratio (gross)
    const deleteOps = ops.filter(op => op && op.op === 'deleteNote').length;
    if (before.noteCount > 0){
      const ratio = deleteOps / Math.max(1, before.noteCount);
      if (ratio >= SEMANTIC_LIMITS.MAX_DELETE_RATIO){
        errors.push('semantic_delete_ratio:' + ratio.toFixed(3));
      } else if (ratio >= 0.50){
        warnings.push('semantic_delete_ratio_warn:' + ratio.toFixed(3));
      }

      // net delete ratio (after apply)
      const netDel = (before.noteCount - after.noteCount) / Math.max(1, before.noteCount);
      if (netDel >= SEMANTIC_LIMITS.MAX_DELETE_RATIO){
        errors.push('semantic_net_delete_ratio:' + netDel.toFixed(3));
      } else if (netDel >= 0.50){
        warnings.push('semantic_net_delete_ratio_warn:' + netDel.toFixed(3));
      }
    }

    // density
    if (after.maxNotesPerBeat > SEMANTIC_LIMITS.MAX_NOTES_PER_BEAT){
      errors.push('semantic_notes_per_beat_excess:' + after.maxNotesPerBeat);
    }

    // span guard
    if (after.spanBeat > SEMANTIC_LIMITS.SPAN_ABS_MAX){
      errors.push('semantic_span_abs_excess:' + after.spanBeat);
    }
    if (before.spanBeat > 0){
      const allowed = (before.spanBeat * SEMANTIC_LIMITS.SPAN_GROWTH_MULT) + SEMANTIC_LIMITS.SPAN_GROWTH_ADD_BEAT;
      if (after.spanBeat > allowed){
        errors.push('semantic_span_growth_excess:' + after.spanBeat + '>' + allowed.toFixed(3));
      }
    }

    // tiny duration explosion
    if (after.noteCount >= SEMANTIC_LIMITS.TINY_DUR_MIN_NOTES){
      const r = after.tinyDurCount / Math.max(1, after.noteCount);
      if (r >= SEMANTIC_LIMITS.TINY_DUR_RATIO){
        errors.push('semantic_tiny_duration_excess:' + r.toFixed(3));
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  function snapNoteShape(n){
    return {
      id: String(n.id),
      pitch: coercePitch(n.pitch),
      velocity: coerceVelocity(n.velocity),
      startBeat: Number(n.startBeat),
      durationBeat: Number(n.durationBeat),
    };
  }

  function findNote(score, noteId){
    const nid = String(noteId);
    for (let ti=0; ti<(score.tracks||[]).length; ti++){
      const t = score.tracks[ti];
      const notes = Array.isArray(t.notes) ? t.notes : [];
      for (let ni=0; ni<notes.length; ni++){
        const n = notes[ni];
        if (String(n.id) === nid){
          return { track: t, trackIndex: ti, note: n, noteIndex: ni };
        }
      }
    }
    return null;
  }

  function ensureScoreBeat(score, api){
    if (api && typeof api.ensureScoreBeatIds === 'function') return api.ensureScoreBeatIds(score);
    // minimal fallback
    if (!score) score = { version: 2, tracks: [] };
    if (!Array.isArray(score.tracks)) score.tracks = [];
    for (const t of score.tracks){
      if (!Array.isArray(t.notes)) t.notes = [];
      for (const n of t.notes){
        n.id = String(n.id || 'n_' + Math.random().toString(16).slice(2,8));
        n.pitch = coercePitch(n.pitch);
        n.velocity = coerceVelocity(n.velocity);
        n.startBeat = Math.max(0, coerceBeat(n.startBeat || 0, api));
        n.durationBeat = coerceDurationBeat(n.durationBeat || 0.5, api);
        if (has(n,'start')) delete n.start;
        if (has(n,'duration')) delete n.duration;
      }
    }
    score.version = 2;
    return score;
  }

  function getDefaultTrackId(score){
    const t0 = (score.tracks && score.tracks[0]) ? score.tracks[0] : null;
    return t0 ? String(t0.id || 'trk_0') : 'trk_0';
  }

  function ensureTrack(score, trackId, api){
    const tid = String(trackId || getDefaultTrackId(score));
    for (const t of (score.tracks||[])){
      if (String(t.id) === tid) return t;
    }
    // create if missing (audit-friendly)
    const api2 = api;
    const uid = (api2 && typeof api2.uid === 'function') ? api2.uid : (p)=> (p||'id_') + Math.random().toString(16).slice(2,10);
    const t = { id: tid || uid('trk_'), name: 'Track', notes: [] };
    score.tracks = Array.isArray(score.tracks) ? score.tracks : [];
    score.tracks.push(t);
    return t;
  }

  function validatePatch(patch, clip){
    const errors = [];
    const warnings = [];

    if (!patch || typeof patch !== 'object'){
      return { ok:false, errors:['patch_not_object'], warnings:[] };
    }
    if (!Array.isArray(patch.ops)) errors.push('ops_not_array');

    const ops = Array.isArray(patch.ops) ? patch.ops : [];
    const score = clip && clip.score ? clip.score : null;

    // Basic per-op validation (semantic sanity is in T3-3).
    for (let i=0; i<ops.length; i++){
      const op = ops[i];
      if (!op || typeof op !== 'object'){ errors.push('op['+i+']_not_object'); continue; }
      const kind = String(op.op || '');
      if (!kind) { errors.push('op['+i+']_missing_op'); continue; }

      if (kind === 'addNote'){
        if (typeof op.trackId !== 'string' || !op.trackId) errors.push('op['+i+']_add_trackId_required');
        if (!op.note || typeof op.note !== 'object'){
          errors.push('op['+i+']_add_missing_note');
        } else {
          const n = op.note;
          const sb = Number(n.startBeat);
          const db = Number(n.durationBeat);
          const pit = Number(n.pitch);
          const vel = Number(n.velocity);
          if (!isFiniteNumber(sb)) errors.push('op['+i+']_add_startBeat_invalid');
          if (!isFiniteNumber(db) || !(db > 0)) errors.push('op['+i+']_add_durationBeat_invalid');
          if (!isFiniteNumber(pit) || pit < 0 || pit > 127) errors.push('op['+i+']_add_pitch_oob');
          if (!isFiniteNumber(vel) || vel < 1 || vel > 127) errors.push('op['+i+']_add_velocity_oob');
        }
      } else if (kind === 'deleteNote'){
        if (!op.noteId) errors.push('op['+i+']_delete_missing_noteId');
      } else if (kind === 'moveNote'){
        if (!op.noteId) errors.push('op['+i+']_move_missing_noteId');
        if (!isFiniteNumber(Number(op.deltaBeat))) errors.push('op['+i+']_move_missing_deltaBeat');
      } else if (kind === 'setNote'){
        if (!op.noteId) errors.push('op['+i+']_set_missing_noteId');
        if (!(has(op,'pitch') || has(op,'velocity') || has(op,'startBeat') || has(op,'durationBeat'))){
          warnings.push('op['+i+']_set_has_no_fields');
        }

        if (has(op,'pitch')){
          const pch = Number(op.pitch);
          if (!isFiniteNumber(pch)) errors.push('op['+i+']_set_pitch_nan');
          else if (pch < 0 || pch > 127) errors.push('op['+i+']_set_pitch_oob');
        }
        if (has(op,'velocity')){
          const vel = Number(op.velocity);
          if (!isFiniteNumber(vel)) errors.push('op['+i+']_set_velocity_nan');
          else if (vel < 1 || vel > 127) errors.push('op['+i+']_set_velocity_oob');
        }
        if (has(op,'startBeat')){
          const sb = Number(op.startBeat);
          if (!isFiniteNumber(sb) || sb < 0) errors.push('op['+i+']_set_startBeat_invalid');
        }
        if (has(op,'durationBeat')){
          const db = Number(op.durationBeat);
          if (!isFiniteNumber(db) || !(db > 0)) errors.push('op['+i+']_set_durationBeat_invalid');
        }
      } else {
        errors.push('op['+i+']_unknown_op:' + kind);
      }

      // If clip provided, ensure note exists for noteId ops.
      if (score && (kind === 'deleteNote' || kind === 'moveNote' || kind === 'setNote') && op.noteId){
        if (!findNote(score, op.noteId)){
          errors.push('op['+i+']_note_not_found:' + String(op.noteId));
        }
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  // NOTE (Node-safe overload):
  //   Browser usage: applyPatchToClip(clip, patch, opts)
  //   Node tests usage: applyPatchToClip(H2SProjectApi, clip, patch, opts)
  // We keep both to avoid brittle coupling between Node harness and browser globals.
  function applyPatchToClip(a, b, c, d){
    // detect whether caller passed H2SProject API explicitly
    const looksLikeApi = (x)=> !!(x && typeof x === 'object' &&
      typeof x.normalizeBeat === 'function' &&
      typeof x.ensureScoreBeatIds === 'function' &&
      typeof x.recomputeClipMetaFromScoreBeat === 'function');

    const api = looksLikeApi(a) ? a : getProjectApi();
    const clip = looksLikeApi(a) ? b : a;
    const patch = looksLikeApi(a) ? c : b;
    const opts = looksLikeApi(a) ? d : c;

    if (!api) return { ok:false, errors:['H2SProject_missing'], warnings:[] };

    const v = validatePatch(patch, clip);
    if (!v.ok) return { ok:false, errors:v.errors, warnings:v.warnings };

    const outClip = deepClone(clip || {});
    outClip.score = ensureScoreBeat(deepClone(outClip.score || { version:2, tracks:[] }), api);

    const appliedOps = [];
    const inverseOps = [];

    const ops = patch.ops || [];
    for (let i=0; i<ops.length; i++){
      const op = ops[i];
      const kind = String(op.op);

      if (kind === 'addNote'){
        const score = outClip.score;
        const trackId = op.trackId ? String(op.trackId) : getDefaultTrackId(score);
        const t = ensureTrack(score, trackId, api);
        const uid = (api && typeof api.uid === 'function') ? api.uid : (p)=> (p||'id_') + Math.random().toString(16).slice(2,10);
        const nIn = op.note || {};
        const noteId = String(nIn.id || uid('n_'));
        const newNote = {
          id: noteId,
          pitch: coercePitch(nIn.pitch),
          velocity: coerceVelocity(nIn.velocity),
          startBeat: Math.max(0, coerceBeat(nIn.startBeat || 0, api)),
          durationBeat: coerceDurationBeat(nIn.durationBeat || 0.5, api),
        };
        t.notes = Array.isArray(t.notes) ? t.notes : [];
        t.notes.push(newNote);

        appliedOps.push({ op:'addNote', trackId, noteId, before:null, after:snapNoteShape(newNote) });
        inverseOps.push({ op:'deleteNote', noteId });

      } else if (kind === 'deleteNote'){
        const hit = findNote(outClip.score, op.noteId);
        if (!hit) continue; // should not happen due to validate
        const before = snapNoteShape(hit.note);
        hit.track.notes.splice(hit.noteIndex, 1);

        appliedOps.push({ op:'deleteNote', trackId:String(hit.track.id||''), noteId:String(op.noteId), before, after:null });
        inverseOps.push({ op:'addNote', trackId:String(hit.track.id||''), note: before });

      } else if (kind === 'moveNote'){
        const hit = findNote(outClip.score, op.noteId);
        if (!hit) continue;
        const before = snapNoteShape(hit.note);
        const delta = Number(op.deltaBeat || 0);
        const nextStart = Math.max(0, coerceBeat(Number(hit.note.startBeat || 0) + delta, api));
        hit.note.startBeat = nextStart;
        // normalize duration also (no change, but keeps rounding consistent)
        hit.note.durationBeat = coerceDurationBeat(hit.note.durationBeat, api);
        const after = snapNoteShape(hit.note);

        appliedOps.push({ op:'moveNote', noteId:String(op.noteId), before, after, deltaBeat: coerceBeat(delta, api) });
        inverseOps.push({ op:'moveNote', noteId:String(op.noteId), deltaBeat: coerceBeat(-delta, api) });

      } else if (kind === 'setNote'){
        const hit = findNote(outClip.score, op.noteId);
        if (!hit) continue;
        const before = snapNoteShape(hit.note);

        if (has(op,'pitch')) hit.note.pitch = coercePitch(op.pitch);
        if (has(op,'velocity')) hit.note.velocity = coerceVelocity(op.velocity);
        if (has(op,'startBeat')) hit.note.startBeat = Math.max(0, coerceBeat(op.startBeat, api));
        if (has(op,'durationBeat')) hit.note.durationBeat = coerceDurationBeat(op.durationBeat, api);

        const after = snapNoteShape(hit.note);

        // Build inverse as set back to "before".
        inverseOps.push({
          op: 'setNote',
          noteId: String(op.noteId),
          pitch: before.pitch,
          velocity: before.velocity,
          startBeat: before.startBeat,
          durationBeat: before.durationBeat,
        });

        appliedOps.push({ op:'setNote', noteId:String(op.noteId), before, after });
      }
    }

    // Recompute meta strongly consistent with score.
    if (!outClip.meta) outClip.meta = {};
    const srcTempo = (outClip.meta && isFiniteNumber(outClip.meta.sourceTempoBpm)) ? Number(outClip.meta.sourceTempoBpm) : null;
    api.recomputeClipMetaFromScoreBeat(outClip);
    if (outClip.meta) outClip.meta.sourceTempoBpm = srcTempo;

    // Attach audit info (small).
    const appliedPatch = {
      version: 1,
      id: (patch && patch.id) ? String(patch.id) : null,
      createdAt: Date.now(),
      ops: appliedOps,
      meta: (patch && patch.meta && typeof patch.meta === 'object') ? deepClone(patch.meta) : {}
    };

    const inversePatch = { version: 1, ops: inverseOps };

    const sem = semanticSanityGate(clip, outClip, patch);
    if (!sem.ok){
      return {
        ok: false,
        errors: sem.errors || ['semantic_reject'],
        warnings: (v.warnings || []).concat(sem.warnings || [])
      };
    }

    const warnings = (v.warnings || []).concat(sem.warnings || []);

    return {
      ok: true,
      clip: outClip,
      appliedPatch,
      inversePatch,
      warnings
    };
  }

  function invertAppliedPatch(appliedPatch){
    // Invert from appliedPatch.ops where before/after are recorded.
    if (!appliedPatch || typeof appliedPatch !== 'object' || !Array.isArray(appliedPatch.ops)){
      return { ok:false, errors:['appliedPatch_invalid'] };
    }
    const inv = [];
    for (let i=appliedPatch.ops.length-1; i>=0; i--){
      const op = appliedPatch.ops[i];
      const kind = String(op.op || '');
      if (kind === 'addNote'){
        inv.push({ op:'deleteNote', noteId: String(op.noteId) });
      } else if (kind === 'deleteNote'){
        if (op.before){
          inv.push({ op:'addNote', trackId: String(op.trackId || ''), note: deepClone(op.before) });
        }
      } else if (kind === 'moveNote'){
        const db = Number(op.deltaBeat || 0);
        inv.push({ op:'moveNote', noteId: String(op.noteId), deltaBeat: -db });
      } else if (kind === 'setNote'){
        if (op.before){
          inv.push({ op:'setNote', noteId: String(op.noteId),
            pitch: op.before.pitch, velocity: op.before.velocity,
            startBeat: op.before.startBeat, durationBeat: op.before.durationBeat
          });
        }
      }
    }
    return { ok:true, patch:{ version:1, ops:inv } };
  }

  function summarizeAppliedPatch(x, opts){
    const maxExamples = (opts && isFiniteNumber(opts.maxExamples)) ? Number(opts.maxExamples) : 6;

    if (!x || typeof x !== 'object') return { ops: 0 };

    // Accept: applyPatchToClip result, appliedPatch object, or patch-like with ops.
    const ap = (x.appliedPatch && Array.isArray(x.appliedPatch.ops)) ? x.appliedPatch
      : (Array.isArray(x.ops) ? x
      : ((x.patch && Array.isArray(x.patch.ops)) ? x.patch : null));

    if (!ap) return { ops: 0 };

    const ops = Array.isArray(ap.ops) ? ap.ops : [];
    const byOp = {};
    const clamp = { pitch: 0, velocity: 0, startBeat: 0, durationBeat: 0 };
    const examples = [];

    const inPitchRange = (v)=> isFiniteNumber(v) && v >= 0 && v <= 127;
    const inVelRange = (v)=> isFiniteNumber(v) && v >= 0 && v <= 127;

    for (let i=0; i<ops.length; i++){
      const op = ops[i] || {};
      const kind = String(op.op || 'unknown');
      byOp[kind] = (byOp[kind] || 0) + 1;

      const before = op.before || null;
      const after = op.after || null;

      // Detect clamps/fixes.
      if (before && after){
        if (has(before,'pitch') && has(after,'pitch')){
          const b = Number(before.pitch), a = Number(after.pitch);
          if (b !== a && !inPitchRange(b) && inPitchRange(a)) clamp.pitch++;
        }
        if (has(before,'velocity') && has(after,'velocity')){
          const b = Number(before.velocity), a = Number(after.velocity);
          if (b !== a && !inVelRange(b) && inVelRange(a)) clamp.velocity++;
        }
        if (has(before,'startBeat') && has(after,'startBeat')){
          const b = Number(before.startBeat), a = Number(after.startBeat);
          if (b !== a && (!isFiniteNumber(b) || b < 0) && (isFiniteNumber(a) && a >= 0)) clamp.startBeat++;
        }
        if (has(before,'durationBeat') && has(after,'durationBeat')){
          const b = Number(before.durationBeat), a = Number(after.durationBeat);
          if (b !== a && (!isFiniteNumber(b) || b <= 0) && (isFiniteNumber(a) && a > 0)) clamp.durationBeat++;
        }
      }

      // Examples: keep small and readable.
      if (examples.length < maxExamples){
        if (before && after){
          const changes = {};
          const fields = ['pitch','velocity','startBeat','durationBeat'];
          for (let f=0; f<fields.length; f++){
            const k = fields[f];
            if (has(before,k) && has(after,k) && before[k] !== after[k]){
              changes[k] = [before[k], after[k]];
            }
          }
          if (Object.keys(changes).length){
            examples.push({ op: kind, noteId: op.noteId || null, changes });
          }
        } else if (kind === 'addNote' && after){
          examples.push({ op: kind, noteId: op.noteId || null, after });
        } else if (kind === 'deleteNote' && before){
          examples.push({ op: kind, noteId: op.noteId || null, before });
        } else if (kind === 'moveNote' && before && after){
          examples.push({ op: kind, noteId: op.noteId || null, deltaBeat: op.deltaBeat || op.delta || null });
        }
      }
    }

    return {
      ops: ops.length,
      byOp,
      clamp,
      examples
    };
  }



  const API = {
    validatePatch,
    applyPatchToClip,
    invertAppliedPatch,
    summarizeAppliedPatch,
  };

  ROOT.H2SAgentPatch = API;

  if (typeof module !== 'undefined' && module.exports){
    module.exports = API;
  }
})();
