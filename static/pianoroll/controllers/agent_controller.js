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

      // Capture previous head snapshot for revision chain
      const prevRevisionId = clip.revisionId || null;
      let prevSnapshot = null;
      try {
        prevSnapshot = _clone(clip);
        // Avoid recursively storing history inside history
        if (prevSnapshot && prevSnapshot.revisions) prevSnapshot.revisions = [];
      } catch (e) {
        prevSnapshot = null;
      }

      // create new head revision first (never overwrite raw)
      const resNew = H2SProject.beginNewClipRevision(project, cid, { name: clip.name });
      if (!resNew || !resNew.ok){
        return { ok:false, error: (resNew && resNew.error) || 'beginNewClipRevision_failed' };
      }

      const head = project.clips[cid];

      // Link revision chain for ghost/history UX
      if (prevRevisionId && !head.parentRevisionId) head.parentRevisionId = prevRevisionId;
      if (Array.isArray(head.revisions) && prevSnapshot){
        // store a snapshot of the previous head
        head.revisions.push(prevSnapshot);
      }

      const patch = buildPseudoAgentPatch(head);
      const valid = H2SAgentPatch.validatePatch(patch, { project, clip: head });
      if (!valid || !valid.ok){
        head.meta = head.meta || {};
        head.meta.agent = head.meta.agent || {};
        head.meta.agent.lastError = (valid && valid.error) || 'Patch rejected';
        // Persist v2 truth only. DO NOT call opts.persist() here because app.persist()
        // re-migrates from the v1 view and can clobber v2-only fields/meta.
        opts.setProjectFromV2(project);
        return { ok:false, error: (valid && valid.error) || 'Patch rejected' };
      }

      const applied = H2SAgentPatch.applyPatchToClip(head, patch, { project });

      // applyPatch may return a NEW clip; write back into current head
      if (!applied || applied.ok === false){
        head.meta = head.meta || {};
        head.meta.agent = head.meta.agent || {};
        head.meta.agent.lastError = (applied && applied.error) ? applied.error : 'applyPatch failed';
        opts.setProjectFromV2(project);
        return { ok:false, error: head.meta.agent.lastError };
      }
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
      head.meta.agent.optimizedFromRevisionId = prevRevisionId || head.parentRevisionId || null;
      head.meta.agent.appliedAt = _now();
      head.meta.agent.patchOps = (patch.ops || []).length;
      if (H2SAgentPatch.summarizeAppliedPatch){
        head.meta.agent.patchSummary = H2SAgentPatch.summarizeAppliedPatch(applied);
      } else {
        head.meta.agent.patchSummary = { ops: (patch.ops || []).length };
      }

      // Persist v2 truth only. DO NOT call opts.persist() here because app.persist()
      // re-migrates from the v1 view and can clobber v2-only fields/meta.
      opts.setProjectFromV2(project);
      return { ok:true, revisionId: head.revisionId, ops: (patch.ops||[]).length };
    }

    return { optimizeClip };
  }

  const API = { create, buildPseudoAgentPatch };
  ROOT.H2SAgentController = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
