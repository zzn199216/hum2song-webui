/* static/pianoroll/controllers/agent_controller.js
   Agent Runner v0 — pseudo agent priority + safe presets (PR-2A plumbing)
*/
(function(ROOT){
  'use strict';

  const H2SAgentPatch = ROOT.H2SAgentPatch;
  const H2SProject = ROOT.H2SProject;

  function _assert(cond, msg){ if(!cond) throw new Error(msg || 'assert'); }
  function _now(){ return Date.now(); }
  function _clone(x){ return JSON.parse(JSON.stringify(x)); }

  const DEFAULT_OPT_SOURCE = 'safe_stub_v0';
  const SAFE_STUB_PRESET = 'alt_110_80';

  /** Safe preset IDs (PR-2A). Only velocity and optional durationBeat allowed. */
  const PRESET_IDS = {
    DYNAMICS_ACCENT: 'dynamics_accent',
    DYNAMICS_LEVEL: 'dynamics_level',
    DURATION_GENTLE: 'duration_gentle',
    /** PR-5b: deterministic no-op for tests; returns empty patch. */
    NOOP: 'noop',
  };
  /** Allowlist: only these preset IDs may run; unknown → fallback to safe_stub_v0. */
  const SAFE_PRESET_ALLOWLIST = {
    [PRESET_IDS.DYNAMICS_ACCENT]: true,
    [PRESET_IDS.DYNAMICS_LEVEL]: true,
    [PRESET_IDS.DURATION_GENTLE]: true,
    [PRESET_IDS.NOOP]: true,
  };

  function _opsByOp(ops){
    const out = {};
    const arr = Array.isArray(ops) ? ops : [];
    for (const op of arr){
      const k = op && op.op ? String(op.op) : 'unknown';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  function buildPseudoAgentPatch(clip){
    const ops = [];
    const score = clip && clip.score;
    if (!score || !Array.isArray(score.tracks)) return { version:1, clipId: clip && clip.id, ops };

    for (const tr of score.tracks){
      const notes = tr.notes || [];
      for (const n of notes){
        const before = _clone(n);
        const after = _clone(n);

        if (typeof after.pitch !== 'number') after.pitch = Number(after.pitch);
        if (!Number.isFinite(after.pitch)) after.pitch = before.pitch;
        after.pitch = Math.max(0, Math.min(127, Math.round(after.pitch)));

        if (typeof after.velocity !== 'number') after.velocity = Number(after.velocity);
        if (!Number.isFinite(after.velocity)) after.velocity = before.velocity;
        after.velocity = Math.max(1, Math.min(127, Math.round(after.velocity)));

        if (typeof after.startBeat !== 'number') after.startBeat = Number(after.startBeat);
        if (!Number.isFinite(after.startBeat)) after.startBeat = before.startBeat;
        after.startBeat = Math.max(0, after.startBeat);

        if (typeof after.durationBeat !== 'number') after.durationBeat = Number(after.durationBeat);
        if (!Number.isFinite(after.durationBeat)) after.durationBeat = before.durationBeat;

        const changed =
          after.pitch !== before.pitch ||
          after.velocity !== before.velocity ||
          after.startBeat !== before.startBeat ||
          after.durationBeat !== before.durationBeat;

        if (changed){
          ops.push({ op:'setNote', noteId:n.id, before, after });
          return { version:1, clipId: clip && clip.id, ops };
        }
      }
    }
    return { version:1, clipId: clip && clip.id, ops };
  }

  function _buildSafeStubPatch(clip){
    const ops = [];
    const examples = [];
    const score = clip && clip.score;
    if (!score || !Array.isArray(score.tracks)) {
      return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
    }

    for (const tr of score.tracks){
      const notes = Array.isArray(tr.notes) ? tr.notes : [];
      for (const n of notes){
        const noteId = n && n.id;
        if (!noteId) continue;

        const pitch = Number(n.pitch);
        const startBeat = Number(n.startBeat);
        const durationBeat = Number(n.durationBeat);
        if (!isFinite(pitch) || !isFinite(startBeat) || !isFinite(durationBeat)) continue;
        if (pitch < 0 || pitch > 127 || startBeat < 0 || durationBeat <= 0) continue;

        const oldVel = (typeof n.velocity === 'number' && isFinite(n.velocity)) ? n.velocity : null;
        const newVel = (oldVel === 110) ? 80 : 110;

        ops.push({
          op:'setNote',
          noteId:String(noteId),
          pitch,startBeat,durationBeat,
          velocity:newVel
        });
        examples.push({ noteId:String(noteId), oldVel, newVel });
        return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
      }
    }
    return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
  }

  /** dynamics_accent: velocity 80–110, no pitch/startBeat (PR-2A safe preset). */
  function _buildPresetDynamicsAccent(clip){
    const ops = [];
    const examples = [];
    const score = clip && clip.score;
    if (!score || !Array.isArray(score.tracks)) return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
    for (const tr of score.tracks){
      const notes = Array.isArray(tr.notes) ? tr.notes : [];
      for (const n of notes){
        const noteId = n && n.id;
        if (!noteId) continue;
        const pitch = Number(n.pitch);
        const startBeat = Number(n.startBeat);
        const durationBeat = Number(n.durationBeat);
        if (!isFinite(pitch) || !isFinite(startBeat) || !isFinite(durationBeat)) continue;
        if (pitch < 0 || pitch > 127 || startBeat < 0 || durationBeat <= 0) continue;
        const oldVel = (typeof n.velocity === 'number' && isFinite(n.velocity)) ? n.velocity : 90;
        const newVel = (oldVel >= 100) ? 80 : Math.min(110, Math.max(80, oldVel + 10));
        if (newVel === oldVel && oldVel >= 80 && oldVel <= 110) continue;
        ops.push({ op:'setNote', noteId: String(noteId), pitch, startBeat, durationBeat, velocity: newVel });
        examples.push({ noteId: String(noteId), oldVel, newVel });
      }
    }
    return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
  }

  /** dynamics_level: velocity 70–105 (PR-2A safe preset). */
  function _buildPresetDynamicsLevel(clip){
    const ops = [];
    const examples = [];
    const score = clip && clip.score;
    if (!score || !Array.isArray(score.tracks)) return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
    for (const tr of score.tracks){
      const notes = Array.isArray(tr.notes) ? tr.notes : [];
      for (const n of notes){
        const noteId = n && n.id;
        if (!noteId) continue;
        const pitch = Number(n.pitch);
        const startBeat = Number(n.startBeat);
        const durationBeat = Number(n.durationBeat);
        if (!isFinite(pitch) || !isFinite(startBeat) || !isFinite(durationBeat)) continue;
        if (pitch < 0 || pitch > 127 || startBeat < 0 || durationBeat <= 0) continue;
        const oldVel = (typeof n.velocity === 'number' && isFinite(n.velocity)) ? n.velocity : 90;
        const newVel = Math.min(105, Math.max(70, oldVel));
        if (newVel === oldVel) continue;
        ops.push({ op:'setNote', noteId: String(noteId), pitch, startBeat, durationBeat, velocity: newVel });
        examples.push({ noteId: String(noteId), oldVel, newVel });
      }
    }
    return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
  }

  /** duration_gentle: durationBeat ±10%, clamped >0, order preserved (PR-2A). */
  function _buildPresetDurationGentle(clip){
    const ops = [];
    const examples = [];
    const score = clip && clip.score;
    if (!score || !Array.isArray(score.tracks)) return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
    for (const tr of score.tracks){
      const notes = Array.isArray(tr.notes) ? tr.notes : [];
      for (const n of notes){
        const noteId = n && n.id;
        if (!noteId) continue;
        const durationBeat = Number(n.durationBeat);
        if (!isFinite(durationBeat) || durationBeat <= 0) continue;
        const lo = durationBeat * 0.9;
        const hi = durationBeat * 1.1;
        const newDur = Math.max(1e-6, Math.min(hi, Math.round(durationBeat * 100) / 100));
        const clamped = Math.max(lo, Math.min(hi, newDur));
        if (clamped === durationBeat || Math.abs(clamped - durationBeat) < 1e-9) continue;
        ops.push({
          op: 'setNote',
          noteId: String(noteId),
          pitch: Number(n.pitch),
          startBeat: Number(n.startBeat),
          durationBeat: clamped,
          velocity: Number(n.velocity),
        });
        examples.push({ noteId: String(noteId), oldDurationBeat: durationBeat, newDurationBeat: clamped });
      }
    }
    return { patch:{ version:1, clipId: clip && clip.id, ops }, examples };
  }

  /** Resolve preset to { patch, examples }. Falls back to safe stub for unknown preset. */
  function _buildPatchFromPreset(clip, presetId){
    const id = presetId && String(presetId);
    if (id === PRESET_IDS.DYNAMICS_ACCENT) return _buildPresetDynamicsAccent(clip);
    if (id === PRESET_IDS.DYNAMICS_LEVEL) return _buildPresetDynamicsLevel(clip);
    if (id === PRESET_IDS.DURATION_GENTLE) return _buildPresetDurationGentle(clip);
    if (id === PRESET_IDS.NOOP) return { patch: { version: 1, clipId: clip && clip.id, ops: [] }, examples: [] };
    return _buildSafeStubPatch(clip);
  }

  function create(opts){
    /** @param {string} clipId
     *  @param {{ requestedPresetId?: string, userPrompt?: string }} options - optional; do not store full userPrompt in meta
     *  When called with one arg (e.g. from App), options are taken from opts.getOptimizeOptions() or ROOT.__h2s_optimize_options.
     */
    function optimizeClip(clipId, options){
      if (options === undefined && opts.getOptimizeOptions && typeof opts.getOptimizeOptions === 'function') {
        options = opts.getOptimizeOptions();
      }
      if (options === undefined && typeof ROOT !== 'undefined' && ROOT.__h2s_optimize_options !== undefined) {
        options = ROOT.__h2s_optimize_options;
        ROOT.__h2s_optimize_options = undefined;
      }
      const project = opts.getProjectV2();
      const cid = String(clipId||'');
      const clip = project && project.clips && project.clips[cid];
      if (!clip) return { ok:false, reason:'clip_not_found' };

      const optsIn = (options && typeof options === 'object') ? options : {};
      const requestedPresetId = (optsIn.requestedPresetId != null && optsIn.requestedPresetId !== '') ? String(optsIn.requestedPresetId) : null;
      const userPrompt = (optsIn.userPrompt != null && typeof optsIn.userPrompt === 'string') ? optsIn.userPrompt : null;
      if (userPrompt !== null && userPrompt.length > 0) {
        optsIn._promptLen = userPrompt.length;
      }

      const beforeRevisionId = clip.revisionId || null;

      // ALWAYS run pseudo agent first (semantic priority)
      const pseudoPatch = buildPseudoAgentPatch(clip);
      let patch = null;
      let examples = [];
      let executedSource = 'pseudo_v0';
      let executedPreset = 'pseudo_v0';

      if (pseudoPatch.ops && pseudoPatch.ops.length > 0){
        patch = pseudoPatch;
      } else {
        const inAllowlist = requestedPresetId && SAFE_PRESET_ALLOWLIST[requestedPresetId];
        const effectivePresetId = inAllowlist ? requestedPresetId : SAFE_STUB_PRESET;
        const res = _buildPatchFromPreset(clip, effectivePresetId);
        patch = res.patch;
        examples = res.examples || [];
        executedSource = inAllowlist ? 'safe_preset' : DEFAULT_OPT_SOURCE;
        executedPreset = effectivePresetId;
      }

      const opsN = patch.ops.length;
      const patchSummaryBase = {
        requestedSource: requestedPresetId,
        requestedPresetId: requestedPresetId,
        executedSource: executedSource,
        executedPreset: executedPreset,
        source: executedSource,
        preset: executedPreset,
      };
      if (optsIn._promptLen != null) patchSummaryBase.promptLen = optsIn._promptLen;
      if (requestedPresetId && !SAFE_PRESET_ALLOWLIST[requestedPresetId]) patchSummaryBase.reason = 'unknown_preset_fallback';

      if (opsN === 0){
        return {
          ok:true,
          ops:0,
          patchSummary: Object.assign({}, patchSummaryBase, {
            status:'ok',
            noChanges:true,
            reason:'empty_ops',
            ops:0,
            byOp:{},
            examples:[]
          })
        };
      }

      const valid = H2SAgentPatch.validatePatch(patch, clip);
      if (!valid || !valid.ok){
        const reason = (valid && (valid.error || valid.reason || (valid.errors && valid.errors[0])))
          ? (valid.error || valid.reason || valid.errors[0])
          : 'patch_rejected';
        return {
          ok:false,
          reason,
          patchSummary: Object.assign({}, patchSummaryBase, {
            status:'failed',
            reason:String(reason),
            ops:opsN,
            byOp:_opsByOp(patch.ops),
            examples
          })
        };
      }

      const applied = H2SAgentPatch.applyPatchToClip(clip, patch, { project });
      if (!applied || !applied.clip){
        return {
          ok:false,
          reason:'apply_failed',
          patchSummary: Object.assign({}, patchSummaryBase, {
            status:'failed',
            reason:'apply_failed',
            ops:opsN,
            byOp:_opsByOp(patch.ops),
            examples
          })
        };
      }

      const resNew = H2SProject.beginNewClipRevision(project, cid, { name: clip.name });
      if (!resNew || !resNew.ok){
        return {
          ok:false,
          reason:'beginNewClipRevision_failed',
          patchSummary: Object.assign({}, patchSummaryBase, {
            status:'failed',
            reason:'beginNewClipRevision_failed',
            ops:opsN,
            byOp:_opsByOp(patch.ops),
            examples
          })
        };
      }

      const head = project.clips[cid];
      head.score = applied.clip.score;
      H2SProject.recomputeClipMetaFromScoreBeat?.(head);

      head.meta = head.meta || {};
      head.meta.agent = {
        optimizedFromRevisionId: beforeRevisionId,
        appliedAt: _now(),
        patchOps: opsN,
        patchSummary: Object.assign({}, patchSummaryBase, {
          status:'ok',
          ops:opsN,
          byOp:_opsByOp(patch.ops),
          examples
        })
      };

      opts.setProjectFromV2(project);
      opts.commitV2?.('agent_optimize');

      return { ok:true, ops:opsN };
    }
    return { optimizeClip };
  }

  const API = { create, buildPseudoAgentPatch };
  ROOT.H2SAgentController = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
