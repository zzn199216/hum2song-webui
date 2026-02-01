/* static/pianoroll/controllers/agent_controller.js
   T3-4 Agent Runner v0: build + validate + apply patch into a new clip revision.
   Plain script (no import/export). Node-safe export.
*/
(function(ROOT){
  'use strict';

  const H2SAgentPatch = ROOT.H2SAgentPatch;
  const H2SProject = ROOT.H2SProject;

  function _assert(cond, msg){ if(!cond) throw new Error(msg || 'assert'); }
  function _now(){ return Date.now(); }
  function _clone(x){ return JSON.parse(JSON.stringify(x)); }

  // v0 pseudo agent: only repairs illegal numeric values via setNote ops.
  // No musical quantize/merge/dedupe/snap.
  function buildPseudoAgentPatch(clip){
    const ops = [];
    const score = clip && clip.score;
    if (!score || !Array.isArray(score.tracks)) return { version:1, clipId: clip && clip.id, ops };

    for (const tr of score.tracks){
      const notes = tr.notes || [];
      for (const n of notes){
        const before = _clone(n);
        const after = _clone(n);

        // pitch
        if (typeof after.pitch !== 'number') after.pitch = Number(after.pitch);
        if (!Number.isFinite(after.pitch)) after.pitch = before.pitch;
        after.pitch = Math.max(0, Math.min(127, Math.round(after.pitch)));

        // velocity
        if (typeof after.velocity !== 'number') after.velocity = Number(after.velocity);
        if (!Number.isFinite(after.velocity)) after.velocity = before.velocity;
        after.velocity = Math.max(1, Math.min(127, Math.round(after.velocity)));

        // beats
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
          ops.push({ op:'setNote', trackId: tr.id, noteId: n.id, before, after });
        }
      }
    }
    return { version:1, clipId: clip && clip.id, ops };
  }

  function create(opts){
    _assert(opts && typeof opts.getProjectV2 === 'function', 'getProjectV2 required');
    _assert(typeof opts.setProjectFromV2 === 'function', 'setProjectFromV2 required');
    _assert(typeof opts.persist === 'function', 'persist required');
    _assert(typeof opts.render === 'function', 'render required');

    function optimizeClip(clipId){
      _assert(H2SAgentPatch && H2SAgentPatch.validatePatch, 'H2SAgentPatch missing');
      _assert(H2SProject && H2SProject.beginNewClipRevision, 'H2SProject revision API missing');

      const project = opts.getProjectV2();
      const cid = String(clipId || '');
      if (!cid) return { ok:false, error:'bad_clip' };
      const clip = project && project.clips && project.clips[cid];
      if (!clip) return { ok:false, error:'clip_not_found' };

      const beforeRevisionId = clip.revisionId || null;

      // Build patch against the current head FIRST.
      // No-op Optimize must not create a new revision.
      const patch = buildPseudoAgentPatch(clip);
      const opsN = (patch && Array.isArray(patch.ops)) ? patch.ops.length : 0;

      const valid = H2SAgentPatch.validatePatch(patch, { project, clip });
      if (!valid || !valid.ok){
        clip.meta = clip.meta || {};
        clip.meta.agent = clip.meta.agent || {};
        clip.meta.agent.lastError = (valid && valid.error) || 'Patch rejected';
        opts.setProjectFromV2(project);
        return { ok:false, error: clip.meta.agent.lastError };
      }

      // No-op: only update meta.agent for auditability (no revision bump).
      if (opsN === 0){
        clip.meta = clip.meta || {};
        clip.meta.agent = clip.meta.agent || {};
        clip.meta.agent.optimizedFromRevisionId = beforeRevisionId || null;
        clip.meta.agent.appliedAt = _now();
        clip.meta.agent.patchOps = 0;
        clip.meta.agent.patchSummary = { ops: 0 };
        opts.setProjectFromV2(project);
        return { ok:true, noop:true, revisionId: clip.revisionId, ops: 0 };
      }

      // Mutating Optimize: create a new head revision so raw is preserved.
      const resNew = H2SProject.beginNewClipRevision(project, cid, { name: clip.name });
      if (!resNew || !resNew.ok){
        return { ok:false, error: (resNew && resNew.error) || 'beginNewClipRevision_failed' };
      }

      const head = project.clips[cid];
      const applied = H2SAgentPatch.applyPatchToClip(head, patch, { project });
      if (!applied || applied.ok === false){
        // Best-effort rollback to the pre-opt head so we don't leave a broken revision.
        try{
          if (beforeRevisionId && H2SProject.applySnapshotToClipHead){
            H2SProject.applySnapshotToClipHead(project, cid, beforeRevisionId);
          }
        }catch(e){}

        const err = (applied && applied.error) ? applied.error : 'applyPatch failed';
        head.meta = head.meta || {};
        head.meta.agent = head.meta.agent || {};
        head.meta.agent.lastError = err;
        opts.setProjectFromV2(project);
        return { ok:false, error: err };
      }

      // applyPatch may return a NEW clip; write back into the current head
      if (applied && applied.clip){
        if (applied.clip.score) head.score = applied.clip.score;
        if (applied.clip.meta){
          const keepAgent = head.meta && head.meta.agent ? _clone(head.meta.agent) : null;
          head.meta = applied.clip.meta;
          if (keepAgent){
            head.meta = head.meta || {};
            head.meta.agent = head.meta.agent || {};
            Object.assign(head.meta.agent, keepAgent);
          }
        }
      }

      if (H2SProject.recomputeClipMetaFromScoreBeat){
        H2SProject.recomputeClipMetaFromScoreBeat(head);
      }

      head.meta = head.meta || {};
      head.meta.agent = head.meta.agent || {};
      head.meta.agent.optimizedFromRevisionId = beforeRevisionId || head.parentRevisionId || null;
      head.meta.agent.appliedAt = _now();
      head.meta.agent.patchOps = opsN;
      if (H2SAgentPatch.summarizeAppliedPatch){
        head.meta.agent.patchSummary = H2SAgentPatch.summarizeAppliedPatch(applied);
      } else {
        head.meta.agent.patchSummary = { ops: opsN };
      }

      opts.setProjectFromV2(project);
      return { ok:true, revisionId: head.revisionId, ops: opsN };
    }

    return { optimizeClip };
  }

  const API = { create, buildPseudoAgentPatch };
  ROOT.H2SAgentController = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
