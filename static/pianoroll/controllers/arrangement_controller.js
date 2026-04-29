(function(ROOT){
  'use strict';

  if (typeof require === 'function'){
    if (!ROOT.H2SArrangementPatchV0){
      try {
        const mod = require('../core/arrangement_patch_v0.js');
        if (mod && !ROOT.H2SArrangementPatchV0) ROOT.H2SArrangementPatchV0 = mod;
      } catch (_) {}
    }
  }

  function isFiniteNumber(x){
    return typeof x === 'number' && isFinite(x);
  }

  function asString(x){
    return (x == null) ? '' : String(x);
  }

  function safeTrim(x){
    return asString(x).trim();
  }

  function clipKind(projectApi, clip){
    if (projectApi && typeof projectApi.clipKind === 'function'){
      return projectApi.clipKind(clip);
    }
    return (clip && clip.kind === 'audio') ? 'audio' : 'note';
  }

  function getClipMap(project){
    if (!project || !project.clips || typeof project.clips !== 'object' || Array.isArray(project.clips)) return {};
    return project.clips;
  }

  function countNotes(scoreBeat){
    let n = 0;
    const tracks = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
    for (const tr of tracks){
      const notes = (tr && Array.isArray(tr.notes)) ? tr.notes : [];
      n += notes.length;
    }
    return n;
  }

  function buildMelodyNoteTable(scoreBeat, maxRows){
    const rows = [];
    const tracks = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
    for (let ti = 0; ti < tracks.length; ti++){
      const tr = tracks[ti] || {};
      const trackId = safeTrim(tr.id || tr.trackId) || ('track_' + ti);
      const notes = Array.isArray(tr.notes) ? tr.notes.slice() : [];
      notes.sort(function(a, b){
        const sa = Number(a && a.startBeat);
        const sb = Number(b && b.startBeat);
        if (sa !== sb) return sa - sb;
        const ia = asString(a && a.id);
        const ib = asString(b && b.id);
        if (ia < ib) return -1;
        if (ia > ib) return 1;
        return 0;
      });
      for (const note of notes){
        if (rows.length >= maxRows) return rows;
        rows.push({
          trackId: trackId,
          noteId: asString(note && note.id),
          pitch: Number(note && note.pitch),
          velocity: Number(note && note.velocity),
          startBeat: Number(note && note.startBeat),
          durationBeat: Number(note && note.durationBeat),
        });
      }
    }
    return rows;
  }

  function summarizeTracks(project, maxItems){
    const out = [];
    const tracks = (project && Array.isArray(project.tracks)) ? project.tracks : [];
    for (let i = 0; i < tracks.length && out.length < maxItems; i++){
      const t = tracks[i] || {};
      out.push({
        trackId: safeTrim(t.id || t.trackId) || ('track_' + i),
        name: safeTrim(t.name) || '',
        instrument: safeTrim(t.instrument) || 'default',
      });
    }
    return out;
  }

  function summarizeInstances(project, maxItems){
    const out = [];
    const instances = (project && Array.isArray(project.instances)) ? project.instances : [];
    for (let i = 0; i < instances.length && out.length < maxItems; i++){
      const inst = instances[i] || {};
      out.push({
        instanceId: safeTrim(inst.id),
        clipId: safeTrim(inst.clipId),
        trackId: safeTrim(inst.trackId),
        startBeat: Number(inst.startBeat),
        transpose: Number(inst.transpose || 0),
      });
    }
    return out;
  }

  function buildPromptContext(input){
    const noteTable = buildMelodyNoteTable(input.selectedClip.score, 512);
    const payload = {
      task: 'Hum2Song Arrangement Patch v0',
      goal: input.goal,
      userPrompt: input.userPrompt || '',
      project: {
        bpm: input.bpm,
        timeSignature: input.timeSignature || null,
      },
      selectedClip: {
        clipId: input.selectedClipId,
        name: safeTrim(input.selectedClip.name) || '',
        spanBeat: Number(input.selectedClipSpanBeat),
        instanceStartBeat: Number(input.selectedInstanceStartBeat),
      },
      melodyNoteTableBeat: noteTable,
      existingTracks: summarizeTracks(input.projectV2, 24),
      existingTimelineInstances: summarizeInstances(input.projectV2, 48),
    };

    const schema = {
      kind: 'arrangement_patch_v0',
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'string', name: 'string', instrument: 'string' },
        { op: 'createClip', clipId: 'string', name: 'string', sourceTaskId: 'optional_string', scoreBeat: {
          version: 2,
          time_signature: 'optional_string',
          tracks: [
            { id: 'string', name: 'optional_string', notes: [
              { id: 'string', pitch: '0..127', velocity: '1..127', startBeat: '>=0', durationBeat: '>0' }
            ] }
          ],
        } },
        { op: 'setTrackInstrument', trackId: 'string', instrument: 'string' },
        { op: 'addInstance', instanceId: 'string', clipId: 'string', trackId: 'string', startBeat: '>=0', transpose: 'optional_-48..48' },
      ],
    };

    const systemPrompt = [
      'You are an arrangement generator for Hum2Song.',
      'Output exactly ONE JSON object in a single ```json code block with no other text.',
      'The JSON object MUST follow Arrangement Patch v0 for additive accompaniment only.',
      '',
      'Hard constraints:',
      '- kind must be "arrangement_patch_v0".',
      '- beats-only: never output seconds fields (no startSec/durationSec/spanSec or any *sec field).',
      '- additive-only: use only createTrack/createClip/setTrackInstrument/addInstance.',
      '- never modify or delete existing melody material.',
      '- do not reference non-existent clip/track IDs.',
      '- prefer 1-2 new tracks maximum.',
      '- keep accompaniment sparse, supportive, and musically simple.',
      '- generated caps: max 2 new tracks, max 4 new clips, max 8 new instances, max 256 notes total.',
      '',
      'Return only the JSON code block.',
    ].join('\n');

    const userPrompt = [
      'Generate Arrangement Patch v0 for goal: add_accompaniment_v0.',
      (input.userPrompt ? ('User instruction: ' + input.userPrompt) : 'User instruction: (none)'),
      '',
      'Context JSON:',
      JSON.stringify(payload, null, 2),
      '',
      'Allowed schema JSON:',
      JSON.stringify(schema, null, 2),
    ].join('\n');

    return { systemPrompt: systemPrompt, userPrompt: userPrompt };
  }

  function validateHooks(hooks){
    const req = ['getProjectV2', 'setProjectFromV2', 'getSelectedClipId', 'getSelectedInstanceId'];
    for (const k of req){
      if (!hooks || typeof hooks[k] !== 'function') throw new Error('missing_hook:' + k);
    }
  }

  function create(hooks){
    validateHooks(hooks);
    const H2SProject = hooks.H2SProject || ROOT.H2SProject;
    const ArrangementPatch = ROOT.H2SArrangementPatchV0;

    function statusLog(msg, extra){
      if (typeof hooks.log === 'function'){
        try { hooks.log(msg, extra || null); } catch (_) {}
      }
    }

    async function runArrangementV0(options){
      const opts = (options && typeof options === 'object') ? options : {};
      const goal = safeTrim(opts.goal || 'add_accompaniment_v0');
      const userPrompt = (opts.userPrompt != null) ? asString(opts.userPrompt).trim() : '';
      const resultBase = {
        ok: false,
        reason: '',
        detail: '',
        arrangementOutcome: null,
        summary: null,
        llmDebug: null,
        promptTrace: null,
        rawPatch: null,
      };

      if (goal !== 'add_accompaniment_v0'){
        return Object.assign({}, resultBase, {
          reason: 'unsupported_goal',
          detail: 'supported goal: add_accompaniment_v0',
        });
      }

      const projectV2 = hooks.getProjectV2();
      if (!projectV2 || typeof projectV2 !== 'object'){
        return Object.assign({}, resultBase, { reason: 'project_missing' });
      }

      const selectedClipId = safeTrim(hooks.getSelectedClipId());
      if (!selectedClipId){
        return Object.assign({}, resultBase, { reason: 'selected_clip_missing' });
      }
      const selectedInstanceId = safeTrim(hooks.getSelectedInstanceId());
      if (!selectedInstanceId){
        return Object.assign({}, resultBase, { reason: 'selected_instance_missing' });
      }

      const clips = getClipMap(projectV2);
      const selectedClip = clips[selectedClipId] || null;
      if (!selectedClip){
        return Object.assign({}, resultBase, { reason: 'selected_clip_not_found', detail: selectedClipId });
      }
      if (clipKind(H2SProject, selectedClip) === 'audio'){
        return Object.assign({}, resultBase, { reason: 'audio_clip_not_supported' });
      }
      const selectedScore = selectedClip.score || {};
      if (!Array.isArray(selectedScore.tracks) || countNotes(selectedScore) < 1){
        return Object.assign({}, resultBase, { reason: 'selected_clip_not_editable_note_clip' });
      }

      const selectedInstance = (Array.isArray(projectV2.instances) ? projectV2.instances : []).find(function(inst){
        return inst && safeTrim(inst.id) === selectedInstanceId;
      }) || null;
      if (!selectedInstance){
        return Object.assign({}, resultBase, { reason: 'selected_instance_not_found', detail: selectedInstanceId });
      }

      if (!ArrangementPatch || typeof ArrangementPatch.validateArrangementPatchV0 !== 'function' || typeof ArrangementPatch.applyArrangementPatchV0ToProject !== 'function'){
        return Object.assign({}, resultBase, { reason: 'arrangement_patch_module_missing' });
      }

      const cfgApi = ROOT.H2S_LLM_CONFIG;
      const cfg = (cfgApi && typeof cfgApi.loadLlmConfig === 'function') ? cfgApi.loadLlmConfig() : null;
      if (!cfg || !safeTrim(cfg.baseUrl) || !safeTrim(cfg.model)){
        return Object.assign({}, resultBase, { reason: 'llm_config_missing' });
      }
      const llmClient = ROOT.H2S_LLM_CLIENT;
      if (!llmClient || typeof llmClient.callChatCompletions !== 'function' || typeof llmClient.extractJsonObject !== 'function'){
        return Object.assign({}, resultBase, { reason: 'llm_client_not_loaded' });
      }

      const bpm = isFiniteNumber(Number(projectV2.bpm)) ? Number(projectV2.bpm) : 120;
      const selectedClipSpanBeat = (selectedClip.meta && isFiniteNumber(Number(selectedClip.meta.spanBeat)))
        ? Number(selectedClip.meta.spanBeat)
        : 0;
      const timeSignature = safeTrim(selectedScore.time_signature || null) || null;
      const promptBuilt = buildPromptContext({
        goal: goal,
        userPrompt: userPrompt,
        projectV2: projectV2,
        selectedClipId: selectedClipId,
        selectedClip: selectedClip,
        selectedClipSpanBeat: selectedClipSpanBeat,
        selectedInstanceStartBeat: Number(selectedInstance.startBeat || 0),
        timeSignature: timeSignature,
        bpm: bpm,
      });
      const messages = [
        { role: 'system', content: promptBuilt.systemPrompt },
        { role: 'user', content: promptBuilt.userPrompt },
      ];
      const promptTrace = {
        systemPrompt: promptBuilt.systemPrompt,
        userPrompt: promptBuilt.userPrompt,
      };

      let rawText = '';
      let parsedPatch = null;
      statusLog('arrangement_v0: llm_request_started', { goal: goal });
      try {
        const llmRes = await llmClient.callChatCompletions(cfg, messages, { temperature: 0.2, timeoutMs: 20000 });
        rawText = (llmRes && typeof llmRes.text === 'string') ? llmRes.text : '';
        parsedPatch = llmClient.extractJsonObject(rawText);
      } catch (err){
        return Object.assign({}, resultBase, {
          reason: 'llm_request_failed',
          detail: (err && err.message) ? String(err.message) : 'llm_request_failed',
          llmDebug: {
            callCount: 1,
            model: safeTrim(cfg.model),
            baseUrl: safeTrim(cfg.baseUrl),
          },
          promptTrace: promptTrace,
        });
      }

      if (!parsedPatch || typeof parsedPatch !== 'object'){
        return Object.assign({}, resultBase, {
          reason: 'llm_no_valid_json',
          detail: 'no_json_object_extracted',
          llmDebug: { callCount: 1, model: safeTrim(cfg.model), baseUrl: safeTrim(cfg.baseUrl), outputChars: rawText.length },
          promptTrace: promptTrace,
        });
      }

      const patch = parsedPatch;
      const validation = ArrangementPatch.validateArrangementPatchV0(projectV2, patch, { H2SProject: H2SProject });
      if (!validation || !validation.ok){
        return Object.assign({}, resultBase, {
          reason: 'patch_validation_failed',
          detail: (validation && Array.isArray(validation.errors)) ? validation.errors.slice(0, 10).join('; ') : 'validation_failed',
          arrangementOutcome: validation || null,
          llmDebug: { callCount: 1, model: safeTrim(cfg.model), baseUrl: safeTrim(cfg.baseUrl), outputChars: rawText.length },
          promptTrace: promptTrace,
          rawPatch: patch,
        });
      }

      const applied = ArrangementPatch.applyArrangementPatchV0ToProject(projectV2, patch, { H2SProject: H2SProject });
      if (!applied || !applied.ok || !applied.project){
        return Object.assign({}, resultBase, {
          reason: 'patch_apply_failed',
          detail: (applied && Array.isArray(applied.errors)) ? applied.errors.slice(0, 10).join('; ') : 'apply_failed',
          arrangementOutcome: applied || null,
          llmDebug: { callCount: 1, model: safeTrim(cfg.model), baseUrl: safeTrim(cfg.baseUrl), outputChars: rawText.length },
          promptTrace: promptTrace,
          rawPatch: patch,
        });
      }

      hooks.setProjectFromV2(applied.project);
      const s = applied.summary || {};
      const summary = {
        createdTrackIds: Array.isArray(s.createdTrackIds) ? s.createdTrackIds.slice() : [],
        createdClipIds: Array.isArray(s.createdClipIds) ? s.createdClipIds.slice() : [],
        createdInstanceIds: Array.isArray(s.createdInstanceIds) ? s.createdInstanceIds.slice() : [],
        totalNotes: Number(s.totalNotes || 0),
      };
      statusLog('arrangement_v0: applied', summary);
      return {
        ok: true,
        reason: 'ok',
        detail: '',
        arrangementOutcome: applied,
        summary: summary,
        llmDebug: {
          callCount: 1,
          model: safeTrim(cfg.model),
          baseUrl: safeTrim(cfg.baseUrl),
          outputChars: rawText.length,
        },
        promptTrace: promptTrace,
        rawPatch: patch,
      };
    }

    return {
      runArrangementV0: runArrangementV0,
    };
  }

  const API = { create: create };
  ROOT.H2SArrangementController = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
