/* Hum2Song Studio MVP - app.js (v8)
   - Fix hit-testing: note interactions have priority over cursor click
   - Add "Insert Note" workflow based on selected grid cell
   - Keep Cancel semantics (draft score)
*/
(function(){
  'use strict';

  const API = {
    /** @param {string} fmt */
    generate: (fmt) => {
      const q = new URLSearchParams();
      q.set('output_format', fmt || 'mp3');
      return `/generate?${q.toString()}`;
    },
    task: (id) => `/tasks/${encodeURIComponent(id)}`,
    score: (id) => `/tasks/${encodeURIComponent(id)}/score`,
  };
  const LS_KEY_V1 = 'hum2song_studio_project_v1';
  /** Legacy flat slot; migrated once to per-project storage. */
  const LS_KEY_LEGACY_V2 = 'hum2song_studio_project_v2';
  const LS_KEY_CURRENT_PROJECT_ID = 'hum2song_studio_current_project_id';
  const LS_KEY_PROJECTS_INDEX = 'hum2song_studio_projects_index';
  const LS_KEY_PROJECT_DATA_PREFIX = 'hum2song_studio_project_data_';
  const LS_KEY_OPT_OPTIONS = 'hum2song_studio_opt_options_by_clip'; // PR-5f: persist per-clip optimize preset across refresh
  const LS_KEY_LOG_OPEN = 'hum2song_studio_log_open'; // PR-UX3a: persist log drawer open/closed
  const LS_KEY_AI_DRAWER_OPEN = 'hum2song_studio_ai_drawer_open'; // PR-UX4c: persist AI Settings drawer open/closed
  const LS_KEY_AI_ASSIST_OPEN = 'hum2song_studio_ai_assist_open'; // PR-UX7a: persist AI Assistant dock open/closed
  const LS_KEY_SKIP_PROJECT_HOME_AUTO = 'hum2song_studio_skip_project_home_auto'; // Project Home MVP: skip auto-open on load after first Continue
  /** Dev-only: set localStorage to '1' to run transcription scores through heuristic pitch-bucket multi-track split before clip creation. */
  const LS_KEY_DEV_TRANSCRIPTION_PITCH_SPLIT = 'hum2song_studio_dev_transcription_pitch_split';
  /** Dev-only: set localStorage to '1' to segment each exploded track (after trim) into shorter clips by gap + max duration. */
  const LS_KEY_DEV_TRANSCRIPTION_EXPLODE_SEGMENT = 'hum2song_studio_dev_transcription_explode_segment';
  /** Dev-only: set localStorage to '1' to segment the full score on bar boundaries before explode (disables per-track gap/max segmentation for that import). */
  const LS_KEY_DEV_TRANSCRIPTION_BAR_SEGMENT = 'hum2song_studio_dev_transcription_bar_segment';
  /** Dev-only: set localStorage to '1' to log [H2S perf] timings (import explode, persist, render; editor modalDraw phase object). */
  const LS_KEY_DEV_PERF_TIMING = 'hum2song_studio_dev_perf_timing';
  function _devPerfTimingEnabled(){
    try{
      return typeof localStorage !== 'undefined' && String(localStorage.getItem(LS_KEY_DEV_PERF_TIMING) || '') === '1';
    }catch(e){ return false; }
  }

  /** Transcription import: skip auto-opening the editor when result exceeds these (notes or span in seconds). */
  const IMPORT_AUTO_OPEN_MAX_NOTES = 2000;
  const IMPORT_AUTO_OPEN_MAX_SPAN_SEC = 180;
  function _importTooLargeForAutoOpen(clip){
    if (!clip || !clip.meta) return false;
    const n = typeof clip.meta.notes === 'number' ? clip.meta.notes : 0;
    const span = (typeof clip.meta.spanSec === 'number' && isFinite(clip.meta.spanSec)) ? clip.meta.spanSec : 0;
    return n > IMPORT_AUTO_OPEN_MAX_NOTES || span > IMPORT_AUTO_OPEN_MAX_SPAN_SEC;
  }

  const LS_KEYS_INSP = {
    project: 'hum2song_studio_insp_project_open',
    export: 'hum2song_studio_insp_export_open',
    opt: 'hum2song_studio_insp_opt_open',
    opt_adv: 'hum2song_studio_insp_opt_adv_open',
    opt_results: 'hum2song_studio_insp_opt_results_open',
    history: 'hum2song_studio_insp_history_open',
  };
  function getInspectorSectionOpen(key){
    try{
      const k = LS_KEYS_INSP[key];
      if (!k) return false;
      const v = localStorage.getItem(k);
      if (v === null && key === 'opt') return true; // Optimize open by default (primary action area)
      return v === '1';
    }catch(e){ return false; }
  }
  function setInspectorSectionOpen(key, open){
    try{
      const k = LS_KEYS_INSP[key];
      if (k) localStorage.setItem(k, open ? '1' : '0');
    }catch(e){}
  }

  // PR-UX2 / INFRA-1a: Inspector Optimize templates — derived from shared registry
  const INSPECTOR_TEMPLATES = (typeof window !== 'undefined' && window.H2S_OPTIMIZE_TEMPLATES_V1_MAP) ? window.H2S_OPTIMIZE_TEMPLATES_V1_MAP : {};

  /** UX7b: Keyword-based mapping from natural-language text to template/intent. Returns null fields if no match. */
  function _mapAiAssistTextToTemplate(text){
    if (!text || typeof text !== 'string') return { templateId: null, templateLabel: '', intent: null };
    const t = String(text).toLowerCase().trim();
    const rules = [
      { id: 'bluesy_v1', keywords: ['blues', 'bluesy', 'more blues', '蓝调'] },
      { id: 'fix_pitch_v1', keywords: ['pitch', 'out of tune', 'off pitch', '跑调', '音准', '音不准'] },
      { id: 'tighten_rhythm_v1', keywords: ['rhythm', 'tighter rhythm', 'timing', 'more steady', '节奏', '更稳', '紧一点'] },
      { id: 'clean_outliers_v1', keywords: ['outlier', 'weird notes', 'stray notes', 'noisy notes', '杂音', '异常音', '怪音'] },
    ];
    for (const r of rules){
      for (const kw of r.keywords){
        if (t.indexOf(kw) >= 0){
          const tm = INSPECTOR_TEMPLATES[r.id];
          if (tm){
            const intent = tm.intent && typeof tm.intent === 'object'
              ? { fixPitch: !!tm.intent.fixPitch, tightenRhythm: !!tm.intent.tightenRhythm, reduceOutliers: !!tm.intent.reduceOutliers }
              : null;
            return { templateId: r.id, templateLabel: tm.label || r.id, intent };
          }
        }
      }
    }
    return { templateId: null, templateLabel: '', intent: null };
  }

  /**
   * Narrow Assistant command: add track (matches `runCommand('add_track')` only).
   * Keep in sync with scripts/tests/ai_assist_dock.test.js `resolveAssistantAddTrackIntentFromText`.
   */
  function _resolveAssistantAddTrackIntentFromText(text){
    if (!text || typeof text !== 'string') return false;
    let s = String(text).toLowerCase().trim();
    s = s.replace(/^please\s+/, '');
    s = s.replace(/[.!?]+$/g, '').trim();
    const phrases = [
      'add a track',
      'add track',
      'create a new track',
      'create new track',
      'new track',
    ];
    return phrases.indexOf(s) >= 0;
  }

  /**
   * Narrow Assistant command: move selected timeline instance horizontally by beat delta.
   * Returns { direction: 'left'|'right', deltaBeats: number } or null.
   * Keep in sync with scripts/tests/ai_assist_dock.test.js `resolveAssistantMoveInstanceIntentFromText`.
   */
  function _resolveAssistantMoveInstanceIntentFromText(text){
    if (!text || typeof text !== 'string') return null;
    let s = String(text).toLowerCase().trim();
    s = s.replace(/^please\s+/, '');
    s = s.replace(/\s+please\s*$/g, '').trim();
    s = s.replace(/[.!?]+$/g, '').trim();
    const re = /^move\s+(?:this|(?:the\s+)?selected\s+instance|(?:the\s+)?selected\s+block)\s+(left|right)\s+(\d+(?:\.\d+)?)\s*(?:beat|beats)?$/;
    const m = s.match(re);
    if (!m) return null;
    const dir = m[1];
    const num = Number(m[2]);
    if (!isFinite(num) || num <= 0) return null;
    const MAX_DELTA = 64;
    if (num > MAX_DELTA) return null;
    return { direction: (dir === 'left') ? 'left' : 'right', deltaBeats: num };
  }

  /**
   * Narrow Assistant command: remove selected timeline instance (matches `runCommand('remove_instance')` only).
   * Keep in sync with scripts/tests/ai_assist_dock.test.js `resolveAssistantRemoveInstanceIntentFromText`.
   */
  function _resolveAssistantRemoveInstanceIntentFromText(text){
    if (!text || typeof text !== 'string') return false;
    let s = String(text).toLowerCase().trim();
    s = s.replace(/^please\s+/, '');
    s = s.replace(/\s+please\s*$/g, '').trim();
    s = s.replace(/[.!?]+$/g, '').trim();
    const phrases = [
      'remove this',
      'delete this',
      'remove selected instance',
      'delete selected instance',
      'remove selected block',
      'delete selected block',
    ];
    return phrases.indexOf(s) >= 0;
  }

  /** Map Assistant planKind (AI or rule) to execution template + intent. Does not include "generic". */
  function _templateExecutionFieldsFromPlanKind(planKind){
    if (planKind == null || typeof planKind !== 'string') return null;
    const k = String(planKind).trim().toLowerCase();
    if (k === 'generic' || k === '') return null;
    const idByKind = {
      'clean-outliers': 'clean_outliers_v1',
      'fix-pitch': 'fix_pitch_v1',
      'tighten-rhythm': 'tighten_rhythm_v1',
      'bluesy': 'bluesy_v1',
    };
    const templateId = idByKind[k];
    if (!templateId) return null;
    const tm = INSPECTOR_TEMPLATES[templateId];
    if (!tm) return null;
    const intent = tm.intent && typeof tm.intent === 'object'
      ? { fixPitch: !!tm.intent.fixPitch, tightenRhythm: !!tm.intent.tightenRhythm, reduceOutliers: !!tm.intent.reduceOutliers }
      : null;
    if (!intent) return null;
    return { templateId: templateId, templateLabel: (tm.label != null && String(tm.label).trim()) ? String(tm.label).trim() : templateId, intent: intent };
  }

  /** When keyword mapping missed but planKind is task-specific, backfill card template for optimize execution. */
  function _syncAssistantCardTemplateFromPlan(card){
    if (!card || typeof card !== 'object') return;
    const plan = card.plan;
    if (!plan || typeof plan !== 'object') return;
    const pk = (plan.planKind != null && String(plan.planKind).trim()) ? String(plan.planKind).trim() : '';
    if (!pk) return;
    const fields = _templateExecutionFieldsFromPlanKind(plan.planKind);
    if (!fields || !fields.templateId || !fields.intent) return;
    if (card.templateId != null && String(card.templateId).trim() !== '') return;
    card.templateId = fields.templateId;
    card.templateLabel = fields.templateLabel;
    card.intent = fields.intent;
    if (card.reasoningLog && typeof card.reasoningLog === 'object'){
      card.reasoningLog.templateId = fields.templateId;
      card.reasoningLog.intent = { fixPitch: !!fields.intent.fixPitch, tightenRhythm: !!fields.intent.tightenRhythm, reduceOutliers: !!fields.intent.reduceOutliers };
    }
  }

  /** Normalize card.plan for optimize options (same shape as setOptimizeOptions / agent). */
  function _normalizeAssistantPlanForExecution(plan){
    if (!plan || typeof plan !== 'object') return null;
    if (!Array.isArray(plan.planLines) || plan.planLines.length < 1) return null;
    if (!plan.planTitle && !plan.planKind) return null;
    const lines = plan.planLines.slice(0, 6).map(function(l){
      return (typeof l === 'string') ? l : (l != null ? String(l) : '');
    }).filter(function(l){ return typeof l === 'string' && l.trim(); });
    if (lines.length < 1) return null;
    return {
      planKind: plan.planKind || null,
      planTitle: (plan.planTitle != null && String(plan.planTitle).trim()) ? String(plan.planTitle).trim() : '',
      planLines: lines,
    };
  }

  /**
   * Phase-1 Assistant deterministic NL routing. Tries H2SPhase1AssistantNarrow first; if the
   * bundle is missing, incomplete, or throws, falls back to inline on the API object or a minimal
   * duplicate (keep in sync with phase1_assistant_narrow.resolvePhase1AssistantIntentFromTextInline).
   */
  function _resolvePhase1AssistantIntentForSend(text){
    const root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (!root || text == null || typeof text !== 'string') return null;
    const api = root.H2SPhase1AssistantNarrow;
    if (api && typeof api.resolvePhase1AssistantIntentFromText === 'function'){
      try {
        return api.resolvePhase1AssistantIntentFromText(text);
      } catch (_e) { /* fall through */ }
    }
    if (api && typeof api.resolvePhase1AssistantIntentFromTextInline === 'function'){
      try {
        return api.resolvePhase1AssistantIntentFromTextInline(root, text);
      } catch (_e) { /* fall through */ }
    }
    return _resolvePhase1AssistantIntentAppFallback(root, text);
  }

  function _resolvePhase1AssistantIntentAppFallback(root, text){
    const R = root.H2SRhythmTightenLoosen;
    if (R && typeof R.narrowRhythmIntentFromText === 'function'){
      const n = R.narrowRhythmIntentFromText(text);
      if (n && n.mode) return { branch: 'rhythm_tighten_loosen', intent: n };
    }
    const LT = root.H2SLocalTranspose;
    if (LT && typeof LT.narrowLocalTransposeIntentFromText === 'function'){
      const n = LT.narrowLocalTransposeIntentFromText(text);
      if (n && isFinite(Number(n.semitone_delta))) return { branch: 'local_transpose', intent: n };
    }
    const VS = root.H2SVelocityShape;
    if (VS && typeof VS.narrowVelocityShapeIntentFromText === 'function'){
      const n = VS.narrowVelocityShapeIntentFromText(text);
      if (n && n.mode) return { branch: 'velocity_shape', intent: n };
    }
    return null;
  }

  /**
   * Single authoritative snapshot for one Assistant Run (after _syncAssistantCardTemplateFromPlan).
   * Used for setOptimizeOptions, reasoningLog at run start, and executionTrace (not later card mutations).
   */
  function _buildAssistantRunExecutionSnapshot(card){
    if (card && card.rhythmIntent && typeof card.rhythmIntent === 'object' && card.rhythmIntent.mode){
      const usedPlan = _normalizeAssistantPlanForExecution(card && card.plan && typeof card.plan === 'object' ? card.plan : null);
      return {
        usedRequestedPresetId: 'rhythm_tighten_loosen',
        usedPlan: usedPlan,
        usedTemplateId: null,
        usedIntent: null,
        rhythmIntent: {
          capability_id: String(card.rhythmIntent.capability_id || 'rhythm_tighten_loosen'),
          mode: String(card.rhythmIntent.mode),
          strength: card.rhythmIntent.strength ? String(card.rhythmIntent.strength) : 'medium',
        },
      };
    }
    if (card && card.localTransposeIntent && typeof card.localTransposeIntent === 'object' && isFinite(Number(card.localTransposeIntent.semitone_delta))){
      const usedPlan = _normalizeAssistantPlanForExecution(card && card.plan && typeof card.plan === 'object' ? card.plan : null);
      return {
        usedRequestedPresetId: 'local_transpose',
        usedPlan: usedPlan,
        usedTemplateId: null,
        usedIntent: null,
        localTransposeIntent: {
          capability_id: String(card.localTransposeIntent.capability_id || 'local_transpose'),
          semitone_delta: Math.round(Number(card.localTransposeIntent.semitone_delta)),
        },
      };
    }
    if (card && card.velocityShapeIntent && typeof card.velocityShapeIntent === 'object' && card.velocityShapeIntent.mode){
      const usedPlan = _normalizeAssistantPlanForExecution(card && card.plan && typeof card.plan === 'object' ? card.plan : null);
      return {
        usedRequestedPresetId: 'velocity_shape',
        usedPlan: usedPlan,
        usedTemplateId: null,
        usedIntent: null,
        velocityShapeIntent: {
          capability_id: String(card.velocityShapeIntent.capability_id || 'velocity_shape'),
          mode: String(card.velocityShapeIntent.mode),
          strength: card.velocityShapeIntent.strength ? String(card.velocityShapeIntent.strength) : 'medium',
        },
      };
    }
    const usedRequestedPresetId = 'llm_v0';
    const usedPlan = _normalizeAssistantPlanForExecution(card && card.plan && typeof card.plan === 'object' ? card.plan : null);
    let usedTemplateId = (card && card.templateId != null && String(card.templateId).trim()) ? String(card.templateId).trim() : null;
    let usedIntent = null;
    if (card && card.intent && typeof card.intent === 'object'){
      usedIntent = {
        fixPitch: !!card.intent.fixPitch,
        tightenRhythm: !!card.intent.tightenRhythm,
        reduceOutliers: !!card.intent.reduceOutliers,
      };
    }
    if (!usedTemplateId || !usedIntent){
      usedTemplateId = null;
      usedIntent = null;
    }
    return {
      usedRequestedPresetId: usedRequestedPresetId,
      usedPlan: usedPlan,
      usedTemplateId: usedTemplateId,
      usedIntent: usedIntent,
    };
  }

  /** PR1: Attempt AI-generated plan. Returns Promise<plan|null>. Falls back to rule-based on any failure. */
  function _tryGenerateAiPlan(promptText, templateId, intent){
    const ROOT = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : {});
    const client = ROOT.H2S_LLM_CLIENT;
    const configApi = ROOT.H2S_LLM_CONFIG;
    if (!client || typeof client.callChatCompletions !== 'function' || typeof client.extractJsonObject !== 'function') return Promise.resolve(null);
    if (!configApi || typeof configApi.loadLlmConfig !== 'function') return Promise.resolve(null);
    let cfg;
    try { cfg = configApi.loadLlmConfig(); } catch (_) { return Promise.resolve(null); }
    if (!cfg || typeof cfg.baseUrl !== 'string' || !cfg.baseUrl.trim() || typeof cfg.model !== 'string' || !cfg.model.trim()) return Promise.resolve(null);

    const systemMsg = 'You are a music optimization assistant. Reply with ONLY a JSON object, no other text. Schema: { "planKind": "fix-pitch"|"tighten-rhythm"|"clean-outliers"|"bluesy"|"generic", "planTitle": "short title", "planLines": ["Goal: ...", "Strategy: ...", "Note: ..."] }. planLines must have 2-4 strings. Output valid JSON only.';
    const hint = templateId ? ' Detected template: ' + String(templateId) + '.' : '';
    const userMsg = 'User request: ' + (typeof promptText === 'string' ? promptText.slice(0, 200) : '') + hint + '\n\nOutput the plan JSON object only.';

    return client.callChatCompletions(cfg, [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }], { temperature: 0.2, timeoutMs: 8000 })
      .then(function(res){
        const text = (res && typeof res.text === 'string') ? res.text : '';
        const obj = client.extractJsonObject(text);
        if (!obj || typeof obj !== 'object') return null;
        const kind = (obj.planKind != null && String(obj.planKind).trim()) ? String(obj.planKind).trim() : null;
        const title = (obj.planTitle != null && String(obj.planTitle).trim()) ? String(obj.planTitle).trim() : null;
        const lines = Array.isArray(obj.planLines) ? obj.planLines.filter(function(l){ return typeof l === 'string' && l.trim(); }) : [];
        if (!kind || !title || lines.length < 2) return null;
        return {
          planKind: kind,
          planTitle: title,
          planLines: lines.slice(0, 6),
          templateId: templateId || null,
          intent: intent && typeof intent === 'object' ? { fixPitch: !!intent.fixPitch, tightenRhythm: !!intent.tightenRhythm, reduceOutliers: !!intent.reduceOutliers } : null,
        };
      })
      .catch(function(){ return null; });
  }

  /** PR2: Enrich reasoning log with execution/result metadata from Run. */
  function _enrichReasoningLogFromRun(log, patchSummary, accepted, runState, resultKind, rejectionReason){
    if (!log || typeof log !== 'object') return;
    log.runState = runState;
    log.resultKind = resultKind != null ? resultKind : null;
    log.accepted = !!accepted;
    if (rejectionReason != null && String(rejectionReason).trim()) log.rejectionReason = String(rejectionReason).trim().slice(0, 120);
    else log.rejectionReason = null;
    if (patchSummary && typeof patchSummary === 'object') {
      log.executedPreset = (patchSummary.executedPreset != null && String(patchSummary.executedPreset).trim()) ? String(patchSummary.executedPreset).trim() : null;
      log.executedSource = (patchSummary.executedSource != null && String(patchSummary.executedSource).trim()) ? String(patchSummary.executedSource).trim() : null;
      log.promptVersion = (patchSummary.promptMeta && patchSummary.promptMeta.promptVersion != null && String(patchSummary.promptMeta.promptVersion).trim()) ? String(patchSummary.promptMeta.promptVersion).trim() : null;
      log.patchSummary = { ops: typeof patchSummary.ops === 'number' ? patchSummary.ops : null, status: (patchSummary.status != null && String(patchSummary.status).trim()) ? String(patchSummary.status).trim() : null, reason: (patchSummary.reason != null && String(patchSummary.reason).trim()) ? String(patchSummary.reason).trim().slice(0, 80) : null };
    } else {
      log.executedPreset = null;
      log.executedSource = null;
      log.promptVersion = null;
      log.patchSummary = null;
    }
  }

  /** Debug PR3: whitelist final LLM prompt trace (prompt text only; no headers/cfg/secrets). */
  function _sanitizeLlmPromptTraceForAssistantTrace(raw){
    if (!raw || typeof raw !== 'object') return null;
    const MAX = 24000;
    function trunc(s){
      if (typeof s !== 'string') return '';
      return s.length > MAX ? s.slice(0, MAX) + '\n...[truncated]...' : s;
    }
    const out = {};
    if (raw.attemptIndex != null && isFinite(Number(raw.attemptIndex))) out.attemptIndex = Number(raw.attemptIndex);
    if (typeof raw.finalSystemPrompt === 'string') out.finalSystemPrompt = trunc(raw.finalSystemPrompt);
    if (typeof raw.finalUserPrompt === 'string') out.finalUserPrompt = trunc(raw.finalUserPrompt);
    if (raw.blocks && typeof raw.blocks === 'object'){
      const b = raw.blocks;
      const bo = {};
      if (b.resolvedTemplateId != null && String(b.resolvedTemplateId).trim()) bo.resolvedTemplateId = String(b.resolvedTemplateId).trim().slice(0, 80);
      else bo.resolvedTemplateId = null;
      if (b.resolvedIntent && typeof b.resolvedIntent === 'object'){
        bo.resolvedIntent = {
          fixPitch: !!b.resolvedIntent.fixPitch,
          tightenRhythm: !!b.resolvedIntent.tightenRhythm,
          reduceOutliers: !!b.resolvedIntent.reduceOutliers,
        };
      }
      if (b.promptVersion != null && String(b.promptVersion).trim()) bo.promptVersion = String(b.promptVersion).trim().slice(0, 80);
      if (typeof b.planBlock === 'string') bo.planBlock = trunc(b.planBlock);
      if (typeof b.directivesBlock === 'string') bo.directivesBlock = trunc(b.directivesBlock);
      if (typeof b.userBody === 'string') bo.userBody = trunc(b.userBody);
      out.blocks = bo;
    }
    if (!out.finalSystemPrompt && !out.finalUserPrompt && !out.blocks) return null;
    return out;
  }

  /** Debug PR1: safe subset of llmDebug for Assistant card executionTrace (no raw model text, no secrets). */
  function _sanitizeLlmDebugForAssistantTrace(llmDebug){
    if (!llmDebug || typeof llmDebug !== 'object') return null;
    const out = {};
    if (llmDebug.attemptCount != null && isFinite(Number(llmDebug.attemptCount))) out.attemptCount = Number(llmDebug.attemptCount);
    if (llmDebug.totalAttempts != null && isFinite(Number(llmDebug.totalAttempts))) out.totalAttempts = Number(llmDebug.totalAttempts);
    if (llmDebug.finalAttemptIndex != null && isFinite(Number(llmDebug.finalAttemptIndex))) out.finalAttemptIndex = Number(llmDebug.finalAttemptIndex);
    if (llmDebug.preRequestExit === true) out.preRequestExit = true;
    if (typeof llmDebug.safeModeResolved === 'boolean') out.safeModeResolved = llmDebug.safeModeResolved;
    if (llmDebug.reason != null && typeof llmDebug.reason === 'string') out.reason = llmDebug.reason.slice(0, 120);
    if (Array.isArray(llmDebug.errors) && llmDebug.errors.length){
      const joined = llmDebug.errors.slice(0, 3).map(function(e){ return String(e).slice(0, 80); }).join(' | ');
      out.errorSummary = joined.length > 200 ? joined.slice(0, 197) + '...' : joined;
    }
    if (Array.isArray(llmDebug.attemptSummaries) && llmDebug.attemptSummaries.length){
      out.attemptSummaries = llmDebug.attemptSummaries.slice(0, 4).map(function(row){
        if (!row || typeof row !== 'object') return { attemptIndex: null, reason: '', outcome: null };
        return {
          attemptIndex: (row.attemptIndex != null && isFinite(Number(row.attemptIndex))) ? Number(row.attemptIndex) : null,
          reason: (row.reason != null && typeof row.reason === 'string') ? row.reason.slice(0, 120) : '',
          outcome: (row.outcome != null && typeof row.outcome === 'string') ? row.outcome.slice(0, 48) : null,
        };
      });
    }
    return Object.keys(out).length ? out : null;
  }

  function _compactPatchSummaryForExecutionTrace(ps){
    if (!ps || typeof ps !== 'object') return null;
    const out = {};
    if (typeof ps.ops === 'number' && isFinite(ps.ops)) out.ops = ps.ops;
    if (ps.status != null && String(ps.status).trim()) out.status = String(ps.status).trim().slice(0, 40);
    if (ps.reason != null && String(ps.reason).trim()) out.reason = String(ps.reason).trim().slice(0, 80);
    if (ps.noChanges === true) out.noChanges = true;
    return Object.keys(out).length ? out : null;
  }

  /** Debug PR1: structured trace for one Assistant Run (optimizeResult + run snapshot or card context). */
  function _buildAiAssistExecutionTrace(card, optRes, runSnapshot){
    const trace = {};
    const rl = card && card.reasoningLog && typeof card.reasoningLog === 'object' ? card.reasoningLog : null;
    try {
      if (optRes && typeof optRes === 'object' && optRes.executionPath != null && String(optRes.executionPath).trim() !== ''){
        trace.executionPath = String(optRes.executionPath).trim();
      }
      if (runSnapshot && typeof runSnapshot === 'object'){
        if (runSnapshot.usedTemplateId != null && String(runSnapshot.usedTemplateId).trim() !== ''){
          trace.templateId = String(runSnapshot.usedTemplateId).trim();
        }
        if (runSnapshot.usedIntent && typeof runSnapshot.usedIntent === 'object'){
          trace.intent = {
            fixPitch: !!runSnapshot.usedIntent.fixPitch,
            tightenRhythm: !!runSnapshot.usedIntent.tightenRhythm,
            reduceOutliers: !!runSnapshot.usedIntent.reduceOutliers,
          };
        }
        if (runSnapshot.usedRequestedPresetId != null) trace.requestedPresetId = runSnapshot.usedRequestedPresetId;
        if (runSnapshot.usedPlan && runSnapshot.usedPlan.planTitle){
          trace.planSummary = String(runSnapshot.usedPlan.planTitle).slice(0, 200);
        }
        trace.executionSnapshot = {
          usedPlan: runSnapshot.usedPlan,
          usedTemplateId: runSnapshot.usedTemplateId,
          usedIntent: runSnapshot.usedIntent ? {
            fixPitch: !!runSnapshot.usedIntent.fixPitch,
            tightenRhythm: !!runSnapshot.usedIntent.tightenRhythm,
            reduceOutliers: !!runSnapshot.usedIntent.reduceOutliers,
          } : null,
          usedRequestedPresetId: runSnapshot.usedRequestedPresetId,
        };
      } else {
        if (card && card.templateId != null && String(card.templateId).trim() !== '') trace.templateId = String(card.templateId).trim();
        if (card && card.intent && typeof card.intent === 'object'){
          trace.intent = { fixPitch: !!card.intent.fixPitch, tightenRhythm: !!card.intent.tightenRhythm, reduceOutliers: !!card.intent.reduceOutliers };
        }
        if (rl && rl.planSummary != null) trace.planSummary = String(rl.planSummary).slice(0, 200);
        if (rl && rl.requestedPresetId != null) trace.requestedPresetId = rl.requestedPresetId;
      }
      if (!trace.planSummary && rl && rl.planSummary != null) trace.planSummary = String(rl.planSummary).slice(0, 200);
      if (!trace.requestedPresetId && rl && rl.requestedPresetId != null) trace.requestedPresetId = rl.requestedPresetId;
      const ps = (optRes && optRes.patchSummary && typeof optRes.patchSummary === 'object') ? optRes.patchSummary : null;
      if (ps){
        if (ps.executedPreset != null) trace.executedPreset = String(ps.executedPreset).trim();
        if (ps.executedSource != null) trace.executedSource = String(ps.executedSource).trim();
        if (ps.promptMeta && ps.promptMeta.promptVersion != null) trace.promptVersion = String(ps.promptMeta.promptVersion).trim();
      }
      if (!trace.promptVersion && rl && rl.promptVersion != null && String(rl.promptVersion).trim() !== ''){
        trace.promptVersion = String(rl.promptVersion).trim();
      }
      trace.patchSummary = _compactPatchSummaryForExecutionTrace(ps);
      if (rl && typeof rl.accepted === 'boolean') trace.accepted = rl.accepted;
      if (rl && rl.runState != null && String(rl.runState).trim() !== '') trace.runState = String(rl.runState).trim();
      if (rl && rl.resultKind != null) trace.resultKind = rl.resultKind;
      if (rl && rl.rejectionReason != null && String(rl.rejectionReason).trim()) trace.rejectionReason = String(rl.rejectionReason).trim().slice(0, 120);
      if (optRes && optRes.llmDebug){
        const s = _sanitizeLlmDebugForAssistantTrace(optRes.llmDebug);
        if (s) trace.llmDebugSummary = s;
      }
      if (optRes && optRes.executionPath === 'llm' && optRes.llmPromptTrace){
        const pt = _sanitizeLlmPromptTraceForAssistantTrace(optRes.llmPromptTrace);
        if (pt) trace.llmPromptTrace = pt;
      }
    } catch (_e) { /* keep partial trace */ }
    return trace;
  }

  /** Debug PR2: compact safe HTML for Assistant card trace panel (whitelist only; no raw LLM / secrets). */
  function _buildAiAssistDebugHtml(it, escapeHtml){
    if (!_dbgEnabled()) return '';
    const rl = it && it.reasoningLog && typeof it.reasoningLog === 'object' ? it.reasoningLog : null;
    const et = it && it.executionTrace && typeof it.executionTrace === 'object' ? it.executionTrace : null;
    if (!rl && !et) return '';
    const merged = {};
    function set(k, v){
      if (v === undefined || v === null) return;
      if (typeof v === 'boolean') merged[k] = v ? 'true' : 'false';
      else if (typeof v === 'object') merged[k] = JSON.stringify(v);
      else merged[k] = String(v);
    }
    if (rl){
      if (rl.templateId != null) set('templateId', rl.templateId);
      if (rl.intent && typeof rl.intent === 'object') set('intent', rl.intent);
      if (rl.planSource != null) set('planSource', rl.planSource);
      if (rl.planSummary != null) set('planSummary', rl.planSummary);
      if (rl.requestedPresetId != null) set('requestedPresetId', rl.requestedPresetId);
      if (rl.userPrompt != null) set('userPrompt', rl.userPrompt);
      if (rl.promptVersion != null) set('promptVersion', rl.promptVersion);
      if (rl.runState != null) set('runState', rl.runState);
      if (rl.resultKind != null) set('resultKind', rl.resultKind);
      if (typeof rl.accepted === 'boolean') set('accepted', rl.accepted);
      if (rl.rejectionReason != null) set('rejectionReason', rl.rejectionReason);
      if (rl.patchSummary && typeof rl.patchSummary === 'object'){
        if (rl.patchSummary.ops != null) set('patchSummary.ops', rl.patchSummary.ops);
        if (rl.patchSummary.status != null) set('patchSummary.status', rl.patchSummary.status);
        if (rl.patchSummary.reason != null) set('patchSummary.reason', rl.patchSummary.reason);
      }
    }
    if (et){
      if (et.executionPath != null) set('executionPath', et.executionPath);
      if (et.executedPreset != null) set('executedPreset', et.executedPreset);
      if (et.executedSource != null) set('executedSource', et.executedSource);
      if (et.promptVersion != null) set('promptVersion', et.promptVersion);
      if (et.runState != null) set('runState', et.runState);
      if (et.resultKind != null) set('resultKind', et.resultKind);
      if (typeof et.accepted === 'boolean') set('accepted', et.accepted);
      if (et.rejectionReason != null) set('rejectionReason', et.rejectionReason);
      if (et.patchSummary && typeof et.patchSummary === 'object'){
        if (et.patchSummary.ops != null) set('patchSummary.ops', et.patchSummary.ops);
        if (et.patchSummary.status != null) set('patchSummary.status', et.patchSummary.status);
        if (et.patchSummary.reason != null) set('patchSummary.reason', et.patchSummary.reason);
      }
      const lds = et.llmDebugSummary;
      if (lds && typeof lds === 'object'){
        if (lds.attemptCount != null) set('llmDebugSummary.attemptCount', lds.attemptCount);
        if (typeof lds.safeModeResolved === 'boolean') set('llmDebugSummary.safeModeResolved', lds.safeModeResolved);
        if (lds.reason != null) set('llmDebugSummary.reason', lds.reason);
        if (lds.errorSummary != null) set('llmDebugSummary.errorSummary', lds.errorSummary);
      }
    }
    const order = [
      'templateId', 'intent', 'planSource', 'planSummary', 'requestedPresetId', 'userPrompt',
      'executionPath', 'executedPreset', 'executedSource', 'promptVersion',
      'runState', 'resultKind', 'accepted', 'rejectionReason',
      'patchSummary.ops', 'patchSummary.status', 'patchSummary.reason',
      'llmDebugSummary.attemptCount', 'llmDebugSummary.safeModeResolved', 'llmDebugSummary.reason', 'llmDebugSummary.errorSummary',
    ];
    const rows = [];
    for (let i = 0; i < order.length; i++){
      const k = order[i];
      if (!Object.prototype.hasOwnProperty.call(merged, k)) continue;
      let v = merged[k];
      if (v.length > 400) v = v.slice(0, 397) + '...';
      rows.push('<div class="aiAssistDbgRow"><span class="aiAssistDbgK">' + escapeHtml(k) + '</span><span class="aiAssistDbgV">' + escapeHtml(v) + '</span></div>');
    }
    if (!rows.length && !(et && et.llmPromptTrace && typeof et.llmPromptTrace === 'object')) return '';
    let body = rows.length ? '<div class="aiAssistDbgBody">' + rows.join('') + '</div>' : '';
    const pt = et && et.llmPromptTrace && typeof et.llmPromptTrace === 'object' ? et.llmPromptTrace : null;
    if (pt){
      const blk = pt.blocks && typeof pt.blocks === 'object' ? pt.blocks : null;
      const blkObj = blk ? {
        resolvedTemplateId: blk.resolvedTemplateId,
        resolvedIntent: blk.resolvedIntent,
        promptVersion: blk.promptVersion,
        planBlock: blk.planBlock,
        directivesBlock: blk.directivesBlock,
        userBody: blk.userBody,
      } : {};
      let blkJson = '';
      try { blkJson = JSON.stringify(blkObj, null, 2); } catch (_e) { blkJson = '{}'; }
      if (blkJson.length > 32000) blkJson = blkJson.slice(0, 32000) + '\n...[truncated]...';
      const sys = typeof pt.finalSystemPrompt === 'string' ? pt.finalSystemPrompt : '';
      const usr = typeof pt.finalUserPrompt === 'string' ? pt.finalUserPrompt : '';
      const preStyle = 'white-space:pre-wrap;word-break:break-word;margin:4px 0;font-size:10px;line-height:1.35;max-height:200px;overflow:auto;';
      body += '<details class="aiAssistDbgPrompt" style="margin-top:6px;font-size:10px;"><summary style="cursor:pointer;">Final LLM prompt</summary>';
      if (pt.attemptIndex != null) body += '<div style="margin-top:4px;color:var(--muted);">attemptIndex: ' + escapeHtml(String(pt.attemptIndex)) + '</div>';
      body += '<div style="margin-top:6px;font-weight:600;">Blocks</div><pre style="' + preStyle + '">' + escapeHtml(blkJson) + '</pre>';
      body += '<div style="margin-top:6px;font-weight:600;">system</div><pre style="' + preStyle + '">' + escapeHtml(sys.length > 32000 ? sys.slice(0, 32000) + '\n...[truncated]...' : sys) + '</pre>';
      body += '<div style="margin-top:6px;font-weight:600;">user</div><pre style="' + preStyle + '">' + escapeHtml(usr.length > 32000 ? usr.slice(0, 32000) + '\n...[truncated]...' : usr) + '</pre>';
      body += '</details>';
    }
    return body;
  }

  /** Rule-based plan for Assistant card (no LLM). Returns { planTitle, planLines, planKind }. */
  function _buildAiAssistPlan(templateId, intent, promptText){
    const tid = (templateId != null && String(templateId).trim()) ? String(templateId).trim() : null;
    const plans = {
      fix_pitch_v1: {
        planTitle: 'Fix Pitch',
        planKind: 'fix-pitch',
        planLines: [
          'Goal: correct clearly out-of-tune notes.',
          'Strategy: prioritize sustained notes; keep rhythm mostly stable.',
          'Note: if the original humming is unstable, correction may be limited.',
        ],
      },
      tighten_rhythm_v1: {
        planTitle: 'Tighten Rhythm',
        planKind: 'tighten-rhythm',
        planLines: [
          'Goal: align timing to a steadier groove.',
          'Strategy: adjust note starts and durations; keep pitches unchanged.',
          'Note: small timing tweaks preserve the feel.',
        ],
      },
      clean_outliers_v1: {
        planTitle: 'Clean Outliers',
        planKind: 'clean-outliers',
        planLines: [
          'Goal: smooth extreme values and reduce stray notes.',
          'Strategy: target velocity and short outliers without rewriting melody.',
          'Note: preserves overall character while reducing noise.',
        ],
      },
      bluesy_v1: {
        planTitle: 'Bluesy',
        planKind: 'bluesy',
        planLines: [
          'Goal: add subtle blues inflection to timing and dynamics.',
          'Strategy: align to groove with blues feel; keep melody recognizable.',
          'Note: small adjustments for a more expressive result.',
        ],
      },
    };
    if (tid && plans[tid]) {
      return plans[tid];
    }
    return {
      planTitle: 'Optimize',
      planKind: 'generic',
      planLines: [
        'Goal: apply optimization based on your description.',
        'Strategy: use your prompt to guide pitch, timing, or dynamics changes.',
        'Note: results depend on the clarity of the source material.',
      ],
    };
  }

  // --- debug gate (localStorage.h2s_debug === '1') ---
  function _dbgEnabled(){
    try{
      return (typeof localStorage !== 'undefined') && (localStorage.h2s_debug === '1');
    }catch(e){
      return false;
    }
  }

  function dbg(){
    if (!_dbgEnabled()) return;
    try{ console.log.apply(console, arguments); }catch(_){ }
  }


  // --- storage is beats-only (ProjectDoc v2). UI remains v1 seconds until controllers are migrated. ---
  function _readLS(key){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e){
      console.warn('[app] Failed to parse localStorage', key, e);
      return null;
    }
  }

  function _writeLS(key, obj){
    try{
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (e){
      console.warn('[app] Failed to write localStorage', key, e);
    }
  }

  function _beatToSec(beat, bpm){
    const P = window.H2SProject;
    if (P && typeof P.beatToSec === 'function') return P.beatToSec(beat, bpm);
    return (beat * 60) / (bpm || 120);
  }

  function _scoreBeatToSec(scoreBeat, bpm){
    const P = window.H2SProject;
    if (P && typeof P.scoreBeatToSec === 'function') return P.scoreBeatToSec(scoreBeat, bpm);

    // Fallback: convert minimal beat score -> sec score (single tempo).
    const out = { version: 1, tempo_bpm: bpm || 120, time_signature: scoreBeat && scoreBeat.time_signature ? scoreBeat.time_signature : null, tracks: [] };
    if (!scoreBeat || !Array.isArray(scoreBeat.tracks)) return out;

    for (const tr of scoreBeat.tracks){
      const notes = [];
      for (const n of (tr.notes || [])){
        notes.push({
          id: n.id,
          pitch: n.pitch,
          velocity: n.velocity,
          start: _beatToSec(n.startBeat || 0, bpm || 120),
          duration: _beatToSec(n.durationBeat || 0, bpm || 120)
        });
      }
      out.tracks.push({ id: tr.id, name: tr.name, notes });
    }
    return out;
  }

  function _projectV1ToV2(p1){
    const P = window.H2SProject;
    if (P && typeof P.migrateProjectV1toV2 === 'function') return P.migrateProjectV1toV2(p1);
    return null;
  }

  function _isProjectV2(obj){
    const P = window.H2SProject;
    if (P && typeof P.isProjectV2 === 'function') return P.isProjectV2(obj);
    return !!(obj && obj.version === 2 && obj.timebase === 'beat');
  }

  /** Minimal validation for `hum2song_clip_bundle` (Export Selected Clip JSON). */
  function _validateHum2songClipBundle(obj){
    if (!obj || typeof obj !== 'object') return false;
    if (obj.kind !== 'hum2song_clip_bundle') return false;
    if (Number(obj.version) !== 1) return false;
    if (Number(obj.schemaVersion) !== 2) return false;
    if (obj.timebase !== 'beat') return false;
    if (typeof obj.bpm !== 'number' || !isFinite(obj.bpm)) return false;
    const clip = obj.clip;
    if (!clip || typeof clip !== 'object') return false;
    const sc = clip.score;
    if (!sc || typeof sc !== 'object' || !Array.isArray(sc.tracks)) return false;
    return true;
  }

  /** Clip entries suitable for "import one clip from full project JSON" (same structural bar as clip bundle). */
  function _importableClipIdsFromProjectDoc(p2){
    if (!p2 || !p2.clips || typeof p2.clips !== 'object' || Array.isArray(p2.clips)) return [];
    const clips = p2.clips;
    const order = (Array.isArray(p2.clipOrder) && p2.clipOrder.length) ? p2.clipOrder.slice() : Object.keys(clips);
    const out = [];
    const seen = Object.create(null);
    function tryAdd(cid){
      if (!cid || seen[cid]) return;
      const c = clips[cid];
      if (!c || typeof c !== 'object') return;
      const sc = c.score;
      if (!sc || typeof sc !== 'object' || !Array.isArray(sc.tracks)) return;
      seen[cid] = true;
      out.push(String(cid));
    }
    for (const cid of order) tryAdd(String(cid));
    for (const cid of Object.keys(clips)) tryAdd(String(cid));
    return out;
  }

  function _projectV2ToV1View(p2){
    const bpm = (p2 && typeof p2.bpm === 'number') ? p2.bpm : 120;

    const tracks = Array.isArray(p2 && p2.tracks)
      ? p2.tracks.map((t, i) => {
          const tid = (t && (t.trackId || t.id)) ? String(t.trackId || t.id) : ('track-' + (i+1));
          return {
            // legacy compat: some UI reads `id`
            id: tid,
            name: (t && typeof t.name === 'string' && t.name) ? t.name : ('Track ' + (i+1)),
            // view-only fields:
            trackId: tid,
            instrument: (t && typeof t.instrument === 'string' && t.instrument) ? t.instrument : 'default',
            gainDb: (t && typeof t.gainDb === 'number' && isFinite(t.gainDb)) ? t.gainDb : 0,
            muted: (t && typeof t.muted === 'boolean') ? t.muted : false,
          };
        })
      : [{ id: 'track-1', name: 'Track 1', trackId: 'track-1', instrument: 'default' }];

    const trackIndexById = {};
    // IMPORTANT: instances carry inst.trackId; key by `trackId`
    tracks.forEach((t, i) => { trackIndexById[t.trackId] = i; });

    const pxPerBeat = (p2 && p2.ui && typeof p2.ui.pxPerBeat === 'number') ? p2.ui.pxPerBeat : 240;
    const pxPerSec = (window.H2SProject && typeof window.H2SProject.pxPerBeatToPxPerSec === 'function')
      ? window.H2SProject.pxPerBeatToPxPerSec(pxPerBeat, bpm)
      : (pxPerBeat * bpm / 60);

    const playheadBeat = (p2 && p2.ui && typeof p2.ui.playheadBeat === 'number') ? p2.ui.playheadBeat : 0;
    const playheadSec = _beatToSec(playheadBeat, bpm);

    const clipsMap = (p2 && p2.clips) ? p2.clips : {};
    const order = (p2 && Array.isArray(p2.clipOrder)) ? p2.clipOrder : Object.keys(clipsMap);

    const clips = [];
    for (const cid of order){
      const c = clipsMap[cid];
      if (!c) continue;

      const P = window.H2SProject;
      const isAudio = P && typeof P.clipKind === 'function' && P.clipKind(c) === 'audio';
      const scoreSec = isAudio ? _scoreBeatToSec({ version: 2, tracks: [] }, bpm) : _scoreBeatToSec(c.score, bpm);
      const meta = c.meta || {};
      const spanBeat = (typeof meta.spanBeat === 'number') ? meta.spanBeat : 0;

      const clipV1 = {
        id: c.id || cid,
        name: c.name || 'Clip',
        createdAt: c.createdAt || Date.now(),
        sourceTaskId: (c.sourceTaskId !== undefined) ? c.sourceTaskId : null,
        score: scoreSec,
        revisionId: (c.revisionId != null) ? String(c.revisionId) : null,
        parentRevisionId: (c.parentRevisionId != null) ? String(c.parentRevisionId) : null,
        updatedAt: (typeof c.updatedAt === 'number') ? c.updatedAt : null,
        _abARevisionId: (c._abARevisionId != null) ? String(c._abARevisionId) : null,
        _abBRevisionId: (c._abBRevisionId != null) ? String(c._abBRevisionId) : null,
        revisions: Array.isArray(c.revisions) ? c.revisions.map(r => ({
          revisionId: (r && r.revisionId != null) ? String(r.revisionId) : null,
          parentRevisionId: (r && r.parentRevisionId != null) ? String(r.parentRevisionId) : null,
          createdAt: (r && typeof r.createdAt === 'number') ? r.createdAt : null,
          name: (r && typeof r.name === 'string') ? r.name : null,
          score: (r && r.score) ? _scoreBeatToSec(r.score, bpm) : null,
          meta: (r && r.meta) ? r.meta : null,
        })) : [],
        meta: {
          agent: (meta && meta.agent) ? meta.agent : null,
          notes: (typeof meta.notes === 'number') ? meta.notes : 0,
          pitchMin: (typeof meta.pitchMin === 'number') ? meta.pitchMin : null,
          pitchMax: (typeof meta.pitchMax === 'number') ? meta.pitchMax : null,
          spanSec: _beatToSec(spanBeat, bpm),
          sourceTempoBpm: (typeof meta.sourceTempoBpm === 'number') ? meta.sourceTempoBpm : null
        }
      };
      if (isAudio){
        clipV1.kind = 'audio';
        clipV1.audio = (c.audio && typeof c.audio === 'object')
          ? { assetRef: String(c.audio.assetRef || ''), durationSec: (isFinite(Number(c.audio.durationSec)) ? Number(c.audio.durationSec) : 0) }
          : { assetRef: '', durationSec: 0 };
      }
      clips.push(clipV1);
    }

    const instances = [];
    for (const inst of (p2 && Array.isArray(p2.instances) ? p2.instances : [])){
      const trackIndex = (inst && inst.trackId && (inst.trackId in trackIndexById)) ? trackIndexById[inst.trackId] : 0;
      instances.push({
        id: inst.id,
        clipId: inst.clipId,
        trackIndex,
        startSec: _beatToSec(inst.startBeat || 0, bpm),
        transpose: inst.transpose || 0
      });
    }

    return { version: 1, bpm, tracks, clips, instances, ui: { pxPerSec, playheadSec } };
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  
  // --- Audio unlock (Chrome autoplay) ---
  // Tone.js may initialize its AudioContext in 'suspended' state until a real user gesture.
  // IMPORTANT: call without awaiting to preserve user-activation.
  function _unlockAudioFromGesture(){
    try{
      const Tone = (typeof window !== 'undefined') ? window.Tone : null;
      if (!Tone) return;
      if (Tone.start){
        // Do NOT await: awaiting can lose user-activation in Chrome.
        Tone.start();
      } else if (Tone.context && Tone.context.resume){
        Tone.context.resume();
      }
    }catch(e){}
  }

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function fmtSec(x){
    if (!isFinite(x)) return '-';
    return (Math.round(x*100)/100).toFixed(2) + 's';
  }

  let _lastLogLine = '';
  function updateLogStatusBar(){
    if (typeof document === 'undefined') return;
    const bar = document.getElementById('logStatusBar');
    if (!bar) return;
    const statusText = (app.state && app.state.statusText != null && String(app.state.statusText).trim()) ? String(app.state.statusText).trim() : '';
    const txt = statusText || _lastLogLine || ((window.I18N && window.I18N.t) ? window.I18N.t('log.ready') : 'Ready');
    bar.textContent = txt.length > 80 ? txt.slice(0, 77) + '...' : txt;
    bar.classList.toggle('error', /failed|error/i.test(txt));
    bar.title = (window.I18N && window.I18N.t) ? window.I18N.t('log.clickToExpand') : 'Click to expand log';
  }
  function setLogOpen(open){
    const panel = document.getElementById('logPanel');
    if (!panel) return;
    panel.classList.toggle('collapsed', !open);
    try{ localStorage.setItem(LS_KEY_LOG_OPEN, open ? '1' : '0'); }catch(e){}
  }
  function log(msg){
    const el = $('#log');
    const t = new Date();
    const line = `[${t.toLocaleTimeString()}] ${msg}\n`;
    el.textContent = line + el.textContent;
    _lastLogLine = String(msg).trim();
    if (!(app.state && app.state.statusText)) updateLogStatusBar();
    dbg(msg);
  }

  function downloadText(filename, text){
    const blob = new Blob([text], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }

  async function fetchJson(url, opts){
    const res = await fetch(url, opts || {});
    const ct = res.headers.get('content-type') || '';
    const txt = await res.text();
    if (!res.ok){
      throw new Error(`${res.status} ${txt}`);
    }
    if (ct.includes('application/json')){
      return JSON.parse(txt);
    }
    // some endpoints may return json without header
    try { return JSON.parse(txt); } catch(e){ return { raw: txt }; }
  }

  function _projectDataKey(id){
    return LS_KEY_PROJECT_DATA_PREFIX + String(id);
  }

  /** One-time: legacy flat hum2song_studio_project_v2 -> current id + index + per-project blob. */
  function _migrateLegacyV2IfNeeded(){
    try{
      if (typeof localStorage === 'undefined') return;
      const legacyRaw = localStorage.getItem(LS_KEY_LEGACY_V2);
      if (!legacyRaw) return;
      const hasCurrent = localStorage.getItem(LS_KEY_CURRENT_PROJECT_ID);
      const hasIndex = localStorage.getItem(LS_KEY_PROJECTS_INDEX);
      if (hasCurrent && hasIndex){
        try{ localStorage.removeItem(LS_KEY_LEGACY_V2); }catch(e){}
        return;
      }
      const P = window.H2SProject;
      const id = (P && typeof P.uid === 'function') ? P.uid('prj_') : ('prj_' + Math.random().toString(16).slice(2) + Date.now().toString(16));
      localStorage.setItem(_projectDataKey(id), legacyRaw);
      localStorage.setItem(LS_KEY_CURRENT_PROJECT_ID, id);
      localStorage.setItem(LS_KEY_PROJECTS_INDEX, JSON.stringify({
        version: 1,
        projects: [{ id, migratedFromLegacyV2: true, migratedAt: Date.now() }]
      }));
      localStorage.removeItem(LS_KEY_LEGACY_V2);
    } catch (e){
      console.warn('[app] legacy v2 migration failed', e);
    }
  }

  function _repairLocalProjectIndex(){
    try{
      if (typeof localStorage === 'undefined') return;
      if (localStorage.getItem(LS_KEY_CURRENT_PROJECT_ID)) return;
      const ir = localStorage.getItem(LS_KEY_PROJECTS_INDEX);
      if (!ir) return;
      const idx = JSON.parse(ir);
      const list = idx && idx.projects;
      if (!Array.isArray(list) || !list.length) return;
      const first = list[0] && list[0].id;
      if (first) localStorage.setItem(LS_KEY_CURRENT_PROJECT_ID, String(first));
    } catch (e){
      console.warn('[app] repair project index failed', e);
    }
  }

  function _ensureCurrentProjectIdForWrite(){
    try{
      if (typeof localStorage === 'undefined') return;
      _migrateLegacyV2IfNeeded();
      _repairLocalProjectIndex();
      if (localStorage.getItem(LS_KEY_CURRENT_PROJECT_ID)) return;
      const P = window.H2SProject;
      const id = (P && typeof P.uid === 'function') ? P.uid('prj_') : ('prj_' + Math.random().toString(16).slice(2) + Date.now().toString(16));
      localStorage.setItem(LS_KEY_CURRENT_PROJECT_ID, id);
      localStorage.setItem(LS_KEY_PROJECTS_INDEX, JSON.stringify({
        version: 1,
        projects: [{ id, createdAt: Date.now() }]
      }));
    } catch (e){
      console.warn('[app] ensure current project id failed', e);
    }
  }

  /** Active ProjectDoc v2 localStorage key, or null if none yet (no auto-create). */
  function _getActiveProjectDocStorageKey(){
    try{
      if (typeof localStorage === 'undefined') return null;
      _migrateLegacyV2IfNeeded();
      _repairLocalProjectIndex();
      const id = localStorage.getItem(LS_KEY_CURRENT_PROJECT_ID);
      if (!id) return null;
      return _projectDataKey(id);
    } catch (e){
      console.warn('[app] active project storage key failed', e);
      return null;
    }
  }

  function _readProjectsIndex(){
    try{
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(LS_KEY_PROJECTS_INDEX);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      if (!Array.isArray(o.projects)) o.projects = [];
      return o;
    } catch (e){
      return null;
    }
  }

  function _writeProjectsIndex(idx){
    try{
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LS_KEY_PROJECTS_INDEX, JSON.stringify(idx));
    } catch (e){
      console.warn('[app] write projects index failed', e);
    }
  }

  function _clipCountFromP2(p2){
    if (!p2 || !p2.clips || typeof p2.clips !== 'object' || Array.isArray(p2.clips)) return 0;
    return Object.keys(p2.clips).length;
  }

  function _labelHintFromP2(p2){
    if (!p2 || !p2.clips || typeof p2.clips !== 'object') return '';
    const order = (Array.isArray(p2.clipOrder) && p2.clipOrder.length) ? p2.clipOrder : Object.keys(p2.clips);
    for (const cid of order){
      const c = p2.clips[cid];
      if (c && typeof c.name === 'string' && String(c.name).trim()) return String(c.name).trim().slice(0, 64);
    }
    return '';
  }

  /** Keep projects index row in sync with current blob (BPM, clip count, optional label from first clip). */
  function _touchCurrentProjectIndexFromDoc(p2){
    try{
      if (!p2 || typeof localStorage === 'undefined') return;
      _migrateLegacyV2IfNeeded();
      _repairLocalProjectIndex();
      const id = localStorage.getItem(LS_KEY_CURRENT_PROJECT_ID);
      if (!id) return;
      const idx = _readProjectsIndex() || { version: 1, projects: [] };
      if (!Array.isArray(idx.projects)) idx.projects = [];
      const bpm = (typeof p2.bpm === 'number' && isFinite(p2.bpm)) ? p2.bpm : 120;
      const clipCount = _clipCountFromP2(p2);
      const labelHint = _labelHintFromP2(p2);
      const now = Date.now();
      let found = false;
      for (let i = 0; i < idx.projects.length; i++){
        const e = idx.projects[i];
        if (e && String(e.id) === String(id)){
          e.updatedAt = now;
          e.bpm = bpm;
          e.clipCount = clipCount;
          if (labelHint) e.label = labelHint;
          found = true;
          break;
        }
      }
      if (!found){
        idx.projects.push({ id, createdAt: now, updatedAt: now, bpm, clipCount, label: labelHint || undefined });
      }
      _writeProjectsIndex(idx);
    } catch (e){
      console.warn('[app] touch project index failed', e);
    }
  }

  function _formatLocalProjectRowLabel(entry, currentId){
    const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
    const id = entry && entry.id;
    const isCur = currentId && id && String(currentId) === String(id);
    const bpm = (typeof entry.bpm === 'number' && isFinite(entry.bpm)) ? Math.round(entry.bpm) : '?';
    const n = (typeof entry.clipCount === 'number') ? entry.clipCount : '?';
    const hasLabel = entry && typeof entry.label === 'string' && String(entry.label).trim();
    const title = hasLabel
      ? String(entry.label).trim().slice(0, 48)
      : (_t('projectHome.untitled') + ' · ' + (id ? String(id).slice(-8) : ''));
    let line = title + ' — ' + bpm + ' ' + _t('projectHome.bpmLabel') + ' · ' + n + ' ' + _t('projectHome.clipsLabel');
    if (entry.updatedAt) line += ' · ' + new Date(entry.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    return (isCur ? '● ' : '') + line;
  }

  function persist(){
    const _perf = _devPerfTimingEnabled();
    const _perfT0 = _perf && typeof performance !== 'undefined' ? performance.now() : 0;
    try{
    // Persist ProjectDoc v2 (beats). UI keeps a v1 (seconds) view until controllers are migrated.
    // IMPORTANT: persist() must NOT clobber v2-only fields (e.g., track.instrument) by migrating from v1.
    _ensureCurrentProjectIdForWrite();
    const docKey = _getActiveProjectDocStorageKey();
    if (!docKey) return;
    const prevV2 = app._projectV2 || _readLS(docKey);

    const p2 = _projectV1ToV2(app.project);
    if (!p2) return;

    
// Preserve v2-only track fields (currently: instrument, gainDb).
try{
  if (prevV2 && Array.isArray(prevV2.tracks) && Array.isArray(p2.tracks)){
    const instByTid = new Map();
    const gainByTid = new Map();
    const mutedByTid = new Map();
    for (const t of prevV2.tracks){
      const tid = (t && (t.trackId || t.id)) ? String(t.trackId || t.id) : null;
      if (!tid) continue;
      if (typeof t.instrument === 'string' && t.instrument) instByTid.set(tid, t.instrument);
      if (typeof t.gainDb === 'number' && isFinite(t.gainDb)) gainByTid.set(tid, t.gainDb);
      if (typeof t.muted === 'boolean') mutedByTid.set(tid, t.muted);
    }

    for (const t of p2.tracks){
      const tid = (t && (t.trackId || t.id)) ? String(t.trackId || t.id) : null;
      if (!tid) continue;

      // Keep id/trackId consistent (compat).
      if (!t.id) t.id = tid;
      if (!t.trackId) t.trackId = tid;

      const inst = instByTid.get(tid);
      if (typeof inst === 'string' && inst) t.instrument = inst;

      const g = gainByTid.get(tid);
      if (typeof g === 'number' && isFinite(g)) t.gainDb = g;

      const m = mutedByTid.get(tid);
      if (typeof m === 'boolean') t.muted = m;

      // Ensure defaults for v2-only fields when missing from v1 migration.
      if (typeof t.instrument !== 'string' || !t.instrument) t.instrument = 'default';
      if (typeof t.gainDb !== 'number' || !isFinite(t.gainDb)) t.gainDb = 0;
      if (typeof t.muted !== 'boolean') t.muted = false;
    }
  }
  // Preserve clip revision chain (revisionId, parentRevisionId, revisions) so Undo Optimize works.
  if (prevV2 && prevV2.clips && typeof prevV2.clips === 'object' && p2.clips && typeof p2.clips === 'object'){
    for (const cid of Object.keys(p2.clips)){
      const prevClip = prevV2.clips[cid];
      if (!prevClip) continue;
      const dst = p2.clips[cid];
      if (dst && prevClip.revisionId != null) dst.revisionId = prevClip.revisionId;
      if (dst && prevClip.parentRevisionId !== undefined) dst.parentRevisionId = prevClip.parentRevisionId;
      if (dst && prevClip.revisions != null) dst.revisions = prevClip.revisions;
      if (dst && prevClip.updatedAt != null) dst.updatedAt = prevClip.updatedAt;
    }
  }
  if (typeof window !== 'undefined' && window.H2SProject && typeof window.H2SProject.normalizeProjectRevisionChains === 'function'){
    window.H2SProject.normalizeProjectRevisionChains(p2);
  }
} catch(e){
      console.warn('[persist] v2 merge failed', e);
    }

    _writeLS(docKey, p2);

    // IMPORTANT: sync in-memory v2 cache; otherwise later writes (e.g. setTrackInstrument)
    // may read a stale cached project and overwrite newer instances.
    app._projectV2 = p2;

    _touchCurrentProjectIndexFromDoc(p2);

    // Ensure beats-only storage after migration.
    try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
    } finally {
      if (_perf && typeof performance !== 'undefined'){
        console.log('[H2S perf] persist', (performance.now() - _perfT0).toFixed(2) + 'ms');
      }
    }
  }

  function restore(){
    if (typeof localStorage === 'undefined') return null;
    _migrateLegacyV2IfNeeded();
    _repairLocalProjectIndex();

    const docKey = _getActiveProjectDocStorageKey();
    if (docKey){
      const p2 = _readLS(docKey);
      if (p2) return p2;
    }

    const legacy = _readLS(LS_KEY_V1);
    if (!legacy) return null;

    const migrated = _projectV1ToV2(legacy);
    if (migrated){
      _ensureCurrentProjectIdForWrite();
      const k = _getActiveProjectDocStorageKey();
      if (k) _writeLS(k, migrated);
      try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
      return migrated;
    }

    // Fallback: still return legacy if migration is unavailable.
    return legacy;
  }

  const app = {
    project: null,
    _projectV2: null,
    _lastOptimizeOptions: null,  // PR-3: app-level state for optimize options
    _lastOptimizeSnapshot: null, // Studio “last optimize” summary (user-facing; refreshed on lang change)
    _optPresetByClipId: {},      // PR-3: per-clip last selected preset for dropdown persistence
    _optOptionsByClipId: {},     // PR-5c: per-clip full options so getOptimizeOptions(clipId) returns correct preset
    _pendingClipFromProject: null, // full project doc v2 while "Import clip from project JSON" chooser is open
    // debug helper (gated by localStorage.h2s_debug === '1')
    dbg: function(){ return dbg.apply(null, arguments); },

    // v2-only commit path: write v2 truth to storage and refresh UI view
    commitV2: function(projectV2, reason){
      if (reason) this.dbg('[commitV2]', reason);
      return this.setProjectFromV2(projectV2);
    },

    // v1->v2 migration commit path (legacy seconds UI -> beats truth)
    persistFromV1: function(reason){
      if (reason) this.dbg('[persistFromV1]', reason);
      persist();
      const p2 = this.getProjectV2();
      if (p2 && _isProjectV2(p2)) this.project = _projectV2ToV1View(p2);
      this.render();
    },

// Controllers (optional)
agentCtrl: null,

// PR-UX6a: Command layer — runCommand + event bus
_cmdSubs: [],
onCommandEvent(fn){ this._cmdSubs = this._cmdSubs || []; this._cmdSubs.push(fn); return () => { this._cmdSubs = this._cmdSubs.filter(x => x !== fn); }; },
_emitCmd(type, detail){ (this._cmdSubs || []).forEach(fn => { try { fn({ type, ...detail }); } catch (e) {} }); },
_cmdLabel(cmd){
  const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
  if (cmd === 'optimize_clip') return _t('cmd.optimizing');
  if (cmd === 'rollback_clip') return _t('cmd.undoing');
  if (cmd === 'open_editor') return _t('cmd.openingEditor');
  if (cmd === 'add_clip_to_timeline') return _t('cmd.addClipTimeline');
  if (cmd === 'remove_instance') return _t('cmd.removeInstance');
  if (cmd === 'move_instance') return _t('cmd.moveInstance');
  if (cmd === 'add_track') return _t('cmd.addTrack');
  return cmd;
},
_cmdDoneLabel(cmd){
  const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
  if (cmd === 'optimize_clip') return _t('cmd.optimized');
  if (cmd === 'rollback_clip') return _t('cmd.undone');
  return '';
},
async runCommand(command, payload){
  payload = payload || {};
  const startedAt = Date.now();
  this._emitCmd('started', { command, payload, startedAt });
  try {
    let result = { ok: true, command, payload, startedAt, finishedAt: null, message: '', data: null };
    switch (command) {
      case 'open_ai_settings':
        this.openAiSettingsDrawer();
        result.message = 'opened';
        break;
      case 'close_ai_settings':
        this.closeAiSettingsDrawer();
        result.message = 'closed';
        break;
      case 'open_inspector_optimize':
        setInspectorSectionOpen('opt', true);
        this.render();
        result.message = 'opened';
        break;
      case 'select_instance': {
        const instId = payload.instanceId;
        if (!instId) throw new Error('instanceId required');
        const inst = (this.project.instances || []).find(x => x && x.id === instId);
        if (!inst) throw new Error('instance not found');
        this.state.selectedInstanceId = instId;
        if (inst.clipId) this.state.selectedClipId = inst.clipId;
        if (Number.isFinite(inst.trackIndex) && typeof this.setActiveTrackIndex === 'function') this.setActiveTrackIndex(inst.trackIndex);
        this.render();
        result.data = { instanceId: instId, clipId: inst.clipId };
        break;
      }
      case 'select_clip': {
        const clipId = payload.clipId;
        if (!clipId) throw new Error('clipId required');
        this.state.selectedClipId = clipId;
        this.state.selectedInstanceId = null;
        this.render();
        result.data = { clipId };
        break;
      }
      case 'open_editor': {
        const clipId = payload.clipId;
        if (!clipId) throw new Error('clipId required');
        this.openClipEditor(clipId);
        result.data = { clipId };
        break;
      }
      case 'optimize_clip': {
        const clipId = payload.clipId;
        if (!clipId) throw new Error('clipId required');
        const optRes = await this.optimizeClip(clipId);
        if (optRes && !optRes.ok) throw new Error(optRes.reason || optRes.detail || optRes.message || 'Optimize failed');
        result.data = { clipId, optimizeResult: optRes };
        break;
      }
      case 'rollback_clip': {
        const clipId = payload.clipId;
        if (!clipId) throw new Error('clipId required');
        const res = this.rollbackClipRevision(clipId);
        if (res && res.ok) { persist(); this.render(); }
        result.data = { clipId, rollbackResult: res };
        break;
      }
      case 'add_clip_to_timeline': {
        const clipId = payload.clipId;
        if (!clipId) throw new Error('clipId required');
        const clips = this.project.clips || [];
        const clipOk = Array.isArray(clips) && clips.some(c => c && c.id === clipId);
        if (!clipOk) throw new Error('clip not found');
        const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
        const bpm = (this.project && typeof this.project.bpm === 'number' && isFinite(this.project.bpm)) ? this.project.bpm : 120;
        let startSec;
        if (payload.startBeat != null && P && typeof P.normalizeBeat === 'function' && typeof P.beatToSec === 'function' && isFinite(Number(payload.startBeat))){
          const sb = P.normalizeBeat(Number(payload.startBeat));
          startSec = P.beatToSec(sb, bpm);
        }
        let trackIndex;
        if (payload.trackIndex != null && Number.isFinite(Number(payload.trackIndex))){
          const max = Math.max(0, ((this.project.tracks || []).length) - 1);
          trackIndex = Math.max(0, Math.min(max, Math.round(Number(payload.trackIndex))));
        }
        this.addClipToTimeline(clipId, startSec, trackIndex);
        result.message = 'added';
        const selId = this.state && this.state.selectedInstanceId;
        const instAdded = selId ? (this.project.instances || []).find(x => x && x.id === selId) : null;
        const tiOut = instAdded && typeof instAdded.trackIndex === 'number' ? instAdded.trackIndex : (trackIndex != null ? trackIndex : (Number.isFinite(this.state.activeTrackIndex) ? this.state.activeTrackIndex : 0));
        const sbOut = (instAdded && P && typeof P.secToBeat === 'function') ? P.secToBeat(instAdded.startSec || 0, bpm) : ((startSec != null && P && typeof P.secToBeat === 'function') ? P.secToBeat(startSec, bpm) : null);
        result.data = { clipId, instanceId: instAdded ? instAdded.id : null, startBeat: sbOut, trackIndex: tiOut };
        break;
      }
      case 'remove_instance': {
        const instanceId = payload.instanceId;
        if (!instanceId) throw new Error('instanceId required');
        const idx = (this.project.instances || []).findIndex(x => x && x.id === instanceId);
        if (idx < 0) throw new Error('instance not found');
        this.deleteInstance(instanceId);
        result.message = 'removed';
        result.data = { instanceId };
        break;
      }
      case 'move_instance': {
        const instanceId = payload.instanceId;
        if (!instanceId) throw new Error('instanceId required');
        const inst = (this.project.instances || []).find(x => x && x.id === instanceId);
        if (!inst) throw new Error('instance not found');
        const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
        const bpm = (this.project && typeof this.project.bpm === 'number' && isFinite(this.project.bpm)) ? this.project.bpm : 120;
        let changed = false;
        if (payload.startBeat != null && P && typeof P.normalizeBeat === 'function' && typeof P.beatToSec === 'function' && isFinite(Number(payload.startBeat))){
          const sb = P.normalizeBeat(Number(payload.startBeat));
          inst.startSec = P.beatToSec(sb, bpm);
          changed = true;
        }
        if (payload.trackIndex != null && Number.isFinite(Number(payload.trackIndex))){
          const max = Math.max(0, ((this.project.tracks || []).length) - 1);
          inst.trackIndex = Math.max(0, Math.min(max, Math.round(Number(payload.trackIndex))));
          changed = true;
        }
        if (!changed){
          result.message = 'noop';
          result.data = { instanceId, noop: true };
          break;
        }
        persist();
        this.render();
        result.message = 'moved';
        result.data = {
          instanceId,
          startBeat: (P && typeof P.secToBeat === 'function') ? P.secToBeat(inst.startSec || 0, bpm) : null,
          trackIndex: (typeof inst.trackIndex === 'number') ? inst.trackIndex : 0,
        };
        break;
      }
      case 'add_track': {
        this.addTrack();
        result.message = 'added';
        const p2 = (typeof this.getProjectV2 === 'function') ? this.getProjectV2() : null;
        const tracks = (p2 && Array.isArray(p2.tracks)) ? p2.tracks : [];
        const last = tracks.length ? tracks[tracks.length - 1] : null;
        result.data = { trackIndex: tracks.length - 1, trackId: last && (last.trackId || last.id) ? String(last.trackId || last.id) : null };
        break;
      }
      default:
        throw new Error('unknown command: ' + command);
    }
    result.finishedAt = Date.now();
    this._emitCmd('done', { command, payload, result });
    return result;
  } catch (err) {
    const finishedAt = Date.now();
    const msg = (err && (err.message || String(err))) || 'error';
    const error = { message: msg.slice(0, 200), finishedAt };
    this._emitCmd('failed', { command, payload, error });
    return { ok: false, command, payload, startedAt, finishedAt, message: error.message, data: null };
  }
},

// --- v2 hooks: Library/Agent expect these (beats-only truth) ---
getProjectV2(){
  // v2 beats-only doc is the only source of truth.
  if (this._projectV2) return this._projectV2;

  const docKey = _getActiveProjectDocStorageKey();
  if (!docKey) return null;
  const raw = _readLS(docKey);
  if (!raw) return null;

  // Normalize / migrate using project.js helpers if available.
  try{
    const P = window.H2SProject;
    if (P && typeof P.loadProjectDocV2 === 'function'){
      const p2 = P.loadProjectDocV2(raw);
      // Normalize legacy track schema: some old saves used `id` instead of `trackId`.
      if (p2 && Array.isArray(p2.tracks)) {
        for (const t of p2.tracks) {
          if (t && !t.trackId && t.id) t.trackId = t.id;
          if (t && typeof t.instrument !== 'string') t.instrument = 'default';
          if (t && (typeof t.gainDb !== 'number' || !isFinite(t.gainDb))) t.gainDb = 0;
      if (t && typeof t.muted !== 'boolean') t.muted = false;
        }
      }
      this._projectV2 = p2;
      return p2;
    }
  } catch(e){
    console.warn('[App] getProjectV2 normalize failed', e);
  }
  // Fallback: return raw (best effort)
  this._projectV2 = raw;
  return raw;
},

/** For export fallbacks: active ProjectDoc v2 localStorage key (no side effects beyond migration/repair). */
getActiveProjectDocumentLocalStorageKey(){
  return _getActiveProjectDocStorageKey();
},

setProjectFromV2(projectV2){
  // Persist v2 beats-only doc, then refresh derived v1 view for UI/controllers.
  if (!projectV2) return {ok:false, error:'no_project_v2'};
  if (typeof window !== 'undefined' && window.H2SProject && typeof window.H2SProject.normalizeProjectRevisionChains === 'function'){
    window.H2SProject.normalizeProjectRevisionChains(projectV2);
  }
  // Normalize legacy track schema on write.
  if (Array.isArray(projectV2.tracks)) {
    for (const t of projectV2.tracks) {
      if (t && !t.trackId && t.id) t.trackId = t.id;
      if (t && typeof t.instrument !== 'string') t.instrument = 'default';
      if (t && (typeof t.gainDb !== 'number' || !isFinite(t.gainDb))) t.gainDb = 0;
      if (t && typeof t.muted !== 'boolean') t.muted = false;
    }
  }
  this._projectV2 = projectV2;
  _ensureCurrentProjectIdForWrite();
  const docKey = _getActiveProjectDocStorageKey();
  if (!docKey) return { ok: false, error: 'no_project_storage_key' };
  _writeLS(docKey, projectV2);
  _touchCurrentProjectIndexFromDoc(projectV2);
  this.project = _projectV2ToV1View(projectV2);
  this.render();
  return {ok:true};
},

// --- T4-1.F: single write entry for per-track instrument (v2 truth) ---
setTrackInstrument(trackId, instrument){
  const p2 = this.getProjectV2();
  if (!p2 || !Array.isArray(p2.tracks)){
    console.error('[App] setTrackInstrument: project v2 missing');
    return;
  }
  const t = p2.tracks.find(x => x && ((x.trackId === trackId) || (x.id === trackId)));
  if (!t){
    console.error('[App] setTrackInstrument: trackId not found', trackId);
    return;
  }
  // Repair legacy data that used `id` instead of `trackId`
  if (!t.trackId && t.id === trackId) t.trackId = trackId;
  t.instrument = instrument;
  this.setProjectFromV2(p2); // persist + rebuild v1 view + render
},
setTrackGainDb(trackId, gainDb){
  const p2 = this.getProjectV2();
  if (!p2 || !Array.isArray(p2.tracks)){
    console.error('[App] setTrackGainDb: project v2 missing');
    return;
  }
  const t = p2.tracks.find(x => x && ((x.trackId === trackId) || (x.id === trackId)));
  if (!t){
    console.error('[App] setTrackGainDb: trackId not found', trackId);
    return;
  }
  if (!t.trackId && t.id === trackId) t.trackId = trackId;
  const v = Number(gainDb);
  t.gainDb = (Number.isFinite(v) ? Math.max(-30, Math.min(6, v)) : 0);
  this.setProjectFromV2(p2);
},


setTrackMuted(trackId, muted){
  const p2 = this.getProjectV2();
  if (!p2 || !Array.isArray(p2.tracks)){
    console.error('[App] setTrackMuted: project v2 missing');
    return;
  }
  const t = p2.tracks.find(x => x && ((x.trackId === trackId) || (x.id === trackId)));
  if (!t){
    console.error('[App] setTrackMuted: trackId not found', trackId);
    return;
  }
  if (!t.trackId && t.id === trackId) t.trackId = trackId;
  t.muted = Boolean(muted);
  this.setProjectFromV2(p2);
},



// PR-5c: order-agnostic (cid, options) or (options, cid); normalize requestedPresetId / presetId / preset
setOptimizeOptions(arg0, arg1){
  let cid = null;
  let opts = null;
  if (typeof arg0 === 'string') {
    cid = arg0;
    opts = (arg1 && typeof arg1 === 'object') ? arg1 : null;
  } else if (typeof arg1 === 'string') {
    cid = arg1;
    opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
  } else {
    opts = (arg0 && typeof arg0 === 'object') ? arg0 : null;
  }
  const preset = opts && (opts.requestedPresetId != null ? opts.requestedPresetId : opts.presetId != null ? opts.presetId : opts.preset);
  const defaultIntent = { fixPitch: false, tightenRhythm: false, reduceOutliers: false };
  const existingOpts = cid ? this.getOptimizeOptions(cid) : null;
  const intent = (opts && opts.intent && typeof opts.intent === 'object')
    ? { fixPitch: !!opts.intent.fixPitch, tightenRhythm: !!opts.intent.tightenRhythm, reduceOutliers: !!opts.intent.reduceOutliers }
    : (existingOpts && existingOpts.intent && typeof existingOpts.intent === 'object')
      ? { fixPitch: !!existingOpts.intent.fixPitch, tightenRhythm: !!existingOpts.intent.tightenRhythm, reduceOutliers: !!existingOpts.intent.reduceOutliers }
      : defaultIntent;
  const rawTemplateId = opts && opts.templateId;
  const templateId = rawTemplateId !== undefined
    ? ((rawTemplateId != null && String(rawTemplateId).trim()) ? String(rawTemplateId).trim() : null)
    : (existingOpts && existingOpts.templateId != null && String(existingOpts.templateId).trim()) ? String(existingOpts.templateId).trim() : null;
  const rawPlan = opts && opts.plan;
  /** Like templateId: carry forward snapshot unless incoming opts explicitly sets the key (null clears). */
  let assistantExecutionPlanSnapshot;
  if (!opts || !Object.prototype.hasOwnProperty.call(opts, '_assistantExecutionPlanSnapshot')){
    assistantExecutionPlanSnapshot = existingOpts && existingOpts._assistantExecutionPlanSnapshot;
  } else {
    assistantExecutionPlanSnapshot = opts._assistantExecutionPlanSnapshot;
  }
  let plan = null;
  if (assistantExecutionPlanSnapshot != null && typeof assistantExecutionPlanSnapshot === 'object'){
    plan = _normalizeAssistantPlanForExecution(assistantExecutionPlanSnapshot);
  } else {
    plan = (rawPlan && typeof rawPlan === 'object' && Array.isArray(rawPlan.planLines) && rawPlan.planLines.length >= 1 && (rawPlan.planTitle || rawPlan.planKind))
      ? { planKind: rawPlan.planKind || null, planTitle: (rawPlan.planTitle && String(rawPlan.planTitle).trim()) ? String(rawPlan.planTitle).trim() : '', planLines: rawPlan.planLines.slice(0, 6).filter(function(l){ return typeof l === 'string'; }) }
      : (existingOpts && existingOpts.plan && typeof existingOpts.plan === 'object') ? existingOpts.plan : null;
  }
  let nextVelocityShapeIntent;
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'velocityShapeIntent')){
    nextVelocityShapeIntent = (opts.velocityShapeIntent && typeof opts.velocityShapeIntent === 'object' && opts.velocityShapeIntent.mode)
      ? {
        capability_id: String(opts.velocityShapeIntent.capability_id || 'velocity_shape'),
        mode: String(opts.velocityShapeIntent.mode),
        strength: opts.velocityShapeIntent.strength ? String(opts.velocityShapeIntent.strength) : 'medium',
      }
      : null;
  } else if (existingOpts && existingOpts.velocityShapeIntent){
    nextVelocityShapeIntent = existingOpts.velocityShapeIntent;
  }
  let nextLocalTransposeIntent;
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'localTransposeIntent')){
    nextLocalTransposeIntent = (opts.localTransposeIntent && typeof opts.localTransposeIntent === 'object' && isFinite(Number(opts.localTransposeIntent.semitone_delta)))
      ? {
        capability_id: String(opts.localTransposeIntent.capability_id || 'local_transpose'),
        semitone_delta: Math.round(Number(opts.localTransposeIntent.semitone_delta)),
      }
      : null;
  } else if (existingOpts && existingOpts.localTransposeIntent){
    nextLocalTransposeIntent = existingOpts.localTransposeIntent;
  }
  let nextRhythmIntent;
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'rhythmIntent')){
    nextRhythmIntent = (opts.rhythmIntent && typeof opts.rhythmIntent === 'object' && opts.rhythmIntent.mode)
      ? {
        capability_id: String(opts.rhythmIntent.capability_id || 'rhythm_tighten_loosen'),
        mode: String(opts.rhythmIntent.mode),
        strength: opts.rhythmIntent.strength ? String(opts.rhythmIntent.strength) : 'medium',
      }
      : null;
  } else if (existingOpts && existingOpts.rhythmIntent){
    nextRhythmIntent = existingOpts.rhythmIntent;
  }
  const normalizedOpts = opts ? (function(){
    const base = {
      requestedPresetId: (preset != null && preset !== '') ? String(preset) : null,
      userPrompt: opts.userPrompt != null ? opts.userPrompt : null,
      intent,
      templateId: templateId || null,
      plan: plan || null,
    };
    if (assistantExecutionPlanSnapshot !== undefined){
      base._assistantExecutionPlanSnapshot = assistantExecutionPlanSnapshot;
    }
    if (nextVelocityShapeIntent !== undefined){
      base.velocityShapeIntent = nextVelocityShapeIntent;
    }
    if (nextLocalTransposeIntent !== undefined){
      base.localTransposeIntent = nextLocalTransposeIntent;
    }
    if (nextRhythmIntent !== undefined){
      base.rhythmIntent = nextRhythmIntent;
    }
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'velocityShapeNoteIds')){
      base.velocityShapeNoteIds = Array.isArray(opts.velocityShapeNoteIds) ? opts.velocityShapeNoteIds.slice() : null;
    }
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'localTransposeNoteIds')){
      base.localTransposeNoteIds = Array.isArray(opts.localTransposeNoteIds) ? opts.localTransposeNoteIds.slice() : null;
    }
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'rhythmNoteIds')){
      base.rhythmNoteIds = Array.isArray(opts.rhythmNoteIds) ? opts.rhythmNoteIds.slice() : null;
    }
    return base;
  })() : null;
  this._lastOptimizeOptions = normalizedOpts;
  if (cid) {
    this._optPresetByClipId[cid] = normalizedOpts ? normalizedOpts.requestedPresetId : null;
    this._optOptionsByClipId[cid] = normalizedOpts;
    if (typeof localStorage !== 'undefined') {
      try {
        const map = _readLS(LS_KEY_OPT_OPTIONS) || {};
        const persisted = normalizedOpts ? Object.assign({}, normalizedOpts) : null;
        if (persisted && Object.prototype.hasOwnProperty.call(persisted, 'velocityShapeNoteIds')){
          delete persisted.velocityShapeNoteIds;
        }
        if (persisted && Object.prototype.hasOwnProperty.call(persisted, 'localTransposeNoteIds')){
          delete persisted.localTransposeNoteIds;
        }
        if (persisted && Object.prototype.hasOwnProperty.call(persisted, 'rhythmNoteIds')){
          delete persisted.rhythmNoteIds;
        }
        map[cid] = persisted;
        _writeLS(LS_KEY_OPT_OPTIONS, map);
      } catch (e) { console.warn('[App] persist opt options failed', e); }
    }
  }
},
getOptimizePresetForClip(clipId){
  const opts = this.getOptimizeOptions(clipId);
  return (opts && opts.requestedPresetId != null) ? opts.requestedPresetId : null;
},
getOptimizeOptions(clipId){
  if (clipId && this._optOptionsByClipId && this._optOptionsByClipId[clipId] != null) return this._optOptionsByClipId[clipId];
  if (clipId && typeof localStorage !== 'undefined') {
    try {
      const map = _readLS(LS_KEY_OPT_OPTIONS);
      if (map && typeof map === 'object' && map[clipId] != null) {
        this._optOptionsByClipId[clipId] = map[clipId];
        this._optPresetByClipId[clipId] = (map[clipId].requestedPresetId != null) ? map[clipId].requestedPresetId : null;
        return map[clipId];
      }
    } catch (e) { console.warn('[App] read opt options failed', e); }
  }
  return this._lastOptimizeOptions || null;
},

// PR-5e: optOverride = one-shot options for this call only; does NOT modify stored per-clip options.
async optimizeClip(clipId, optOverride){
  if (!this.agentCtrl || typeof this.agentCtrl.optimizeClip !== 'function'){
    console.warn('[App] optimizeClip called but agent controller is not available');
    try{ alert('Optimize unavailable: agent controller not initialized. Check console for details.'); }catch(_){}
    const bad = { ok: false, error: 'no_agent_controller' };
    try { this._updateLastOptimizeSummary(bad, clipId); } catch (e) { /* ignore */ }
    return bad;
  }
  let options = optOverride;
  if (options && typeof options === 'object') {
    const stored = (clipId && this.getOptimizeOptions) ? this.getOptimizeOptions(clipId) : null;
    const merged = {};
    if (stored && typeof stored === 'object'){
      for (const k in stored){
        if (Object.prototype.hasOwnProperty.call(stored, k)) merged[k] = stored[k];
      }
    }
    for (const k in options){
      if (Object.prototype.hasOwnProperty.call(options, k) && options[k] !== undefined){
        merged[k] = options[k];
      }
    }
    const preset = merged.requestedPresetId != null ? merged.requestedPresetId : merged.presetId != null ? merged.presetId : merged.preset;
    const intent = options.intent && typeof options.intent === 'object'
      ? { fixPitch: !!options.intent.fixPitch, tightenRhythm: !!options.intent.tightenRhythm, reduceOutliers: !!options.intent.reduceOutliers }
      : { fixPitch: false, tightenRhythm: false, reduceOutliers: false };
    options = {
      requestedPresetId: (preset != null && preset !== '') ? String(preset) : null,
      userPrompt: merged.userPrompt != null ? merged.userPrompt : null,
      intent,
    };
    if (merged.templateId != null && String(merged.templateId).trim()){
      options.templateId = String(merged.templateId).trim();
    }
    if (merged.plan && typeof merged.plan === 'object'){
      options.plan = merged.plan;
    }
    if (Object.prototype.hasOwnProperty.call(merged, '_assistantExecutionPlanSnapshot')){
      options._assistantExecutionPlanSnapshot = merged._assistantExecutionPlanSnapshot;
    }
    if (merged.velocityShapeIntent && typeof merged.velocityShapeIntent === 'object' && merged.velocityShapeIntent.mode){
      options.velocityShapeIntent = merged.velocityShapeIntent;
    }
    if (merged.localTransposeIntent && typeof merged.localTransposeIntent === 'object' && isFinite(Number(merged.localTransposeIntent.semitone_delta))){
      options.localTransposeIntent = merged.localTransposeIntent;
    }
    if (Array.isArray(merged.velocityShapeNoteIds) && merged.velocityShapeNoteIds.length > 0){
      options.velocityShapeNoteIds = merged.velocityShapeNoteIds.slice();
    }
    if (Array.isArray(merged.localTransposeNoteIds) && merged.localTransposeNoteIds.length > 0){
      options.localTransposeNoteIds = merged.localTransposeNoteIds.slice();
    }
    if (merged.rhythmIntent && typeof merged.rhythmIntent === 'object' && merged.rhythmIntent.mode){
      options.rhythmIntent = merged.rhythmIntent;
    }
    if (Array.isArray(merged.rhythmNoteIds) && merged.rhythmNoteIds.length > 0){
      options.rhythmNoteIds = merged.rhythmNoteIds.slice();
    }
  }
  const out = await this.agentCtrl.optimizeClip(clipId, options);
  try { this._updateLastOptimizeSummary(out, clipId); } catch (e) { /* ignore */ }
  return out;
},

  _lastOptPathLabel(pathRaw, t){
    const p = String(pathRaw || '').trim();
    const keyBy = {
      'llm': 'lastOpt.path.llm',
      'velocity_shape': 'lastOpt.path.velocityShape',
      'local_transpose': 'lastOpt.path.localTranspose',
      'rhythm_tighten_loosen': 'lastOpt.path.rhythm',
      'pseudo': 'lastOpt.path.pseudo',
      'preset': 'lastOpt.path.preset',
    };
    if (keyBy[p]) return t(keyBy[p]);
    return t('lastOpt.path.other').replace('{id}', p ? p.slice(0, 28) : '?');
  },

  _lastOptLlmOutcomeLabel(lo, t){
    const x = String(lo || '').trim().toLowerCase();
    if (x === 'applied') return t('lastOpt.llm.applied');
    if (x === 'no_op') return t('lastOpt.llm.noOp');
    if (x.indexOf('rejected') === 0) return t('lastOpt.llm.rejected');
    if (x === 'failed_config' || x === 'failed_client') return t('lastOpt.llm.configProblem');
    if (x === 'failed_apply' || x === 'apply_failed') return t('lastOpt.llm.failedApply');
    if (x === 'failed_revision' || x.indexOf('beginnewcliprevision') === 0) return t('lastOpt.llm.failedRevision');
    if (x.indexOf('failed') === 0) return t('lastOpt.llm.failed');
    return t('lastOpt.llm.other');
  },

  _lastOptDeterministicOutcome(ps, ops, noCh, t){
    if (noCh || ops === 0) return t('lastOpt.change.noChange');
    if (ps && ps.isVelocityOnly === true) return t('lastOpt.change.velocityOnly');
    if (ps && (ps.hasPitchChange === true || ps.hasTimingChange === true)) return t('lastOpt.change.pitchTiming');
    if (ps && ps.hasStructuralChange === true) return t('lastOpt.change.structure');
    return t('lastOpt.change.updated');
  },

  _lastOptFailureDetail(res, t){
    const r = (res && res.reason != null) ? String(res.reason)
      : (res && res.error != null) ? String(res.error) : '';
    const key = 'lastOpt.fail.' + r;
    const localized = t(key);
    if (localized !== key) return localized;
    return t('lastOpt.fail.generic').replace('{reason}', r ? r.slice(0, 56) : t('lastOpt.fail.unknownReason'));
  },

  _formatLastOptimizeLine(res, clipId){
    const t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
    if (!res) return t('lastOpt.none');
    const p2 = this.getProjectV2 && this.getProjectV2();
    const clip = clipId && p2 && p2.clips && p2.clips[clipId] ? p2.clips[clipId] : null;
    const ps = (res.patchSummary && typeof res.patchSummary === 'object') ? res.patchSummary
      : (clip && clip.meta && clip.meta.agent && clip.meta.agent.patchSummary) ? clip.meta.agent.patchSummary : null;
    const pathRaw = (res.executionPath != null && String(res.executionPath).trim() !== '') ? String(res.executionPath).trim()
      : (ps && ps.executionPath) ? String(ps.executionPath) : '';
    const pathLabel = this._lastOptPathLabel(pathRaw || 'unknown', t);

    if (!res.ok) {
      const detail = this._lastOptFailureDetail(res, t);
      return t('lastOpt.lineFailed').replace('{path}', pathLabel).replace('{detail}', detail);
    }

    const ops = (res.ops != null) ? Number(res.ops) : 0;
    const noCh = (ps && ps.noChanges === true) || ops === 0;
    const pathStr = String(pathRaw || '');
    let outcomeLine = '';
    if (pathStr === 'llm') {
      const lo = res.llmOutcome || (ps && ps.llm && ps.llm.outcome) || '';
      outcomeLine = this._lastOptLlmOutcomeLabel(lo, t);
    } else {
      outcomeLine = this._lastOptDeterministicOutcome(ps, ops, noCh, t);
    }

    const revNew = !noCh && ops > 0;
    const revText = revNew ? t('lastOpt.rev.newVersion') : t('lastOpt.rev.noChange');
    return t('lastOpt.lineOk').replace('{path}', pathLabel).replace('{outcome}', outcomeLine).replace('{revision}', revText);
  },

  _updateLastOptimizeSummary(res, clipId){
    const p2 = this.getProjectV2 && this.getProjectV2();
    const cid = clipId || null;
    const clip = cid && p2 && p2.clips && p2.clips[cid] ? p2.clips[cid] : null;
    const revisionIdAtRun = (clip && clip.revisionId != null) ? String(clip.revisionId) : '';
    let docKeyAtRun = null;
    try { docKeyAtRun = _getActiveProjectDocStorageKey(); } catch (e) { docKeyAtRun = null; }
    this._lastOptimizeSnapshot = {
      res: res || null,
      clipId: cid,
      revisionIdAtRun,
      docKeyAtRun,
    };
    this._applyLastOptimizeSummaryI18n();
  },

  /** True when stored summary no longer matches current project doc or clip head revision. */
  _isLastOptimizeSnapshotStale(){
    const s = this._lastOptimizeSnapshot;
    if (!s) return false;
    if (!s.clipId) return true;
    let curKey = null;
    try { curKey = _getActiveProjectDocStorageKey(); } catch (e) { curKey = null; }
    if (s.docKeyAtRun != null && curKey != null && s.docKeyAtRun !== curKey) return true;
    const p2 = this.getProjectV2 && this.getProjectV2();
    if (!p2 || !p2.clips || !p2.clips[s.clipId]) return true;
    const clip = p2.clips[s.clipId];
    const curRev = (clip && clip.revisionId != null) ? String(clip.revisionId) : '';
    if (s.revisionIdAtRun === undefined || s.revisionIdAtRun === null) return true;
    return curRev !== String(s.revisionIdAtRun);
  },

  _applyLastOptimizeSummaryI18n(){
    const el = (typeof document !== 'undefined') ? document.getElementById('studioLastOptimizeSummary') : null;
    if (!el) return;
    const t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
    if (!this._lastOptimizeSnapshot){
      el.textContent = t('lastOpt.none');
      return;
    }
    if (typeof this._isLastOptimizeSnapshotStale === 'function' && this._isLastOptimizeSnapshotStale()){
      el.textContent = t('lastOpt.stale');
      return;
    }
    const s = this._lastOptimizeSnapshot;
    el.textContent = this._formatLastOptimizeLine(s.res, s.clipId);
  },

  _lastOptIntentDetailLine(ps, pathRaw, t){
    if (!ps || !pathRaw) return '';
    const p = String(pathRaw);
    if (p === 'llm' && ps.promptMeta && ps.promptMeta.templateId != null && String(ps.promptMeta.templateId).trim()){
      return String(ps.promptMeta.templateId).trim().slice(0, 48);
    }
    if (p === 'velocity_shape' && ps.velocityShape && typeof ps.velocityShape === 'object'){
      const m = ps.velocityShape.mode;
      if (m != null && String(m).trim()) return t('lastOpt.detail.intentFmt').replace('{n}', String(m).slice(0, 48));
    }
    if (p === 'local_transpose' && ps.localTranspose && typeof ps.localTranspose === 'object'){
      const n = ps.localTranspose.semitone_delta;
      if (Number.isFinite(Number(n))) return t('lastOpt.detail.intentTranspose').replace('{n}', String(n));
    }
    if (p === 'rhythm_tighten_loosen' && ps.rhythm && typeof ps.rhythm === 'object'){
      const m = ps.rhythm.mode;
      if (m != null && String(m).trim()) return t('lastOpt.detail.intentFmt').replace('{n}', String(m).slice(0, 48));
    }
    return '';
  },

  _renderLastOptimizeDetailsBody(){
    const body = (typeof document !== 'undefined') ? document.getElementById('studioLastOptimizeDetailsBody') : null;
    if (!body) return;
    const t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
    while (body.firstChild) body.removeChild(body.firstChild);
    const addRow = (labelKey, valueStr) => {
      const row = document.createElement('div');
      row.className = 'lastOptDetailRow';
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = t(labelKey);
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = valueStr;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    };
    const s = this._lastOptimizeSnapshot;
    if (!s || !s.res){
      const p = document.createElement('div');
      p.style.opacity = '0.9';
      p.textContent = t('lastOpt.detail.empty');
      body.appendChild(p);
      return;
    }
    const res = s.res;
    const ps = (res.patchSummary && typeof res.patchSummary === 'object') ? res.patchSummary : null;
    const pathRaw = (res.executionPath != null && String(res.executionPath).trim() !== '') ? String(res.executionPath).trim()
      : (ps && ps.executionPath) ? String(ps.executionPath) : '';
    const pathStr = String(pathRaw || '');
    addRow('lastOpt.detail.lblPath', this._lastOptPathLabel(pathRaw || 'unknown', t));
    if (!res.ok){
      addRow('lastOpt.detail.lblOutcome', this._lastOptFailureDetail(res, t));
    } else {
      const ops = (res.ops != null) ? Number(res.ops) : 0;
      const noCh = (ps && ps.noChanges === true) || ops === 0;
      let outcomeLine = '';
      if (pathStr === 'llm'){
        const lo = res.llmOutcome || (ps && ps.llm && ps.llm.outcome) || '';
        outcomeLine = this._lastOptLlmOutcomeLabel(lo, t);
      } else {
        outcomeLine = this._lastOptDeterministicOutcome(ps, ops, noCh, t);
      }
      addRow('lastOpt.detail.lblOutcome', outcomeLine);
      addRow('lastOpt.detail.lblOps', String(ops));
      const revNew = !noCh && ops > 0;
      addRow('lastOpt.detail.lblRevision', revNew ? t('lastOpt.rev.newVersion') : t('lastOpt.rev.noChange'));
    }
    const stale = (typeof this._isLastOptimizeSnapshotStale === 'function') && this._isLastOptimizeSnapshotStale();
    addRow('lastOpt.detail.lblStale', stale ? t('lastOpt.detail.valStale') : t('lastOpt.detail.valCurrent'));
    if (s.clipId) addRow('lastOpt.detail.lblClip', String(s.clipId).slice(0, 28));
    if (ps && ps.executedPreset != null && String(ps.executedPreset).trim()){
      addRow('lastOpt.detail.lblPreset', String(ps.executedPreset).slice(0, 48));
    }
    const intentLine = this._lastOptIntentDetailLine(ps, pathRaw, t);
    if (intentLine) addRow('lastOpt.detail.lblIntent', intentLine);
    if (pathStr === 'llm' && ps && ps.llm && typeof ps.llm === 'object' && ps.llm.preRequestExit === true){
      addRow('lastOpt.detail.lblNote', t('lastOpt.detail.preRequest'));
    }
    if (pathStr === 'llm'){
      const llmB = ps && ps.llm && typeof ps.llm === 'object' ? ps.llm : null;
      const total = llmB && (llmB.totalAttempts != null) ? Number(llmB.totalAttempts)
        : (res.llmDebug && res.llmDebug.totalAttempts != null) ? Number(res.llmDebug.totalAttempts) : null;
      const finalIdx = llmB && (llmB.finalAttemptIndex != null) ? Number(llmB.finalAttemptIndex)
        : (res.llmDebug && res.llmDebug.finalAttemptIndex != null) ? Number(res.llmDebug.finalAttemptIndex) : null;
      if (total != null && Number.isFinite(total) && total >= 1){
        addRow('lastOpt.detail.lblRetries', t('lastOpt.detail.retryFmt')
          .replace('{total}', String(Math.min(Math.floor(total), 99)))
          .replace('{final}', (finalIdx != null && Number.isFinite(finalIdx)) ? String(Math.floor(finalIdx)) : '—'));
      }
    }
  },

  _renderLastOptimizeDetailsBodyIfOpen(){
    if (!this._lastOptimizeDetailsOpen) return;
    this._renderLastOptimizeDetailsBody();
  },

  _closeLastOptimizeDetails(){
    const panel = (typeof document !== 'undefined') ? document.getElementById('studioLastOptimizeDetails') : null;
    const btn = (typeof document !== 'undefined') ? document.getElementById('btnLastOptimizeDetails') : null;
    if (panel) panel.classList.add('hidden');
    if (panel) panel.setAttribute('aria-hidden', 'true');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    this._lastOptimizeDetailsOpen = false;
    if (this._lastOptimizeDetailsOnDocDown){
      document.removeEventListener('pointerdown', this._lastOptimizeDetailsOnDocDown, true);
      this._lastOptimizeDetailsOnDocDown = null;
    }
    if (this._lastOptimizeDetailsOnKey){
      document.removeEventListener('keydown', this._lastOptimizeDetailsOnKey);
      this._lastOptimizeDetailsOnKey = null;
    }
  },

  _openLastOptimizeDetails(){
    const panel = (typeof document !== 'undefined') ? document.getElementById('studioLastOptimizeDetails') : null;
    const btn = (typeof document !== 'undefined') ? document.getElementById('btnLastOptimizeDetails') : null;
    if (!panel) return;
    this._closeLastOptimizeDetails();
    this._renderLastOptimizeDetailsBody();
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    this._lastOptimizeDetailsOpen = true;
    const app = this;
    this._lastOptimizeDetailsOnDocDown = function(ev){
      const raw = ev.target;
      const node = (raw && raw.nodeType === 1) ? raw : (raw && raw.parentElement);
      if (!node || typeof node.closest !== 'function') return;
      if (node.closest('#studioLastOptimizeDetails') || node.closest('#btnLastOptimizeDetails')) return;
      app._closeLastOptimizeDetails();
    };
    document.addEventListener('pointerdown', this._lastOptimizeDetailsOnDocDown, true);
    this._lastOptimizeDetailsOnKey = function(ev){
      if (ev.key === 'Escape') app._closeLastOptimizeDetails();
    };
    document.addEventListener('keydown', this._lastOptimizeDetailsOnKey);
  },

  _toggleLastOptimizeDetails(){
    if (this._lastOptimizeDetailsOpen) this._closeLastOptimizeDetails();
    else this._openLastOptimizeDetails();
  },

  _initLastOptimizeDetails(){
    try{
      if (typeof document === 'undefined') return;
      if (this._lastOptimizeDetailsInitialized) return;
      const btn = document.getElementById('btnLastOptimizeDetails');
      const closeBtn = document.getElementById('btnLastOptimizeDetailsClose');
      if (!btn) return;
      this._lastOptimizeDetailsInitialized = true;
      this._lastOptimizeDetailsOpen = false;
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (e) {} this._toggleLastOptimizeDetails(); });
      if (closeBtn) closeBtn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (e) {} this._closeLastOptimizeDetails(); });
    }catch(e){ console.warn('[lastOpt] _initLastOptimizeDetails failed', e); }
  },

// PR-5: Undo Optimize — rollback clip to parent revision (atomic: setProjectFromV2 + commitV2).
rollbackClipRevision(clipId){
  const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
  if (!P || typeof P.rollbackClipRevision !== 'function') return { ok: false, reason: 'no_rollback' };
  const p2 = this.getProjectV2();
  if (!p2 || !p2.clips || !p2.clips[clipId]) return { ok: false, reason: 'clip_not_found' };
  const res = P.rollbackClipRevision(p2, clipId);
  if (res && res.ok && res.changed) this.setProjectFromV2(p2);
  return res || { ok: false, reason: 'rollback_failed' };
},

    state: {
      selectedInstanceId: null,
      selectedClipId: null,
      activeTrackIndex: 0,
      activeTrackId: null,
      draggingInstance: null,
      dragCandidate: null,
      dragOffsetX: 0,
      transportPlaying: false,
      transportStartPerf: 0,
      lastUploadTaskId: null,
      recordingActive: false,
      lastRecordedFile: null,
      importCancelled: false,
      autoOpenAfterImport: true,
      statusText: '', // PR-UX3a: central status for log status bar (set by setImportStatus, etc.)
      aiSettingsOpen: false, // PR-UX4c: AI Settings drawer visibility
      aiAssistOpen: true, // PR-UX7a1: default open on first use; persisted in LS
      modal: {
        show: false,
        clipId: null,
        draftScore: null,
        savedScore: null,
        dirty: false,
        cursorSec: 0,
        selectedNoteId: null,
        selectedCell: null, // {startSec, pitch}
        pxPerSec: 180,
        pitchCenter: 60,
        pitchViewRows: 36,
        rowH: 16,
        padL: 60,
        padT: 20,
        mode: 'none', // drag_note | resize_note | drag_velocity | resize_velocity_lane
        drag: {
          noteId: null,
          startX: 0,
          startY: 0,
          origStart: 0,
          origPitch: 60,
          origDur: 0.3,
          origVelocity: 80,
        },
        velocityLaneHeight: 80,
        velocityLaneCollapsed: false,
        isPlaying: false,
        snapLastNonOff: '16',
        synth: null,
        raf: 0,
      },
    },

    init(){
      const restored = restore();

      // Storage is beats-only (v2). Convert to a v1 (seconds) view for current UI/controllers.
      if (restored && _isProjectV2(restored)){
        this.project = _projectV2ToV1View(restored);
      } else {
        this.project = restored || H2SProject.defaultProject();
      }

      
// Wire AgentController (Optimize) if available
try{
  const ROOT = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : {});
  if (ROOT.H2SAgentController && typeof ROOT.H2SAgentController.create === 'function'){
    // AgentController expects v2 hooks + persist/render callbacks
    // PR-3/PR-5c: Pass getOptimizeOptions(clipId) so agent controller gets per-clip preset
    this.agentCtrl = ROOT.H2SAgentController.create({
      app: this,
      getProjectV2: () => this.getProjectV2(),
      setProjectFromV2: (p2) => this.setProjectFromV2(p2),
      persist: () => persist(),
      render: () => this.render(),
      getOptimizeOptions: (clipId) => this.getOptimizeOptions(clipId),
    });
  }
}catch(e){
  console.warn('AgentController init failed', e);
}

// PR-5f: hydrate per-clip optimize options from localStorage (survives hard refresh)
if (typeof localStorage !== 'undefined') {
  try {
    const stored = _readLS(LS_KEY_OPT_OPTIONS);
    if (stored && typeof stored === 'object') {
      this._optOptionsByClipId = Object.assign({}, this._optOptionsByClipId, stored);
      for (const cid of Object.keys(stored)) {
        const o = stored[cid];
        this._optPresetByClipId[cid] = (o && o.requestedPresetId != null) ? o.requestedPresetId : null;
      }
    }
  } catch (e) { console.warn('[App] hydrate opt options failed', e); }
}

// Ensure minimal structure
      if (!this.project.tracks || this.project.tracks.length === 0){
        this.project.tracks = [{id:H2SProject.uid('trk_'), name:'Track 1'}];
      }
      if (!Array.isArray(this.project.clips)) this.project.clips = [];
      if (!Array.isArray(this.project.instances)) this.project.instances = [];

      // Bind UI
      $('#btnUpload').addEventListener('click', () => this.pickWavAndGenerate());
      const btnImportAudioClip = $('#btnImportAudioClip');
      if (btnImportAudioClip) btnImportAudioClip.addEventListener('click', () => { this.importAudioFileAsNativeClip(); });
      $('#btnClear').addEventListener('click', () => this.clearProject());
      $('#btnClearLog').addEventListener('click', () => { $('#log').textContent = ''; _lastLogLine = ''; if (typeof this.updateLogStatusBar === 'function') this.updateLogStatusBar(); });
      // PR-UX3a: Log panel — restore open state from localStorage, bind status bar click to toggle
      const logOpen = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY_LOG_OPEN) === '1');
      this.setLogOpen(logOpen);
      const logBar = $('#logStatusBar');
      if (logBar) logBar.addEventListener('click', () => { const open = !$('#logPanel').classList.contains('collapsed'); this.setLogOpen(!open); });

      // PR-UX3b: persist Inspector section collapse state when user toggles
      const inspProject = $('#inspProject');
      const inspExport = $('#inspExport');
      if (inspProject) inspProject.addEventListener('toggle', () => { setInspectorSectionOpen('project', inspProject.open); });
      if (inspExport) inspExport.addEventListener('toggle', () => { setInspectorSectionOpen('export', inspExport.open); });

      // PR-UX4c: AI Settings drawer — restore open state, bind open/close
      if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY_AI_DRAWER_OPEN) === '1') this.state.aiSettingsOpen = true;
      // PR-UX7a1: AI Assistant dock — default open on first use; persist once user toggles
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(LS_KEY_AI_ASSIST_OPEN);
        this.state.aiAssistOpen = (stored === null) ? true : (stored === '1');
      }
      this._initAiSettingsDrawer();
      this._initAiAssistDock();

      // PR-UX6b: Status bar integrates with runCommand events
      this.onCommandEvent((ev) => {
        const cmd = ev.command;
        if (cmd === 'open_ai_settings' || cmd === 'close_ai_settings') return;
        if (ev.type === 'started') {
          const text = this._cmdLabel(cmd);
          if (text) this.setImportStatus(text, false);
        } else if (ev.type === 'done') {
          const text = this._cmdDoneLabel ? this._cmdDoneLabel(cmd) : '';
          if (text) this.setImportStatus(text, false);
          if (text) setTimeout(() => { if (this.state.statusText === text) this.setImportStatus('', false); }, 1500);
        } else if (ev.type === 'failed') {
          const msg = (ev.error && ev.error.message) ? ev.error.message : 'error';
          const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
          this.setImportStatus(_t('cmd.failedPrefix') + ': ' + cmd + ': ' + msg, false);
        }
      });

      $('#inpBpm').addEventListener('change', () => {
        // Safety: changing BPM while the clip editor is open can corrupt
        // the sec<->beat boundary (draft seconds would be reinterpreted).
        if (this.state && this.state.modal && this.state.modal.show){
          alert('Please close the Clip Editor before changing BPM.');
          $('#inpBpm').value = this.project.bpm;
          return;
        }
        const raw = Number($('#inpBpm').value || 120);
        const nextBpm = H2SProject.clamp(raw, 30, 260);
        this.setProjectBpm(nextBpm);
      });

      $('#btnExportProject').addEventListener('click', () => {
        const p2 = _projectV1ToV2(this.project);
        const payload = p2 || this.project;
        const fname = p2 ? `hum2song_project_v2_${Date.now()}.json` : `hum2song_project_${Date.now()}.json`;
        downloadText(fname, JSON.stringify(payload, null, 2));
      });

      $('#btnExportSelectedClip').addEventListener('click', () => {
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
        let clipId = this.state && this.state.selectedClipId;
        if (!clipId && this.state && this.state.selectedInstanceId){
          const inst = (this.project.instances || []).find((x) => x && x.id === this.state.selectedInstanceId);
          if (inst && inst.clipId) clipId = inst.clipId;
        }
        if (!clipId){
          alert(_t('inspector.exportSelectedClipNoSelection'));
          return;
        }
        const p2 = _projectV1ToV2(this.project);
        if (!p2 || !_isProjectV2(p2) || !p2.clips || typeof p2.clips !== 'object'){
          alert(_t('inspector.exportSelectedClipNotFound'));
          return;
        }
        const clip = p2.clips[clipId];
        if (!clip){
          alert(_t('inspector.exportSelectedClipNotFound'));
          return;
        }
        const P = window.H2SProject;
        const clipCopy = (P && typeof P.deepClone === 'function') ? P.deepClone(clip) : JSON.parse(JSON.stringify(clip));
        const bpm = (typeof p2.bpm === 'number' && isFinite(p2.bpm)) ? p2.bpm : 120;
        const bundle = {
          kind: 'hum2song_clip_bundle',
          version: 1,
          exportedAt: Date.now(),
          schemaVersion: 2,
          timebase: 'beat',
          bpm,
          clipId: String(clipId),
          clip: clipCopy,
        };
        downloadText(`hum2song_clip_${Date.now()}.json`, JSON.stringify(bundle, null, 2));
      });

      $('#btnImportProject').addEventListener('click', async () => {
        await this.importProjectJsonFromFile();
      });

      $('#btnImportClip').addEventListener('click', async () => {
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
        const f = await this.pickFile('.json');
        if (!f) return;
        let obj;
        try {
          obj = JSON.parse(await f.text());
        } catch (_e) {
          alert(_t('inspector.importClipInvalid'));
          return;
        }
        if (!_validateHum2songClipBundle(obj)) {
          alert(_t('inspector.importClipInvalid'));
          return;
        }
        const P = window.H2SProject;
        if (!P || typeof P.uid !== 'function' || typeof P.deepClone !== 'function') {
          alert(_t('inspector.importClipInvalid'));
          return;
        }
        this.importClipAsNewIntoCurrentProjectV2(obj.clip, obj.bpm);
      });

      $('#btnImportClipFromProject').addEventListener('click', async () => {
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
        const f = await this.pickFile('.json');
        if (!f) return;
        let obj;
        try {
          obj = JSON.parse(await f.text());
        } catch (_e) {
          alert(_t('inspector.importClipFromProjectInvalidJson'));
          return;
        }
        let p2;
        try {
          p2 = H2SProject.loadProjectDocV2(obj);
        } catch (_e) {
          alert(_t('inspector.importClipFromProjectInvalidProject'));
          return;
        }
        if (!_isProjectV2(p2)) {
          alert(_t('inspector.importClipFromProjectInvalidProject'));
          return;
        }
        const ids = _importableClipIdsFromProjectDoc(p2);
        if (!ids.length) {
          alert(_t('inspector.importClipFromProjectNoClips'));
          return;
        }
        this._pendingClipFromProject = p2;
        this._populateClipFromProjectChooser(ids);
        this._openClipFromProjectModal();
      });

      const cfpBackdrop = $('#clipFromProjectBackdrop');
      if (cfpBackdrop) cfpBackdrop.addEventListener('click', () => { this._closeClipFromProjectModal(); });
      const btnCfpCancel = $('#btnClipFromProjectCancel');
      if (btnCfpCancel) btnCfpCancel.addEventListener('click', () => { this._closeClipFromProjectModal(); });
      const btnCfpImport = $('#btnClipFromProjectImport');
      if (btnCfpImport) btnCfpImport.addEventListener('click', () => {
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
        const sel = $('#selClipFromProject');
        const doc = this._pendingClipFromProject;
        const cid = sel && sel.value;
        if (!doc || !cid || !doc.clips || !doc.clips[cid]) {
          alert(_t('inspector.importClipFromProjectInvalidProject'));
          return;
        }
        this.importClipAsNewIntoCurrentProjectV2(doc.clips[cid], doc.bpm);
        this._closeClipFromProjectModal();
      });

      // Transport buttons
      $('#btnPlayProject').addEventListener('click', (ev) => { try{ _unlockAudioFromGesture(); }catch(e){} return this.playProject(); });
      $('#btnStop').addEventListener('click', () => { this.stopProjectReset(); });
      $('#btnRecord').addEventListener('click', () => {
        try{ _unlockAudioFromGesture(); }catch(e){}
        if (this.state.recordingActive) this.stopRecording();
        else this.startRecording();
      });
      $('#btnUseLast').addEventListener('click', () => this.useLastRecording());
      $('#btnPlayLast').addEventListener('click', () => { try{ _unlockAudioFromGesture(); }catch(e){} this.playLastRecording(); });
      const btnAddLastAsAudio = $('#btnAddLastAsAudio');
      if (btnAddLastAsAudio) btnAddLastAsAudio.addEventListener('click', () => { this.addLastRecordingAsNativeAudioClip(); });
      const chkAutoOpen = $('#chkAutoOpenAfterImport');
      if (chkAutoOpen) {
        chkAutoOpen.checked = !!this.state.autoOpenAfterImport;
        chkAutoOpen.addEventListener('change', () => { this.state.autoOpenAfterImport = chkAutoOpen.checked; });
      }
      const btnCancelImport = $('#btnCancelImport');
      if (btnCancelImport) btnCancelImport.addEventListener('click', () => { this.state.importCancelled = true; });
      this._initMasterVolumeUI();
      $('#btnPlayheadToStart').addEventListener('click', () => { this.project.ui.playheadSec = 0; persist(); this.render(); });

      // PR-INS2c: Instrument Library (sampler baseUrl)
      this._initInstrumentLibraryUI();

      // PR-G1b: Language switch (Inspector dropdown)
      this._initLangDropdown();
      this._initBeginnerHintBar();
      this._initLastOptimizeDetails();

      // Modal
      $('#btnModalClose').addEventListener('click', () => this.closeModal(false));
      $('#btnModalCancel').addEventListener('click', () => this.closeModal(false));
      $('#btnModalSave').addEventListener('click', () => this.closeModal(true));

      $('#btnClipPlay').addEventListener('click', (ev) => { try{ _unlockAudioFromGesture(); }catch(e){} return this.modalPlay(); });
      $('#btnClipStop').addEventListener('click', () => this.modalStop());
      $('#btnInsertNote').addEventListener('click', () => this.modalInsertNote());
      $('#btnDeleteNote').addEventListener('click', () => this.modalDeleteSelectedNote());
      $('#selSnap').addEventListener('change', () => {
        // Clip editor snap only (timeline snap has its own dropdown: #selTimelineSnap)
        this.modalRequestDraw();
      });
$('#rngPitchCenter').addEventListener('input', () => {
        const v = Number($('#rngPitchCenter').value || 60);
        this.state.modal.pitchCenter = H2SProject.clamp(v, 0, 127);
        this.modalRequestDraw();
      });

      // Canvas interactions (grid + velocity lane + splitter)
      const canvas = $('#canvas');
      const velocityCanvas = $('#velocityCanvas');
      const velocitySplitter = $('#velocitySplitter');
      if (canvas) canvas.addEventListener('pointerdown', (ev) => this.modalPointerDown(ev));
      if (velocityCanvas && !velocityCanvas.__h2s_vel_bound) {
        velocityCanvas.__h2s_vel_bound = true;
        velocityCanvas.addEventListener('pointerdown', (ev) => this.modalPointerDown(ev));
      }
      if (velocitySplitter && !velocitySplitter.__h2s_vel_bound) {
        velocitySplitter.__h2s_vel_bound = true;
        velocitySplitter.addEventListener('pointerdown', (ev) => this.modalPointerDown(ev));
      }
      window.addEventListener('pointermove', (ev) => this.modalPointerMove(ev));
      window.addEventListener('pointerup', (ev) => this.modalPointerUp(ev));

      window.addEventListener('keydown', (ev) => {
        const cfp = $('#clipFromProjectModal');
        if (cfp && !cfp.classList.contains('hidden')){
          if (ev.key === 'Escape'){
            this._closeClipFromProjectModal();
            ev.preventDefault();
            return;
          }
        }
        const ph = $('#projectHomeModal');
        if (ph && !ph.classList.contains('hidden')){
          if (ev.key === 'Escape'){
            this._dismissProjectHomeAuto();
            ev.preventDefault();
            return;
          }
        }
        const path = (ev.composedPath && ev.composedPath()) || (ev.target ? [ev.target] : []);
        const inInput = path.some((el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
        if (inInput) return;
        if (!this.state.modal.show){
          if (ev.key === 'r' || ev.key === 'R'){ try{ _unlockAudioFromGesture(); }catch(e){} if (this.state.recordingActive) this.stopRecording(); else this.startRecording(); ev.preventDefault(); }
          if (ev.key === 's' || ev.key === 'S'){ if (!this.state.recordingActive) this.stopProjectReset(); ev.preventDefault(); }
          return;
        }
        if (ev.key === 'Escape'){ this.closeModal(false); ev.preventDefault(); }
        if (ev.key === 'Delete' || ev.key === 'Backspace'){ this.modalDeleteSelectedNote(); ev.preventDefault(); }
        if (ev.key === ' '){ this.modalTogglePlay(); ev.preventDefault(); }
        if (ev.key === 'q' || ev.key === 'Q'){ this.modalToggleSnap(); ev.preventDefault(); }
        if (ev.key === '['){ this.modalAdjustSnap(-1); ev.preventDefault(); }
        if (ev.key === ']'){ this.modalAdjustSnap(+1); ev.preventDefault(); }
      });

      // Clip Library controller (render + event binding)
      // IMPORTANT: keep library logic out of app.js so UI tweaks won't break timeline/editor.
      try{
        if (window.H2SLibraryController && window.H2SLibraryController.create){
          this.libraryCtrl = window.H2SLibraryController.create({
            app: this,
            getProjectV2: () => this.getProjectV2(),
            rootEl: $('#clipList'),
            getProject: () => this.project,
            fmtSec,
            escapeHtml,
            onPlay: (clipId) => this.playClip(clipId),
            onAdd: (clipId) => this.addClipToTimeline(clipId),
            onEdit: (clipId) => this.openClipEditor(clipId),
            onRemove: (clipId) => this.deleteClip(clipId),
            onOptimize: (clipId) => this.optimizeClip(clipId),
            onSelectClip: (clipId) => { this.state.selectedClipId = clipId; this.state.selectedInstanceId = null; this.render(); },
          });
        }
      }catch(e){
        console.warn('LibraryController init failed', e);
      }


      // Fallback: ensure Optimize button always triggers, even if a controller binding is missing.
      // We only intercept data-act="optimize" and leave other actions to the existing controller.
      try{
        const clipList = $('#clipList');
        if (clipList && !clipList.__h2sOptFallbackBound){
          clipList.__h2sOptFallbackBound = true;
          clipList.addEventListener('click', (e)=>{
            const btn = e.target && e.target.closest ? e.target.closest('[data-act="optimize"]') : null;
            if (!btn) return;
            const clipId = btn.getAttribute('data-id') || btn.getAttribute('data-clip-id');
            if (!clipId) return;
            // Prevent double-handling if another listener exists.
            e.preventDefault();
            e.stopPropagation();
            Promise.resolve(this.optimizeClip(clipId)).catch(err=>console.warn('[App] optimizeClip failed', err));
          }, true); // capture
        }
      }catch(_){}

      // Selection / Inspector controller (render + shortcuts)
      // IMPORTANT: must NOT rebuild timeline DOM; only touches #selectionBox.
      try{
        if (window.H2SSelectionController && window.H2SSelectionController.create){
          this.selectionCtrl = window.H2SSelectionController.create({
            rootEl: $('#selectionBox'),
            getProject: () => this.project,
            getState: () => this.state,
            fmtSec,
            escapeHtml,
            onEditClip: (clipId) => this.openClipEditor(clipId),
            onDuplicateInstance: (instId) => this.duplicateInstance(instId),
            onRemoveInstance: (instId) => this.deleteInstance(instId),
            onLog: log,
          });
        }
      }catch(e){
        console.warn('SelectionController init failed', e);
      }

      // Audio controller (project playback + clip preview)
      // Editor runtime: modal editing logic is modularized into controllers/editor_runtime.js
      try{
        if(window.H2SEditorRuntime && window.H2SEditorRuntime.create){
          this.editorRt = window.H2SEditorRuntime.create({
            getProject: () => this.project,
            getState: () => this.state,
            persist,
            render: () => this.render(),
            log,
            $,
            $$,
            fmtSec,
            escapeHtml,
          
// v2 boundary helpers (do NOT let runtime touch localStorage)
getProjectV2: () => this.getProjectV2(),
commitV2: (p2, reason) => this.commitV2(p2, reason),
persistFromV1: (reason) => this.persistFromV1(reason),
H2SProject: (typeof window !== 'undefined') ? window.H2SProject : null,
          });
          log('EditorRuntime ready.');
        } else {
          console.warn('[EditorRuntime] Not available (script missing).');
        }
      } catch(e){
        console.warn('[EditorRuntime] init failed', e);
      }
      try{
        if (window.H2SAudioController && window.H2SAudioController.create){
          this.audioCtrl = window.H2SAudioController.create({
            getProject: () => this.project,
            // Beats-based document for project playback scheduling (T2 uses flatten(ProjectDocV2)).
            getProjectV2: () => this.getProjectV2(),
            // legacy compat (some audio builds read getProjectDoc)
            getProjectDoc: () => this.getProjectV2(),
            getState: () => this.state,
            setTransportPlaying: (v) => { this.state.transportPlaying = !!v; },
            onUpdatePlayhead: (sec) => {
              this.project.ui.playheadSec = sec;
              const bpm = (this.project && typeof this.project.bpm === 'number') ? this.project.bpm : 120;
              const beat = (sec * bpm) / 60;
              $('#lblPlayhead').textContent = `${((window.I18N && window.I18N.t) ? window.I18N.t('timeline.playhead') : 'Playhead')}: ${fmtSec(sec)} (${beat.toFixed(2)}b)`;
              if (this.timelineCtrl && typeof this.timelineCtrl.setPlayheadSec === 'function'){
                this.timelineCtrl.setPlayheadSec(sec);
              } else {
                this.renderTimeline();
              }
            },
            onLog: log,
            onAlert: (msg) => alert(msg),
            // Persist/render only on discrete stop events (NOT per-frame).
            onStopped: () => { persist(); this.render(); },
          });
        }
      }catch(e){
        console.warn('AudioController init failed', e);
      }


      // Ensure timeline snap dropdown exists before TimelineController binds.
      this._ensureTimelineSnapSelect();



// Timeline controller (stable drag + dblclick; avoids DOM rebuild between clicks)
try{
  this.timelineCtrl = window.H2STimeline && window.H2STimeline.create ? window.H2STimeline.create({
    tracksEl: $('#tracks'),
    getProject: () => this.project,
    getState: () => this.state,
    onSelectInstance: (instId, el) => {
      this.state.selectedInstanceId = instId;
      const inst = (this.project.instances || []).find(x => x && x.id === instId);
      if (inst && inst.clipId) this.state.selectedClipId = inst.clipId; // Do NOT clear; keep previous if inst has no clipId
      if (inst && Number.isFinite(inst.trackIndex)) this.setActiveTrackIndex(inst.trackIndex);

      // Toggle selected class in-place (no timeline rebuild — preserves dblclick + live drag)
      if (this._selectedInstEl && this._selectedInstEl !== el){
        try{ this._selectedInstEl.classList.remove('selected'); }catch(e){}
      }
      if (el){
        el.classList.add('selected');
        this._selectedInstEl = el;
      }
      // Targeted updates only: inspector, selection UI, library highlight, AI target. Do NOT render timeline.
      this.renderInspector();
      this.renderSelection();
      this.renderSelectedClip();
      if (this.libraryCtrl && this.libraryCtrl.render) this.libraryCtrl.render();
      this._renderAiAssistDock();
      try{ this._initMasterVolumeUI(); }catch(e){}
    },
    onOpenClipEditor: (clipId) => this.openClipEditor(clipId),
    onOpenInspectorOptimize: () => this.runCommand('open_inspector_optimize'),
    onAddClipToTimeline: (clipId, startSec, trackIndex) => this.addClipToTimeline(clipId, startSec, trackIndex),
    onSetActiveTrackIndex: (ti) => this.setActiveTrackIndex(ti),
    onSetTrackInstrument: (trackId, instrument) => this.setTrackInstrument(trackId, instrument),
    onSetTrackGainDb: (trackId, gainDb) => this.setTrackGainDb(trackId, gainDb),
    onPersistAndRender: () => { persist(); this.render(); },
    onRemoveInstance: (instId) => this.deleteInstance(instId),
    escapeHtml,
    fmtSec,
    // Click empty timeline -> move playhead (seek if playing, persist if stopped)
    onMovePlayheadSec: (sec) => {
      this.project.ui.playheadSec = sec;
      const bpm = (this.project && typeof this.project.bpm === 'number') ? this.project.bpm : 120;
      const beat = (sec * bpm) / 60;
      $('#lblPlayhead').textContent = `${((window.I18N && window.I18N.t) ? window.I18N.t('timeline.playhead') : 'Playhead')}: ${fmtSec(sec)} (${beat.toFixed(2)}b)`;

      if (this.timelineCtrl && typeof this.timelineCtrl.setPlayheadSec === 'function'){
        this.timelineCtrl.setPlayheadSec(sec);
      }

      if (this.state.transportPlaying && this.audioCtrl && typeof this.audioCtrl.seekSec === 'function'){
        // Avoid persisting/rebuilding during playback; stop+reschedule inside seekSec().
        this.audioCtrl.seekSec(sec);
        return;
      }
      // Not playing: persist and re-render so the new playhead is saved.
      persist();
      this.render();
    },
    // Optional: label width and drag threshold
    labelWidthPx: 120,
    dragThresholdPx: 4,
  }) : null;
}catch(e){
  console.warn('Timeline controller init failed:', e);
  this.timelineCtrl = null;
}

      this.render();
      log('UI ready.');

      // Project Home MVP: toolbar entry + optional first-load auto-open
      const phModal = $('#projectHomeModal');
      if (phModal){
        const btnPh = $('#btnProjectHome');
        if (btnPh) btnPh.addEventListener('click', () => { this.openProjectHome(); });
        const bd = $('#projectHomeBackdrop');
        if (bd) bd.addEventListener('click', () => { this._dismissProjectHomeAuto(); });
        const btnCont = $('#btnProjectHomeContinue');
        if (btnCont) btnCont.addEventListener('click', () => { this._dismissProjectHomeAuto(); });
        const btnNew = $('#btnProjectHomeNew');
        if (btnNew) btnNew.addEventListener('click', () => {
          this.createNewLocalProject();
          this._dismissProjectHomeAuto();
        });
        const btnImp = $('#btnProjectHomeImport');
        if (btnImp) btnImp.addEventListener('click', async () => {
          const ok = await this.importProjectJsonFromFile({ asNewLocalProject: true });
          if (ok) this._dismissProjectHomeAuto();
        });
        try{
          if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY_SKIP_PROJECT_HOME_AUTO) !== '1'){
            this.openProjectHome();
          }
        }catch(e){}
      }
    },

    // Ensure the Timeline Snap dropdown exists in the DOM.
    // TimelineController will bind to #selTimelineSnap if present.
    _ensureTimelineSnapSelect(){
      try {
        if (typeof document === 'undefined') return;
        if (document.getElementById('selTimelineSnap')) return;

        const bpmInp = document.getElementById('inpBpm');
        if (!bpmInp) return;

        const label = document.createElement('span');
        label.setAttribute('data-i18n', 'timeline.snapLabel');
        label.textContent = (window.I18N && window.I18N.t) ? window.I18N.t('timeline.snapLabel') : 'Snap:';
        label.className = 'miniLabel';

        const sel = document.createElement('select');
        sel.id = 'selTimelineSnap';
        sel.className = 'mini';
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
        const opts = [
          {v:'off', k:'snap.off'},
          {v:'4', k:'snap.1_4'},
          {v:'8', k:'snap.1_8'},
          {v:'16', k:'snap.1_16'},
          {v:'32', k:'snap.1_32'},
        ];
        for (const o of opts){
          const op = document.createElement('option');
          op.value = o.v;
          op.textContent = _t(o.k);
          sel.appendChild(op);
        }
        sel.value = '16';

        // Insert right after the BPM input so it's always visible.
        bpmInp.insertAdjacentElement('afterend', sel);
        sel.insertAdjacentElement('beforebegin', label);
      } catch (e) {
        // Never break UI init for a convenience widget.
        console.warn('[app] _ensureTimelineSnapSelect failed', e);
      }
    },


    /**
     * Change BPM while preserving beat-positions (no visual drift).
     *
     * Rule:
     * - Beats are the source-of-truth (ProjectDoc v2).
     * - UI stays in a v1 seconds-view, but it must keep pxPerBeat constant;
     *   therefore pxPerSec/startSec/playheadSec are re-derived from beats.
     * - If currently playing, we stop+reschedule from the same beat.
     */
    setProjectBpm(nextBpm){
      const oldBpm = (this.project && typeof this.project.bpm === 'number') ? this.project.bpm : 120;
      const bpm = H2SProject.clamp(Number(nextBpm || oldBpm), 30, 260);
      if (bpm === oldBpm){
        $('#inpBpm').value = bpm;
        return;
      }

      const curSec = (this.project && this.project.ui && typeof this.project.ui.playheadSec === 'number') ? this.project.ui.playheadSec : 0;
      const curBeat = (curSec * oldBpm) / 60;
      const wasPlaying = !!(this.state && this.state.transportPlaying && this.audioCtrl && this.audioCtrl.isPlaying && this.audioCtrl.isPlaying());

      // Preferred path: roundtrip through ProjectDoc v2 so ALL derived seconds fields
      // (instances, scores, meta.spanSec, etc.) stay consistent.
      const p2 = _projectV1ToV2(this.project);
      if (p2 && _isProjectV2(p2)){
        p2.bpm = bpm;
        p2.ui = p2.ui || {};
        // Preserve beat position for playhead.
        p2.ui.playheadBeat = Math.max(0, curBeat);
        _ensureCurrentProjectIdForWrite();
        const bpmKey = _getActiveProjectDocStorageKey();
        if (bpmKey){
          _writeLS(bpmKey, p2);
          this._projectV2 = p2;
          _touchCurrentProjectIndexFromDoc(p2);
        }
        try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
        this.project = _projectV2ToV1View(p2);
      } else {
        // Fallback path (should be rare): scale all seconds by oldBpm/bpm.
        const scale = oldBpm / bpm;
        this.project.bpm = bpm;
        this.project.ui = this.project.ui || {};
        if (typeof this.project.ui.playheadSec === 'number') this.project.ui.playheadSec *= scale;
        if (typeof this.project.ui.pxPerSec === 'number') this.project.ui.pxPerSec /= scale; // keep pxPerBeat constant
        if (Array.isArray(this.project.instances)){
          for (const inst of this.project.instances){
            if (typeof inst.startSec === 'number') inst.startSec *= scale;
          }
        }
        if (Array.isArray(this.project.clips)){
          for (const clip of this.project.clips){
            if (clip && clip.score && Array.isArray(clip.score.notes)){
              for (const n of clip.score.notes){
                if (typeof n.start === 'number') n.start *= scale;
                if (typeof n.dur === 'number') n.dur *= scale;
              }
            }
            if (clip && clip.meta && typeof clip.meta.spanSec === 'number') clip.meta.spanSec *= scale;
          }
        }
      }

      $('#inpBpm').value = this.project.bpm;
      persist();
      this.render();
      log('BPM set: ' + this.project.bpm);

      // If playing: stop+reschedule from the same beat.
      if (wasPlaying && this.audioCtrl && typeof this.audioCtrl.seekBeat === 'function'){
        this.audioCtrl.seekBeat(curBeat);
      }
    },

addTrack(){
  // v2-only mutation: add a new track and persist via setProjectFromV2
  const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
  const p2 = this.getProjectV2 && this.getProjectV2();
  if (!p2 || !P) { console.error('[App] addTrack: missing project v2 or H2SProject'); return; }
  if (!Array.isArray(p2.tracks)) p2.tracks = [];
  const id = (P && typeof P.uid === 'function') ? P.uid('trk_') : ('trk_' + Math.random().toString(16).slice(2,10));
  const name = 'Track ' + (p2.tracks.length + 1);
  p2.tracks.push({ id, name, instrument: 'default', gainDb: 0, muted: false });
  // Make the new track active
  this.state.activeTrackIndex = Math.max(0, p2.tracks.length - 1);
  this.state.activeTrackId = id;
  if (typeof this.setProjectFromV2 === 'function') this.setProjectFromV2(p2);
  else { this.project = p2; if (typeof this.persist === 'function') this.persist(); if (typeof this.render === 'function') this.render(); }
},

removeActiveTrack(){
  const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
  const p2 = this.getProjectV2 && this.getProjectV2();
  if (!p2 || !P) { console.error('[App] removeActiveTrack: missing project v2 or H2SProject'); return; }
  if (!Array.isArray(p2.tracks) || p2.tracks.length <= 1){
    console.warn('[App] removeActiveTrack: cannot remove last track');
    return;
  }
  const idx = Math.max(0, Math.min(p2.tracks.length - 1, Number(this.state.activeTrackIndex||0)));
  const tid = p2.tracks[idx] && p2.tracks[idx].id;
  if (!tid){ console.error('[App] removeActiveTrack: active track id missing'); return; }

  // Remove instances on that track (v2 instances is an array)
  if (Array.isArray(p2.instances)){
    p2.instances = p2.instances.filter(inst => inst && inst.trackId !== tid);
  }
  p2.tracks.splice(idx, 1);

  // Clamp active
  const nextIdx = Math.max(0, Math.min(p2.tracks.length - 1, idx));
  const nextId = p2.tracks[nextIdx] && p2.tracks[nextIdx].id;
  this.state.activeTrackIndex = nextIdx;
  this.state.activeTrackId = nextId || null;

  if (typeof this.setProjectFromV2 === 'function') this.setProjectFromV2(p2);
  else { this.project = p2; if (typeof this.persist === 'function') this.persist(); if (typeof this.render === 'function') this.render(); }
},

ensureTrackButtons(){
  if (typeof document === 'undefined') return;
  const kv = document.getElementById('kvTracks');
  if (!kv) return;
  const row = kv.parentElement;
  if (!row) return;
  if (row.querySelector('[data-act="addTrack"]')) return;

  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.gap = '6px';
  wrap.style.marginLeft = '8px';

  const btnAdd = document.createElement('button');
  btnAdd.className = 'btn';
  btnAdd.textContent = '+';
  btnAdd.title = 'Add track';
  btnAdd.setAttribute('data-act','addTrack');

  const btnDel = document.createElement('button');
  btnDel.className = 'btn';
  btnDel.textContent = '−';
  btnDel.title = 'Remove active track';
  btnDel.setAttribute('data-act','removeTrack');

  wrap.appendChild(btnAdd);
  wrap.appendChild(btnDel);
  row.appendChild(wrap);

  btnAdd.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); this.addTrack(); });
  btnDel.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); this.removeActiveTrack(); });
},

    // PR-UX7a: AI Assistant dock — init bindings (guard against double bind)
    _initAiAssistDock(){
      if (this._aiAssistBound) return;
      this._aiAssistBound = true;
      this._aiAssistItems = this._aiAssistItems || [];
      this._aiAssistDebugExpanded = this._aiAssistDebugExpanded || {};
      const header = document.getElementById('aiAssistHeader');
      const sendBtn = document.getElementById('aiAssistSend');
      const inp = document.getElementById('aiAssistInput');
      const body = document.getElementById('aiAssistBody');
      if (inp) inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this._aiAssistSend(); }
      });
      if (header) header.addEventListener('click', () => {
        this.state.aiAssistOpen = !this.state.aiAssistOpen;
        try { localStorage.setItem(LS_KEY_AI_ASSIST_OPEN, this.state.aiAssistOpen ? '1' : '0'); } catch (e) {}
        this.render();
      });
      if (sendBtn) sendBtn.addEventListener('click', () => this._aiAssistSend());
      if (body) body.addEventListener('click', (ev) => {
        const t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        const act = t && t.getAttribute && t.getAttribute('data-act');
        const clipId = t && t.getAttribute && t.getAttribute('data-clip-id');
        if (!act || !clipId) return;
        if (act === 'aiRun') this._aiAssistRun(clipId, t);
        else if (act === 'aiOpenOptimize') this.runCommand('open_inspector_optimize');
        else if (act === 'aiUndo') this._aiAssistUndo(clipId);
        else if (act === 'aiDebugToggle'){
          ev.preventDefault();
          const created = t.getAttribute('data-card-created');
          if (created == null) return;
          this._aiAssistDebugExpanded = this._aiAssistDebugExpanded || {};
          const k = String(clipId) + '\0' + String(created);
          this._aiAssistDebugExpanded[k] = !this._aiAssistDebugExpanded[k];
          this.render();
        }
      });
      const handle = document.getElementById('aiAssistResizeHandle');
      if (handle) {
        handle.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); this._aiAssistStartResize(ev); });
      }
    },
    _syncStudioAiDockRightPanelSafeBottom(){
      try {
        const dock = document.getElementById('aiAssistDock');
        if (!dock || typeof document === 'undefined' || !document.documentElement) return;
        const breathing = 16;
        const h = dock.offsetHeight || 28;
        document.documentElement.style.setProperty('--studio-ai-dock-safe-bottom', (h + breathing) + 'px');
      } catch (_e) {}
    },
    _aiAssistStartResize(ev){
      const dock = document.getElementById('aiAssistDock');
      if (!dock || !dock.classList.contains('open')) return;
      ev.preventDefault();
      const MIN_W = 260; const MIN_H = 220; const MAX_W = Math.min(600, (typeof window !== 'undefined' && window.innerWidth) ? Math.floor(window.innerWidth * 0.9) : 600);
      const MAX_H = Math.min(700, (typeof window !== 'undefined' && window.innerHeight) ? Math.floor(window.innerHeight * 0.9) : 700);
      let prevX = ev.clientX; let prevY = ev.clientY;
      let w = dock.offsetWidth; let h = dock.offsetHeight;
      const onMove = (e) => {
        e.preventDefault();
        const dx = e.clientX - prevX; const dy = e.clientY - prevY;
        prevX = e.clientX; prevY = e.clientY;
        w = Math.max(MIN_W, Math.min(MAX_W, w - dx));
        h = Math.max(MIN_H, Math.min(MAX_H, h - dy));
        dock.style.width = w + 'px'; dock.style.height = h + 'px';
        this._aiAssistDockWidth = w; this._aiAssistDockHeight = h;
        this._syncStudioAiDockRightPanelSafeBottom();
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
        this._syncStudioAiDockRightPanelSafeBottom();
      };
      document.addEventListener('pointermove', onMove, { capture: true });
      document.addEventListener('pointerup', onUp, { capture: true });
      document.addEventListener('pointercancel', onUp, { capture: true });
    },
    _aiAssistSend(){
      const inp = document.getElementById('aiAssistInput');
      if (!inp) return;
      const text = String(inp.value || '').trim();
      if (!text) return;
      inp.value = '';
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
      if (_resolveAssistantAddTrackIntentFromText(text)){
        this._aiAssistItems = this._aiAssistItems || [];
        const pending = { type: 'sys', text: _t('aiAssist.addTrackRunning'), _pendingAddTrack: true };
        this._aiAssistItems.push(pending);
        this.render();
        const self = this;
        Promise.resolve(this.runCommand('add_track', {})).then(function(res){
          const idx = (self._aiAssistItems || []).indexOf(pending);
          if (idx >= 0){
            if (res && res.ok){
              const d = res.data || {};
              const ti = (typeof d.trackIndex === 'number' && isFinite(d.trackIndex)) ? d.trackIndex : null;
              const num = (ti != null) ? String(ti + 1) : '?';
              self._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.addTrackOk').replace(/\{n\}/g, num) };
            } else {
              const msg = (res && res.message) ? String(res.message).slice(0, 120) : '';
              self._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.addTrackFail') + (msg ? ': ' + msg : '') };
            }
          }
          self.render();
        }).catch(function(err){
          const idx = (self._aiAssistItems || []).indexOf(pending);
          if (idx >= 0){
            const msg = (err && err.message) ? String(err.message).slice(0, 120) : '';
            self._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.addTrackFail') + (msg ? ': ' + msg : '') };
          }
          self.render();
        });
        return;
      }
      const moveIntent = _resolveAssistantMoveInstanceIntentFromText(text);
      if (moveIntent){
        this._aiAssistItems = this._aiAssistItems || [];
        const instId = this.state && this.state.selectedInstanceId;
        if (!instId){
          this._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.selectInstanceFirst') });
          this.render();
          return;
        }
        const inst = (this.project.instances || []).find(function(x){ return x && x.id === instId; });
        if (!inst){
          this._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.moveInstanceStale') });
          this.render();
          return;
        }
        const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
        const bpm = (this.project && typeof this.project.bpm === 'number' && isFinite(this.project.bpm)) ? this.project.bpm : 120;
        const curBeat = (P && typeof P.secToBeat === 'function') ? P.secToBeat(inst.startSec || 0, bpm) : 0;
        const delta = (moveIntent.direction === 'right') ? moveIntent.deltaBeats : -moveIntent.deltaBeats;
        const rawNext = curBeat + delta;
        const clamped = rawNext < 0;
        let nextBeat = clamped ? 0 : rawNext;
        if (P && typeof P.normalizeBeat === 'function') nextBeat = P.normalizeBeat(nextBeat);
        const pending = { type: 'sys', text: _t('aiAssist.moveInstanceRunning'), _pendingMoveInstance: true };
        this._aiAssistItems.push(pending);
        this.render();
        const self = this;
        const dirWord = _t(moveIntent.direction === 'left' ? 'aiAssist.dirLeft' : 'aiAssist.dirRight');
        Promise.resolve(this.runCommand('move_instance', { instanceId: instId, startBeat: nextBeat })).then(function(res){
          const idx = (self._aiAssistItems || []).indexOf(pending);
          if (idx >= 0){
            if (res && res.ok){
              let msg = _t('aiAssist.moveInstanceOk')
                .replace(/\{dir\}/g, dirWord)
                .replace(/\{delta\}/g, String(moveIntent.deltaBeats));
              if (clamped) msg += ' ' + _t('aiAssist.moveInstanceClamped');
              self._aiAssistItems[idx] = { type: 'sys', text: msg };
            } else {
              const errMsg = (res && res.message) ? String(res.message).slice(0, 120) : '';
              self._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.moveInstanceFail') + (errMsg ? ': ' + errMsg : '') };
            }
          }
          self.render();
        }).catch(function(err){
          const idx = (self._aiAssistItems || []).indexOf(pending);
          if (idx >= 0){
            const errMsg = (err && err.message) ? String(err.message).slice(0, 120) : '';
            self._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.moveInstanceFail') + (errMsg ? ': ' + errMsg : '') };
          }
          self.render();
        });
        return;
      }
      if (_resolveAssistantRemoveInstanceIntentFromText(text)){
        this._aiAssistItems = this._aiAssistItems || [];
        const instIdRm = this.state && this.state.selectedInstanceId;
        if (!instIdRm){
          this._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.selectInstanceFirst') });
          this.render();
          return;
        }
        const instRm = (this.project.instances || []).find(function(x){ return x && x.id === instIdRm; });
        if (!instRm){
          this._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.moveInstanceStale') });
          this.render();
          return;
        }
        const clipRm = (this.project.clips || []).find(function(c){ return c && c.id === instRm.clipId; });
        const confirmLabel = (clipRm && clipRm.name) ? String(clipRm.name).slice(0, 80) : String(instRm.clipId || instIdRm).slice(0, 80);
        const confirmMsg = _t('aiAssist.removeInstanceConfirm').replace(/\{name\}/g, confirmLabel);
        const win = (typeof window !== 'undefined') ? window : null;
        if (!win || typeof win.confirm !== 'function' || !win.confirm(confirmMsg)){
          this._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.removeInstanceCancelled') });
          this.render();
          return;
        }
        const pendingRm = { type: 'sys', text: _t('aiAssist.removeInstanceRunning'), _pendingRemoveInstance: true };
        this._aiAssistItems.push(pendingRm);
        this.render();
        const selfRm = this;
        Promise.resolve(this.runCommand('remove_instance', { instanceId: instIdRm })).then(function(res){
          const idx = (selfRm._aiAssistItems || []).indexOf(pendingRm);
          if (idx >= 0){
            if (res && res.ok){
              selfRm._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.removeInstanceOk') };
            } else {
              const errMsg = (res && res.message) ? String(res.message).slice(0, 120) : '';
              selfRm._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.removeInstanceFail') + (errMsg ? ': ' + errMsg : '') };
            }
          }
          selfRm.render();
        }).catch(function(err){
          const idx = (selfRm._aiAssistItems || []).indexOf(pendingRm);
          if (idx >= 0){
            const errMsg = (err && err.message) ? String(err.message).slice(0, 120) : '';
            selfRm._aiAssistItems[idx] = { type: 'sys', text: _t('aiAssist.removeInstanceFail') + (errMsg ? ': ' + errMsg : '') };
          }
          selfRm.render();
        });
        return;
      }
      const clipId = this.state.selectedClipId;
      if (!clipId) {
        this._aiAssistItems.push({ type: 'sys', text: _t('aiAssist.selectClipFirst') });
      } else {
        const card = { type: 'card', clipId, promptText: text, createdAt: Date.now(), runState: 'idle', usedPresetId: null, resultKind: null, lastError: null };
        const narrow = _resolvePhase1AssistantIntentForSend(text);
        if (narrow && narrow.branch === 'rhythm_tighten_loosen') {
          card.rhythmIntent = narrow.intent;
        } else if (narrow && narrow.branch === 'local_transpose') {
          card.localTransposeIntent = narrow.intent;
        } else if (narrow && narrow.branch === 'velocity_shape') {
          card.velocityShapeIntent = narrow.intent;
        } else {
          const mapped = _mapAiAssistTextToTemplate(text);
          if (mapped.templateId && mapped.intent) {
            card.templateId = mapped.templateId;
            card.templateLabel = mapped.templateLabel;
            card.intent = mapped.intent;
          }
        }
        card.plan = _buildAiAssistPlan(card.templateId || null, card.intent || null, text);
        card.reasoningLog = {
          userPrompt: text.slice(0, 200),
          templateId: card.templateId || null,
          intent: card.intent && typeof card.intent === 'object' ? { fixPitch: !!card.intent.fixPitch, tightenRhythm: !!card.intent.tightenRhythm, reduceOutliers: !!card.intent.reduceOutliers } : null,
          planSummary: (card.plan && card.plan.planTitle) ? String(card.plan.planTitle) : 'Optimize',
          requestedPresetId: card.rhythmIntent ? 'rhythm_tighten_loosen' : (card.localTransposeIntent ? 'local_transpose' : (card.velocityShapeIntent ? 'velocity_shape' : 'llm_v0')),
          planSource: 'rule',
          createdAt: card.createdAt,
        };
        this._aiAssistItems.push(card);
        _tryGenerateAiPlan(text, card.templateId || null, card.intent || null).then((plan) => {
          if (plan) {
            card.plan = plan;
            if (card.reasoningLog) {
              card.reasoningLog.planSummary = (plan.planTitle && String(plan.planTitle).trim()) ? String(plan.planTitle).trim() : card.reasoningLog.planSummary;
              card.reasoningLog.planSource = 'ai';
            }
            _syncAssistantCardTemplateFromPlan(card);
            this.render();
          }
        }).catch(function(){ /* keep rule-based plan */ });
      }
      this.render();
    },
    async _aiAssistRun(clipId, btnEl){
      if (!clipId) return;
      const promptText = (btnEl && btnEl.getAttribute && btnEl.getAttribute('data-prompt')) || '';
      const card = (this._aiAssistItems || []).find(x => x.type === 'card' && String(x.clipId) === String(clipId) && (!promptText || x.promptText === promptText));
      if (!card) return;
      _syncAssistantCardTemplateFromPlan(card);
      const text = (promptText !== '' && promptText !== null) ? promptText : (card.promptText || '');
      const runSnapshot = _buildAssistantRunExecutionSnapshot(card);
      card._assistantRunSnapshot = runSnapshot;
      if (card.reasoningLog && typeof card.reasoningLog === 'object'){
        card.reasoningLog.templateId = runSnapshot.usedTemplateId;
        card.reasoningLog.intent = runSnapshot.usedIntent ? {
          fixPitch: !!runSnapshot.usedIntent.fixPitch,
          tightenRhythm: !!runSnapshot.usedIntent.tightenRhythm,
          reduceOutliers: !!runSnapshot.usedIntent.reduceOutliers,
        } : null;
        if (runSnapshot.usedPlan && runSnapshot.usedPlan.planTitle){
          card.reasoningLog.planSummary = String(runSnapshot.usedPlan.planTitle).slice(0, 200);
        }
      }
      const opts = { userPrompt: text, requestedPresetId: runSnapshot.usedRequestedPresetId };
      if (runSnapshot.rhythmIntent && typeof runSnapshot.rhythmIntent === 'object'){
        opts.rhythmIntent = runSnapshot.rhythmIntent;
      }
      if (runSnapshot.localTransposeIntent && typeof runSnapshot.localTransposeIntent === 'object'){
        opts.localTransposeIntent = runSnapshot.localTransposeIntent;
      }
      if (runSnapshot.velocityShapeIntent && typeof runSnapshot.velocityShapeIntent === 'object'){
        opts.velocityShapeIntent = runSnapshot.velocityShapeIntent;
      }
      if (runSnapshot.usedTemplateId && runSnapshot.usedIntent) {
        opts.templateId = runSnapshot.usedTemplateId;
        opts.intent = runSnapshot.usedIntent;
      }
      if (runSnapshot.usedPlan) {
        opts.plan = runSnapshot.usedPlan;
      }
      opts._assistantExecutionPlanSnapshot = runSnapshot.usedPlan;
      this.setOptimizeOptions(clipId, opts);
      card.runState = 'running';
      card.resultKind = null;
      card.usedPresetId = null;
      card.lastError = null;
      card.executionTrace = null;
      if (btnEl) btnEl.disabled = true;
      this.render();
      try {
        const res = await this.runCommand('optimize_clip', { clipId });
        if (btnEl) btnEl.disabled = false;
        if (!res || !res.ok) {
          card.runState = 'failed';
          card.lastError = (res && res.message) ? String(res.message).slice(0, 80) : 'Optimize failed';
          if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, null, false, card.runState, card.resultKind, card.lastError);
          try { card.executionTrace = _buildAiAssistExecutionTrace(card, null, runSnapshot); } catch (_e) {}
          this.render();
          return;
        }
        const optRes = (res.data && res.data.optimizeResult) ? res.data.optimizeResult : null;
        if (!optRes || !optRes.ok) {
          card.runState = 'failed';
          card.lastError = (optRes && (optRes.reason || optRes.detail || optRes.message)) ? String(optRes.reason || optRes.detail || optRes.message).slice(0, 80) : 'Optimize failed';
          if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, optRes && optRes.patchSummary ? optRes.patchSummary : null, false, card.runState, card.resultKind, card.lastError);
          try { card.executionTrace = _buildAiAssistExecutionTrace(card, optRes, runSnapshot); } catch (_e) {}
          this.render();
          return;
        }
        let ps = (optRes && optRes.patchSummary) ? optRes.patchSummary : null;
        if (!ps && optRes.ok && optRes.ops > 0) {
          const p2 = this.getProjectV2();
          const c = p2 && p2.clips && p2.clips[clipId];
          ps = (c && c.meta && c.meta.agent && c.meta.agent.patchSummary) ? c.meta.agent.patchSummary : null;
        }
        card.usedPresetId = (ps && ps.executedPreset) ? String(ps.executedPreset) : 'llm_v0';
        if (optRes.ops === 0 || (ps && ps.noChanges === true)) card.resultKind = 'no-op';
        else if (ps && ps.isVelocityOnly === true) card.resultKind = 'velocity-only';
        else if (ps && (ps.hasPitchChange === true || ps.hasTimingChange === true)) card.resultKind = 'pitch/timing';
        else if (ps && ps.hasStructuralChange === true) card.resultKind = 'structure';
        else card.resultKind = 'updated';
        card.runState = 'done';
        if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, ps, true, card.runState, card.resultKind, null);
        try { card.executionTrace = _buildAiAssistExecutionTrace(card, optRes, runSnapshot); } catch (_e) {}
      } catch (err) {
        if (btnEl) btnEl.disabled = false;
        card.runState = 'failed';
        card.lastError = (err && err.message) ? String(err.message).slice(0, 80) : 'Optimize failed';
        if (card.reasoningLog) _enrichReasoningLogFromRun(card.reasoningLog, null, false, card.runState, card.resultKind, card.lastError);
        try { card.executionTrace = _buildAiAssistExecutionTrace(card, null, runSnapshot); } catch (_e) {}
      }
      this.render();
    },
    async _aiAssistUndo(clipId){
      if (!clipId) return;
      const res = await this.runCommand('rollback_clip', { clipId });
      const rb = (res && res.data && res.data.rollbackResult) ? res.data.rollbackResult : null;
      if (rb && rb.ok && rb.changed) {
        const items = this._aiAssistItems || [];
        for (const it of items) {
          if (it.type === 'card' && String(it.clipId) === String(clipId) && it.runState === 'done') it.runState = 'undone';
        }
      }
      this.render();
    },

    _getAiAssistTargetSummary(){
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
      const instId = this.state.selectedInstanceId;
      const clipId = this.state.selectedClipId;
      const clip = clipId ? (this.project.clips || []).find(c => c && String(c.id) === String(clipId)) : null;
      const clipName = clip ? (clip.name || clipId) : (clipId || '');
      const prefix = _t('aiAssist.clipPrefix');
      if (!clipId) return _t('aiAssist.noClip');
      if (instId) {
        const inst = (this.project.instances || []).find(i => i && String(i.id) === String(instId));
        if (inst && String(inst.clipId || '') === String(clipId || '')) {
          const trackNum = (typeof inst.trackIndex === 'number' ? inst.trackIndex : 0) + 1;
          const startStr = fmtSec(inst.startSec);
          const trackPrefix = _t('aiAssist.trackPrefix');
          return prefix + clipName + ' · ' + trackPrefix + trackNum + ' · ' + startStr;
        }
      }
      return prefix + clipName;
    },
    _renderAiAssistDock(){
      const dock = document.getElementById('aiAssistDock');
      const headerTarget = document.getElementById('aiAssistHeaderTarget');
      const headerChevron = document.getElementById('aiAssistHeaderChevron');
      const messagesEl = document.getElementById('aiAssistMessages');
      if (!dock) return;
      dock.classList.toggle('open', !!this.state.aiAssistOpen);
      if (!this.state.aiAssistOpen) dock.style.height = '28px';
      else if (this._aiAssistDockWidth != null || this._aiAssistDockHeight != null) {
        if (this._aiAssistDockWidth != null) dock.style.width = this._aiAssistDockWidth + 'px';
        if (this._aiAssistDockHeight != null) dock.style.height = this._aiAssistDockHeight + 'px';
      } else { dock.style.width = ''; dock.style.height = ''; }
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
      if (headerTarget) headerTarget.textContent = this._getAiAssistTargetSummary();
      if (headerChevron) headerChevron.textContent = this.state.aiAssistOpen ? '\u25BE' : '\u25B8';
      if (messagesEl) {
        const items = this._aiAssistItems || [];
        let html = '';
        for (const it of items) {
          if (it.type === 'sys') {
            html += '<div class="aiAssistSys">' + escapeHtml(it.text) + '</div>';
          } else if (it.type === 'card') {
            const p2 = this.getProjectV2();
            const c = p2 && p2.clips && p2.clips[it.clipId];
            const canUndo = !!(c && c.parentRevisionId != null && String(c.parentRevisionId).trim());
            const runState = it.runState || 'idle';
            const tl = (it.templateLabel && String(it.templateLabel).trim()) ? String(it.templateLabel).trim() : null;
            const up = (it.usedPresetId && String(it.usedPresetId).trim()) ? String(it.usedPresetId).trim() : null;
            const dataRunState = runState !== 'idle' ? (' data-run-state="' + escapeHtml(runState) + '"') : '';
            html += '<div class="aiAssistCard" data-clip-id="' + escapeHtml(String(it.clipId)) + '"' + dataRunState + '>';
            html += '<div class="aiAssistCardPrompt">' + escapeHtml(it.promptText) + '</div>';
            const plan = it.plan && Array.isArray(it.plan.planLines) && it.plan.planLines.length > 0 ? it.plan : null;
            if (plan) {
              html += '<div class="aiAssistCardPlan" data-plan-kind="' + escapeHtml(plan.planKind || 'generic') + '" style="font-size:10px; color:var(--muted); margin-bottom:6px; line-height:1.35;">';
              if (plan.planTitle) html += '<div class="aiAssistCardPlanTitle" style="font-weight:600; margin-bottom:2px;">' + escapeHtml(plan.planTitle) + '</div>';
              for (let i = 0; i < plan.planLines.length; i++) html += '<div class="aiAssistCardPlanLine">' + escapeHtml(plan.planLines[i]) + '</div>';
              html += '</div>';
            }
            if (tl || up){
              const metaText = (tl && up) ? (escapeHtml(tl) + ' · ' + escapeHtml(up)) : (tl ? escapeHtml(tl) : escapeHtml(up));
              html += '<div class="aiAssistCardMeta">' + metaText + '</div>';
            }
            if (runState !== 'idle'){
              let statusLine = '';
              if (runState === 'running') statusLine = _t('aiAssist.statusRunning');
              else if (runState === 'done') statusLine = (it.resultKind === 'no-op') ? _t('aiAssist.resultNoOp') : (it.resultKind === 'velocity-only') ? _t('aiAssist.resultVelocityOnly') : (it.resultKind === 'pitch/timing') ? _t('aiAssist.resultPitchTiming') : (it.resultKind === 'structure') ? _t('aiAssist.resultStructure') : _t('aiAssist.resultUpdated');
              else if (runState === 'failed') statusLine = _t('aiAssist.statusFailed') + ': ' + escapeHtml((it.lastError || 'error').slice(0, 80));
              else if (runState === 'undone') statusLine = _t('aiAssist.statusUndone');
              html += '<div class="aiAssistCardStatus">' + statusLine + '</div>';
            }
            const dbgHtml = _buildAiAssistDebugHtml(it, escapeHtml);
            if (dbgHtml){
              const dbgKey = String(it.clipId) + '\0' + String(it.createdAt);
              const dbgOpen = !!(this._aiAssistDebugExpanded && this._aiAssistDebugExpanded[dbgKey]);
              html += '<div class="aiAssistDbg">';
              html += '<button type="button" class="btn mini aiAssistDbgToggle" data-act="aiDebugToggle" data-clip-id="' + escapeHtml(String(it.clipId)) + '" data-card-created="' + escapeHtml(String(it.createdAt)) + '">' + escapeHtml(dbgOpen ? 'Trace \u25BE' : 'Trace \u25B8') + '</button>';
              html += '<div class="aiAssistDbgPanel' + (dbgOpen ? ' open' : '') + '">' + dbgHtml + '</div>';
              html += '</div>';
            }
            html += '<div class="aiAssistCardBtns">';
            html += '<button type="button" class="btn primary mini" data-act="aiRun" data-clip-id="' + escapeHtml(String(it.clipId)) + '" data-prompt="' + escapeHtml(it.promptText) + '">' + escapeHtml(_t('aiAssist.run')) + '</button>';
            html += '<button type="button" class="btn mini" data-act="aiOpenOptimize" data-clip-id="' + escapeHtml(String(it.clipId)) + '">' + escapeHtml(_t('aiAssist.openOptimize')) + '</button>';
            if (canUndo) html += '<button type="button" class="btn mini" data-act="aiUndo" data-clip-id="' + escapeHtml(String(it.clipId)) + '">' + escapeHtml(_t('aiAssist.undo')) + '</button>';
            html += '</div></div>';
          }
        }
        messagesEl.innerHTML = html || '';
      }
      const inp = document.getElementById('aiAssistInput');
      if (inp && window.I18N && window.I18N.t) {
        const ph = _t('aiAssist.promptPlaceholder');
        if (inp.getAttribute('data-i18n-placeholder')) inp.placeholder = ph;
      }
      this._syncStudioAiDockRightPanelSafeBottom();
    },

    // PR-UX4c: AI Settings drawer — init bindings (guard against double bind)
    _initAiSettingsDrawer(){
      if (this._aiDrawerBound) return;
      this._aiDrawerBound = true;
      const btnOpen = $('#btnAiSettings');
      const btnClose = $('#btnAiSettingsClose');
      const backdrop = $('#aiSettingsBackdrop');
      if (btnOpen) btnOpen.addEventListener('click', () => this.openAiSettingsDrawer());
      if (btnClose) btnClose.addEventListener('click', () => this.closeAiSettingsDrawer());
      if (backdrop) backdrop.addEventListener('click', () => this.closeAiSettingsDrawer());
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && this.state.aiSettingsOpen) this.closeAiSettingsDrawer();
      });
    },
    openAiSettingsDrawer(){
      this.state.aiSettingsOpen = true;
      try{ localStorage.setItem(LS_KEY_AI_DRAWER_OPEN, '1'); }catch(e){}
      this.render();
    },
    closeAiSettingsDrawer(){
      this.state.aiSettingsOpen = false;
      try{ localStorage.setItem(LS_KEY_AI_DRAWER_OPEN, '0'); }catch(e){}
      this.render();
    },

    // PR-UX5a: Set inline status in AI drawer (kind = 'ok'|'err'|'info'); textContent only, no innerHTML
    _setAiInlineStatus(kind, text){
      const el = document.getElementById('aiSettingsInlineStatus');
      if (!el) return;
      el.textContent = text || '';
      el.classList.remove('ok', 'err', 'info');
      if (kind === 'ok' || kind === 'err' || kind === 'info') el.classList.add(kind);
    },

    // PR-UX5a: Update validation hints and Save disabled state from current input values
    _updateAiValidation(baseEl, modelEl, btnSave, hintBase, hintModel){
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
      const baseUrlOk = baseEl && String(baseEl.value || '').trim().length > 0;
      const modelOk = modelEl && String(modelEl.value || '').trim().length > 0;
      if (btnSave){ btnSave.disabled = !(baseUrlOk && modelOk); }
      if (hintBase){ hintBase.textContent = baseUrlOk ? '' : _t('common.required'); }
      if (hintModel){ hintModel.textContent = modelOk ? '' : _t('common.required'); }
    },

    // PR-UX4d: Returns true when AI config is incomplete (missing baseUrl/model, or token for non-local)
    _aiConfigNeedsAttention(){
      try{
        const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG) ? globalThis.H2S_LLM_CONFIG : null;
        if (!api || typeof api.loadLlmConfig !== 'function') return false;
        const cfg = api.loadLlmConfig();
        const missingBaseUrl = !(cfg && cfg.baseUrl && String(cfg.baseUrl).trim());
        const missingModel = !(cfg && cfg.model && String(cfg.model).trim());
        const tokenMissing = !(cfg && cfg.authToken && String(cfg.authToken).trim());
        const baseUrl = (cfg && cfg.baseUrl) ? String(cfg.baseUrl) : '';
        const localEndpoint = /localhost|127\.0\.0\.1/i.test(baseUrl);
        const needsToken = !localEndpoint;
        return missingBaseUrl || missingModel || (needsToken && tokenMissing);
      }catch(e){ return false; }
    },

    // PR-UX4c: AI Settings panel — renders into given container (drawer body)
    renderAiSettingsPanel(container){
      if (!container) return;
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
      const DEEPSEEK_URL = 'https://api.deepseek.com/v1';
      const OLLAMA_URL = 'http://localhost:11434/v1';
      const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG) ? globalThis.H2S_LLM_CONFIG : null;
      let baseVal = ''; let modelVal = ''; let presetVal = 'custom'; let tokenVal = ''; let velocityOnly = true;
      if (api && typeof api.loadLlmConfig === 'function'){
        const cfg = api.loadLlmConfig();
        baseVal = (cfg && typeof cfg.baseUrl === 'string') ? cfg.baseUrl : '';
        modelVal = (cfg && typeof cfg.model === 'string') ? cfg.model : '';
        tokenVal = (cfg && typeof cfg.authToken === 'string') ? cfg.authToken : '';
        velocityOnly = (cfg && typeof cfg.velocityOnly === 'boolean') ? cfg.velocityOnly : true;
        if (baseVal === DEEPSEEK_URL) presetVal = 'deepseek';
        else if (baseVal === OLLAMA_URL) presetVal = 'ollama';
      }
      container.innerHTML = (
        '<div class="col" style="gap:6px;">' +
        '<label class="muted" style="margin:0;" data-i18n="editor.gatewayPreset">' + escapeHtml(_t('editor.gatewayPreset')) + '</label>' +
        '<select id="inspAi_gatewayPreset" class="btn" style="width:100%; padding:6px; font-size:12px;">' +
        '<option value="custom">' + escapeHtml(_t('editor.gatewayCustom')) + '</option>' +
        '<option value="deepseek">' + escapeHtml(_t('editor.gatewayDeepseek')) + '</option>' +
        '<option value="ollama">' + escapeHtml(_t('editor.gatewayOllama')) + '</option>' +
        '</select>' +
        '<div class="muted" style="font-size:11px; margin-top:-2px;" data-i18n="editor.deepseekOllamaHint">' + escapeHtml(_t('editor.deepseekOllamaHint')) + '</div>' +
        '<label class="muted" style="margin:0;">' + escapeHtml(_t('editor.baseUrl')) + '</label>' +
        '<input id="inspAi_baseUrl" type="text" placeholder="' + escapeHtml(_t('editor.baseUrlPlaceholder')) + '" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:8px; background:rgba(0,0,0,.2); color:var(--text); font-size:12px; box-sizing:border-box;" />' +
        '<div class="aiHint aiHintErr" data-ai-hint="baseUrl"></div>' +
        '<label class="muted" style="margin:0;">' + escapeHtml(_t('editor.model')) + '</label>' +
        '<div class="row" style="gap:6px; align-items:center;">' +
        '<input id="inspAi_model" type="text" list="inspAi_modelList" placeholder="' + escapeHtml(_t('editor.modelPlaceholder')) + '" style="flex:1; min-width:0; padding:6px; border:1px solid var(--border); border-radius:8px; background:rgba(0,0,0,.2); color:var(--text); font-size:12px; box-sizing:border-box;" />' +
        '<button id="inspAi_btnLoadModels" type="button" class="btn mini">' + escapeHtml(_t('editor.loadModels')) + '</button>' +
        '</div>' +
        '<datalist id="inspAi_modelList"></datalist>' +
        '<div class="aiHint aiHintErr" data-ai-hint="model"></div>' +
        '<div id="inspAi_modelLoadStatus" class="muted" style="min-height:1em; font-size:11px;"></div>' +
        '<label class="muted" style="margin:0;">' + escapeHtml(_t('editor.authToken')) + '</label>' +
        '<input id="inspAi_authToken" type="password" placeholder="' + escapeHtml(_t('editor.authOptional')) + '" autocomplete="off" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:8px; background:rgba(0,0,0,.2); color:var(--text); font-size:12px; box-sizing:border-box;" />' +
        '<label style="display:flex; align-items:center; gap:8px; cursor:pointer;">' +
        '<input id="inspAi_velocityOnly" type="checkbox" />' +
        '<span>' + escapeHtml(_t('editor.velocityOnlySafe')) + '</span>' +
        '</label>' +
        '<div class="row" style="gap:6px;">' +
        '<button id="inspAi_btnSave" type="button" class="btn mini">' + escapeHtml(_t('inst.save')) + '</button>' +
        '<button id="inspAi_btnReset" type="button" class="btn mini">' + escapeHtml(_t('common.reset')) + '</button>' +
        '<button id="inspAi_btnTest" type="button" class="btn mini">' + escapeHtml(_t('editor.testConnection')) + '</button>' +
        '</div>' +
        '<div id="aiSettingsInlineStatus" class="aiInlineStatus"></div>' +
        '</div>'
      );
      const presetEl = document.getElementById('inspAi_gatewayPreset');
      const baseEl = document.getElementById('inspAi_baseUrl');
      const modelEl = document.getElementById('inspAi_model');
      const tokenEl = document.getElementById('inspAi_authToken');
      const velocityOnlyEl = document.getElementById('inspAi_velocityOnly');
      const btnSave = document.getElementById('inspAi_btnSave');
      const hintBase = container.querySelector('[data-ai-hint="baseUrl"]');
      const hintModel = container.querySelector('[data-ai-hint="model"]');
      if (presetEl) presetEl.value = presetVal;
      if (baseEl) baseEl.value = baseVal;
      if (modelEl) modelEl.value = modelVal;
      if (tokenEl) tokenEl.value = tokenVal;
      if (velocityOnlyEl) velocityOnlyEl.checked = velocityOnly;
      const self = this;
      const updateValidation = function(){ self._updateAiValidation(baseEl, modelEl, btnSave, hintBase, hintModel); };
      self._updateAiValidation(baseEl, modelEl, btnSave, hintBase, hintModel);
      if (baseEl) baseEl.addEventListener('input', updateValidation);
      if (baseEl) baseEl.addEventListener('change', updateValidation);
      if (modelEl) modelEl.addEventListener('input', updateValidation);
      if (modelEl) modelEl.addEventListener('change', updateValidation);
      const applyPresetFill = function(pv){
        if (pv === 'deepseek'){ if (baseEl) baseEl.value = DEEPSEEK_URL; if (modelEl && !modelEl.value.trim()) modelEl.value = 'deepseek-chat'; }
        else if (pv === 'ollama'){ if (baseEl) baseEl.value = OLLAMA_URL; }
      };
      if (presetEl) presetEl.addEventListener('change', function(){ applyPresetFill(this.value || 'custom'); updateValidation(); });
      document.getElementById('inspAi_btnSave').addEventListener('click', function(){
        if (btnSave && btnSave.disabled) return;
        if (!api || typeof api.saveLlmConfig !== 'function') return;
        try {
          const base = (baseEl && baseEl.value != null) ? String(baseEl.value).trim() : '';
          const model = (modelEl && modelEl.value != null) ? String(modelEl.value).trim() : '';
          const token = (tokenEl && tokenEl.value != null) ? String(tokenEl.value) : '';
          api.saveLlmConfig({ baseUrl: base, model: model, authToken: token, velocityOnly: velocityOnlyEl ? velocityOnlyEl.checked : true });
          self._setAiInlineStatus('ok', _t('ai.saved'));
          if (typeof self.setImportStatus === 'function') self.setImportStatus(_t('ai.saved'), false);
          self.render();
        } catch (err) {
          const msg = (err && (err.message || String(err))).slice(0, 200);
          self._setAiInlineStatus('err', _t('ai.saveFailed') + ': ' + msg);
          if (typeof self.setImportStatus === 'function') self.setImportStatus(_t('ai.saveFailed') + ': ' + msg, false);
        }
      });
      document.getElementById('inspAi_btnReset').addEventListener('click', function(){
        if (!api || typeof api.resetLlmConfig !== 'function') return;
        const def = api.resetLlmConfig();
        if (baseEl) baseEl.value = (def && typeof def.baseUrl === 'string') ? def.baseUrl : '';
        if (modelEl) modelEl.value = (def && typeof def.model === 'string') ? def.model : '';
        if (tokenEl) tokenEl.value = '';
        if (velocityOnlyEl) velocityOnlyEl.checked = (def && typeof def.velocityOnly === 'boolean') ? def.velocityOnly : true;
        if (presetEl) presetEl.value = 'custom';
        self._setAiInlineStatus('ok', _t('inspector.aiReset'));
        updateValidation();
        self.render();
      });
      document.getElementById('inspAi_btnTest').addEventListener('click', function(){
        const client = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CLIENT) ? globalThis.H2S_LLM_CLIENT : null;
        if (!api || typeof api.loadLlmConfig !== 'function' || !client || typeof client.callChatCompletions !== 'function'){ self._setAiInlineStatus('err', _t('editor.llmConfigNotLoaded')); return; }
        const base = (baseEl && baseEl.value != null) ? String(baseEl.value).trim() : '';
        const model = (modelEl && modelEl.value != null) ? String(modelEl.value).trim() : '';
        const token = (tokenEl && tokenEl.value != null) ? String(tokenEl.value) : '';
        if (!base || !model){ self._setAiInlineStatus('err', _t('editor.pleaseSetBaseUrlAndModel')); return; }
        self._setAiInlineStatus('info', _t('ai.testing'));
        client.callChatCompletions({ baseUrl: base, model: model, authToken: token }, [{ role: 'system', content: 'Reply with exactly: ok' }, { role: 'user', content: 'ping' }], { timeoutMs: 8000 })
          .then(function(){ self._setAiInlineStatus('ok', _t('ai.testOk')); })
          .catch(function(err){
            const msg = (err && (err.message || String(err))).slice(0, 200);
            let shortMsg = msg;
            if (/401|403|Unauthorized/i.test(msg)) shortMsg = _t('editor.unauthorized');
            else if (/404|not found/i.test(msg)) shortMsg = _t('editor.endpointNotFound');
            else if (/timeout|request timeout/i.test(msg)) shortMsg = _t('editor.timeout');
            else shortMsg = msg || _t('ai.testFailed');
            self._setAiInlineStatus('err', _t('ai.testFailed') + ': ' + shortMsg);
          });
      });
      document.getElementById('inspAi_btnLoadModels').addEventListener('click', function(){
        const client = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CLIENT) ? globalThis.H2S_LLM_CLIENT : null;
        const loadSt = document.getElementById('inspAi_modelLoadStatus');
        const setLoadSt = function(t){ if (loadSt) loadSt.textContent = t || ''; };
        if (!client || typeof client.listModels !== 'function'){ self._setAiInlineStatus('err', _t('editor.llmConfigNotLoaded')); return; }
        const base = (baseEl && baseEl.value != null) ? String(baseEl.value).trim() : '';
        const token = (tokenEl && tokenEl.value != null) ? String(tokenEl.value) : '';
        if (!base){ self._setAiInlineStatus('err', _t('editor.pleaseSetBaseUrl')); return; }
        self._setAiInlineStatus('info', _t('ai.loadingModels'));
        setLoadSt(_t('common.loading'));
        client.listModels({ baseUrl: base, authToken: token }, { timeoutMs: 8000 })
          .then(function(res){
            const ids = (res && Array.isArray(res.ids)) ? res.ids : [];
            const listEl = document.getElementById('inspAi_modelList');
            if (listEl){ listEl.innerHTML = ''; for (var i = 0; i < ids.length && i < 200; i++){ var o = document.createElement('option'); o.value = ids[i]; listEl.appendChild(o); } }
            const loadedMsg = (_t('editor.loadedModels') || 'Loaded {n} models').replace('{n}', String(ids.length));
            setLoadSt(loadedMsg);
            self._setAiInlineStatus('ok', _t('ai.modelsLoaded'));
          })
          .catch(function(err){
            const msg = (err && (err.message || String(err))).slice(0, 200);
            let shortMsg = msg;
            if (/401|403|Unauthorized/i.test(msg)) shortMsg = _t('editor.unauthorized');
            else if (/404|not found/i.test(msg)) shortMsg = _t('editor.endpointNotFound');
            else if (/timeout|request timeout/i.test(msg)) shortMsg = _t('editor.timeout');
            else shortMsg = msg || _t('editor.failedLoadModels');
            setLoadSt(shortMsg);
            self._setAiInlineStatus('err', _t('ai.modelsLoadFailed') + ': ' + shortMsg);
          });
      });
    },

    renderInspector(){
      const emptyEl = $('#inspectorEmptyState');
      const contentEl = $('#inspectorContent');
      const timelineEl = $('#inspectorTimelineSection');
      const projectEl = $('#inspProject');
      const exportEl = $('#inspExport');
      const projectSummary = $('#inspProjectSummary');
      const hasSelection = !!(this.state.selectedClipId || this.state.selectedInstanceId);
      const hasInstance = !!this.state.selectedInstanceId;
      if (emptyEl) emptyEl.style.display = hasSelection ? 'none' : '';
      // Keep #inspectorContent visible without selection so Project summary + Export & Import stay usable.
      if (contentEl) contentEl.style.display = '';
      if (timelineEl) timelineEl.style.display = hasInstance ? '' : 'none';
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
      const tracks = this.project.tracks.length;
      const clips = this.project.clips.length;
      const inst = this.project.instances.length;
      if (projectSummary) projectSummary.textContent = `${_t('inspector.project')}: ${tracks} ${_t('inspector.tracks').toLowerCase()} · ${clips} ${_t('inspector.clips').toLowerCase()} · ${inst} ${_t('inspector.instances').toLowerCase()}`;
      if (projectEl) projectEl.open = getInspectorSectionOpen('project');
      if (exportEl) exportEl.open = getInspectorSectionOpen('export');
    },

    render(){
      const _perf = _devPerfTimingEnabled();
      const _perfT0 = _perf && typeof performance !== 'undefined' ? performance.now() : 0;
      try{
      try{ this.ensureTrackButtons(); }catch(e){}
      // Inspector stats
      $('#kvTracks').textContent = String(this.project.tracks.length);
      $('#kvClips').textContent = String(this.project.clips.length);
      $('#kvInst').textContent = String(this.project.instances.length);
      $('#inpBpm').value = this.project.bpm;

      // PR-UX3b: Inspector progressive disclosure
      this.renderInspector();

      this.renderClipList();
      this.renderTimeline();
      this.renderSelection();
      this.renderSelectedClip();
      // PR-UX4c: AI Settings drawer — show/hide and render form when open
      const aiModal = $('#aiSettingsModal');
      const aiBody = $('#aiSettingsModalBody');
      if (aiModal && aiBody){
        if (this.state.aiSettingsOpen){
          aiModal.classList.remove('hidden');
          aiModal.setAttribute('aria-hidden', 'false');
          this.renderAiSettingsPanel(aiBody);
        } else {
          aiModal.classList.add('hidden');
          aiModal.setAttribute('aria-hidden', 'true');
          aiBody.innerHTML = '';
        }
      }
      // PR-UX4d: AI Settings button — active when drawer open, needsAttention when config incomplete
      const btnAi = $('#btnAiSettings');
      if (btnAi){
        if (this.state.aiSettingsOpen) btnAi.classList.add('active'); else btnAi.classList.remove('active');
        if (this._aiConfigNeedsAttention()) btnAi.classList.add('needsAttention'); else btnAi.classList.remove('needsAttention');
      }
      // PR-UX7a: AI Assistant dock — header, messages, open state
      this._renderAiAssistDock();
      try{ this.updateRecordButtonStates(); }catch(e){}
      try{ this._updateI18nLabels(); }catch(e){}
      // Clip editor: ghost overlay must track current head's parent after optimize / revision changes (same session).
      try{
        if (this.state.modal && this.state.modal.show && this.editorRt){
          if (typeof this.editorRt.modalSyncGhostFromClipParent === 'function') this.editorRt.modalSyncGhostFromClipParent();
          if (typeof this.editorRt.modalRequestDraw === 'function') this.editorRt.modalRequestDraw();
        }
      }catch(e){}
      } finally {
        if (_perf && typeof performance !== 'undefined'){
          console.log('[H2S perf] render', (performance.now() - _perfT0).toFixed(2) + 'ms');
        }
      }
    },

    renderClipList(){
      // Prefer controller-rendered library to keep app.js smaller and reduce regressions.
      if (this.libraryCtrl && this.libraryCtrl.render){
        this.libraryCtrl.render();
        return;
      }

      const root = $('#clipList');
      root.innerHTML = '';
      if (this.project.clips.length === 0){
        const d = document.createElement('div');
        d.className = 'muted';
        d.textContent = (window.I18N && window.I18N.t) ? window.I18N.t('cliplib.noClips') : 'No clips yet. Import audio to generate one.';
        root.appendChild(d);
        return;
      }

      for (const clip of this.project.clips){
        const st = H2SProject.scoreStats(clip.score);
        const el = document.createElement('div');
        el.className = 'clipCard';
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', clip.id);
        });
el.innerHTML = `
          <div class="clipTitle">${escapeHtml(clip.name)}</div>
          <div class="clipMeta"><span>${st.count} ${(window.I18N && window.I18N.t) ? window.I18N.t('cliplib.notes') : 'notes'}</span><span>${fmtSec(st.spanSec)}</span></div>
          <div class="miniBtns">
            <button class="btn mini" data-act="play">${escapeHtml((window.I18N && window.I18N.t) ? window.I18N.t('cliplib.play') : 'Play')}</button>
            <button class="btn mini" data-act="add">${escapeHtml((window.I18N && window.I18N.t) ? window.I18N.t('cliplib.addToSong') : 'Add to Song')}</button>
            <button class="btn mini" data-act="edit">${escapeHtml((window.I18N && window.I18N.t) ? window.I18N.t('cliplib.edit') : 'Edit')}</button>
            <button class="btn mini danger" data-act="remove">${escapeHtml((window.I18N && window.I18N.t) ? window.I18N.t('cliplib.remove') : 'Remove')}</button>
          </div>
        `;

        el.querySelector('[data-act="play"]').addEventListener('click', (e) => { e.stopPropagation(); this.playClip(clip.id); });
        el.querySelector('[data-act="add"]').addEventListener('click', (e) => { e.stopPropagation(); this.addClipToTimeline(clip.id); });
        el.querySelector('[data-act="edit"]').addEventListener('click', (e) => { e.stopPropagation(); this.openClipEditor(clip.id); });
        el.querySelector('[data-act="remove"]').addEventListener('click', (e) => { e.stopPropagation(); this.deleteClip(clip.id); });

        root.appendChild(el);
      }
    },

    
renderTimeline(){
  // Render via timeline_controller to keep DOM stable for dblclick/drag.
  if (this.timelineCtrl && this.timelineCtrl.render){
    // Clear any stale selected element ref if DOM was rebuilt
    this._selectedInstEl = null;
    this.timelineCtrl.render();
    return;
  }
  // Fallback: if controller missing, show a hint rather than a broken timeline.
  const tracks = $('#tracks');
  tracks.innerHTML = '<div class="muted" style="padding:12px;">Timeline controller not loaded.</div>';
},

    renderSelectedClip(){
      const box = $('#selectedClipBox');
      if (!box) return;
      const clipId = this.state.selectedClipId;
      if (!clipId){
        box.className = 'muted';
        box.setAttribute('data-i18n', 'inspector.clickClipHint');
        box.textContent = (window.I18N && window.I18N.t) ? window.I18N.t('inspector.clickClipHint') : 'Click a clip in the library to view History.';
        return;
      }
      const P = (typeof window !== 'undefined' && window.H2SProject) ? window.H2SProject : null;
      const p2 = this.getProjectV2();
      let clip = p2 && p2.clips ? p2.clips[clipId] : null;
      if (!clip) clip = (this.project.clips || []).find(c => c && c.id === clipId);
      if (!clip){
        this.state.selectedClipId = null;
        box.className = 'muted';
        box.setAttribute('data-i18n', 'inspector.clickClipHint');
        box.textContent = (window.I18N && window.I18N.t) ? window.I18N.t('inspector.clickClipHint') : 'Click a clip in the library to view History.';
        return;
      }
      const revInfo = (P && typeof P.listClipRevisions === 'function') ? P.listClipRevisions(clip) : null;
      const view = (typeof window !== 'undefined' && window.H2SLibraryView && window.H2SLibraryView.historyControlsHTML) ? window.H2SLibraryView : null;
      let historyHtml = '';
      if (view) historyHtml = view.historyControlsHTML(clipId, revInfo, escapeHtml);
      const ps = (clip.meta && clip.meta.agent && clip.meta.agent.patchSummary) ||
        (clip.meta && clip.meta.patchSummary) ||
        (clip.meta && clip.meta.agent && clip.meta.agent.lastResult && clip.meta.agent.lastResult.patchSummary) ||
        null;
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
      let resultsHtml = '';
      if (ps && typeof ps === 'object'){
        const parts = [];
        if (typeof ps.ops === 'number') parts.push(`ops: ${ps.ops}`);
        if (ps.isVelocityOnly === true) parts.push(_t('opt.velocityOnly'));
        else {
          if (ps.hasPitchChange === true) parts.push(_t('opt.pitch'));
          if (ps.hasTimingChange === true) parts.push(_t('opt.timing'));
          if (ps.hasStructuralChange === true) parts.push(_t('opt.structure'));
        }
        if (ps.reason && ps.reason !== 'ok' && ps.reason !== 'empty_ops') parts.push(`reason: ${escapeHtml(String(ps.reason))}`);
        if (ps.promptMeta && typeof ps.promptMeta === 'object') {
          const id = (ps.promptMeta.templateId != null && String(ps.promptMeta.templateId).trim()) ? String(ps.promptMeta.templateId) : 'Custom';
          const ver = (ps.promptMeta.promptVersion != null && String(ps.promptMeta.promptVersion).trim()) ? String(ps.promptMeta.promptVersion) : 'manual_v0';
          parts.push(`Template: ${escapeHtml(id)} (${escapeHtml(ver)})`);
        }
        resultsHtml = parts.length > 0 ? parts.join(' · ') : 'No key fields.';
      } else {
        resultsHtml = 'No patch summary yet.';
      }
      const storedPreset = this.getOptimizePresetForClip ? this.getOptimizePresetForClip(clipId) : null;
      const storedOpts = this.getOptimizeOptions ? this.getOptimizeOptions(clipId) : null;
      const storedTemplateId = (storedOpts && storedOpts.templateId) ? String(storedOpts.templateId).trim() : null;
      const presetSelVal = (storedPreset != null && storedPreset !== '') ? String(storedPreset) : '';
      const running = !!this.state._inspectorOptRunning;
      const optError = (this.state._inspectorOptError != null && this.state._inspectorOptError !== '') ? String(this.state._inspectorOptError) : '';
      let llmMode = '';
      let llmModel = '';
      try {
        const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG && typeof globalThis.H2S_LLM_CONFIG.loadLlmConfig === 'function') ? globalThis.H2S_LLM_CONFIG : null;
        if (api) {
          const cfg = api.loadLlmConfig();
          const safeMode = (cfg && typeof cfg.velocityOnly === 'boolean') ? cfg.velocityOnly : true;
          llmMode = safeMode ? _t('opt.safe') : _t('opt.full');
          llmModel = (cfg && cfg.model != null && String(cfg.model).trim()) ? String(cfg.model).trim() : '';
        }
      } catch (_) {}
      const canUndo = !!(clip.parentRevisionId != null && String(clip.parentRevisionId).trim());
      const templateChipsHtml = Object.keys(INSPECTOR_TEMPLATES).map(function(tid){
        const tm = INSPECTOR_TEMPLATES[tid];
        const label = (tm.labelKey && _t(tm.labelKey)) ? _t(tm.labelKey) : (tm.label || tid);
        const sel = storedTemplateId === tid ? ' style="border-color:var(--accent); opacity:1;"' : '';
        return `<button type="button" class="btn mini" data-act="inspTemplateChip" data-template-id="${escapeHtml(tid)}" data-id="${escapeHtml(clipId)}"${sel}>${escapeHtml(label)}</button>`;
      }).join(' ');
      const optimizeBlockHtml = (
        `<details class="inspectorOptimize" data-insp-section="opt" style="margin-top:6px;"${getInspectorSectionOpen('opt') ? ' open' : ''}>` +
          `<summary style="cursor:pointer; user-select:none; opacity:0.9; font-weight:600;">${escapeHtml(_t('opt.optimize'))}</summary>` +
          `<div style="margin-top:8px;">` +
            `<div class="row" style="flex-wrap:wrap; gap:6px; margin-bottom:8px;">${templateChipsHtml}</div>` +
            (llmMode || llmModel ? `<div class="muted" style="font-size:11px; margin-bottom:6px;">${escapeHtml(llmMode ? llmMode + (llmModel ? ' · ' + llmModel : '') : llmModel)}</div>` : '') +
            `<div class="row" style="gap:6px; margin-bottom:6px;">` +
              `<button type="button" class="btn primary mini" data-act="inspRunOptimize" data-id="${escapeHtml(clipId)}"${running ? ' disabled' : ''}>${escapeHtml(_t('opt.run'))}</button>` +
              (canUndo ? `<button type="button" class="btn mini" data-act="inspUndoOptimize" data-id="${escapeHtml(clipId)}"${running ? ' disabled' : ''}>${escapeHtml(_t('opt.undoOptimize'))}</button>` : '') +
            `</div>` +
            (running ? `<div class="muted" style="font-size:12px;">Running…</div>` : optError ? `<div class="muted" style="font-size:12px; color:var(--danger, #e55);">${escapeHtml(optError)}</div>` : '') +
            `<a href="#" data-act="inspOpenEditor" data-id="${escapeHtml(clipId)}" style="font-size:11px; opacity:0.8;">${escapeHtml((window.I18N && window.I18N.t) ? window.I18N.t('inspector.openEditor') : 'Open Editor')}</a>` +
            `<details class="optAdvanced" data-insp-section="opt_adv" style="margin-top:10px;"${getInspectorSectionOpen('opt_adv') ? ' open' : ''}>` +
              `<summary style="cursor:pointer; user-select:none; opacity:0.8;">${escapeHtml(_t('opt.advanced'))}</summary>` +
              `<div style="margin-top:6px;">` +
                `<label style="font-size:12px; opacity:0.8;">${escapeHtml(_t('opt.preset'))}</label>` +
                `<select data-act="inspOptimizePreset" data-id="${escapeHtml(clipId)}" style="display:block; margin-top:4px; padding:4px 6px; font-size:13px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.3); color:inherit; min-width:140px;">` +
                  `<option value=""${presetSelVal === '' ? ' selected' : ''}>Default</option>` +
                  `<option value="llm_v0"${presetSelVal === 'llm_v0' ? ' selected' : ''}>${escapeHtml(_t('opt.llmV0'))}</option>` +
                  `<option value="dynamics_accent"${presetSelVal === 'dynamics_accent' ? ' selected' : ''}>Dynamics Accent</option>` +
                  `<option value="dynamics_level"${presetSelVal === 'dynamics_level' ? ' selected' : ''}>Dynamics Level</option>` +
                  `<option value="duration_gentle"${presetSelVal === 'duration_gentle' ? ' selected' : ''}>Duration Gentle</option>` +
                  `<option value="velocity_shape"${presetSelVal === 'velocity_shape' ? ' selected' : ''}>Velocity shape</option>` +
                  `<option value="local_transpose"${presetSelVal === 'local_transpose' ? ' selected' : ''}>Local transpose</option>` +
                  `<option value="rhythm_tighten_loosen"${presetSelVal === 'rhythm_tighten_loosen' ? ' selected' : ''}>Rhythm tighten/loosen</option>` +
                `</select>` +
              `</div>` +
            `</details>` +
            `<details class="optResults" data-insp-section="opt_results" style="margin-top:6px;"${getInspectorSectionOpen('opt_results') ? ' open' : ''}>` +
              `<summary style="cursor:pointer; user-select:none; opacity:0.8;">${escapeHtml(_t('opt.resultSummary'))}</summary>` +
              `<div id="selectedClipPatchSummary" class="muted" style="font-size:12px; margin-top:6px; line-height:1.4;">${escapeHtml(resultsHtml)}</div>` +
            `</details>` +
          `</div>` +
        `</details>`
      );
      const clipDisplayName = clip.name || clipId || 'Untitled';
      box.removeAttribute('data-i18n');
      box.className = '';
      box.innerHTML = (
        `<div class="kv"><b>Clip</b><input type="text" data-act="inspClipName" data-id="${escapeHtml(clipId)}" data-initial-value="${escapeHtml(clipDisplayName)}" value="${escapeHtml(clipDisplayName)}" style="flex:1; min-width:0; padding:4px 6px; font-size:13px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.3); color:inherit; box-sizing:border-box;" /></div>` +
        optimizeBlockHtml +
        (historyHtml ? (
          `<details class="clipAdvanced" data-insp-section="history" style="margin-top:6px;"${getInspectorSectionOpen('history') ? ' open' : ''}>` +
            `<summary style="cursor:pointer; user-select:none; opacity:0.8;">History</summary>` +
            `<div style="margin-top:6px;">${historyHtml}</div>` +
          `</details>`
        ) : '<div class="muted" style="font-size:12px; margin-top:4px;">No revision history.</div>')
      );
      box.__h2sApp = this;
      if (!box.__h2sSelectedClipBound){
        const self = this;
        box.__h2sSelectedClipBound = true;
        box.__h2sClickHandler = function(ev){
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act],[data-template-id]') : null;
          if (!btn) return;
          const act = btn.getAttribute('data-act') || (btn.getAttribute('data-template-id') ? 'inspTemplateChip' : null);
          const cid = btn.getAttribute('data-id') || self.state.selectedClipId;
          if (!cid) return;
          if (act === 'inspTemplateChip'){
            const tid = btn.getAttribute('data-template-id');
            const tmpl = tid && INSPECTOR_TEMPLATES[tid] ? INSPECTOR_TEMPLATES[tid] : null;
            if (tmpl && self.setOptimizeOptions){
              self.setOptimizeOptions({ templateId: tid, intent: tmpl.intent, requestedPresetId: 'llm_v0', userPrompt: tmpl.seed || null }, cid);
            }
            self.renderSelectedClip();
            return;
          }
          if (act === 'inspRunOptimize'){
            if (self.state._inspectorOptRunning) return;
            self.state._inspectorOptRunning = true;
            self.state._inspectorOptError = '';
            self.renderSelectedClip();
            self.runCommand('optimize_clip', { clipId: cid }).then(function(res){
              self.state._inspectorOptRunning = false;
              self.state._inspectorOptError = '';
              if (res && !res.ok && res.message) self.state._inspectorOptError = res.message;
              if (res && res.ok) {
                setInspectorSectionOpen('opt', true);
                setInspectorSectionOpen('opt_results', true);
              }
              persist();
              self.render();
            }).catch(function(err){
              self.state._inspectorOptRunning = false;
              self.state._inspectorOptError = (err && err.message) ? String(err.message) : 'Optimize failed';
              self.renderSelectedClip();
            });
            return;
          }
          if (act === 'inspUndoOptimize'){
            if (self.state._inspectorOptRunning) return;
            self.runCommand('rollback_clip', { clipId: cid }).then(function(res){
              if (res && res.ok){ persist(); self.render(); }
            });
            return;
          }
          if (act === 'inspOpenEditor'){
            ev.preventDefault();
            self.openClipEditor(cid);
            return;
          }
          const p2 = self.getProjectV2();
          if (!P) return;
          if (act === 'inspRollbackRev' && P.rollbackClipRevision){
            const res = P.rollbackClipRevision(p2, cid);
            if (res && res.ok && self.setProjectFromV2) self.setProjectFromV2(p2);
            self.render();
            return;
          }
          if (act === 'inspAbToggle' && P.toggleClipAB){
            const res = P.toggleClipAB(p2, cid);
            if (res && res.ok && self.setProjectFromV2) self.setProjectFromV2(p2);
            self.render();
            return;
          }
          if (act === 'inspRevActivate'){
            const sels = box.querySelectorAll('select[data-act="inspRevSelect"]');
            const sel = Array.from(sels || []).find(s => (s.getAttribute('data-id') || '') === cid) || null;
            const revId = sel ? sel.value : null;
            if (!revId || !P.setClipActiveRevision) return;
            const target = p2 || self.project;
            const res = P.setClipActiveRevision(target, cid, revId);
            if (res && res.ok && p2 && self.setProjectFromV2) self.setProjectFromV2(p2);
            if (res && res.ok && self.state.modal && self.state.modal.show && self.state.modal.clipId === cid && !self.state.modal.dirty && self.editorRt && typeof self.editorRt.modalRefreshDraftFromClip === 'function'){
              try { self.editorRt.modalRefreshDraftFromClip(); } catch (e) {}
            }
            self.render();
            return;
          }
        };
        box.__h2sChangeHandler = function(ev){
          const el = ev.target;
          if (!el || !el.getAttribute) return;
          const act = el.getAttribute('data-act');
          const cid = el.getAttribute('data-id');
          const self = box.__h2sApp;
          if (act === 'inspOptimizePreset'){
            const presetId = (el.value && String(el.value).trim()) || null;
            if (cid && self && typeof self.setOptimizeOptions === 'function'){
              self.setOptimizeOptions({ requestedPresetId: presetId, userPrompt: null }, cid);
            }
            self.render();
            return;
          }
          if (act === 'inspClipName'){
            if (!cid || !self) return;
            const newName = String(el.value || '').trim() || 'Untitled';
            const p2 = self.getProjectV2();
            const clip = p2 && p2.clips && p2.clips[cid];
            if (!clip) return;
            if (newName === (clip.name || '')) return;
            clip.name = newName;
            self.setProjectFromV2(p2);
            return;
          }
          if (act !== 'inspRevSelect') return;
          if (!cid || !P || !P.setClipActiveRevision) return;
          const revId = el.value;
          const p2 = self.getProjectV2();
          const target = p2 || self.project;
          const res = P.setClipActiveRevision(target, cid, revId);
          if (res && res.ok && p2 && self.setProjectFromV2) self.setProjectFromV2(p2);
          if (res && res.ok && self.state.modal && self.state.modal.show && self.state.modal.clipId === cid && !self.state.modal.dirty && self.editorRt && typeof self.editorRt.modalRefreshDraftFromClip === 'function'){
            try { self.editorRt.modalRefreshDraftFromClip(); } catch (e) {}
          }
          self.render();
        };
        box.__h2sKeydownHandler = function(ev){
          const el = ev.target;
          if (!el || el.getAttribute('data-act') !== 'inspClipName') return;
          const self = box.__h2sApp;
          if (ev.key === 'Enter'){
            ev.preventDefault();
            el.blur();
            return;
          }
          if (ev.key === 'Escape'){
            ev.preventDefault();
            const initial = el.getAttribute('data-initial-value') || '';
            el.value = initial;
            el.blur();
            return;
          }
        };
        box.addEventListener('click', box.__h2sClickHandler, true);
        box.addEventListener('change', box.__h2sChangeHandler);
        box.addEventListener('keydown', box.__h2sKeydownHandler);
        box.__h2sToggleHandler = function(ev){
          const d = ev.target;
          if (!d || d.tagName !== 'DETAILS') return;
          const key = d.getAttribute && d.getAttribute('data-insp-section');
          if (key === 'opt' || key === 'opt_adv' || key === 'opt_results' || key === 'history') setInspectorSectionOpen(key, d.open);
        };
        box.addEventListener('toggle', box.__h2sToggleHandler);
      }
    },

    renderSelection(){
      if (this.selectionCtrl && this.selectionCtrl.render){
        this.selectionCtrl.render();
        return;
      }

      // Fallback (should not happen in normal builds)
      const box = $('#selectionBox');
      const id = this.state.selectedInstanceId;
      if (!id){
        box.className = 'muted';
        box.setAttribute('data-i18n', 'inspector.selectInstanceHint');
        box.textContent = (window.I18N && window.I18N.t) ? window.I18N.t('inspector.selectInstanceHint') : 'Select a clip instance on timeline.';
        return;
      }
      const inst = this.project.instances.find(x => x.id === id);
      if (!inst){
        box.className = 'muted';
        box.setAttribute('data-i18n', 'inspector.selectInstanceHint');
        box.textContent = (window.I18N && window.I18N.t) ? window.I18N.t('inspector.selectInstanceHint') : 'Select a clip instance on timeline.';
        return;
      }
      const clip = this.project.clips.find(c => c.id === inst.clipId);
      box.removeAttribute('data-i18n');
      box.className = '';
      const _t2 = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
      box.innerHTML = `
        <div class="kv"><b>Clip</b><span>${escapeHtml(clip ? clip.name : inst.clipId)}</span></div>
        <div class="kv"><b>Start</b><span>${fmtSec(inst.startSec)}</span></div>
        <div class="kv"><b>Transpose</b><span>${inst.transpose || 0}</span></div>
        <div class="row" style="margin-top:10px;">
          <button id="btnSelEdit" class="btn mini">${escapeHtml(_t2('actions.edit'))}</button>
          <button id="btnSelDup" class="btn mini">${escapeHtml(_t2('actions.duplicate'))}</button>
          <button id="btnSelDel" class="btn mini danger">${escapeHtml(_t2('actions.remove'))}</button>
        </div>
      `;
      box.querySelector('#btnSelEdit').addEventListener('click', () => this.openClipEditor(inst.clipId));
      box.querySelector('#btnSelDup').addEventListener('click', () => this.duplicateInstance(inst.id));
      box.querySelector('#btnSelDel').addEventListener('click', () => this.deleteInstance(inst.id));
    },

    selectInstance(instId){
      this.state.selectedInstanceId = instId;
      this.render();
    },

    duplicateInstance(instId){
      const inst = this.project.instances.find(x => x.id === instId);
      if (!inst) return;
      const copy = H2SProject.deepClone(inst);
      copy.id = H2SProject.uid('inst_');
      copy.startSec = inst.startSec + 0.2; // small offset to see it
      this.project.instances.push(copy);
      persist();
      log('Duplicated instance.');
      this.render();
    },

    deleteInstance(instId){
      const idx = this.project.instances.findIndex(x => x.id === instId);
      if (idx < 0) return;
      this.project.instances.splice(idx, 1);
      if (this.state.selectedInstanceId === instId) this.state.selectedInstanceId = null;
      persist();
      log('Removed instance.');
      this.render();
    },
    deleteClip(clipId){
      const clip = this.project.clips.find(c => c.id === clipId);
      if (!clip) return;

      const instCount = (this.project.instances || []).filter(x => x.clipId === clipId).length;
      const msg = instCount > 0
        ? `Remove clip "${clip.name}" and ${instCount} instance(s) from timeline?`
        : `Remove clip "${clip.name}"?`;

      if (!confirm(msg)) return;

      // If currently editing this clip, close modal (Cancel).
      if (this.state.modal && this.state.modal.show && this.state.modal.clipId === clipId){
        this.closeModal(false);
      }

      // Remove instances referencing the clip
      this.project.instances = (this.project.instances || []).filter(x => x.clipId !== clipId);
      // Remove the clip itself
      this.project.clips = (this.project.clips || []).filter(c => c.id !== clipId);

      // Clear selection if needed
      if (this.state.selectedInstanceId){
        const ok = (this.project.instances || []).some(x => x.id === this.state.selectedInstanceId);
        if (!ok) this.state.selectedInstanceId = null;
      }
      if (this.state.selectedClipId === clipId) this.state.selectedClipId = null;

      persist();
      log('Removed clip.');
      this.render();
    },




    setActiveTrackIndex(trackIndex){
      const n = Number(trackIndex);
      if (!Number.isFinite(n)) return {ok:false, error:'bad_track_index'};
      const max = Math.max(0, (this.project.tracks||[]).length - 1);
      const ti = Math.max(0, Math.min(max, Math.round(n)));
      this.state.activeTrackIndex = ti;
      this.state.activeTrackId = (this.project.tracks && this.project.tracks[ti]) ? this.project.tracks[ti].id : null;
      // Soft update: timeline highlight only (no persist)
      try{
        if (this.timelineCtrl && typeof this.timelineCtrl.setActiveTrackIndex === 'function'){
          this.timelineCtrl.setActiveTrackIndex(ti);
        }else{
          this.renderTimeline();
        }
      }catch(e){}
      return {ok:true, trackIndex: ti, trackId: this.state.activeTrackId};
    },

    addClipToTimeline(clipId, startSec, trackIndex, opts){
      const skipPersistRender = opts && opts.skipPersistRender === true;
      const ti = (trackIndex == null) ? (Number.isFinite(this.state.activeTrackIndex) ? this.state.activeTrackIndex : 0) : trackIndex;
      const inst = H2SProject.createInstance(clipId, startSec || (this.project.ui.playheadSec || 0), ti);
      this.project.instances.push(inst);
      this.state.selectedInstanceId = inst.id;
      if (inst.clipId) this.state.selectedClipId = inst.clipId;
      if (!skipPersistRender){
        persist();
        log('Added clip to timeline.');
        this.render();
      }
    },

    instancePointerDown(ev, instId){
      ev.preventDefault();
      ev.stopPropagation();
      const el = ev.currentTarget;
      this.selectInstance(instId);
      const rect = el.getBoundingClientRect();
      this.state.draggingInstance = instId;
      this.state.dragOffsetX = ev.clientX - rect.left;
      el.setPointerCapture(ev.pointerId);
    },

    timelinePointerMove(ev){
      if (!this.state.draggingInstance) return;
      // handled in pointermove on window
    },

    timelinePointerUp(ev){
      // handled in pointerup on window
    },

    async pickWavAndGenerate(){
      const f = await this.pickFile('.wav,.mp3,.m4a,.flac,.ogg');
      if (!f) return;
      await this.uploadFileAndGenerate(f);
    },

    /**
     * Slice D/E: import a local audio file as a native `kind: 'audio'` clip.
     * Slice E: audio bytes are stored in IndexedDB; assetRef is `localidb:<id>` (durable across reload in this browser).
     */
    async _decodeAudioFileDurationSec(file){
      if (!file || !(file instanceof Blob)) return 1e-6;
      const Ctx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!Ctx) return 1;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try{
            const ctx = new Ctx();
            const ab = reader.result;
            const buf = await ctx.decodeAudioData(ab instanceof ArrayBuffer ? ab.slice(0) : ab);
            const d = buf.duration;
            try { await ctx.close(); } catch (_e) {}
            resolve((isFinite(d) && d > 0) ? d : 1e-6);
          } catch (e){
            reject(e);
          }
        };
        reader.onerror = () => reject(reader.error || new Error('file read failed'));
        reader.readAsArrayBuffer(file);
      });
    },

    /**
     * Shared path for native audio clips: decode duration, IndexedDB store, create clip + instance, persist.
     * @param {File|Blob} file
     * @param {{ baseName?: string, statusDoneKey?: string }} opts - baseName overrides stem from file.name; optional i18n key for final status (default io.importAudioStoredLocal)
     * @returns {Promise<{ ok: boolean, reason?: string, clipId?: string }>}
     */
    async _commitNativeAudioFile(file, opts){
      opts = opts || {};
      const P = window.H2SProject;
      if (!P || typeof P.createClipFromAudio !== 'function' || typeof P.createInstanceV2 !== 'function'){
        try { alert('Audio import is unavailable (project helpers missing).'); } catch (_e) {}
        return { ok: false, reason: 'no_project_helpers' };
      }
      if (!file || !(file instanceof Blob)){
        return { ok: false, reason: 'no_file' };
      }
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
      this.setImportStatus(_t('io.importAudioDecoding'), false);
      let durationSec = 1;
      try{
        durationSec = await this._decodeAudioFileDurationSec(file);
      } catch (e){
        console.warn('[App] audio duration decode failed', e);
        durationSec = 1;
      }
      if (!isFinite(durationSec) || durationSec <= 0) durationSec = 1e-6;
      const LAS = (typeof window !== 'undefined') ? window.H2SLocalAudioAssets : null;
      if (!LAS || typeof LAS.storeImportedAudioFile !== 'function'){
        try { alert(_t('io.importAudioNoStore') || 'Local audio storage is not available in this environment.'); } catch (_e) {}
        return { ok: false, reason: 'no_local_store' };
      }
      let assetRef;
      try{
        const st = await LAS.storeImportedAudioFile(file);
        assetRef = st && st.assetRef ? String(st.assetRef) : '';
      } catch (e){
        console.warn('[App] storeImportedAudioFile failed', e);
        try { alert(_t('io.importAudioStoreFailed') || 'Could not save imported audio locally (storage full or blocked).'); } catch (_e) {}
        return { ok: false, reason: 'store_failed' };
      }
      if (!assetRef){
        try { alert(_t('io.importAudioStoreFailed') || 'Could not save imported audio locally.'); } catch (_e) {}
        return { ok: false, reason: 'no_asset_ref' };
      }
      const nameFromFile = (file.name && /\.[^/.]+$/.test(String(file.name)))
        ? String(file.name).replace(/\.[^/.]+$/, '')
        : '';
      const baseName = (typeof opts.baseName === 'string' && String(opts.baseName).trim())
        ? String(opts.baseName).trim()
        : (nameFromFile || 'Imported audio');
      let p2 = this.getProjectV2();
      if (!p2) p2 = _projectV1ToV2(this.project);
      if (!p2 || !_isProjectV2(p2)){
        return { ok: false, reason: 'no_project_v2' };
      }
      const projBpm = (typeof p2.bpm === 'number' && isFinite(p2.bpm)) ? p2.bpm : 120;
      const clip = P.createClipFromAudio({
        assetRef,
        durationSec,
        name: baseName,
        bpm: projBpm,
      });
      if (!p2.clips || typeof p2.clips !== 'object' || Array.isArray(p2.clips)) p2.clips = {};
      p2.clips[clip.id] = clip;
      if (!Array.isArray(p2.clipOrder)) p2.clipOrder = [];
      p2.clipOrder.unshift(clip.id);
      if (typeof P.repairClipOrderV2 === 'function') P.repairClipOrderV2(p2);
      const ti = Number.isFinite(this.state.activeTrackIndex) ? Math.max(0, Math.floor(this.state.activeTrackIndex)) : 0;
      const tr = (p2.tracks && p2.tracks.length) ? p2.tracks[Math.min(ti, p2.tracks.length - 1)] : null;
      const trackId = (tr && (tr.trackId || tr.id)) ? String(tr.trackId || tr.id) : (P.SCHEMA_V2 && P.SCHEMA_V2.DEFAULT_TRACK_ID) ? P.SCHEMA_V2.DEFAULT_TRACK_ID : 'trk_0';
      const startBeat = (p2.ui && typeof p2.ui.playheadBeat === 'number' && isFinite(p2.ui.playheadBeat)) ? Math.max(0, p2.ui.playheadBeat) : 0;
      const inst = P.createInstanceV2(clip.id, startBeat, trackId);
      if (!Array.isArray(p2.instances)) p2.instances = [];
      p2.instances.push(inst);
      if (typeof P.normalizeProjectV2 === 'function') P.normalizeProjectV2(p2);
      this.state.selectedClipId = clip.id;
      this.state.selectedInstanceId = inst.id;
      this.setProjectFromV2(p2);
      const doneKey = (typeof opts.statusDoneKey === 'string' && opts.statusDoneKey.trim()) ? opts.statusDoneKey.trim() : 'io.importAudioStoredLocal';
      this.setImportStatus(_t(doneKey), false);
      log('Committed native audio clip: ' + clip.id);
      return { ok: true, clipId: clip.id };
    },

    async importAudioFileAsNativeClip(){
      let file;
      try{
        file = await this.pickFile('audio/*');
      } catch (e){
        return;
      }
      if (!file) return;
      await this._commitNativeAudioFile(file, {});
    },

    /** Record → native audio: uses same pipeline as direct import (`_commitNativeAudioFile`). */
    async addLastRecordingAsNativeAudioClip(){
      const f = this.state && this.state.lastRecordedFile;
      if (!f) return;
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
      const baseName = _t('cliplib.recordingClipName') || 'Recording';
      await this._commitNativeAudioFile(f, { baseName, statusDoneKey: 'io.addRecordingAsAudioDone' });
    },

    /** PR-C2: Set import status (upload/generate progress). showCancel: only during active import. */
    setImportStatus(text, showCancel){
      if (typeof document === 'undefined') return;
      const el = $('#studioImportStatus');
      if (el) el.textContent = text || '';
      const btn = $('#btnCancelImport');
      if (btn) btn.style.display = (text && showCancel) ? 'inline-block' : 'none';
      this.state.statusText = text || '';
      if (typeof this.updateLogStatusBar === 'function') this.updateLogStatusBar();
      const t = String(text || '');
      if (/Failed|Error/i.test(t) && typeof this.setLogOpen === 'function') this.setLogOpen(true);
    },
    /** PR-UX3a: Update log status bar text from statusText or last log line or Ready. */
    updateLogStatusBar(){
      if (typeof document === 'undefined') return;
      const bar = $('#logStatusBar');
      if (!bar) return;
      const status = (this.state && this.state.statusText) || _lastLogLine || ((window.I18N && window.I18N.t) ? window.I18N.t('log.ready') : 'Ready');
      const txt = String(status || '');
      bar.textContent = txt.length > 80 ? txt.slice(0, 77) + '...' : txt;
      bar.classList.toggle('error', /Failed|Error/i.test(String(status)));
      bar.title = (window.I18N && window.I18N.t) ? window.I18N.t('log.clickToExpand') : 'Click to expand log';
    },
    /** PR-UX3a: Set log drawer open/closed and persist. */
    setLogOpen(open){
      const panel = $('#logPanel');
      if (!panel) return;
      panel.classList.toggle('collapsed', !open);
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY_LOG_OPEN, open ? '1' : '0');
      } catch (e) {}
    },

    /** PR-C1: Shared upload/generate pipeline — used by Upload WAV and Use last recording. */
    async uploadFileAndGenerate(f){
      if (!f || !(f instanceof Blob)) return;
      const file = f instanceof File ? f : new File([f], (f.name || 'recording.webm'), { type: (f.type || 'audio/webm') });
      this.state.importCancelled = false;
      this.setImportStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.uploading') : 'Uploading audio...', true);
      log(`Uploading ${file.name} ...`);
      try{
        const fd = new FormData();
        fd.append('file', file, file.name);
        const res = await fetchJson(API.generate('mp3'), { method:'POST', body:fd });
        const tid = res.task_id || res.id || res.taskId || res.task || null;
        if (!tid){
          this.setImportStatus('Failed: Server did not return task ID.', false);
          log('generate returned no task_id');
          alert('Upload failed: server did not return a task ID. Check backend logs.');
          return;
        }
        this.state.lastUploadTaskId = tid;
        log(`Generate queued: ${tid}`);
        this.setImportStatus(((window.I18N && window.I18N.t) ? window.I18N.t('io.processing') : 'Processing...') + ' (task: ' + String(tid).slice(0, 8) + '...)', true);
        await this.pollTaskUntilDone(tid);
        if (this.state.importCancelled){
          this.setImportStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.cancelled') : 'Cancelled.', false);
          log('Import cancelled by user');
          return;
        }
        this.setImportStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.fetching') : 'Fetching...', true);
        const score = await fetchJson(API.score(tid));
        if (this.state.importCancelled){
          this.setImportStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.cancelled') : 'Cancelled.', false);
          return;
        }
        let splitRes = { score, applied: false };
        try{
          const flagOn = (typeof localStorage !== 'undefined') && String(localStorage.getItem(LS_KEY_DEV_TRANSCRIPTION_PITCH_SPLIT) || '') === '1';
          const S = (typeof globalThis !== 'undefined' && globalThis.H2SScoreHeuristicSplit) || (typeof window !== 'undefined' && window.H2SScoreHeuristicSplit);
          if (flagOn && S && typeof S.applyTranscriptionPitchSplitIfEnabled === 'function'){
            splitRes = S.applyTranscriptionPitchSplitIfEnabled(score, true);
            if (splitRes.applied) log('Transcription: heuristic pitch-bucket split applied (dev flag).');
          }
        }catch(e){
          console.warn('[app] transcription pitch split skipped', e);
          splitRes = { score, applied: false };
        }
        const scoreForClip = splitRes.score;

        this.setImportStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.creatingClip') : 'Creating clip...', true);

        if ((this.project.clips || []).length === 0){
          const srcBpm = (typeof scoreForClip.tempo_bpm === 'number') ? scoreForClip.tempo_bpm : ((typeof scoreForClip.bpm === 'number') ? scoreForClip.bpm : null);
          if (typeof srcBpm === 'number' && isFinite(srcBpm) && srcBpm >= 30 && srcBpm <= 300){
            this.project.bpm = srcBpm;
            const el = $('#bpm');
            if (el) el.value = String(Math.round(srcBpm));
          }
        }

        const importBaseName = file.name.replace(/\.[^/.]+$/, '');
        const playheadSec = this.project.ui.playheadSec || 0;
        const SplitApi = (typeof globalThis !== 'undefined' && globalThis.H2SScoreHeuristicSplit) || (typeof window !== 'undefined' && window.H2SScoreHeuristicSplit);
        const explodeSegmentDev =
          (typeof localStorage !== 'undefined') &&
          String(localStorage.getItem(LS_KEY_DEV_TRANSCRIPTION_EXPLODE_SEGMENT) || '') === '1';
        const barSegDev =
          (typeof localStorage !== 'undefined') &&
          String(localStorage.getItem(LS_KEY_DEV_TRANSCRIPTION_BAR_SEGMENT) || '') === '1';
        const barSegActive =
          barSegDev &&
          SplitApi &&
          typeof SplitApi.segmentScoreDocByBarBoundaries === 'function';
        let barScoreSegments = null;
        if (barSegActive){
          try{
            barScoreSegments = SplitApi.segmentScoreDocByBarBoundaries(scoreForClip, { maxBars: 2 });
            log('Transcription: bar-aware full-score segmentation (dev flag).');
          }catch(e){
            console.warn('[app] bar-aware segmentation skipped', e);
            barScoreSegments = null;
          }
        }
        const useGapSeg = explodeSegmentDev && !barSegActive;

        let explodeParts = null;
        if (SplitApi && typeof SplitApi.explodeNonEmptyTracksToSingleTrackScores === 'function'){
          if (splitRes.applied){
            explodeParts = SplitApi.explodeNonEmptyTracksToSingleTrackScores(scoreForClip);
          }
        }
        const useExplode = Array.isArray(explodeParts) && explodeParts.length >= 2;

        if (barSegActive && Array.isArray(barScoreSegments) && barScoreSegments.length > 0){
          let maxExplodeParts = 0;
          for (let bx = 0; bx < barScoreSegments.length; bx++){
            const segSc = barScoreSegments[bx] && barScoreSegments[bx].score;
            if (!SplitApi || typeof SplitApi.explodeNonEmptyTracksToSingleTrackScores !== 'function') continue;
            const ep = SplitApi.explodeNonEmptyTracksToSingleTrackScores(segSc);
            if (Array.isArray(ep) && ep.length > maxExplodeParts) maxExplodeParts = ep.length;
          }
          if (!this.project.tracks) this.project.tracks = [];
          while (this.project.tracks.length < maxExplodeParts){
            const n = this.project.tracks.length + 1;
            this.project.tracks.push({ id: H2SProject.uid('trk_'), name: 'Track ' + n });
          }
          const _perfImp = _devPerfTimingEnabled();
          const _perfLoopT0 = _perfImp && typeof performance !== 'undefined' ? performance.now() : 0;
          let explodeClipCount = 0;
          let lastClipIdForAutoOpen = null;
          for (let bi = 0; bi < barScoreSegments.length; bi++){
            const barSeg = barScoreSegments[bi];
            const segScore = barSeg && barSeg.score;
            const segTMinAbs = (typeof barSeg.tMin === 'number' && isFinite(barSeg.tMin)) ? barSeg.tMin : 0;
            if (!segScore) continue;
            let explodePartsSeg = null;
            if (SplitApi && typeof SplitApi.explodeNonEmptyTracksToSingleTrackScores === 'function'){
              explodePartsSeg = SplitApi.explodeNonEmptyTracksToSingleTrackScores(segScore);
            }
            if (!Array.isArray(explodePartsSeg) || explodePartsSeg.length === 0) continue;
            const barLabel = barScoreSegments.length > 1 ? (' · ' + (bi + 1)) : '';
            for (let k = explodePartsSeg.length - 1; k >= 0; k--){
              const part = explodePartsSeg[k];
              let scoreForPart = part.score;
              let tMinForPart = 0;
              if (SplitApi && typeof SplitApi.trimScoreDocToNoteExtent === 'function'){
                const trimmed = SplitApi.trimScoreDocToNoteExtent(part.score);
                scoreForPart = trimmed.score;
                tMinForPart = (typeof trimmed.tMin === 'number' && isFinite(trimmed.tMin)) ? trimmed.tMin : 0;
              }
              let segmentBlocks;
              if (useGapSeg && SplitApi && typeof SplitApi.segmentScoreDocByGapAndMaxDuration === 'function'){
                segmentBlocks = SplitApi.segmentScoreDocByGapAndMaxDuration(scoreForPart, {
                  minGapSec: 1.15,
                  maxDurationSec: 24,
                });
              } else {
                segmentBlocks = [{ score: scoreForPart, tMin: 0, tMax: 0 }];
              }
              explodeClipCount += segmentBlocks.length;
              for (let si = segmentBlocks.length - 1; si >= 0; si--){
                const seg = segmentBlocks[si];
                const segTMin = (typeof seg.tMin === 'number' && isFinite(seg.tMin)) ? seg.tMin : 0;
                const instanceStartSec = playheadSec + segTMinAbs + tMinForPart + segTMin;
                const segLabel = segmentBlocks.length > 1 ? (' · ' + (si + 1)) : '';
                let _tCreate = 0;
                if (_perfImp && typeof performance !== 'undefined') _tCreate = performance.now();
                const clip = H2SProject.createClipFromScore(seg.score, {
                  name: importBaseName + barLabel + ' — ' + part.trackName + segLabel,
                  sourceTaskId: tid,
                });
                lastClipIdForAutoOpen = clip.id;
                if (_perfImp && typeof performance !== 'undefined'){
                  console.log('[H2S perf] import bar-seg explode createClipFromScore bi=' + bi + ' k=' + k + ' si=' + si, (performance.now() - _tCreate).toFixed(2) + 'ms');
                }
                if (!clip.meta) clip.meta = {};
                const srcMeta = seg.score;
                if (typeof srcMeta.tempo_bpm === 'number') clip.meta.sourceTempoBpm = srcMeta.tempo_bpm;
                else if (typeof srcMeta.bpm === 'number') clip.meta.sourceTempoBpm = srcMeta.bpm;
                if (splitRes.applied) clip.meta.heuristicPitchSplit = true;
                clip.meta.splitExploded = explodePartsSeg.length >= 2;
                clip.meta.splitExplodeIndex = part.splitIndex;
                clip.meta.splitTrackName = part.trackName;
                if (barScoreSegments.length > 1){
                  clip.meta.splitBarSegmentIndex = bi;
                  clip.meta.splitBarSegmentCount = barScoreSegments.length;
                }
                if (segmentBlocks.length > 1){
                  clip.meta.splitSegmentIndex = si;
                  clip.meta.splitSegmentCount = segmentBlocks.length;
                }
                this.project.clips.unshift(clip);
                let _tAdd = 0;
                if (_perfImp && typeof performance !== 'undefined') _tAdd = performance.now();
                this.addClipToTimeline(clip.id, instanceStartSec, k, { skipPersistRender: true });
                if (_perfImp && typeof performance !== 'undefined'){
                  console.log('[H2S perf] import bar-seg addClipToTimeline bi=' + bi + ' k=' + k + ' si=' + si, (performance.now() - _tAdd).toFixed(2) + 'ms');
                }
              }
            }
          }
          if (_perfImp && typeof performance !== 'undefined'){
            console.log('[H2S perf] import bar-segment explode loop total', (performance.now() - _perfLoopT0).toFixed(2) + 'ms');
          }
          persist();
          this.render();
          log('Added clip to timeline.');
          const doneMulti = 'Done: ' + explodeClipCount + ' clips (bar segment + explode).';
          this.setImportStatus((window.I18N && window.I18N.t) ? (window.I18N.t('io.done') + ' (' + explodeClipCount + ' clips)') : doneMulti, false);
          log('Clips added (bar segment + explode): ' + explodeClipCount);
          if (explodeClipCount === 1 && lastClipIdForAutoOpen && this.state.autoOpenAfterImport && typeof this.openClipEditor === 'function'){
            const c = this.project.clips.find((x) => x && x.id === lastClipIdForAutoOpen);
            if (c && !_importTooLargeForAutoOpen(c)){
              setTimeout(() => this.openClipEditor(lastClipIdForAutoOpen), 0);
            }
          } else {
            log('Import: editor not auto-opened (multi-clip).');
          }
          setTimeout(() => this.setImportStatus('', false), 2500);
        } else if (useExplode){
          if (!this.project.tracks) this.project.tracks = [];
          while (this.project.tracks.length < explodeParts.length){
            const n = this.project.tracks.length + 1;
            this.project.tracks.push({ id: H2SProject.uid('trk_'), name: 'Track ' + n });
          }
          const _perfImp = _devPerfTimingEnabled();
          const _perfLoopT0 = _perfImp && typeof performance !== 'undefined' ? performance.now() : 0;
          if (explodeSegmentDev) log('Transcription: explode time segmentation (dev flag).');
          let explodeClipCount = 0;
          for (let k = explodeParts.length - 1; k >= 0; k--){
            const part = explodeParts[k];
            let scoreForPart = part.score;
            let tMinForPart = 0;
            if (SplitApi && typeof SplitApi.trimScoreDocToNoteExtent === 'function'){
              const trimmed = SplitApi.trimScoreDocToNoteExtent(part.score);
              scoreForPart = trimmed.score;
              tMinForPart = (typeof trimmed.tMin === 'number' && isFinite(trimmed.tMin)) ? trimmed.tMin : 0;
            }
            let segmentBlocks;
            if (useGapSeg && SplitApi && typeof SplitApi.segmentScoreDocByGapAndMaxDuration === 'function'){
              segmentBlocks = SplitApi.segmentScoreDocByGapAndMaxDuration(scoreForPart, {
                minGapSec: 1.15,
                maxDurationSec: 24,
              });
            } else {
              segmentBlocks = [{ score: scoreForPart, tMin: 0, tMax: 0 }];
            }
            explodeClipCount += segmentBlocks.length;
            // Unshift in reverse segment order so clips array keeps increasing time per track (seg si=0 first).
            for (let si = segmentBlocks.length - 1; si >= 0; si--){
              const seg = segmentBlocks[si];
              const segTMin = (typeof seg.tMin === 'number' && isFinite(seg.tMin)) ? seg.tMin : 0;
              // Absolute: playhead + trim offset (full score) + segment offset (trimmed score, rebased notes).
              const instanceStartSec = playheadSec + tMinForPart + segTMin;
              const segLabel = segmentBlocks.length > 1 ? (' · ' + (si + 1)) : '';
              let _tCreate = 0;
              if (_perfImp && typeof performance !== 'undefined') _tCreate = performance.now();
              const clip = H2SProject.createClipFromScore(seg.score, {
                name: importBaseName + ' — ' + part.trackName + segLabel,
                sourceTaskId: tid,
              });
              if (_perfImp && typeof performance !== 'undefined'){
                console.log('[H2S perf] import explode createClipFromScore k=' + k + ' si=' + si, (performance.now() - _tCreate).toFixed(2) + 'ms');
              }
              if (!clip.meta) clip.meta = {};
              const srcMeta = seg.score;
              if (typeof srcMeta.tempo_bpm === 'number') clip.meta.sourceTempoBpm = srcMeta.tempo_bpm;
              else if (typeof srcMeta.bpm === 'number') clip.meta.sourceTempoBpm = srcMeta.bpm;
              if (splitRes.applied) clip.meta.heuristicPitchSplit = true;
              clip.meta.splitExploded = true;
              clip.meta.splitExplodeIndex = part.splitIndex;
              clip.meta.splitTrackName = part.trackName;
              if (segmentBlocks.length > 1){
                clip.meta.splitSegmentIndex = si;
                clip.meta.splitSegmentCount = segmentBlocks.length;
              }
              this.project.clips.unshift(clip);
              let _tAdd = 0;
              if (_perfImp && typeof performance !== 'undefined') _tAdd = performance.now();
              this.addClipToTimeline(clip.id, instanceStartSec, k, { skipPersistRender: true });
              if (_perfImp && typeof performance !== 'undefined'){
                console.log('[H2S perf] import explode addClipToTimeline k=' + k + ' si=' + si, (performance.now() - _tAdd).toFixed(2) + 'ms');
              }
            }
          }
          if (_perfImp && typeof performance !== 'undefined'){
            console.log('[H2S perf] import explode loop total', (performance.now() - _perfLoopT0).toFixed(2) + 'ms');
          }
          persist();
          this.render();
          log('Added clip to timeline.');
          const doneMulti = 'Done: ' + explodeClipCount + ' clips on ' + explodeParts.length + ' tracks.';
          this.setImportStatus((window.I18N && window.I18N.t) ? (window.I18N.t('io.done') + ' (' + explodeClipCount + ' clips)') : doneMulti, false);
          log('Clips added (split explode): ' + explodeClipCount);
          log('Import: editor not auto-opened (multi-clip).');
          setTimeout(() => this.setImportStatus('', false), 2500);
        } else {
          const clip = H2SProject.createClipFromScore(scoreForClip, { name: importBaseName, sourceTaskId: tid });
          if (!clip.meta) clip.meta = {};
          if (typeof scoreForClip.tempo_bpm === 'number') clip.meta.sourceTempoBpm = scoreForClip.tempo_bpm;
          else if (typeof scoreForClip.bpm === 'number') clip.meta.sourceTempoBpm = scoreForClip.bpm;
          if (splitRes.applied) clip.meta.heuristicPitchSplit = true;
          this.project.clips.unshift(clip);
          this.addClipToTimeline(clip.id, playheadSec, 0);
          persist();
          this.render();
          this.setImportStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.done') : 'Done', false);
          log(`Clip added: ${clip.name}`);
          const cidNew = clip.id;
          const skipAutoOpenLarge = _importTooLargeForAutoOpen(clip);
          if (skipAutoOpenLarge) log('Import: editor not auto-opened (large result).');
          if (this.state.autoOpenAfterImport && typeof this.openClipEditor === 'function' && !skipAutoOpenLarge){
            setTimeout(() => this.openClipEditor(cidNew), 0);
          }
          setTimeout(() => this.setImportStatus('', false), 2000);
        }
      }catch(e){
        if (this.state.importCancelled){
          this.setImportStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.cancelled') : 'Cancelled.', false);
          log('Import cancelled by user');
        }else{
          const msg = (e && e.message) ? String(e.message) : String(e);
          const short = msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
          this.setImportStatus('Failed: ' + short, false);
          log('Upload/generate error: ' + msg);
          console.error('[Studio] uploadFileAndGenerate error', e);
          let userMsg = 'Generate failed. ';
          if (/timeout/i.test(msg)) userMsg += 'Processing timed out. Try a shorter clip.';
          else if (/task failed/i.test(msg)) userMsg += 'Backend task failed. Check server logs.';
          else if (/fetch|network/i.test(msg)) userMsg += 'Network error. Check connection and server.';
          else userMsg += 'See status bar and console for details.';
          alert(userMsg);
        }
      }
    },

    /**
     * Original audio clip → new editable note clip via the same /generate → poll → /score path as Import as notes.
     * Does not remove or modify the source audio clip.
     */
    async convertAudioClipToEditable(clipId){
      const P = window.H2SProject;
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
      if (!clipId || !P || typeof P.clipKind !== 'function') return { ok: false, reason: 'bad_args' };
      const p2 = (typeof this.getProjectV2 === 'function') ? this.getProjectV2() : null;
      const c = p2 && p2.clips && p2.clips[clipId];
      if (!c || P.clipKind(c) !== 'audio'){
        try { alert(_t('cliplib.convertToEditableNeedAudio')); } catch (_e) {}
        return { ok: false, reason: 'not_audio' };
      }
      const assetRef = (c.audio && typeof c.audio.assetRef === 'string') ? c.audio.assetRef.trim() : '';
      const LAS = (typeof window !== 'undefined') ? window.H2SLocalAudioAssets : null;
      if (!LAS || typeof LAS.getFileForLocalAssetRef !== 'function'){
        try { alert(_t('io.convertAudioBlobMissing')); } catch (_e) {}
        return { ok: false, reason: 'no_local_assets_api' };
      }
      if (typeof LAS.isLocalImportedAudioRef !== 'function' || !LAS.isLocalImportedAudioRef(assetRef)){
        try { alert(_t('io.convertAudioOnlyLocal')); } catch (_e) {}
        return { ok: false, reason: 'not_localidb' };
      }
      const file = await LAS.getFileForLocalAssetRef(assetRef);
      if (!file){
        try { alert(_t('io.convertAudioBlobMissing')); } catch (_e) {}
        return { ok: false, reason: 'no_file' };
      }
      await this.uploadFileAndGenerate(file);
      return { ok: true };
    },

    /** PR-C5.3b: Reliable isPlaying for S button visibility. */
    _isPlaying(){
      if (this.audioCtrl && typeof this.audioCtrl.playing === 'boolean') return this.audioCtrl.playing;
      if (this.state && this.state.transportPlaying) return true;
      try{
        if (typeof window !== 'undefined' && window.Tone && window.Tone.Transport) return String(window.Tone.Transport.state) === 'started';
      }catch(e){}
      return false;
    },

    /** PR-C1/PR-C5: Recording state machine + Recording panel UI. */
    updateRecordButtonStates(){
      if (typeof document === 'undefined') return;
      const rec = $('#btnRecord');
      const stp = document.getElementById('btnStop');
      const useLast = $('#btnUseLast');
      const timerEl = $('#studioRecordTimer');
      const waveEl = $('#studioRecordWaveform');
      const statusEl = $('#studioRecordStatus');
      const active = !!this.state.recordingActive;
      if (rec) {
        rec.textContent = active ? ('\u23F9 ' + ((window.I18N && window.I18N.t) ? window.I18N.t('top.stop') : 'Stop')) : ('\u{1F534} ' + ((window.I18N && window.I18N.t) ? window.I18N.t('top.record') : 'Record'));
        rec.title = active ? 'Stop recording' : 'Record mic (R)';
        rec.disabled = false;
      }
      if (stp) {
        const playing = this._isPlaying();
        stp.style.visibility = playing ? 'visible' : 'hidden';
        stp.style.pointerEvents = playing ? '' : 'none';
        stp.title = 'Stop + Reset (S)';
      }
      if (useLast) {
        useLast.disabled = !this.state.lastRecordedFile;
        useLast.style.opacity = this.state.lastRecordedFile ? '1' : '.6';
      }
      const playLast = document.getElementById('btnPlayLast');
      if (playLast) {
        playLast.disabled = !this.state.lastRecordedFile;
        playLast.style.opacity = this.state.lastRecordedFile ? '1' : '.6';
      }
      const addLastAsAudio = document.getElementById('btnAddLastAsAudio');
      if (addLastAsAudio) {
        addLastAsAudio.disabled = !this.state.lastRecordedFile;
        addLastAsAudio.style.opacity = this.state.lastRecordedFile ? '1' : '.6';
      }
      if (timerEl) timerEl.style.display = active ? '' : 'none';
      if (waveEl) waveEl.style.display = active ? '' : 'none';
    },

    async startRecording(){
      if (this.state.recordingActive) return;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function'){
        log('Microphone not available in this environment.');
        return;
      }
      const statusEl = typeof document !== 'undefined' ? $('#studioRecordStatus') : null;
      const timerEl = typeof document !== 'undefined' ? $('#studioRecordTimer') : null;
      const waveEl = typeof document !== 'undefined' ? $('#studioRecordWaveform') : null;
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: mime });
          const ext = mime.indexOf('webm') >= 0 ? 'webm' : 'ogg';
          this.state.lastRecordedFile = new File([blob], `recording.${ext}`, { type: blob.type || 'audio/webm' });
          this.state.recordingActive = false;
          this._stopRecordingUI();
          const durSec = this._recordingStartMs ? (Date.now() - this._recordingStartMs) / 1000 : 0;
          const mm = Math.floor(durSec / 60);
          const ss = Math.floor(durSec % 60);
          const durStr = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
          if (statusEl) { statusEl.dataset.recordingStatus = '1'; statusEl.textContent = `Recording stopped (${durStr})`; }
          setTimeout(() => { if (statusEl) { statusEl.textContent = ''; delete statusEl.dataset.recordingStatus; } }, 2000);
          this.updateRecordButtonStates();
          log('Recording stopped.');
        };
        recorder.onerror = (e) => {
          this.state.recordingActive = false;
          this._stopRecordingUI();
          this.updateRecordButtonStates();
          log(`Recording error: ${e.error || 'unknown'}`);
        };
        this._mediaRecorder = recorder;
        this._recordedChunks = chunks;
        recorder.start(200);
        this.state.recordingActive = true;
        this._recordingStartMs = Date.now();
        this._startRecordingUI(stream, waveEl, timerEl);
        this.updateRecordButtonStates();
        log('Recording started.');
      }catch(e){
        this.state.recordingActive = false;
        if (statusEl) statusEl.textContent = 'Microphone permission denied.';
        this.updateRecordButtonStates();
        this.setImportStatus('Microphone permission denied.', false);
        log(`Microphone access denied or unavailable: ${String(e && e.message ? e.message : e)}`);
        alert('Cannot access microphone. Please allow mic permission and try again.');
        setTimeout(() => { this.setImportStatus('', false); if (statusEl) statusEl.textContent = ''; }, 5000);
      }
    },

    _startRecordingUI(stream, waveEl, timerEl){
      if (typeof document === 'undefined') return;
      const self = this;
      const statusEl = $('#studioRecordStatus');
      this._recordingTimerInterval = setInterval(() => {
        if (!self.state.recordingActive || !timerEl) return;
        const elapsed = (Date.now() - (self._recordingStartMs || 0)) / 1000;
        const mm = Math.floor(elapsed / 60);
        const ss = Math.floor(elapsed % 60);
        timerEl.textContent = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
      }, 200);
      if (waveEl && stream){
        const CtxClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || (typeof AudioContext !== 'undefined' ? AudioContext : null);
        if (!CtxClass){
          if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
          return;
        }
        (async () => {
          try{
            const audioCtx = new CtxClass();
            await audioCtx.resume().catch(() => {});
            this._recAudioCtx = audioCtx;
            const src = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;
            src.connect(analyser);
            const z = audioCtx.createGain();
            z.gain.value = 0;
            analyser.connect(z);
            z.connect(audioCtx.destination);
            this._recAnalyser = analyser;
            this._recZeroGain = z;
            this._recStreamSrc = src;
            const data = new Uint8Array(analyser.fftSize);
            const canvas = waveEl;
            const w = canvas.width;
            const h = canvas.height;
            const sliceWidth = w / data.length;
            const draw = () => {
              try{
                if (!self.state.recordingActive || !analyser) return;
                const ctx2d = canvas.getContext('2d');
                if (!ctx2d){
                  if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
                  return;
                }
                analyser.getByteTimeDomainData(data);
                ctx2d.clearRect(0, 0, w, h);
                ctx2d.strokeStyle = 'rgba(239,68,68,.7)';
                ctx2d.lineWidth = 2;
                ctx2d.beginPath();
                let x = 0;
                for (let i = 0; i < data.length; i++){
                  const v = data[i] / 128.0;
                  const y = v * (h / 2);
                  if (i === 0) ctx2d.moveTo(x, y);
                  else ctx2d.lineTo(x, y);
                  x += sliceWidth;
                }
                ctx2d.stroke();
                ctx2d.strokeStyle = 'rgba(255,255,255,.15)';
                ctx2d.lineWidth = 1;
                ctx2d.beginPath();
                ctx2d.moveTo(0, h / 2);
                ctx2d.lineTo(w, h / 2);
                ctx2d.stroke();
              }catch(err){
                if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
                log('Waveform draw error: ' + err);
                return;
              }
              self._recordingWaveformRaf = requestAnimationFrame(draw);
            };
            draw();
          }catch(err){
            log('Waveform init failed: ' + err);
            if (statusEl) statusEl.textContent = 'Waveform unavailable (recording still works).';
          }
        })();
      }
    },

    _stopRecordingUI(){
      if (typeof document === 'undefined') return;
      if (this._recordingTimerInterval){ clearInterval(this._recordingTimerInterval); this._recordingTimerInterval = null; }
      if (this._recordingWaveformRaf){ cancelAnimationFrame(this._recordingWaveformRaf); this._recordingWaveformRaf = null; }
      if (this._recStreamSrc){ try{ this._recStreamSrc.disconnect(); }catch(e){} this._recStreamSrc = null; }
      if (this._recAnalyser){ try{ this._recAnalyser.disconnect(); }catch(e){} this._recAnalyser = null; }
      if (this._recZeroGain){ try{ this._recZeroGain.disconnect(); }catch(e){} this._recZeroGain = null; }
      if (this._recAudioCtx){ this._recAudioCtx.close().catch(() => {}); this._recAudioCtx = null; }
      const timerEl = $('#studioRecordTimer');
      const waveEl = $('#studioRecordWaveform');
      if (timerEl){ timerEl.textContent = '00:00'; timerEl.style.display = 'none'; }
      if (waveEl){
        waveEl.style.display = 'none';
        const g = waveEl.getContext('2d');
        if (g) g.clearRect(0, 0, waveEl.width, waveEl.height);
      }
    },

    stopRecording(){
      if (!this.state.recordingActive || !this._mediaRecorder) return;
      try{
        if (this._mediaRecorder.state !== 'inactive') this._mediaRecorder.stop();
      }catch(e){ log(`Stop recording: ${e}`); }
      this._stopRecordingUI();
      this._mediaRecorder = null;
      this._recordedChunks = null;
    },

    useLastRecording(){
      if (!this.state.lastRecordedFile) return;
      this.uploadFileAndGenerate(this.state.lastRecordedFile);
    },

    /** UX: Preview last recorded raw audio before generation. Safe no-op if no recording. */
    playLastRecording(){
      if (!this.state.lastRecordedFile) return;
      try{
        const url = URL.createObjectURL(this.state.lastRecordedFile);
        const audio = new Audio(url);
        const revoke = () => { try{ URL.revokeObjectURL(url); }catch(e){} };
        audio.onended = revoke;
        audio.onerror = revoke;
        audio.play().catch(() => revoke());
      }catch(e){ /* minimal safe failure: do not break recording or generation flow */ }
    },

    async pollTaskUntilDone(taskId){
      const maxWaitMs = 180000;
      const start = performance.now();
      while (true){
        if (this.state.importCancelled) throw new Error('Cancelled by user');
        const data = await fetchJson(API.task(taskId));
        const status = String((data.status || data.state || data.task_status || data.taskStatus || '')).toLowerCase();
        if (status.includes('completed') || status.includes('done') || status === 'success'){
          log(`Task completed: ${taskId}`);
          return;
        }
        if (status.includes('failed') || status.includes('error')){
          throw new Error(`Task failed: ${JSON.stringify(data)}`);
        }
        if (performance.now() - start > maxWaitMs){
          throw new Error('Task timeout');
        }
        await sleep(800);
      }
    },

    clearProject(opts){
      const skipConfirm = opts && opts.skipConfirm;
      if (!skipConfirm && !confirm('Clear local project (clips + timeline)?')) return;
      this.project = H2SProject.defaultProject();
      persist();
      this.render();
      log('Cleared project.');
    },

    /**
     * Inspector: replace current local project blob.
     * Project Home: pass { asNewLocalProject: true } to add a new local entry and switch to it.
     */
    async importProjectJsonFromFile(opts){
      opts = opts || {};
      const f = await this.pickFile('.json');
      if (!f) return false;
      const txt = await f.text();
      try{
        const obj = JSON.parse(txt);
        const loaded = H2SProject.loadProjectDocV2(obj);
        if (opts.asNewLocalProject){
          const base = String(f.name || 'import').replace(/\.json$/i, '').trim() || 'import';
          this._createLocalProjectEntryAndSwitch(loaded, { importLabel: base.slice(0, 64) });
        } else {
          this.setProjectFromV2(loaded);
        }
        try{ localStorage.removeItem(LS_KEY_V1); }catch(e){}
        log('Imported project json.');
        return true;
      }catch(e){
        alert('Invalid JSON.');
        return false;
      }
    },

    /** New blank local project entry; does not clear other stored projects. */
    createNewLocalProject(){
      const P = window.H2SProject;
      if (!P || typeof P.defaultProjectV2 !== 'function' || typeof P.uid !== 'function'){
        console.error('[App] createNewLocalProject: H2SProject missing');
        return;
      }
      const p2 = P.defaultProjectV2();
      this._createLocalProjectEntryAndSwitch(p2, {});
      this.state.selectedClipId = null;
      this.state.selectedInstanceId = null;
      log('New local project.');
    },

    /**
     * Append a new index row, set current id, persist v2 blob via setProjectFromV2.
     * @param {object} p2 - ProjectDoc v2
     * @param {{ importLabel?: string }} meta
     */
    _createLocalProjectEntryAndSwitch(p2, meta){
      const P = window.H2SProject;
      if (!P || typeof P.uid !== 'function' || !p2) return;
      meta = meta || {};
      const id = P.uid('prj_');
      const idx = _readProjectsIndex() || { version: 1, projects: [] };
      if (!Array.isArray(idx.projects)) idx.projects = [];
      const now = Date.now();
      const bpm = (typeof p2.bpm === 'number' && isFinite(p2.bpm)) ? p2.bpm : 120;
      const clipCount = _clipCountFromP2(p2);
      const label = (meta.importLabel && String(meta.importLabel).trim()) ? String(meta.importLabel).trim().slice(0, 64) : '';
      idx.projects.push({
        id,
        createdAt: now,
        updatedAt: now,
        bpm,
        clipCount,
        ...(label ? { label } : {}),
      });
      _writeProjectsIndex(idx);
      try{
        if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY_CURRENT_PROJECT_ID, id);
      }catch(e){}
      this._projectV2 = null;
      this.setProjectFromV2(p2);
    },

    _switchToLocalProjectId(projectId){
      if (!projectId) return;
      _migrateLegacyV2IfNeeded();
      _repairLocalProjectIndex();
      const cur = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY_CURRENT_PROJECT_ID) : null;
      if (cur && String(cur) === String(projectId)){
        this.closeProjectHome();
        return;
      }
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(_projectDataKey(projectId)) : null;
      if (!raw){
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
        alert(_t('projectHome.missingBlob'));
        return;
      }
      try{
        const obj = JSON.parse(raw);
        const loaded = H2SProject.loadProjectDocV2(obj);
        try{
          if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY_CURRENT_PROJECT_ID, String(projectId));
        }catch(e){}
        this._projectV2 = null;
        this.setProjectFromV2(loaded);
        this.state.selectedClipId = null;
        this.state.selectedInstanceId = null;
        this.closeProjectHome();
        log('Opened local project: ' + projectId);
      }catch(e){
        console.warn('[App] switch local project failed', e);
        alert('Invalid project data.');
      }
    },

    /**
     * Add a deep-cloned clip as a NEW clip (new id) into the current project v2 doc.
     * Shared by Import Clip JSON (bundle) and Import Clip from Project JSON.
     * sourceBpmForMeta: BPM from the source file (bundle or project); stored on clip.meta.importedBundleBpm for mismatch UX.
     */
    importClipAsNewIntoCurrentProjectV2(sourceClip, sourceBpmForMeta){
      const P = window.H2SProject;
      if (!P || typeof P.uid !== 'function' || typeof P.deepClone !== 'function') return null;
      let p2 = this.getProjectV2();
      if (!p2) p2 = _projectV1ToV2(this.project);
      if (!p2 || !_isProjectV2(p2)) return null;
      const newId = P.uid('clip_');
      const clip = P.deepClone(sourceClip);
      clip.id = newId;
      if (typeof clip.name !== 'string' || !String(clip.name).trim()) clip.name = 'Imported clip';
      const isAudio = (typeof P.clipKind === 'function' && P.clipKind(clip) === 'audio');
      if (isAudio && 'score' in clip) delete clip.score;
      if (typeof P.normalizeClipRevisionChain === 'function') P.normalizeClipRevisionChain(clip);
      if (isAudio){
        const bpmMeta = (typeof p2.bpm === 'number' && isFinite(p2.bpm)) ? p2.bpm : 120;
        if (typeof P.recomputeClipMetaFromAudio === 'function') P.recomputeClipMetaFromAudio(clip, bpmMeta);
      } else {
        if (clip.score && typeof P.ensureScoreBeatIds === 'function') P.ensureScoreBeatIds(clip.score);
        if (typeof P.recomputeClipMetaFromScoreBeat === 'function') P.recomputeClipMetaFromScoreBeat(clip);
      }
      const bundleBpm = (typeof sourceBpmForMeta === 'number' && isFinite(sourceBpmForMeta)) ? sourceBpmForMeta : null;
      if (bundleBpm != null) {
        if (!clip.meta || typeof clip.meta !== 'object') clip.meta = {};
        clip.meta.importedBundleBpm = bundleBpm;
      }
      if (!p2.clips || typeof p2.clips !== 'object' || Array.isArray(p2.clips)) p2.clips = {};
      p2.clips[newId] = clip;
      if (!Array.isArray(p2.clipOrder)) p2.clipOrder = [];
      p2.clipOrder.unshift(newId);
      if (typeof P.repairClipOrderV2 === 'function') P.repairClipOrderV2(p2);
      const projBpm = (typeof p2.bpm === 'number' && isFinite(p2.bpm)) ? p2.bpm : 120;
      this.setProjectFromV2(p2);
      this.state.selectedClipId = newId;
      this.state.selectedInstanceId = null;
      log('Imported clip JSON: ' + newId);
      if (bundleBpm != null && Math.round(bundleBpm) !== Math.round(projBpm)) {
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
        alert(_t('inspector.importClipBpmNote', { exportBpm: String(Math.round(bundleBpm)), projectBpm: String(Math.round(projBpm)) }));
      }
      return newId;
    },

    _populateClipFromProjectChooser(ids){
      const doc = this._pendingClipFromProject;
      const sel = $('#selClipFromProject');
      const lbl = $('#lblClipFromProjectBpm');
      if (!sel || !doc) return;
      const bpm = (typeof doc.bpm === 'number' && isFinite(doc.bpm)) ? doc.bpm : 120;
      const cur = this.getProjectV2();
      const curBpm = (cur && typeof cur.bpm === 'number' && isFinite(cur.bpm)) ? cur.bpm : 120;
      if (lbl){
        const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
        lbl.textContent = _t('inspector.importClipFromProjectBpmHint', { sourceBpm: String(Math.round(bpm)), projectBpm: String(Math.round(curBpm)) });
      }
      sel.innerHTML = '';
      for (let i = 0; i < ids.length; i++){
        const id = ids[i];
        const c = doc.clips[id];
        const name = (c && typeof c.name === 'string' && String(c.name).trim()) ? String(c.name).trim() : id;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name + ' — ' + id;
        sel.appendChild(opt);
      }
    },

    _openClipFromProjectModal(){
      const el = $('#clipFromProjectModal');
      if (!el) return;
      if (typeof this._updateI18nLabels === 'function') this._updateI18nLabels();
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
    },

    _closeClipFromProjectModal(){
      const el = $('#clipFromProjectModal');
      if (!el) return;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
      this._pendingClipFromProject = null;
    },

    _refreshProjectHomeSummary(){
      const bpmEl = $('#projectHomeBpm');
      const clEl = $('#projectHomeClips');
      if (!bpmEl || !clEl) return;
      const bpm = (this.project && typeof this.project.bpm === 'number' && isFinite(this.project.bpm)) ? Math.round(this.project.bpm) : 120;
      bpmEl.textContent = String(bpm);
      const clips = (this.project && Array.isArray(this.project.clips)) ? this.project.clips : [];
      clEl.textContent = String(clips.length);
    },

    _refreshProjectHomeLocalList(){
      const ul = $('#projectHomeLocalList');
      if (!ul) return;
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
      _migrateLegacyV2IfNeeded();
      _repairLocalProjectIndex();
      const idx = _readProjectsIndex();
      const cur = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY_CURRENT_PROJECT_ID) : null;
      ul.innerHTML = '';
      const projects = (idx && Array.isArray(idx.projects)) ? idx.projects : [];
      if (!projects.length){
        const li = document.createElement('li');
        li.className = 'muted';
        li.style.padding = '8px 10px';
        li.style.fontSize = '12px';
        li.textContent = _t('projectHome.emptyLocalList');
        ul.appendChild(li);
        return;
      }
      for (let i = 0; i < projects.length; i++){
        const entry = projects[i];
        if (!entry || !entry.id) continue;
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn projectHomeLocalBtn';
        btn.setAttribute('data-project-id', String(entry.id));
        if (cur && String(cur) === String(entry.id)) btn.classList.add('current');
        btn.textContent = _formatLocalProjectRowLabel(entry, cur);
        btn.title = String(entry.id);
        const pid = entry.id;
        btn.addEventListener('click', () => { this._switchToLocalProjectId(pid); });
        li.appendChild(btn);
        ul.appendChild(li);
      }
    },

    openProjectHome(){
      const el = $('#projectHomeModal');
      if (!el) return;
      if (typeof this._updateI18nLabels === 'function') this._updateI18nLabels();
      this._refreshProjectHomeSummary();
      this._refreshProjectHomeLocalList();
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
    },

    closeProjectHome(){
      const el = $('#projectHomeModal');
      if (!el) return;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    },

    _dismissProjectHomeAuto(){
      try{
        if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY_SKIP_PROJECT_HOME_AUTO, '1');
      }catch(e){}
      this.closeProjectHome();
    },

    pickFile(accept){
      return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept || '';
        inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
        inp.click();
      });
    },

    /* ---------------- Project playback (simple) ---------------- */
    async ensureTone(){
      // Tone may load async (fallback)
      for (let i=0;i<40;i++){
        if (window.Tone) return true;
        await sleep(50);
      }
      return !!window.Tone;
    },

    async _getMasterGainDb(){
      try{
        const raw = localStorage.getItem('h2s_master_gain_db');
        const v = Number(raw);
        if (Number.isFinite(v)) return Math.max(-40, Math.min(0, v));
      }catch(e){}
      return -24;
    },
    _setMasterGainDb(db){
      const v = Math.max(-40, Math.min(0, Number(db)));
      try{ localStorage.setItem('h2s_master_gain_db', String(v)); }catch(e){}
      this._masterGainDb = v;
      this._applyMasterGain();
    },
    _applyMasterGain(){
      try{
        if (window.Tone && Tone.Destination && Tone.Destination.volume){
          const v = (typeof this._masterGainDb === 'number') ? this._masterGainDb : this._getMasterGainDb();
          Tone.Destination.volume.value = v;
        }
      }catch(e){}
    },
    _initLangDropdown(){
      try{
        if (typeof document === 'undefined' || typeof window.I18N === 'undefined') return;
        const sel = document.getElementById('selLang');
        if (!sel) return;
        const I18N = window.I18N;
        I18N.init();

        const populate = () => {
          const list = I18N.availableLanguages();
          sel.innerHTML = '';
          for (const it of list){
            const opt = document.createElement('option');
            opt.value = (it && it.code) ? String(it.code) : '';
            opt.textContent = (it && it.label) ? String(it.label) : opt.value;
            sel.appendChild(opt);
          }
          const cur = I18N.getLang();
          if (list.some(it => (it && it.code) === cur)) sel.value = cur;
          else sel.value = (list[0] && list[0].code) || 'en';
        };

        const onLangChange = async () => {
          const lang = sel.value;
          if (!lang) return;
          try{
            await I18N.load(lang);
            I18N.setLang(lang);
            this._updateI18nLabels();
            this.render();
          }catch(e){ console.warn('[i18n] load locale failed', e); }
        };

        sel.addEventListener('change', onLangChange);

        Promise.all([
          I18N.loadManifest ? I18N.loadManifest().catch(() => {}) : Promise.resolve(),
          I18N.load(I18N.getLang()).catch(() => {})
        ]).then(() => { populate(); this._updateI18nLabels(); this.render(); }).catch(() => { populate(); this._updateI18nLabels(); this.render(); });
      }catch(e){ console.warn('[i18n] _initLangDropdown failed', e); }
    },

    _initBeginnerHintBar(){
      try{
        if (this._beginnerHintBarWired) return;
        this._beginnerHintBarWired = true;

        const KEY = 'h2s_beginner_hint_dismissed';
        const panel = document.getElementById('beginnerHintHelpPanel');
        const backdrop = document.getElementById('beginnerHintHelpBackdrop');
        const btnMore = document.getElementById('btnBeginnerHintMoreHelp');
        const btnClose = document.getElementById('btnBeginnerHintHelpClose');
        const btnEntry = document.getElementById('btnBeginnerHelpEntry');
        const bar = document.getElementById('beginnerHintBar');

        const openHelp = () => {
          if (!panel) return;
          panel.classList.remove('hidden');
          panel.setAttribute('aria-hidden', 'false');
        };
        const closeHelp = () => {
          if (!panel) return;
          panel.classList.add('hidden');
          panel.setAttribute('aria-hidden', 'true');
        };

        const btnRestore = document.getElementById('btnBeginnerHintRestore');
        if (btnRestore && bar){
          btnRestore.addEventListener('click', (e) => {
            e.stopPropagation();
            try{ if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY); }catch(err){}
            bar.classList.remove('hidden');
            closeHelp();
          });
        }

        if (btnEntry) btnEntry.addEventListener('click', (e) => { e.stopPropagation(); openHelp(); });
        if (btnMore) btnMore.addEventListener('click', (e) => { e.stopPropagation(); openHelp(); });
        if (btnClose) btnClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); });
        if (backdrop) backdrop.addEventListener('click', closeHelp);
        document.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Escape') return;
          if (!panel || panel.classList.contains('hidden')) return;
          closeHelp();
        });

        const btnDismiss = document.getElementById('btnBeginnerHintDismiss');
        if (!bar || !btnDismiss) return;

        const applyDismissed = () => {
          try{ if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1') bar.classList.add('hidden'); }catch(e){}
        };
        applyDismissed();

        const copyFallback = (text) => {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          try{ document.execCommand('copy'); }catch(err){}
          document.body.removeChild(ta);
        };

        const copyToClipboard = (text, el) => {
          const I18N = window.I18N;
          const i18nKey = el.getAttribute('data-i18n');
          const copiedLabel = (I18N && I18N.t) ? I18N.t('beginnerHint.copied') : 'Copied';
          const orig = el.textContent;
          const restore = () => {
            if (I18N && I18N.t && i18nKey) el.textContent = I18N.t(i18nKey);
            else el.textContent = orig;
          };
          const flash = () => {
            el.textContent = copiedLabel;
            setTimeout(restore, 1400);
          };
          if (navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(text).then(flash).catch(() => { copyFallback(text); flash(); });
          } else {
            copyFallback(text);
            flash();
          }
        };

        bar.addEventListener('click', (ev) => {
          const raw = ev.target;
          const node = (raw && raw.nodeType === 1) ? raw : (raw && raw.parentElement);
          if (!node || typeof node.closest !== 'function') return;
          const t = node.closest('[data-copy-cmd]');
          if (!t || !bar.contains(t)) return;
          const cmd = t.getAttribute('data-copy-cmd');
          if (!cmd) return;
          ev.preventDefault();
          copyToClipboard(cmd, t);
        });

        btnDismiss.addEventListener('click', () => {
          bar.classList.add('hidden');
          try{ if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, '1'); }catch(e){}
        });
      }catch(e){ console.warn('[beginnerHint] _initBeginnerHintBar failed', e); }
    },

    _updateI18nLabels(){
      try{
        if (typeof document === 'undefined' || !window.I18N || typeof window.I18N.t !== 'function') return;
        const I18N = window.I18N;
        document.querySelectorAll('[data-i18n]').forEach(function(el){
          const k = el.getAttribute('data-i18n');
          if (k) el.textContent = I18N.t(k);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){
          const k = el.getAttribute('data-i18n-placeholder');
          if (k && el.placeholder !== undefined) el.placeholder = I18N.t(k);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(function(el){
          const k = el.getAttribute('data-i18n-title');
          if (k) el.title = I18N.t(k);
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach(function(el){
          const k = el.getAttribute('data-i18n-aria-label');
          if (k) el.setAttribute('aria-label', I18N.t(k));
        });
        if (typeof this._applyLastOptimizeSummaryI18n === 'function') this._applyLastOptimizeSummaryI18n();
        if (typeof this._renderLastOptimizeDetailsBodyIfOpen === 'function') this._renderLastOptimizeDetailsBodyIfOpen();
      }catch(e){}
    },
    _initMasterVolumeUI(){
      // Browser-only, safe if called multiple times.
      try{
        if (typeof document === 'undefined') return;
        if (document.getElementById('h2sMasterVol')) return;

        const row = document.querySelector('.topbar .row');
        if (!row) return;

        this._masterGainDb = this._getMasterGainDb();

        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';
        wrap.style.marginLeft = '10px';

        const lab = document.createElement('span');
        lab.setAttribute('data-i18n', 'top.vol');
        lab.textContent = (window.I18N && window.I18N.t) ? window.I18N.t('top.vol') : 'Vol';
        lab.style.fontSize = '12px';
        lab.style.opacity = '0.85';

        const input = document.createElement('input');
        input.id = 'h2sMasterVol';
        input.type = 'range';
        input.min = '-40';
        input.max = '0';
        input.step = '1';
        input.value = String(this._masterGainDb);
        input.title = 'Master volume (dB)';
        input.style.width = '120px';
        const val = document.createElement('span');
        val.id = 'h2sMasterVolVal';
        val.style.fontSize = '12px';
        val.style.opacity = '0.85';
        val.style.minWidth = '28px';
        val.style.textAlign = 'right';

        const dbToPct = (db) => {
          const x = Math.max(-40, Math.min(0, Number(db)));
          return Math.round(((x + 40) / 40) * 100);
        };
        const updateVal = () => { val.textContent = String(dbToPct(input.value)); };
        updateVal();

        const stop = (e)=>e.stopPropagation();
        input.addEventListener('pointerdown', stop);
        input.addEventListener('mousedown', stop);
        input.addEventListener('click', stop);

        input.addEventListener('input', () => {
          this._setMasterGainDb(Number(input.value));
          updateVal();
        });

        wrap.appendChild(lab);
        wrap.appendChild(input);
        wrap.appendChild(val);
        row.appendChild(wrap);
      }catch(e){}
    },
    _initInstrumentLibraryUI(){
      try{
        if (typeof document === 'undefined' || !window.H2SProject) return;
        const inp = document.getElementById('inpSamplerBaseUrl');
        const btnSave = document.getElementById('btnSaveSamplerBaseUrl');
        const btnTest = document.getElementById('btnTestSampler');
        const status = document.getElementById('samplerBaseUrlStatus');
        const selPack = document.getElementById('selSamplerPack');
        const inpUpload = document.getElementById('inpSamplerUpload');
        const btnUpload = document.getElementById('btnSamplerUpload');
        const btnClear = document.getElementById('btnClearSamplerPack');
        const uploadStatus = document.getElementById('samplerUploadStatus');
        if (!inp || !btnSave) return;

        const setStatus = (msg) => { if (status) status.textContent = msg || ''; };
        const setUploadStatus = (msg) => { if (uploadStatus) uploadStatus.textContent = msg || ''; };
        const renderInput = () => {
          const v = (window.H2SProject.getSamplerBaseUrl && window.H2SProject.getSamplerBaseUrl()) || '';
          inp.value = v;
        };
        renderInput();

        if (btnSave.__h2sInstrumentLibBound) return;
        btnSave.__h2sInstrumentLibBound = true;

        btnSave.addEventListener('click', () => {
          const v = inp.value.trim();
          if (window.H2SProject.setSamplerBaseUrl) window.H2SProject.setSamplerBaseUrl(v);
          setStatus(v ? 'Saved. Base URL: ' + v : 'Cleared. Using default path.');
        });
        if (btnTest){
          btnTest.addEventListener('click', () => {
            setStatus('Testing...');
            const P = window.H2SProject;
            const packId = selPack && selPack.value;
            const pack = (packId && P && P.SAMPLER_PACKS && P.SAMPLER_PACKS[packId]) || (P && P.SAMPLER_PACKS && P.SAMPLER_PACKS['tonejs:piano']) || null;
            const baseUrl = (P && P.getResolvedSamplerBaseUrl && pack) ? P.getResolvedSamplerBaseUrl(pack) : null;
            const firstKey = (pack && pack.requiredKeys && pack.requiredKeys[0]) || (pack && pack.urls && Object.keys(pack.urls)[0]) || 'A1';
            const filename = (pack && pack.urls && pack.urls[firstKey]) || (firstKey + '.mp3');
            const testUrl = baseUrl ? (baseUrl.replace(/\/+$/, '') + '/' + filename) : null;
            if (!testUrl){
              setStatus('No base URL configured.');
              return;
            }
            fetch(testUrl, { method: 'HEAD' })
              .then(r => { setStatus(r.ok ? 'Test OK: samples reachable.' : 'Test failed: ' + r.status); })
              .catch(() => { setStatus('Test failed: network error.'); });
          });
        }

        function refreshPackDropdown(){
          if (!selPack || !window.H2SProject || !window.H2SProject.SAMPLER_PACKS) return;
          const packs = window.H2SProject.SAMPLER_PACKS;
          let html = Object.keys(packs).map(k => `<option value="${k}">${(packs[k].label || k).replace(/</g,'&lt;')}</option>`).join('');
          const custom = window.__h2s_custom_instruments || [];
          if (custom.length){
            html += '<optgroup label="' + escapeHtml((window.I18N && window.I18N.t) ? window.I18N.t('inst.myInstruments') : 'My Instruments') + '">';
            custom.forEach(c => { html += '<option value="' + (c.packId || '').replace(/"/g,'&quot;') + '">' + (c.displayName || c.packId || '').replace(/</g,'&lt;') + '</option>'; });
            html += '</optgroup>';
          }
          selPack.innerHTML = html;
        }
        if (selPack && window.H2SProject && window.H2SProject.SAMPLER_PACKS) refreshPackDropdown();

        function updateUploadButtonLabel(){
          if (!btnUpload) return;
          btnUpload.textContent = 'Upload samples (creates new instrument)';
        }

        function refreshUploadStatus(){
          if (!uploadStatus || !selPack) return;
          const packId = selPack.value;
          if (!packId){
            refreshAllPacksStatus();
            return;
          }
          const isCustom = packId.indexOf('user:') === 0;
          if (isCustom && window.H2SInstrumentLibraryStore){
            window.H2SInstrumentLibraryStore.listSamples(packId).then(keys => {
              const have = keys || [];
              if (have.length === 0) setUploadStatus('No samples in this custom instrument.');
              else if (have.length === 1) setUploadStatus('Available (local): ' + have[0] + ' (oneshot).');
              else setUploadStatus('Available (local): ' + have.sort().join(', ') + ' (sampler).');
            });
            return;
          }
          const probe = (window.H2SProject && window.H2SProject.probeSamplerAvailability) ? window.H2SProject.probeSamplerAvailability : null;
          if (!probe){
            if (window.H2SInstrumentLibraryStore){
              const packs = (window.H2SProject && window.H2SProject.SAMPLER_PACKS) || {};
              const pack = packs[packId];
              const required = (pack && pack.requiredKeys) ? pack.requiredKeys : (window.H2SInstrumentLibraryStore.VALID_NOTE_KEYS || ['A1','A2','A3','A4','A5','A6']).slice();
              window.H2SInstrumentLibraryStore.listSamples(packId).then(keys => {
                const have = keys || [];
                const missing = required.filter(k => have.indexOf(k) < 0);
                if (have.length === 0) setUploadStatus('No local samples.');
                else if (have.length === 1) setUploadStatus('Available (local): ' + have[0] + ' (needs >=2 to enable sampler).');
                else setUploadStatus('Local: ' + have.sort().join(', ') + (missing.length ? ' | Missing: ' + missing.join(', ') : ' (complete)'));
              });
            } else setUploadStatus('');
            return;
          }
          probe(packId).then(info => {
            const av = info.availableKeys || [];
            const miss = info.missingKeys || [];
            const src = info.source || '';
            if (av.length === 0) setUploadStatus('No samples. Use baseUrl or upload (e.g. A4.mp3 or C4.wav).');
            else if (av.length === 1) setUploadStatus('Available (' + (src === 'local' ? 'local' : 'remote') + '): ' + av[0] + ' (needs >=2 to enable sampler).');
            else setUploadStatus('Available (' + (src === 'local' ? 'local' : 'remote') + '): ' + av.sort().join(', ') + (miss.length ? ' | Missing: ' + miss.join(', ') : ' (complete)'));
          }).catch(() => setUploadStatus(''));
        }

        function refreshAllPacksStatus(){
          if (!uploadStatus || !window.H2SInstrumentLibraryStore || !window.H2SProject || !window.H2SProject.SAMPLER_PACKS) return;
          const packs = window.H2SProject.SAMPLER_PACKS;
          Promise.all(Object.keys(packs).map(packId => window.H2SInstrumentLibraryStore.listSamples(packId))).then(results => {
            const parts = [];
            Object.keys(packs).forEach((packId, i) => {
              const keys = results[i] || [];
              const pack = packs[packId];
              const required = (pack && pack.requiredKeys) ? pack.requiredKeys.length : 6;
              const label = (pack && pack.label || packId).split(' ')[0];
              parts.push(label + ': ' + keys.length + '/' + required);
            });
            setUploadStatus(parts.length ? parts.join(' | ') : 'No packs.');
          });
        }

        if (selPack){
          selPack.addEventListener('change', refreshUploadStatus);
          updateUploadButtonLabel();
        }

        if (btnUpload && inpUpload){
          btnUpload.addEventListener('click', () => { inpUpload.click(); });
          inpUpload.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (!files.length || !window.H2SInstrumentLibraryStore) return;
            const store = window.H2SInstrumentLibraryStore;
            const toUpload = [];
            let skipped = 0;
            for (let i = 0; i < files.length; i++){
              const key = store.parseNoteKeyFromFilename(files[i].name);
              if (key) toUpload.push({ file: files[i], key });
              else skipped++;
            }
            if (!toUpload.length){ setUploadStatus(skipped ? skipped + ' file(s) skipped. Tips: use names like A4.mp3 or C4.wav.' : 'No recognizable samples. Tips: A1..A6 or C3/Ds4/F#2/Bb3.'); return; }
            const uniqueKeys = [...new Set(toUpload.map(x => x.key))];
            const baseName = (files[0] && files[0].name) ? files[0].name.replace(/\.[^/.]+$/, '').trim().slice(0, 32) || 'Uploaded' : 'Uploaded';
            const kind = uniqueKeys.length >= 2 ? 'sampler' : 'oneshot';
            setUploadStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.creating') : 'Creating custom instrument...');
            store.createCustomInstrument(baseName, kind).then(({ packId, displayName }) => {
              setUploadStatus('Uploading ' + toUpload.length + ' sample(s)...');
              return Promise.all(toUpload.map(x => store.putSample(packId, x.key, x.file, x.file.name))).then(() => {
                let msg = 'Created ' + displayName + ' and uploaded ' + toUpload.length + '.';
                if (skipped) msg += ' Skipped: ' + skipped + '.';
                msg += ' To use: select it in the track instrument dropdown.';
                setUploadStatus(msg);
                return store.listCustomInstruments().then(list => {
                  window.__h2s_custom_instruments = list;
                  if (window.H2SApp && typeof window.H2SApp.renderTimeline === 'function') window.H2SApp.renderTimeline();
                });
              });
            }).then(() => refreshUploadStatus()).catch(() => { setUploadStatus('Upload failed.'); });
          });
        }

        if (btnClear && selPack){
          btnClear.addEventListener('click', () => {
            const packId = selPack.value;
            if (!packId){ setUploadStatus('Select a pack first.'); return; }
            const store = window.H2SInstrumentLibraryStore;
            if (!store) return;
            const isCustom = packId.indexOf('user:') === 0;
            setUploadStatus(isCustom ? 'Deleting instrument...' : 'Clearing...');
            (isCustom ? store.deleteCustomInstrument(packId) : store.clearPack(packId)).then(() => {
              setUploadStatus(isCustom ? 'Deleted.' : 'Cleared.');
              if (isCustom && store.listCustomInstruments){
                return store.listCustomInstruments().then(list => {
                  window.__h2s_custom_instruments = list;
                  refreshPackDropdown();
                  if (window.H2SApp && typeof window.H2SApp.renderTimeline === 'function') window.H2SApp.renderTimeline();
                });
              }
            }).then(() => refreshUploadStatus()).catch(() => setUploadStatus('Failed.'));
          });
        }

        const inpFolder = document.getElementById('inpSamplerFolder');
        const btnFolder = document.getElementById('btnSamplerFolder');
        if (inpFolder && btnFolder && window.H2SInstrumentLibraryStore){
          btnFolder.addEventListener('click', () => inpFolder.click());
          inpFolder.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (!files.length){ refreshUploadStatus(); return; }
            const store = window.H2SInstrumentLibraryStore;
            const toImport = [];
            let skipped = 0;
            for (let i = 0; i < files.length; i++){
              const noteKey = store.parseNoteKeyFromFilename(files[i].name);
              if (noteKey) toImport.push({ file: files[i], noteKey });
              else skipped++;
            }
            const uniqueKeys = [...new Set(toImport.map(x => x.noteKey))];
            if (uniqueKeys.length === 0){
              setUploadStatus('No recognizable samples found. Tips: sample files must be named like A4.mp3 or C4.wav.');
              return;
            }
            const baseName = (files[0] && files[0].webkitRelativePath) ? files[0].webkitRelativePath.split(/[/\\]/)[0] || 'Imported' : 'Imported';
            const kind = uniqueKeys.length >= 2 ? 'sampler' : 'oneshot';
            setUploadStatus((window.I18N && window.I18N.t) ? window.I18N.t('io.creating') : 'Creating custom instrument...');
            store.createCustomInstrument(baseName, kind).then(({ packId, displayName }) => {
              setUploadStatus('Importing ' + toImport.length + ' sample(s)...');
              return Promise.all(toImport.map(x => store.putSample(packId, x.noteKey, x.file, x.file.name))).then(() => {
                const recognized = [...new Set(toImport.map(x => x.noteKey))].sort();
                let msg = 'Created ' + displayName + ' and imported ' + toImport.length + ' sample(s). Recognized: ' + recognized.join(', ');
                if (skipped) msg += '. Skipped: ' + skipped + ' (unknown names).';
                msg += ' To use: select it in the track instrument dropdown.';
                setUploadStatus(msg);
                return store.listCustomInstruments().then(list => {
                  window.__h2s_custom_instruments = list;
                  if (window.H2SApp && typeof window.H2SApp.renderTimeline === 'function') window.H2SApp.renderTimeline();
                });
              });
            }).then(() => refreshUploadStatus()).catch(() => setUploadStatus('Import failed.'));
          });
        }

        refreshUploadStatus();
        if (window.H2SInstrumentLibraryStore && window.H2SInstrumentLibraryStore.listCustomInstruments){
          window.H2SInstrumentLibraryStore.listCustomInstruments().then(list => {
            window.__h2s_custom_instruments = list;
            refreshPackDropdown();
            if (typeof this.renderTimeline === 'function') this.renderTimeline();
          });
        }
      }catch(e){}
    },
	async playProject(){
      // Single source of truth: AudioController schedules project playback (v2 flatten).
      // app.js must NOT maintain a parallel legacy scheduling path, to avoid "wrong entry" regressions.
      this._applyMasterGain();
      if (!(this.audioCtrl && typeof this.audioCtrl.playProject === 'function')){
        console.error('[App] playProject: AudioController not available (refusing legacy path).');
        alert('Audio engine not ready (AudioController missing).');
        return false;
      }
      const result = await this.audioCtrl.playProject();
      this.updateRecordButtonStates();
      return result;
    },

    stopProject(){
      if (this.audioCtrl && this.audioCtrl.stop){
        // Delegate to AudioController
        this.audioCtrl.stop();
        this.updateRecordButtonStates();
        return;
      }
      if (window.Tone){
        try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){}
      }
      this.state.transportPlaying = false;
      log('Project stop.');
      persist();
      this.render();
    },

    /** PR-C5.3: Stop playback and reset playhead to start. S key / S button. */
    stopProjectReset(){
      if (this.audioCtrl && this.audioCtrl.stop){
        this.audioCtrl.stop(true);
        this.updateRecordButtonStates();
        return;
      }
      if (window.Tone){
        try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){}
      }
      this.state.transportPlaying = false;
      if (this.project && this.project.ui) this.project.ui.playheadSec = 0;
      log('Project stop (reset).');
      persist();
      this.render();
    },

    async playClip(clipId){
      if (this.audioCtrl && this.audioCtrl.playClip){
        // Delegate to AudioController
        return await this.audioCtrl.playClip(clipId);
      }
      const clip = this.project.clips.find(c => c.id === clipId);
      if (!clip) return;
      const ok = await this.ensureTone();
      if (!ok){ alert('Tone.js not available.'); return; }
      Tone.start(); // no await (keep user-gesture)
      const synth = new Tone.PolySynth(Tone.Synth).toDestination();

      Tone.Transport.stop();
      Tone.Transport.cancel();
      Tone.Transport.seconds = 0;
      Tone.Transport.bpm.value = this.project.bpm || 120;

      const score = H2SProject.ensureScoreIds(H2SProject.deepClone(clip.score));
      let maxT = 0;
      for (const tr of score.tracks || []){
        for (const n of tr.notes || []){
          maxT = Math.max(maxT, n.start + n.duration);
          Tone.Transport.schedule((time) => {
            const pitch = H2SProject.clamp(Math.round(n.pitch || 60), 0, 127);
            const vel = H2SProject.clamp(Math.round(n.velocity || 100), 1, 127)/127;
            synth.triggerAttackRelease(Tone.Frequency(pitch, "midi"), n.duration, time, vel);
          }, n.start);
        }
      }
      Tone.Transport.start("+0.05");
      log(`Clip play: ${clip.name}`);
      setTimeout(()=>{ try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(e){} }, Math.ceil((maxT + 0.2) * 1000));
    },

        /* ---------------- Modal editor (delegated to EditorRuntime) ---------------- */
    openClipEditor(clipId){ return this.editorRt && this.editorRt.openClipEditor ? this.editorRt.openClipEditor(clipId) : undefined; },
    closeModal(save){ return this.editorRt && this.editorRt.closeModal ? this.editorRt.closeModal(save) : undefined; },
    modalAdjustSnap(...args){ return this.editorRt && this.editorRt.modalAdjustSnap ? this.editorRt.modalAdjustSnap(...args) : undefined; },
    modalAllNotes(...args){ return this.editorRt && this.editorRt.modalAllNotes ? this.editorRt.modalAllNotes(...args) : undefined; },
    modalDeleteSelectedNote(...args){ return this.editorRt && this.editorRt.modalDeleteSelectedNote ? this.editorRt.modalDeleteSelectedNote(...args) : undefined; },
    modalDraw(...args){ return this.editorRt && this.editorRt.modalDraw ? this.editorRt.modalDraw(...args) : undefined; },
    modalFindNoteById(...args){ return this.editorRt && this.editorRt.modalFindNoteById ? this.editorRt.modalFindNoteById(...args) : undefined; },
    modalGetSnapValue(...args){ return this.editorRt && this.editorRt.modalGetSnapValue ? this.editorRt.modalGetSnapValue(...args) : undefined; },
    modalHitTest(...args){ return this.editorRt && this.editorRt.modalHitTest ? this.editorRt.modalHitTest(...args) : undefined; },
    modalInsertNote(...args){ return this.editorRt && this.editorRt.modalInsertNote ? this.editorRt.modalInsertNote(...args) : undefined; },
    modalPlay(...args){ return this.editorRt && this.editorRt.modalPlay ? this.editorRt.modalPlay(...args) : undefined; },
    modalPointerDown(...args){ return this.editorRt && this.editorRt.modalPointerDown ? this.editorRt.modalPointerDown(...args) : undefined; },
    modalPointerMove(...args){ return this.editorRt && this.editorRt.modalPointerMove ? this.editorRt.modalPointerMove(...args) : undefined; },
    modalPointerUp(...args){ return this.editorRt && this.editorRt.modalPointerUp ? this.editorRt.modalPointerUp(...args) : undefined; },
    modalQuantize(...args){ return this.editorRt && this.editorRt.modalQuantize ? this.editorRt.modalQuantize(...args) : undefined; },
    modalRequestDraw(...args){ return this.editorRt && this.editorRt.modalRequestDraw ? this.editorRt.modalRequestDraw(...args) : undefined; },
    modalResizeCanvasToContent(...args){ return this.editorRt && this.editorRt.modalResizeCanvasToContent ? this.editorRt.modalResizeCanvasToContent(...args) : undefined; },
    modalSetSnapValue(...args){ return this.editorRt && this.editorRt.modalSetSnapValue ? this.editorRt.modalSetSnapValue(...args) : undefined; },
    modalSnapSec(...args){ return this.editorRt && this.editorRt.modalSnapSec ? this.editorRt.modalSnapSec(...args) : undefined; },
    modalStop(...args){ return this.editorRt && this.editorRt.modalStop ? this.editorRt.modalStop(...args) : undefined; },
    modalTogglePlay(...args){ return this.editorRt && this.editorRt.modalTogglePlay ? this.editorRt.modalTogglePlay(...args) : undefined; },
    modalToggleSnap(...args){ return this.editorRt && this.editorRt.modalToggleSnap ? this.editorRt.modalToggleSnap(...args) : undefined; },
    modalUpdateRightPanel(...args){ return this.editorRt && this.editorRt.modalUpdateRightPanel ? this.editorRt.modalUpdateRightPanel(...args) : undefined; },
  };

  // Global pointer handlers (timeline drag)
  window.addEventListener('pointermove', (ev) => {
    if (!app.state.draggingInstance) return;
    // update instance start live for smoother UX
    const inst = app.project.instances.find(x => x.id === app.state.draggingInstance);
    if (!inst) return;
    const tracksEl = $('#tracks');
    const rect = tracksEl.getBoundingClientRect();
    const pxPerSec = app.project.ui.pxPerSec || 160;
    const x = ev.clientX - rect.left - 120 - app.state.dragOffsetX;
    inst.startSec = Math.max(0, x / pxPerSec);
    app.renderTimeline();
    persist();
  });

  window.addEventListener('pointerup', (ev) => {
    // modal pointer up already attached
    // finalize timeline drag
    if (app.state.draggingInstance){
      app.state.draggingInstance = null;
      persist();
      app.render();
    }
  });

  // Helpers
  function escapeHtml(s){
    return String(s || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function roundRect(ctx, x, y, w, h, r){
    r = Math.max(0, Math.min(r, Math.min(w,h)/2));
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  // Expose for debug
  window.H2SApp = app;

  
  // One-time unlock on first user gesture anywhere.
  try{
    if (typeof document !== 'undefined'){
      document.addEventListener('pointerdown', () => { _unlockAudioFromGesture(); }, { once:true, capture:true });
      document.addEventListener('keydown', () => { _unlockAudioFromGesture(); }, { once:true, capture:true });
    }
  }catch(e){}
// Boot
  window.addEventListener('load', () => app.init());
})();
