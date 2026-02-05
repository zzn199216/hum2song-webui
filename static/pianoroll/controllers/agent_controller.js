/* static/pianoroll/controllers/agent_controller.js
   Agent Runner v0 — pseudo agent priority + safe_stub_v0 fallback
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

  function create(opts){
    function optimizeClip(clipId){
      const project = opts.getProjectV2();
      const cid = String(clipId||'');
      const clip = project && project.clips && project.clips[cid];
      if (!clip) return { ok:false, reason:'clip_not_found' };

      const beforeRevisionId = clip.revisionId || null;

      // ALWAYS run pseudo agent first
      const pseudoPatch = buildPseudoAgentPatch(clip);
      let patch = null;
      let examples = [];
      let source = 'pseudo_v0';
      let preset = 'pseudo_v0';

      if (pseudoPatch.ops && pseudoPatch.ops.length > 0){
        patch = pseudoPatch;
      } else {
        const res = _buildSafeStubPatch(clip);
        patch = res.patch;
        examples = res.examples || [];
        source = DEFAULT_OPT_SOURCE;
        preset = SAFE_STUB_PRESET;
      }

      const opsN = patch.ops.length;
      if (opsN === 0){
        return {
          ok:true,
          ops:0,
          patchSummary:{
            source,
            preset,
            status:'ok',
            noChanges:true,
            reason:'empty_ops',
            ops:0,
            byOp:{},
            examples:[]
          }
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
          patchSummary:{
            source,
            preset,
            status:'failed',
            reason:String(reason),
            ops:opsN,
            byOp:_opsByOp(patch.ops),
            examples
          }
        };
      }

      const applied = H2SAgentPatch.applyPatchToClip(clip, patch, { project });
      if (!applied || !applied.clip){
        return {
          ok:false,
          reason:'apply_failed',
          patchSummary:{
            source,
            preset,
            status:'failed',
            reason:'apply_failed',
            ops:opsN,
            byOp:_opsByOp(patch.ops),
            examples
          }
        };
      }

      const resNew = H2SProject.beginNewClipRevision(project, cid, { name: clip.name });
      if (!resNew || !resNew.ok){
        return {
          ok:false,
          reason:'beginNewClipRevision_failed',
          patchSummary:{
            source,
            preset,
            status:'failed',
            reason:'beginNewClipRevision_failed',
            ops:opsN,
            byOp:_opsByOp(patch.ops),
            examples
          }
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
        patchSummary:{
          source,
          preset,
          status:'ok',
          ops:opsN,
          byOp:_opsByOp(patch.ops),
          examples
        }
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
