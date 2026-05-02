(function(root, factory){
  if (typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    root.H2SArrangementPatchV0 = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  function isFiniteNumber(x){
    return typeof x === 'number' && isFinite(x);
  }

  function deepClone(obj){
    if (!obj) return obj;
    try { return JSON.parse(JSON.stringify(obj)); } catch(e){ return obj; }
  }

  function clamp(v, a, b){
    return Math.max(a, Math.min(b, v));
  }

  function getProjectApi(opts){
    if (opts && opts.H2SProject && typeof opts.H2SProject === 'object') return opts.H2SProject;
    if (typeof window !== 'undefined' && window.H2SProject) return window.H2SProject;
    if (typeof globalThis !== 'undefined' && globalThis.H2SProject) return globalThis.H2SProject;
    return null;
  }

  function getAllowedOpTypes(){
    return new Set(['createTrack', 'createClip', 'addInstance', 'setTrackInstrument']);
  }

  // Detect accidental seconds fields anywhere in the patch payload.
  function collectSecondsFieldKeys(x){
    const out = [];
    const seen = new Set();
    function walk(v){
      if (!v || typeof v !== 'object') return;
      if (seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)){
        for (const it of v) walk(it);
        return;
      }
      for (const k of Object.keys(v)){
        if (typeof k === 'string'){
          // Conservative: keys ending with "Sec" are seconds-based fields in this codebase.
          if (/Sec$/i.test(k)) out.push(k);
          // Also catch explicit camelCase "sec" suffixes.
          if (/sec$/i.test(k)) out.push(k);
        }
        walk(v[k]);
      }
    }
    walk(x);
    return out;
  }

  function isNonEmptyString(x){
    return typeof x === 'string' && x.trim().length > 0;
  }

  function normalizeTranspose(projectApi, transpose){
    if (!projectApi || typeof projectApi.coerceTranspose !== 'function') {
      const n = Number(transpose);
      if (!isFiniteNumber(n)) return 0;
      return clamp(Math.round(n), -48, 48);
    }
    return projectApi.coerceTranspose(transpose);
  }

  function resolveExistingTrackIds(project){
    const ids = new Set();
    if (!project || !Array.isArray(project.tracks)) return ids;
    for (const t of project.tracks){
      if (!t) continue;
      if (isNonEmptyString(t.id)) ids.add(String(t.id));
      if (isNonEmptyString(t.trackId)) ids.add(String(t.trackId));
    }
    return ids;
  }

  function resolveExistingClipIds(project){
    const ids = new Set();
    if (!project || !project.clips || typeof project.clips !== 'object' || Array.isArray(project.clips)) return ids;
    for (const cid of Object.keys(project.clips)){
      ids.add(String(cid));
      const c = project.clips[cid];
      if (c && isNonEmptyString(c.id)) ids.add(String(c.id));
    }
    return ids;
  }

  function resolveExistingInstanceIds(project){
    const ids = new Set();
    if (!project || !Array.isArray(project.instances)) return ids;
    for (const inst of project.instances){
      if (inst && isNonEmptyString(inst.id)) ids.add(String(inst.id));
    }
    return ids;
  }

  function findTrackById(project, trackId){
    if (!project || !Array.isArray(project.tracks)) return null;
    const tid = String(trackId);
    return project.tracks.find(t => t && ((isNonEmptyString(t.id) && String(t.id) === tid) || (isNonEmptyString(t.trackId) && String(t.trackId) === tid))) || null;
  }

  function validateScoreBeatV2(scoreBeat, opts){
    const projectApi = opts && opts.H2SProject ? opts.H2SProject : null;
    const errors = [];

    if (!scoreBeat || typeof scoreBeat !== 'object') errors.push('scoreBeat_not_object');
    const sb = scoreBeat || {};
    if (sb.version !== undefined && sb.version !== 2) errors.push('scoreBeat.version_must_be_2_or_omitted');

    if (!Array.isArray(sb.tracks) || sb.tracks.length < 1) errors.push('scoreBeat.tracks_not_array_or_empty');

    const maxNotesPerClip = (opts && isFiniteNumber(opts.maxNotesPerClip)) ? opts.maxNotesPerClip : 2000;
    const noteIds = new Set();
    let noteCount = 0;

    for (let ti = 0; ti < (sb.tracks || []).length; ti++){
      const tr = sb.tracks[ti];
      if (!tr || typeof tr !== 'object') { errors.push('track_not_object:' + ti); continue; }
      if (!isNonEmptyString(tr.id)) errors.push('track.id_required:' + ti);

      if (tr.notes !== undefined && !Array.isArray(tr.notes)) errors.push('track.notes_not_array:' + ti);
      const notes = Array.isArray(tr.notes) ? tr.notes : [];

      for (let ni = 0; ni < notes.length; ni++){
        const n = notes[ni];
        if (!n || typeof n !== 'object') { errors.push('note_not_object:' + ti + ':' + ni); continue; }

        // Beats-only storage: reject legacy v1 keys and seconds-based keys.
        if ('start' in n || 'duration' in n) errors.push('note_legacy_start_duration_forbidden:' + ti + ':' + ni);
        if ('startSec' in n || 'durationSec' in n || 'spanSec' in n) errors.push('note_seconds_fields_forbidden:' + ti + ':' + ni);

        if (!isNonEmptyString(n.id)) errors.push('note.id_required:' + ti + ':' + ni);
        const noteId = String(n.id || '');
        if (noteIds.has(noteId)) errors.push('note.id_duplicate:' + noteId);
        noteIds.add(noteId);

        const pitch = Number(n.pitch);
        const velocity = Number(n.velocity);
        const startBeat = Number(n.startBeat);
        const durationBeat = Number(n.durationBeat);

        if (!isFiniteNumber(pitch) || pitch < 0 || pitch > 127) errors.push('note.pitch_invalid:' + noteId);
        if (!isFiniteNumber(velocity) || velocity < 1 || velocity > 127) errors.push('note.velocity_invalid:' + noteId);
        if (!isFiniteNumber(startBeat) || startBeat < 0) errors.push('note.startBeat_invalid:' + noteId);
        if (!isFiniteNumber(durationBeat) || !(durationBeat > 0)) errors.push('note.durationBeat_invalid:' + noteId);

        noteCount++;
        if (noteCount > maxNotesPerClip) errors.push('scoreBeat_too_many_notes');
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings: [],
      noteCount
    };
  }

  function validateArrangementPatchV0(projectV2, patch, opts){
    const projectApi = getProjectApi(opts);
    const errors = [];
    const warnings = [];

    const MAX_OPS = (opts && isFiniteNumber(opts.maxOps)) ? opts.maxOps : 200;
    const MAX_TOTAL_NOTES = (opts && isFiniteNumber(opts.maxTotalNotes)) ? opts.maxTotalNotes : 5000;

    if (!projectApi) errors.push('H2SProject_missing');
    if (!patch || typeof patch !== 'object') errors.push('patch_not_object');
    if (patch && patch.version !== 1) errors.push('patch.version_must_be_1');

    // Seconds fields forbidden in any shape (reject early).
    const secondsKeys = collectSecondsFieldKeys(patch);
    if (secondsKeys.length) errors.push('seconds_fields_forbidden:' + secondsKeys.slice(0, 5).join(','));

    const ops = (patch && Array.isArray(patch.ops)) ? patch.ops : null;
    if (!ops) errors.push('patch.ops_not_array');
    if (ops && ops.length > MAX_OPS) errors.push('patch_too_many_ops:' + ops.length);

    const allowedOps = getAllowedOpTypes();

    const createdTrackIds = new Set();
    const createdClipIds = new Set();
    const createdInstanceIds = new Set();

    const existingTrackIds = resolveExistingTrackIds(projectV2);
    const existingClipIds = resolveExistingClipIds(projectV2);
    const existingInstanceIds = resolveExistingInstanceIds(projectV2);

    const createTrackOps = [];
    const createClipOps = [];
    const addInstanceOps = [];
    const setTrackInstrumentOps = [];

    let totalNotes = 0;

    for (let i = 0; i < (ops || []).length; i++){
      const op = ops[i];
      if (!op || typeof op !== 'object') { errors.push('op[' + i + ']_not_object'); continue; }
      const kind = String(op.op || '');
      if (!kind) { errors.push('op[' + i + ']_missing_op'); continue; }
      if (!allowedOps.has(kind)) { errors.push('op[' + i + ']_unsupported_op:' + kind); continue; }

      if (kind === 'createTrack'){
        if (!isNonEmptyString(op.trackId)) errors.push('createTrack.trackId_required:' + i);
        if (!isNonEmptyString(op.name)) errors.push('createTrack.name_required:' + i);
        if (!isNonEmptyString(op.instrument)) errors.push('createTrack.instrument_required:' + i);
        if (Object.prototype.hasOwnProperty.call(op, 'gainDb')){
          const g = op.gainDb;
          if (typeof g !== 'number' || !isFiniteNumber(g)){
            errors.push('createTrack.gainDb_invalid:' + i);
          } else if (g < -30 || g > 6){
            errors.push('createTrack.gainDb_out_of_range:' + i);
          }
        }
        const tid = String(op.trackId || '');
        if (createdTrackIds.has(tid)) errors.push('createTrack.duplicate_trackId:' + tid);
        if (existingTrackIds.has(tid)) errors.push('createTrack.trackId_exists:' + tid);
        createdTrackIds.add(tid);
        createTrackOps.push(op);
      } else if (kind === 'createClip'){
        if (!isNonEmptyString(op.clipId)) errors.push('createClip.clipId_required:' + i);
        if (!isNonEmptyString(op.name)) errors.push('createClip.name_required:' + i);
        if (!op.scoreBeat || typeof op.scoreBeat !== 'object') errors.push('createClip.scoreBeat_required:' + i);

        const cid = String(op.clipId || '');
        if (createdClipIds.has(cid)) errors.push('createClip.duplicate_clipId:' + cid);
        if (existingClipIds.has(cid)) errors.push('createClip.clipId_exists:' + cid);
        createdClipIds.add(cid);

        const vScore = validateScoreBeatV2(op.scoreBeat, { H2SProject: projectApi, maxNotesPerClip: 2000 });
        if (!vScore.ok){
          errors.push.apply(errors, vScore.errors);
        }
        totalNotes += vScore.noteCount || 0;
        createClipOps.push(op);
      } else if (kind === 'addInstance'){
        if (!isNonEmptyString(op.instanceId)) errors.push('addInstance.instanceId_required:' + i);
        if (!isNonEmptyString(op.clipId)) errors.push('addInstance.clipId_required:' + i);
        if (!isNonEmptyString(op.trackId)) errors.push('addInstance.trackId_required:' + i);
        if (!isFiniteNumber(Number(op.startBeat)) || !(Number(op.startBeat) >= 0)) errors.push('addInstance.startBeat_invalid:' + i);

        const instId = String(op.instanceId || '');
        if (createdInstanceIds.has(instId)) errors.push('addInstance.duplicate_instanceId:' + instId);
        if (existingInstanceIds.has(instId)) errors.push('addInstance.instanceId_exists:' + instId);
        createdInstanceIds.add(instId);

        addInstanceOps.push(op);
      } else if (kind === 'setTrackInstrument'){
        if (!isNonEmptyString(op.trackId)) errors.push('setTrackInstrument.trackId_required:' + i);
        if (!isNonEmptyString(op.instrument)) errors.push('setTrackInstrument.instrument_required:' + i);
        setTrackInstrumentOps.push(op);
      }
    }

    // Dependency validation for dangling refs (enforce generated-clip-only default).
    for (const op of addInstanceOps){
      const cid = String(op.clipId || '');
      if (!createdClipIds.has(cid)) errors.push('addInstance.clipId_dangling:' + cid);

      const tid = String(op.trackId || '');
      if (!createdTrackIds.has(tid) && !existingTrackIds.has(tid)) errors.push('addInstance.trackId_dangling:' + tid);
    }

    // setTrackInstrument must not reference unknown tracks.
    for (const op of setTrackInstrumentOps){
      const tid = String(op.trackId || '');
      if (!createdTrackIds.has(tid) && !existingTrackIds.has(tid)) errors.push('setTrackInstrument.trackId_dangling:' + tid);
    }

    if (totalNotes > MAX_TOTAL_NOTES) errors.push('patch_too_many_notes:' + totalNotes);

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      summary: {
        createdTrackCount: createTrackOps.length,
        createdClipCount: createClipOps.length,
        createdInstanceCount: addInstanceOps.length,
        totalNotes
      },
      _internal: {
        createTrackOps,
        createClipOps,
        addInstanceOps,
        setTrackInstrumentOps,
        createdTrackIds,
        createdClipIds,
        createdInstanceIds
      }
    };
  }

  function applyArrangementPatchV0ToProject(projectV2, patch, opts){
    const projectApi = getProjectApi(opts);
    if (!projectApi) return { ok:false, errors:['H2SProject_missing'], warnings:[], summary:{}, project:null };
    if (typeof projectApi.createClipFromScoreBeat !== 'function') return { ok:false, errors:['H2SProject_missing_createClipFromScoreBeat'], warnings:[], summary:{}, project:null };
    if (typeof projectApi.createInstanceV2 !== 'function') return { ok:false, errors:['H2SProject_missing_createInstanceV2'], warnings:[], summary:{}, project:null };

    const v = validateArrangementPatchV0(projectV2, patch, Object.assign({ H2SProject: projectApi }, opts || {}));
    if (!v.ok){
      return { ok:false, errors:v.errors, warnings:v.warnings, summary:v.summary || {}, project:null };
    }

    const clone = (typeof projectApi.deepClone === 'function') ? projectApi.deepClone(projectV2) : deepClone(projectV2);

    if (!Array.isArray(clone.tracks)) clone.tracks = [];
    if (!clone.clips || typeof clone.clips !== 'object' || Array.isArray(clone.clips)) clone.clips = {};
    if (!Array.isArray(clone.clipOrder)) clone.clipOrder = [];
    if (!Array.isArray(clone.instances)) clone.instances = [];

    const applySummary = {
      createdTrackIds: [],
      createdClipIds: [],
      createdInstanceIds: [],
      totalNotes: v.summary.totalNotes
    };

    // 1) createTrack
    for (const op of v._internal.createTrackOps){
      const trackId = String(op.trackId);
      let gainDb = 0;
      if (Object.prototype.hasOwnProperty.call(op, 'gainDb') && typeof op.gainDb === 'number' && isFiniteNumber(op.gainDb)){
        gainDb = op.gainDb;
      }
      clone.tracks.push({
        id: trackId,
        trackId: trackId,
        name: String(op.name),
        instrument: String(op.instrument),
        gainDb: gainDb,
        muted: false,
      });
      applySummary.createdTrackIds.push(trackId);
    }

    // 2) createClip
    for (const op of v._internal.createClipOps){
      const clipId = String(op.clipId);
      const clip = projectApi.createClipFromScoreBeat(op.scoreBeat, {
        id: clipId,
        name: String(op.name),
        sourceTaskId: isNonEmptyString(op.sourceTaskId) ? String(op.sourceTaskId) : 'arrange:llm_v0',
      });
      clone.clips[clipId] = clip;
      clone.clipOrder.push(clipId);
      applySummary.createdClipIds.push(clipId);
    }

    // 3) setTrackInstrument (optional)
    for (const op of v._internal.setTrackInstrumentOps){
      const trackId = String(op.trackId);
      const t = findTrackById(clone, trackId);
      if (t) t.instrument = String(op.instrument);
    }

    // 4) addInstance
    for (const op of v._internal.addInstanceOps){
      const instanceId = String(op.instanceId);
      const clipId = String(op.clipId);
      const trackId = String(op.trackId);
      const startBeat = Math.max(0, Number(op.startBeat));
      const transpose = (op.transpose !== undefined && op.transpose !== null) ? normalizeTranspose(projectApi, op.transpose) : 0;

      const inst = projectApi.createInstanceV2(clipId, startBeat, trackId);
      inst.id = instanceId; // override generated id with patch reference id
      inst.transpose = transpose;
      clone.instances.push(inst);
      applySummary.createdInstanceIds.push(instanceId);
    }

    // Normalize + invariants
    if (typeof projectApi.normalizeProjectV2 === 'function') projectApi.normalizeProjectV2(clone);
    if (typeof projectApi.checkProjectV2Invariants === 'function'){
      const inv = projectApi.checkProjectV2Invariants(clone);
      if (!inv || !inv.ok){
        return { ok:false, errors:(inv && inv.errors) ? inv.errors : ['project_invariants_failed'], warnings:[], summary:applySummary, project:null };
      }
    }

    // Final: verify created clip revision chain for each created clip.
    const revErrors = [];
    for (const cid of applySummary.createdClipIds){
      const c = clone.clips && clone.clips[cid] ? clone.clips[cid] : null;
      if (!c || !c.revisionId || !c.revisions || !c.revisions[c.revisionId]) revErrors.push('created_clip_revision_chain_invalid:' + cid);
    }
    if (revErrors.length){
      return { ok:false, errors:revErrors, warnings:[], summary:applySummary, project:clone };
    }

    return { ok:true, project:clone, summary:applySummary };
  }

  return {
    validateArrangementPatchV0,
    applyArrangementPatchV0ToProject,
  };
});

