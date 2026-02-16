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

  /** PR-6a: default user prompt when none provided (frontend-only, node-safe). */
  const DEFAULT_OPTIMIZE_USER_PROMPT = 'Apply safe dynamics and timing improvements.';

  /** PR-6a: resolve executed prompt and source for patchSummary trace. */
  function resolveOptimizeUserPrompt(opts){
    const raw = (opts && opts.userPrompt != null && typeof opts.userPrompt === 'string') ? String(opts.userPrompt).trim() : '';
    if (raw === '') {
      const prompt = DEFAULT_OPTIMIZE_USER_PROMPT;
      const preview = prompt.length > 40 ? prompt.slice(0, 37) + '...' : prompt;
      return { prompt, source: 'default', preview };
    }
    const preview = raw.length > 40 ? raw.slice(0, 37) + '...' : raw;
    return { prompt: raw, source: 'user', preview };
  }

  /** Safe preset IDs (PR-2A). Only velocity and optional durationBeat allowed. */
  const PRESET_IDS = {
    DYNAMICS_ACCENT: 'dynamics_accent',
    DYNAMICS_LEVEL: 'dynamics_level',
    DURATION_GENTLE: 'duration_gentle',
    /** PR-5b: deterministic no-op for tests; returns empty patch. */
    NOOP: 'noop',
    /** PR-7b-2: LLM gateway; returns patch from OpenAI-compatible chat completions. */
    LLM_V0: 'llm_v0',
  };
  /** Allowlist: only these preset IDs may run; unknown → fallback to safe_stub_v0. */
  const SAFE_PRESET_ALLOWLIST = {
    [PRESET_IDS.DYNAMICS_ACCENT]: true,
    [PRESET_IDS.DYNAMICS_LEVEL]: true,
    [PRESET_IDS.DURATION_GENTLE]: true,
    [PRESET_IDS.NOOP]: true,
    [PRESET_IDS.LLM_V0]: true,
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

  /** PR-B3a: Compute patch type summary from ops (pitch/timing/structure/velocity-only). */
  function _computePatchTypeSummary(ops){
    const arr = Array.isArray(ops) ? ops : [];
    let hasPitchChange = false;
    let hasTimingChange = false;
    let hasStructuralChange = false;
    for (const op of arr){
      if (!op || typeof op !== 'object') continue;
      const ot = String(op.op || '');
      if (ot === 'addNote' || ot === 'deleteNote') hasStructuralChange = true;
      if (ot === 'moveNote') hasTimingChange = true;
      if (ot === 'setNote'){
        if (op.pitch != null) hasPitchChange = true;
        if (op.startBeat != null || op.durationBeat != null) hasTimingChange = true;
      }
    }
    const isVelocityOnly = arr.length > 0 && !hasPitchChange && !hasTimingChange && !hasStructuralChange;
    return { hasPitchChange, hasTimingChange, hasStructuralChange, isVelocityOnly };
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
    /** PR-7b-2: Run optimize with llm_v0 preset (async). Returns Promise<result>. */
    function _runLlmV0Optimize(project, cid, clip, optsIn, promptInfo, beforeRevisionId, requestedPresetId){
      const requestedUserPrompt = (optsIn.userPrompt != null && typeof optsIn.userPrompt === 'string') ? optsIn.userPrompt : null;
      const patchSummaryBase = {
        requestedSource: requestedPresetId,
        requestedPresetId: requestedPresetId,
        executedSource: 'llm_v0',
        executedPreset: 'llm_v0',
        source: 'llm_v0',
        preset: 'llm_v0',
        requestedUserPrompt: requestedUserPrompt,
        executedUserPromptSource: promptInfo.source,
        executedUserPromptPreview: promptInfo.preview,
      };
      if (optsIn._promptLen != null) patchSummaryBase.promptLen = optsIn._promptLen;

      function fail(reason, summaryExtras){
        return {
          ok: false,
          reason: reason,
          patchSummary: Object.assign({}, patchSummaryBase, {
            status: 'failed',
            reason: String(reason),
            ops: 0,
            byOp: {},
            examples: [],
          }, summaryExtras || {}),
        };
      }

      const cfg = (ROOT.H2S_LLM_CONFIG && typeof ROOT.H2S_LLM_CONFIG.loadLlmConfig === 'function')
        ? ROOT.H2S_LLM_CONFIG.loadLlmConfig()
        : null;
      if (!cfg || typeof cfg.baseUrl !== 'string' || !cfg.baseUrl.trim() || typeof cfg.model !== 'string' || !cfg.model.trim()){
        return Promise.resolve(fail('llm_config_missing', { reason: 'llm_config_missing' }));
      }

      // PR-8D: Determine safe mode (velocity-only) - default ON if missing
      const safeMode = (cfg && typeof cfg.velocityOnly === 'boolean') ? cfg.velocityOnly : true;

      // PR-8B-1: Extract clip metadata and noteIds for structured hint
      const score = clip && clip.score;
      const tracks = (score && Array.isArray(score.tracks)) ? score.tracks : [];
      let noteCount = 0;
      let noteIds = [];
      let pitchMin = null;
      let pitchMax = null;
      let maxSpanBeat = 0;
      for (const tr of tracks){
        const notes = Array.isArray(tr.notes) ? tr.notes : [];
        for (const n of notes){
          if (n && n.id){
            if (noteIds.length < 80) noteIds.push(String(n.id));
            noteCount += 1;
            const p = Number(n.pitch);
            if (isFinite(p) && p >= 0 && p <= 127){
              if (pitchMin == null || p < pitchMin) pitchMin = p;
              if (pitchMax == null || p > pitchMax) pitchMax = p;
            }
            const sb = Number(n.startBeat);
            const db = Number(n.durationBeat);
            if (isFinite(sb) && isFinite(db) && db > 0){
              const end = sb + db;
              if (end > maxSpanBeat) maxSpanBeat = end;
            }
          }
        }
      }
      const meta = clip && clip.meta;
      const finalNoteCount = (meta && typeof meta.notes === 'number') ? meta.notes : noteCount;
      const finalPitchMin = (meta && typeof meta.pitchMin === 'number') ? meta.pitchMin : pitchMin;
      const finalPitchMax = (meta && typeof meta.pitchMax === 'number') ? meta.pitchMax : pitchMax;
      const finalSpanBeat = (meta && typeof meta.spanBeat === 'number') ? meta.spanBeat : maxSpanBeat;
      const p2 = opts.getProjectV2 && typeof opts.getProjectV2 === 'function' ? opts.getProjectV2() : project;
      const bpm = (p2 && typeof p2.bpm === 'number' && p2.bpm > 0) ? p2.bpm : 120;

      // PR-8B-1: Strict system prompt matching validatePatch schema exactly
      // PR-8D: Adjust prompt for safe mode (velocity-only) vs normal mode
      let systemMsg;
      if (safeMode){
        // Safe mode: ONLY setNote ops, ONLY velocity field allowed
        systemMsg = 'You are a music patch generator. Output EXACTLY ONE JSON object wrapped in a single ```json ... ``` code block. No other text before or after the code block.\n\n' +
          'SAFE MODE (Velocity-only): You MUST output ONLY setNote operations that change ONLY velocity. No other op types or fields are allowed.\n\n' +
          'Required patch structure:\n' +
          '{\n' +
          '  "version": 1,\n' +
          '  "clipId": "<string>",\n' +
          '  "ops": [\n' +
          '    {\n' +
          '      "op": "setNote",\n' +
          '      "noteId": "<string>",\n' +
          '      "velocity": <1-127>\n' +
          '    }\n' +
          '  ]\n' +
          '}\n\n' +
          'Allowed op type (ONLY):\n' +
          '- setNote: REQUIRED: op (string, must be "setNote"), noteId (string), velocity (1-127)\n' +
          '  FORBIDDEN: Do NOT include pitch, startBeat, or durationBeat fields\n' +
          '  FORBIDDEN: Do NOT use addNote, deleteNote, or moveNote op types\n\n' +
          'All numeric fields must be finite numbers within stated ranges.\n\n' +
          'Example (setNote with velocity only):\n' +
          '{\n' +
          '  "version": 1,\n' +
          '  "clipId": "clip_abc123",\n' +
          '  "ops": [\n' +
          '    {\n' +
          '      "op": "setNote",\n' +
          '      "noteId": "note_xyz",\n' +
          '      "velocity": 90\n' +
          '    }\n' +
          '  ]\n' +
          '}';
      } else {
        // Normal mode: all 4 op types allowed (PR-8B-1 contract)
        systemMsg = 'You are a music patch generator. Output EXACTLY ONE JSON object wrapped in a single ```json ... ``` code block. No other text before or after the code block.\n\n' +
          'Required patch structure:\n' +
          '{\n' +
          '  "version": 1,\n' +
          '  "clipId": "<string>",\n' +
          '  "ops": [\n' +
          '    {\n' +
          '      "op": "setNote",\n' +
          '      "noteId": "<string>",\n' +
          '      "pitch": <0-127>,\n' +
          '      "startBeat": <number >= 0>,\n' +
          '      "durationBeat": <number > 0>,\n' +
          '      "velocity": <1-127>\n' +
          '    }\n' +
          '  ]\n' +
          '}\n\n' +
          'Allowed op types (field names must match exactly):\n' +
          '- setNote: REQUIRED: op (string), noteId (string). At least ONE of: pitch (0-127), velocity (1-127), startBeat (>=0), durationBeat (>0)\n' +
          '- addNote: REQUIRED: op (string), trackId (string), note (object with: pitch 0-127, startBeat >=0, durationBeat >0, velocity 1-127). Optional: note.id (string)\n' +
          '- deleteNote: REQUIRED: op (string), noteId (string)\n' +
          '- moveNote: REQUIRED: op (string), noteId (string), deltaBeat (number)\n\n' +
          'All numeric fields must be finite numbers within stated ranges.\n\n' +
          'Example (setNote):\n' +
          '{\n' +
          '  "version": 1,\n' +
          '  "clipId": "clip_abc123",\n' +
          '  "ops": [\n' +
          '    {\n' +
          '      "op": "setNote",\n' +
          '      "noteId": "note_xyz",\n' +
          '      "velocity": 90\n' +
          '    }\n' +
          '  ]\n' +
          '}';
      }

      // PR-8B-1: User message with structured clip hint including allowed noteIds
      let clipHint = '\n\n---\n\nClip context (beats-only):\n';
      clipHint += '- clipId: ' + (clip && clip.id ? String(clip.id) : 'unknown') + '\n';
      clipHint += '- notes: ' + String(finalNoteCount) + '\n';
      if (finalPitchMin != null && finalPitchMax != null){
        clipHint += '- pitch range: ' + String(finalPitchMin) + ' to ' + String(finalPitchMax) + ' (MIDI 0-127)\n';
      } else {
        clipHint += '- pitch range: unknown\n';
      }
      if (finalSpanBeat > 0){
        clipHint += '- span: ' + String(finalSpanBeat) + ' beats\n';
      } else {
        clipHint += '- span: unknown\n';
      }
      clipHint += '- bpm: ' + String(bpm) + '\n';
      if (noteIds.length > 0){
        clipHint += '\nAllowed noteIds (use ONLY these for setNote/moveNote/deleteNote):\n';
        clipHint += noteIds.slice(0, 80).join(', ') + '\n';
        if (finalNoteCount > 80){
          clipHint += '\n(Clip has ' + String(finalNoteCount) + ' notes total; only modify noteIds from the allowed list above. Do not invent ids.)\n';
        } else {
          clipHint += '\nIf you use setNote/moveNote/deleteNote, noteId MUST be chosen from the Allowed noteIds list above.\n';
        }
      } else {
        clipHint += '\nNo notes found in clip. Use addNote to create new notes.\n';
      }
      clipHint += '\nOutput only the patch JSON in a ```json ... ``` block.';

      let baseUserContent = promptInfo.prompt + clipHint;
      if (!safeMode){
        baseUserContent = 'User prompt may require pitch/timing changes; do not respond with velocity-only unless explicitly requested.\n\n' + baseUserContent;
      }
      const client = ROOT.H2S_LLM_CLIENT;
      if (!client || typeof client.callChatCompletions !== 'function' || typeof client.extractJsonObject !== 'function'){
        return Promise.resolve(fail('llm_client_not_loaded', { reason: 'llm_client_not_loaded' }));
      }

      // PR-8B-2: Inner async function for one attempt (with optional fix hint for retry)
      // PR-8C: Capture debug data (rawText, extractedJson, validateErrors) for final attempt
      async function attemptOnce(attemptIndex, extraFixHint, debugCapture){
        let userContent = baseUserContent;
        if (attemptIndex === 2 && extraFixHint){
          const fixPrefix = 'The previous output was invalid for this reason: ' + extraFixHint + '\n\nFix the JSON patch ONLY.\nOutput EXACTLY ONE JSON object in a single ```json``` block. No commentary.\nEnsure it matches the required schema and uses only Allowed noteIds.\n\n---\n\n';
          userContent = fixPrefix + baseUserContent;
        }
        const messages = [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userContent },
        ];

        try {
          const res = await client.callChatCompletions(cfg, messages, { temperature: 0.2, timeoutMs: 20000 });
          const text = (res && typeof res.text === 'string') ? res.text : '';
          if (debugCapture) debugCapture.rawText = text;
          const patchObj = client.extractJsonObject(text);
          if (!patchObj || typeof patchObj !== 'object'){
            if (debugCapture) debugCapture.extractedJson = null;
            return { ok: false, reason: 'llm_no_valid_json', detail: 'no_json' };
          }
          if (debugCapture) debugCapture.extractedJson = JSON.stringify(patchObj, null, 2);
          if (!Array.isArray(patchObj.ops)) patchObj.ops = [];
          if (patchObj.version == null) patchObj.version = 1;
          if (patchObj.clipId == null) patchObj.clipId = clip && clip.id;

          const opsN = patchObj.ops.length;
          if (opsN === 0){
            if (debugCapture) debugCapture.validateErrors = [];
            return {
              ok: true,
              ops: 0,
              patchSummary: Object.assign({}, patchSummaryBase, {
                status: 'ok',
                noChanges: true,
                reason: 'empty_ops',
                ops: 0,
                byOp: {},
                examples: [],
              }, _computePatchTypeSummary([])),
            };
          }

          // PR-8D: Safe mode enforcement (velocity-only) - reject disallowed ops/fields before validatePatch
          if (safeMode){
            const errors = [];
            for (let i = 0; i < patchObj.ops.length; i++){
              const op = patchObj.ops[i];
              if (!op || typeof op !== 'object') continue;
              const opType = op.op;
              // Reject any op type other than setNote
              if (opType !== 'setNote'){
                errors.push('disallowed_op:' + String(opType));
                continue;
              }
              // For setNote, reject if it contains pitch, startBeat, or durationBeat
              if (op.pitch != null || op.startBeat != null || op.durationBeat != null){
                const disallowedFields = [];
                if (op.pitch != null) disallowedFields.push('pitch');
                if (op.startBeat != null) disallowedFields.push('startBeat');
                if (op.durationBeat != null) disallowedFields.push('durationBeat');
                errors.push('disallowed_field:' + disallowedFields.join(','));
              }
            }
            if (errors.length > 0){
              const errorCodes = errors.slice(0, 3).join(', ');
              if (debugCapture) debugCapture.validateErrors = errors.slice(0, 10);
              return {
                ok: false,
                reason: 'patch_rejected',
                detail: errorCodes,
                patchObj: patchObj,
                opsN: opsN,
              };
            }
          }

          const valid = H2SAgentPatch.validatePatch(patchObj, clip);
          if (!valid || !valid.ok){
            const firstError = (valid && valid.errors && valid.errors[0]) ? valid.errors[0] : 'patch_rejected';
            const errorCodes = (valid && valid.errors && Array.isArray(valid.errors)) ? valid.errors.slice(0, 3).join(', ') : firstError;
            if (debugCapture) debugCapture.validateErrors = (valid && valid.errors && Array.isArray(valid.errors)) ? valid.errors.slice(0, 10) : [firstError];
            return {
              ok: false,
              reason: 'patch_rejected',
              detail: errorCodes,
              patchObj: patchObj,
              opsN: opsN,
            };
          }
          if (debugCapture) debugCapture.validateErrors = [];

          const applied = H2SAgentPatch.applyPatchToClip(clip, patchObj, { project: project });
          if (!applied || !applied.clip){
            return fail('apply_failed', { ops: opsN, byOp: _opsByOp(patchObj.ops) });
          }

          const resNew = H2SProject.beginNewClipRevision(project, cid, { name: clip.name });
          if (!resNew || !resNew.ok){
            return fail('beginNewClipRevision_failed', { ops: opsN, byOp: _opsByOp(patchObj.ops) });
          }

          const head = project.clips[cid];
          head.score = applied.clip.score;
          if (typeof H2SProject.recomputeClipMetaFromScoreBeat === 'function') H2SProject.recomputeClipMetaFromScoreBeat(head);

          head.meta = head.meta || {};
          head.meta.agent = {
            optimizedFromRevisionId: beforeRevisionId,
            appliedAt: _now(),
            patchOps: opsN,
            patchSummary: Object.assign({}, patchSummaryBase, {
              status: 'ok',
              ops: opsN,
              byOp: _opsByOp(patchObj.ops),
              examples: [],
            }, _computePatchTypeSummary(patchObj.ops)),
          };

          opts.setProjectFromV2(project);
          if (typeof opts.commitV2 === 'function') opts.commitV2('agent_optimize');
          return { ok: true, ops: opsN };
        } catch(err){
          const msg = (err && err.message) ? String(err.message) : 'llm_request_failed';
          // PR-8C: Capture error in debug if available
          if (debugCapture && typeof debugCapture === 'object'){
            if (!debugCapture.rawText || debugCapture.rawText === '') debugCapture.rawText = (err && err.message) ? String(err.message) : 'llm_request_failed';
            if (!debugCapture.validateErrors || !Array.isArray(debugCapture.validateErrors)) debugCapture.validateErrors = [];
            if (msg && !debugCapture.validateErrors.includes(msg)) debugCapture.validateErrors.push(msg);
          }
          return fail(msg, { reason: msg });
        }
      }

      // PR-8B-2: Retry logic - only retry for JSON extraction or validation failures
      // PR-8C: Capture debug data for final attempt (incl. safeModeResolved for console-friendly verification)
      const debugCapture = { rawText: '', extractedJson: null, validateErrors: [] };
      return attemptOnce(1, null, debugCapture).then(function(res1){
        if (res1.ok){
          const out = Object.assign({}, res1);
          out.llmDebug = {
            attemptCount: 1,
            reason: res1.reason || 'ok',
            rawText: debugCapture.rawText || '',
            extractedJson: debugCapture.extractedJson || null,
            errors: debugCapture.validateErrors || [],
            safeModeResolved: safeMode,
          };
          return out;
        }
        if (res1.reason === 'llm_no_valid_json' || res1.reason === 'patch_rejected'){
          let fixDetail = '';
          if (res1.reason === 'llm_no_valid_json'){
            fixDetail = 'no valid JSON object found';
          } else if (res1.reason === 'patch_rejected'){
            fixDetail = (res1.detail && typeof res1.detail === 'string') ? res1.detail : 'patch validation failed';
            if (fixDetail.length > 200) fixDetail = fixDetail.slice(0, 197) + '...';
          }
          // Reset debug capture for second attempt
          debugCapture.rawText = '';
          debugCapture.extractedJson = null;
          debugCapture.validateErrors = [];
          return attemptOnce(2, fixDetail, debugCapture).then(function(res2){
            const out = Object.assign({}, res2);
            out.llmDebug = {
              attemptCount: 2,
              reason: res2.reason || 'ok',
              rawText: debugCapture.rawText || '',
              extractedJson: debugCapture.extractedJson || null,
              errors: debugCapture.validateErrors || [],
              safeModeResolved: safeMode,
            };
            return out;
          });
        }
        // No retry - return first attempt with debug
        const out = Object.assign({}, res1);
        out.llmDebug = {
          attemptCount: 1,
          reason: res1.reason || 'unknown',
          rawText: debugCapture.rawText || '',
          extractedJson: debugCapture.extractedJson || null,
          errors: debugCapture.validateErrors || [],
          safeModeResolved: safeMode,
        };
        return out;
      });
    }

    /** @param {string} clipId
     *  @param {{ requestedPresetId?: string, userPrompt?: string }} options - optional; do not store full userPrompt in meta
     *  When called with one arg (e.g. from App), options are taken from opts.getOptimizeOptions() or ROOT.__h2s_optimize_options.
     */
    function optimizeClip(clipId, options){
      const cidForOptions = String(clipId || '');
      if (options === undefined && opts.getOptimizeOptions && typeof opts.getOptimizeOptions === 'function') {
        options = opts.getOptimizeOptions(cidForOptions);
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
      const promptInfo = resolveOptimizeUserPrompt(optsIn);

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
        if (effectivePresetId === PRESET_IDS.LLM_V0){
          return _runLlmV0Optimize(project, cid, clip, optsIn, promptInfo, beforeRevisionId, requestedPresetId);
        }
        const res = _buildPatchFromPreset(clip, effectivePresetId);
        patch = res.patch;
        examples = res.examples || [];
        executedSource = inAllowlist ? 'safe_preset' : DEFAULT_OPT_SOURCE;
        executedPreset = effectivePresetId;
      }

      const opsN = patch.ops.length;
      const requestedUserPrompt = (optsIn.userPrompt != null && typeof optsIn.userPrompt === 'string') ? optsIn.userPrompt : null;
      const patchSummaryBase = {
        requestedSource: requestedPresetId,
        requestedPresetId: requestedPresetId,
        executedSource: executedSource,
        executedPreset: executedPreset,
        source: executedSource,
        preset: executedPreset,
        requestedUserPrompt,
        executedUserPromptSource: promptInfo.source,
        executedUserPromptPreview: promptInfo.preview,
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
          }, _computePatchTypeSummary([]))
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
        }, _computePatchTypeSummary(patch.ops))
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
