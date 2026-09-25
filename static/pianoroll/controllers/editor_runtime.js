(function(global){
  'use strict';
  // UMD-ish: attach to window.H2SEditorRuntime for browser; module.exports for Node.
  function factory(){
    function create(opts){
      opts = opts || {};
      const root = (typeof window !== 'undefined') ? window : global;
      const _t = (root && root.I18N && typeof root.I18N.t === 'function') ? root.I18N.t.bind(root.I18N) : function(k){ return k; };
      const H2SProject = opts.H2SProject || (root && root.H2SProject) || null;
      const H2SApp = opts.H2SApp || (root && root.H2SApp) || (root && root.window && root.window.H2SApp) || null;
      const H2SEditorCoords = opts.H2SEditorCoords || (root && root.H2SEditorCoords) || null;
      const H2SEditorSelection = opts.H2SEditorSelection || (root && root.H2SEditorSelection) || null;
      const H2SEditorModalResize = opts.H2SEditorModalResize || (root && root.H2SEditorModalResize) || null;
      const H2SClipAutoSplit = opts.H2SClipAutoSplit || (root && root.H2SClipAutoSplit) || null;

      // Optional app-glue helpers (prefer injection; fall back to global H2SApp methods when present).
      const getProjectV2 = (typeof opts.getProjectV2 === 'function') ? opts.getProjectV2 :
        (H2SApp && typeof H2SApp.getProjectV2 === 'function') ? (()=>H2SApp.getProjectV2()) :
        (root && typeof root.getProjectV2 === 'function') ? root.getProjectV2 :
        function(){ return null; };

      const commitV2 = (typeof opts.commitV2 === 'function') ? opts.commitV2 :
        (H2SApp && typeof H2SApp.commitV2 === 'function') ? ((p, reason)=>H2SApp.commitV2(p, reason)) :
        (root && typeof root.commitV2 === 'function') ? root.commitV2 :
        null;

      /** Dev-only: same key as app.js — localStorage 'hum2song_studio_dev_perf_timing' === '1' */
      function _h2sDevPerfTimingEnabled(){
        try{
          return typeof localStorage !== 'undefined' && String(localStorage.getItem('hum2song_studio_dev_perf_timing') || '') === '1';
        }catch(e){ return false; }
      }

      /** Dev-only clip playback timing: prefer performance.now, else Date.now (never gate logging on performance API). */
      function _perfClipNow(){
        try{
          if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
        }catch(e){}
        return Date.now();
      }

      function _h2sDragPerfSessionBegin(inst, mode){
        if (!_h2sDevPerfTimingEnabled()) return;
        inst._h2sDragPerf = {
          tDown: _perfClipNow(),
          mode: String(mode),
          moveCount: 0,
          moveTotalMs: 0,
          moveMaxMs: 0,
          modalDrawCount: 0,
        };
      }

      function _h2sDragPerfSessionEnd(inst){
        const s = inst._h2sDragPerf;
        if (!s) return;
        if (!_h2sDevPerfTimingEnabled()){
          inst._h2sDragPerf = null;
          return;
        }
        const tUp = _perfClipNow();
        const avg = s.moveCount ? (s.moveTotalMs / s.moveCount) : 0;
        try{
          console.log('[H2S perf] clipEditor drag session', {
            mode: s.mode,
            pointerMoves: s.moveCount,
            modalPointerMoveMs: {
              total: Number(s.moveTotalMs.toFixed(3)),
              avg: Number(avg.toFixed(3)),
              max: Number((s.moveCount ? s.moveMaxMs : 0).toFixed(3)),
            },
            modalDrawCalls: s.modalDrawCount,
            dragDurationMs: Number((tUp - s.tDown).toFixed(3)),
          });
        }catch(e){}
        inst._h2sDragPerf = null;
      }

      const persistFromV1 = (typeof opts.persistFromV1 === 'function') ? opts.persistFromV1 :
        (H2SApp && typeof H2SApp.persistFromV1 === 'function') ? ((reason)=>H2SApp.persistFromV1(reason)) :
        (root && typeof root.persistFromV1 === 'function') ? root.persistFromV1 :
        null;


      // Dependency injection (keeps this file testable in Node)
      const persist = typeof opts.persist === 'function' ? opts.persist : function(){};
      const log = typeof opts.log === 'function' ? opts.log : function(){};
      const render = typeof opts.render === 'function' ? opts.render : function(){};
      const getProject = typeof opts.getProject === 'function' ? opts.getProject : function(){ return null; };
      const getState = typeof opts.getState === 'function' ? opts.getState : function(){ return null; };

      const $ = opts.$ || (typeof document !== 'undefined' ? (sel)=>document.querySelector(sel) : null);
      const $$ = opts.$$ || (typeof document !== 'undefined' ? (sel)=>Array.from(document.querySelectorAll(sel)) : null);
      const fmtSec = opts.fmtSec || function(x){ return String(x); };
      const escapeHtml = opts.escapeHtml || function(s){ return String(s||''); };

      // PR-4: Build Optimize status line from clip.meta.agent.patchSummary (Node-safe, no DOM).
      function _editorOptStatusText(agent){
        if (!agent || typeof agent !== 'object') return '';
        const ps = agent.patchSummary;
        if (!ps || typeof ps !== 'object') return '';
        const execPreset = ps.executedPreset || ps.preset || '';
        const ops = Number(ps.ops);
        const reason = ps.reason;
        const parts = [];
        if (execPreset && execPreset !== 'pseudo_v0') parts.push('Preset: ' + String(execPreset));
        parts.push('ops: ' + (Number.isFinite(ops) ? ops : 0));
        if (reason && reason !== 'empty_ops' && reason !== 'ok') parts.push('reason: ' + String(reason));
        return parts.length ? parts.join(' | ') : '';
      }

      // PR-5: Short revision id for UI (Node-safe, no DOM).
      function _shortRev(rid){
        if (rid == null || rid === '') return '-';
        const s = String(rid);
        return s.length > 6 ? s.slice(-6) : s;
      }

      // PR-B3a: Format patch type summary for Quick Optimize display.
      // PR-E5b: Append templateId + promptVersion from promptMeta when present.
      function _formatPromptMetaSuffix(ps){
        if (!ps || !ps.promptMeta || typeof ps.promptMeta !== 'object') return '';
        const pm = ps.promptMeta;
        const id = (pm.templateId != null && String(pm.templateId).trim()) ? String(pm.templateId) : 'Custom';
        const ver = (pm.promptVersion != null && String(pm.promptVersion).trim()) ? String(pm.promptVersion) : 'manual_v0';
        return 'Template: ' + id + ' (' + ver + ')';
      }
      function _formatPatchTypeSummary(ps){
        if (!ps || typeof ps !== 'object') return '';
        const t = (typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
        let base = '';
        if ((ps.ops != null && ps.ops === 0) || ps.noChanges) base = '(no changes)';
        else if (ps.isVelocityOnly === true) base = 'Changed: ' + t('opt.velocityOnly');
        else {
          const parts = [];
          if (ps.hasPitchChange === true) parts.push(t('opt.pitch'));
          if (ps.hasTimingChange === true) parts.push(t('opt.timing'));
          if (ps.hasStructuralChange === true) parts.push(t('opt.structure'));
          base = parts.length === 0 ? 'Changed: ' + t('opt.velocityOnly') : 'Changed: ' + parts.join(' ');
        }
        const suffix = _formatPromptMetaSuffix(ps);
        return suffix ? base + ' | ' + suffix : base;
      }

      // PR-E2 / INFRA-1a: UI-side template map — derived from shared optimize_templates_v1.js
      const TEMPLATES_V1_UI = (root && root.H2S_OPTIMIZE_TEMPLATES_V1_MAP) ? root.H2S_OPTIMIZE_TEMPLATES_V1_MAP : {};
      function _syncQuickOptimizeTemplateButtons(selectedTemplateId){
        if (typeof document === 'undefined') return;
        const container = document.getElementById('editorQuickOptimizeTemplates');
        if (!container) return;
        const activeId = (selectedTemplateId != null && String(selectedTemplateId).trim()) ? String(selectedTemplateId).trim() : '';
        const buttons = container.querySelectorAll('[data-template-id]');
        for (const btn of buttons){
          const id = (btn && btn.getAttribute) ? String(btn.getAttribute('data-template-id') || '') : '';
          btn.classList.toggle('active', !!activeId && id === activeId);
        }
      }

      // NOTE: In the original monolithic app.js, roundRect() lived in the same closure.
      // After modularization (editor_runtime.js extracted into its own file), that helper
      // may be out of scope, causing a runtime ReferenceError and resulting in a blank
      // piano-roll (grid renders, but notes never render).
      // We define it here so editor drawing is self-contained.
      function roundRect(ctx, x, y, w, h, r){
        if (!ctx) return;
        const rr = Math.max(0, Math.min(Number(r) || 0, Math.min(w, h) / 2));
        if (typeof ctx.roundRect === 'function'){
          ctx.roundRect(x, y, w, h, rr);
          return;
        }
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
      }

      // ---- Pitch view sizing / scroll policy ----
      // Enable native vertical scrolling only when pitch range is large enough.
      // Keeps the default view big/readable for normal clips.
      const PITCH_ROWS_FULL = 128;
      const PITCH_PAD_T = 20;
      const PITCH_PAD_B = 10;
      const PITCH_ROW_H_BASE = 18; // bigger by default; zoom can adjust
      const PITCH_ZOOM_LEVELS = [1, 1.25, 1.5];

      // --- Beats v2 boundary helpers (storage beat, editor works in seconds) ---
      function _firstNote(score){
        try {
          const tr = score && score.tracks && score.tracks[0];
          const n = tr && tr.notes && tr.notes[0];
          return n || null;
        } catch(e){ return null; }
      }

      function _isBeatScore(score){
        if (!score) return false;
        if (score.timebase === 'beat') return true;
        if (Number(score.version) === 2) return true;
        const n = _firstNote(score);
        return !!(n && (Object.prototype.hasOwnProperty.call(n,'startBeat') || Object.prototype.hasOwnProperty.call(n,'durationBeat')));
      }

      function _findClip(project, clipId){
        if(!project || !clipId) return null;
        const clips = project.clips;
        if (Array.isArray(clips)){
          return clips.find(c => c && c.id === clipId) || null;
        }
        if (clips && typeof clips === 'object'){
          if (clips[clipId]) return clips[clipId];
          for (const k of Object.keys(clips)){
            const c = clips[k];
            if (c && c.id === clipId) return c;
          }
        }
        return null;
      }

      /** Timeline placement for extract/duplicate: align to source clip instance, not playhead. */
      function _resolveSourceClipPlacement(project, clipId, app){
        const cid = String(clipId || '');
        const bpm = (project && project.bpm) ? Number(project.bpm) : 120;
        let inst = null;

        const p2 = app && typeof app.getProjectV2 === 'function' ? app.getProjectV2() : null;
        if (p2 && Array.isArray(p2.instances) && Array.isArray(p2.tracks)){
          const trackIndexById = {};
          p2.tracks.forEach((t, i) => {
            const tid = t && (t.trackId || t.id) ? String(t.trackId || t.id) : '';
            if (tid) trackIndexById[tid] = i;
          });
          const selId = app && app.state && app.state.selectedInstanceId ? String(app.state.selectedInstanceId) : '';
          const v2Pick = (i) => {
            if (!i || String(i.clipId) !== cid) return null;
            const ti = (i.trackId && trackIndexById[i.trackId] != null) ? trackIndexById[i.trackId] : 0;
            const startBeat = Number(i.startBeat || 0);
            const startSec = (H2SProject && typeof H2SProject.beatToSec === 'function')
              ? H2SProject.beatToSec(startBeat, bpm)
              : (startBeat * 60 / bpm);
            return { startSec: Math.max(0, startSec), trackIndex: ti, instanceId: i.id };
          };
          if (selId){
            const sel = p2.instances.find((i) => i && String(i.id) === selId);
            inst = v2Pick(sel);
          }
          if (!inst){
            const matches = p2.instances.filter((i) => i && String(i.clipId) === cid);
            if (matches.length === 1) inst = v2Pick(matches[0]);
            else if (matches.length > 1){
              const activeTi = app && app.state && Number.isFinite(Number(app.state.activeTrackIndex))
                ? Number(app.state.activeTrackIndex) : 0;
              const pick = matches.find((i) => v2Pick(i) && v2Pick(i).trackIndex === activeTi) || matches[0];
              inst = v2Pick(pick);
            }
          }
        }

        if (!inst){
          const instances = (project && Array.isArray(project.instances)) ? project.instances : [];
          const selId = app && app.state && app.state.selectedInstanceId ? String(app.state.selectedInstanceId) : '';
          if (selId){
            const sel = instances.find((i) => i && String(i.id) === selId);
            if (sel && String(sel.clipId) === cid){
              inst = {
                startSec: Number.isFinite(Number(sel.startSec)) ? Number(sel.startSec) : 0,
                trackIndex: Number.isFinite(Number(sel.trackIndex)) ? Math.max(0, Math.floor(Number(sel.trackIndex))) : 0,
                instanceId: sel.id,
              };
            }
          }
          if (!inst){
            const matches = instances.filter((i) => i && String(i.clipId) === cid);
            if (matches.length === 1){
              inst = {
                startSec: Number.isFinite(Number(matches[0].startSec)) ? Number(matches[0].startSec) : 0,
                trackIndex: Number.isFinite(Number(matches[0].trackIndex)) ? Math.max(0, Math.floor(Number(matches[0].trackIndex))) : 0,
                instanceId: matches[0].id,
              };
            } else if (matches.length > 1){
              const activeTi = app && app.state && Number.isFinite(Number(app.state.activeTrackIndex))
                ? Number(app.state.activeTrackIndex) : 0;
              const pick = matches.find((i) => Number(i.trackIndex) === activeTi) || matches[0];
              inst = {
                startSec: Number.isFinite(Number(pick.startSec)) ? Number(pick.startSec) : 0,
                trackIndex: Number.isFinite(Number(pick.trackIndex)) ? Math.max(0, Math.floor(Number(pick.trackIndex))) : 0,
                instanceId: pick.id,
              };
            }
          }
        }

        if (inst) return inst;
        return { startSec: 0, trackIndex: 0, instanceId: null };
      }

      function _ensureTimelineTrackIndex(app, trackIndex){
        if (!app || typeof app.addTrack !== 'function') return;
        const need = Math.max(1, Math.floor(Number(trackIndex) || 0) + 1);
        while ((app.project && app.project.tracks ? app.project.tracks.length : 0) < need){
          app.addTrack();
        }
      }

      // PR-8C/8H: LLM debug helpers (must be in create() scope so modalBindControls handlers can access them)
      function computeLlmDebugSummary(debug){
        if (!debug || typeof debug !== 'object') return '';
        const attempts = (debug.attemptCount != null) ? Number(debug.attemptCount) : 1;
        const reason = (debug.reason != null && typeof debug.reason === 'string') ? debug.reason : 'unknown';
        let modeLabel = '';
        if (typeof debug.safeModeResolved === 'boolean'){
          modeLabel = debug.safeModeResolved ? ' [Safe mode]' : ' [Full mode]';
        } else {
          try{
            const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG && typeof globalThis.H2S_LLM_CONFIG.loadLlmConfig === 'function') ? globalThis.H2S_LLM_CONFIG : null;
            if (api){
              const cfg = api.loadLlmConfig();
              modeLabel = (cfg && cfg.velocityOnly === false) ? ' [Full mode]' : ' [Safe mode]';
            }
          }catch(_){}
        }
        const extractedStr = (debug.extractedJson && typeof debug.extractedJson === 'string') ? debug.extractedJson : '';
        let opsTotal = 0;
        const opsByType = {};
        const noteIds = new Set();
        const fieldsTouched = new Set();
        let addedNoId = 0;
        let parsed = false;
        if (extractedStr){
          try{
            const patch = JSON.parse(extractedStr);
            const ops = (patch && Array.isArray(patch.ops)) ? patch.ops : [];
            opsTotal = ops.length;
            for (let i = 0; i < ops.length; i++){
              const op = ops[i];
              if (!op || typeof op !== 'object') continue;
              const opType = op.op;
              opsByType[opType] = (opsByType[opType] || 0) + 1;
              if (opType === 'setNote'){
                if (op.noteId) noteIds.add(String(op.noteId));
                if (op.velocity != null) fieldsTouched.add('velocity');
                if (op.pitch != null) fieldsTouched.add('pitch');
                if (op.startBeat != null || op.durationBeat != null) fieldsTouched.add('timing');
              } else if (opType === 'moveNote'){
                if (op.noteId) noteIds.add(String(op.noteId));
                fieldsTouched.add('timing');
              } else if (opType === 'deleteNote'){
                if (op.noteId) noteIds.add(String(op.noteId));
              } else if (opType === 'addNote'){
                if (op.note && op.note.id) noteIds.add(String(op.note.id));
                else addedNoId++;
                fieldsTouched.add('pitch');
                fieldsTouched.add('timing');
                fieldsTouched.add('velocity');
              }
            }
            parsed = true;
          }catch(_){}
        }
        const opsTypesStr = Object.keys(opsByType).length ? Object.keys(opsByType).map(function(k){ return k + '=' + opsByType[k]; }).join(', ') : (opsTotal > 0 ? '?' : '0');
        const changedNotesStr = parsed ? String(noteIds.size + addedNoId) : '(unknown)';
        const fieldsStr = parsed ? (fieldsTouched.size ? Array.from(fieldsTouched).sort().join(', ') : '-') : '?';
        const finishReason = (debug.finishReason != null && typeof debug.finishReason === 'string' && debug.finishReason) ? ' finishReason=' + debug.finishReason : '';
        const partialDiscarded = debug.partialJsonDiscarded === true ? ' partialJsonDiscarded=true' : '';
        const reqTok = debug.requestedMaxOutputTokens != null && isFinite(Number(debug.requestedMaxOutputTokens)) ? Math.floor(Number(debug.requestedMaxOutputTokens)) : null;
        const effTok = debug.effectiveMaxOutputTokens != null && isFinite(Number(debug.effectiveMaxOutputTokens)) ? Math.floor(Number(debug.effectiveMaxOutputTokens)) : null;
        const tokenLine = (reqTok != null || effTok != null) ? (' outputTokens=' + (reqTok != null ? String(reqTok) : '?') + '->' + (effTok != null ? String(effTok) : '?')) : '';
        const providerLine = debug.providerId ? (' provider=' + String(debug.providerId).slice(0, 48)) : '';
        const profileLine = debug.modelProfileId ? (' modelProfile=' + String(debug.modelProfileId).slice(0, 48)) : '';
        return 'attempts=' + attempts + ' reason=' + reason + finishReason + partialDiscarded + tokenLine + providerLine + profileLine + modeLabel + ' ops=' + opsTotal + ' (' + opsTypesStr + ') changedNotes=' + changedNotesStr + ' fieldsTouched=' + fieldsStr;
      }

      function loadLlmDebugUI(){
        if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;
        try{
          const raw = localStorage.getItem('hum2song_studio_llm_debug_last');
          if (!raw || raw === ''){
            const rawEl = document.getElementById('editorLlmDebugRaw');
            const extractedEl = document.getElementById('editorLlmDebugExtracted');
            const errorsEl = document.getElementById('editorLlmDebugErrors');
            if (rawEl) rawEl.value = '';
            if (extractedEl) extractedEl.value = '';
            if (errorsEl) errorsEl.value = '';
            return;
          }
          const debug = JSON.parse(raw);
          const rawEl = document.getElementById('editorLlmDebugRaw');
          const extractedEl = document.getElementById('editorLlmDebugExtracted');
          const errorsEl = document.getElementById('editorLlmDebugErrors');
          if (rawEl) rawEl.value = (debug.rawText && typeof debug.rawText === 'string') ? debug.rawText : '';
          if (extractedEl) extractedEl.value = (debug.extractedJson && typeof debug.extractedJson === 'string') ? debug.extractedJson : '';
          const summaryLine = computeLlmDebugSummary(debug);
          const errText = (debug.errors && Array.isArray(debug.errors)) ? debug.errors.join(', ') : '';
          const attemptText = (debug.attemptCount != null) ? 'Attempt: ' + String(debug.attemptCount) : '';
          const reasonText = (debug.reason && typeof debug.reason === 'string') ? 'Reason: ' + debug.reason : '';
          const parts = [attemptText, reasonText, errText].filter(function(s){ return s && s.trim() !== ''; });
          const detailLine = parts.join(' | ');
          if (errorsEl) errorsEl.value = summaryLine + (detailLine ? '\n' + detailLine : '');
        }catch(e){}
      }

      function saveLlmDebug(clipId, llmDebug){
        if (typeof localStorage === 'undefined' || !llmDebug || typeof llmDebug !== 'object') return;
        try{
          const rawText = (llmDebug.rawText && typeof llmDebug.rawText === 'string') ? llmDebug.rawText : '';
          const extractedJson = (llmDebug.extractedJson && typeof llmDebug.extractedJson === 'string') ? llmDebug.extractedJson : '';
          const errors = (llmDebug.errors && Array.isArray(llmDebug.errors)) ? llmDebug.errors : [];
          const previewHead = (llmDebug.rawModelOutputPreviewHead && typeof llmDebug.rawModelOutputPreviewHead === 'string') ? llmDebug.rawModelOutputPreviewHead : '';
          const previewTail = (llmDebug.rawModelOutputPreviewTail && typeof llmDebug.rawModelOutputPreviewTail === 'string') ? llmDebug.rawModelOutputPreviewTail : '';
          const previewLen = (llmDebug.rawModelOutputLength != null && isFinite(Number(llmDebug.rawModelOutputLength))) ? Number(llmDebug.rawModelOutputLength) : null;
          const debug = {
            ts: Date.now(),
            clipId: (clipId && typeof clipId === 'string') ? clipId : '',
            attemptCount: (llmDebug.attemptCount != null) ? Number(llmDebug.attemptCount) : 1,
            reason: (llmDebug.reason && typeof llmDebug.reason === 'string') ? llmDebug.reason : '',
            finishReason: (llmDebug.finishReason && typeof llmDebug.finishReason === 'string') ? llmDebug.finishReason : '',
            partialJsonDiscarded: llmDebug.partialJsonDiscarded === true,
            safeModeResolved: typeof llmDebug.safeModeResolved === 'boolean' ? llmDebug.safeModeResolved : undefined,
            requestedMaxOutputTokens: (llmDebug.requestedMaxOutputTokens != null && isFinite(Number(llmDebug.requestedMaxOutputTokens))) ? Math.floor(Number(llmDebug.requestedMaxOutputTokens)) : undefined,
            effectiveMaxOutputTokens: (llmDebug.effectiveMaxOutputTokens != null && isFinite(Number(llmDebug.effectiveMaxOutputTokens))) ? Math.floor(Number(llmDebug.effectiveMaxOutputTokens)) : undefined,
            providerMaxOutputTokens: (llmDebug.providerMaxOutputTokens != null && isFinite(Number(llmDebug.providerMaxOutputTokens))) ? Math.floor(Number(llmDebug.providerMaxOutputTokens)) : undefined,
            outputTokenLimitReason: (llmDebug.outputTokenLimitReason && typeof llmDebug.outputTokenLimitReason === 'string') ? llmDebug.outputTokenLimitReason.slice(0, 80) : '',
            providerId: (llmDebug.providerId && typeof llmDebug.providerId === 'string') ? llmDebug.providerId.slice(0, 80) : '',
            modelTier: (llmDebug.modelTier && typeof llmDebug.modelTier === 'string') ? llmDebug.modelTier.slice(0, 80) : '',
            modelProfileId: (llmDebug.modelProfileId && typeof llmDebug.modelProfileId === 'string') ? llmDebug.modelProfileId.slice(0, 80) : '',
            resolvedModelProfileId: (llmDebug.resolvedModelProfileId && typeof llmDebug.resolvedModelProfileId === 'string') ? llmDebug.resolvedModelProfileId.slice(0, 80) : '',
            rawModelOutputPreviewHead: previewHead.length > 5000 ? previewHead.slice(0, 5000) : previewHead,
            rawModelOutputPreviewTail: previewTail.length > 5000 ? previewTail.slice(previewTail.length - 5000) : previewTail,
            rawModelOutputLength: previewLen,
            rawText: rawText.length > 4000 ? rawText.slice(0, 4000) : rawText,
            extractedJson: extractedJson.length > 4000 ? extractedJson.slice(0, 4000) : extractedJson,
            errors: errors.slice(0, 20),
          };
          localStorage.setItem('hum2song_studio_llm_debug_last', JSON.stringify(debug));
          loadLlmDebugUI();
        }catch(e){}
      }

      function _beatToSec(beat, bpm){
        const b = Number(beat) || 0;
        const t = Number(bpm) || 120;
        if (H2SProject && typeof H2SProject.beatToSec === 'function') return H2SProject.beatToSec(b, t);
        return b * 60 / t;
      }

      function _secToBeat(sec, bpm){
        const s = Number(sec) || 0;
        const t = Number(bpm) || 120;
        if (H2SProject && typeof H2SProject.secToBeat === 'function') return H2SProject.secToBeat(s, t);
        return s * t / 60;
      }

      function _normalizeBeat(x){
        const v = Number(x);
        if (!isFinite(v)) return 0;
        if (H2SProject && typeof H2SProject.normalizeBeat === 'function') return H2SProject.normalizeBeat(v);
        // fallback: float round only (no grid snap)
        return Math.round(v * 1e6) / 1e6;
      }

      function _manualScoreBeatToSec(scoreBeat, bpm){
        const out = {
          version: 1,
          tempo_bpm: (scoreBeat && scoreBeat.tempo_bpm != null) ? scoreBeat.tempo_bpm : (Number(bpm) || 120),
          time_signature: (scoreBeat && scoreBeat.time_signature) ? scoreBeat.time_signature : '4/4',
          tracks: []
        };
        const tracks = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
        out.tracks = tracks.map(t => ({
          id: t.id,
          name: t.name,
          program: t.program,
          channel: t.channel,
          notes: (t.notes || []).map(n => ({
            id: n.id,
            pitch: n.pitch,
            velocity: n.velocity,
            start: _beatToSec(n.startBeat, bpm),
            duration: _beatToSec(n.durationBeat, bpm)
          }))
        }));
        return out;
      }

      function _manualScoreSecToBeat(scoreSec, bpm){
        const out = {
          version: 2,
          tempo_bpm: (scoreSec && scoreSec.tempo_bpm != null) ? scoreSec.tempo_bpm : null,
          time_signature: (scoreSec && scoreSec.time_signature) ? scoreSec.time_signature : null,
          tracks: []
        };
        const tracks = (scoreSec && Array.isArray(scoreSec.tracks)) ? scoreSec.tracks : [];
        out.tracks = tracks.map(t => ({
          id: t.id,
          name: t.name,
          program: t.program,
          channel: t.channel,
          notes: (t.notes || []).map(n => ({
            id: n.id,
            pitch: n.pitch,
            velocity: n.velocity,
            startBeat: _normalizeBeat(Math.max(0, _secToBeat(n.start, bpm))),
            durationBeat: _normalizeBeat(Math.max(0, _secToBeat(n.duration, bpm)))
          }))
        }));
        return out;
      }

      function _scoreBeatToSec(scoreBeat, bpm){
        if (H2SProject && typeof H2SProject.scoreBeatToSec === 'function'){
          return H2SProject.scoreBeatToSec(scoreBeat, bpm);
        }
        return _manualScoreBeatToSec(scoreBeat, bpm);
      }

      function _scoreSecToBeat(scoreSec, bpm){
        if (H2SProject && typeof H2SProject.scoreSecToBeat === 'function'){
          return H2SProject.scoreSecToBeat(scoreSec, bpm);
        }
        return _manualScoreSecToBeat(scoreSec, bpm);
      }

      /**
       * Ghost overlay source: the CURRENT clip head's parent revision score (seconds-score for editor).
       * No parent id or missing parent snapshot => null (no ghost).
       */
      function _ghostScoreFromClipParentRevision(p2b, clipId, bpmFallback){
        if (!clipId || !p2b || !p2b.clips || !p2b.clips[clipId]) return null;
        const clipV2 = p2b.clips[clipId];
        const parentId = clipV2 && clipV2.parentRevisionId;
        if (parentId == null || String(parentId).trim() === '') return null;
        const revs = clipV2 && clipV2.revisions;
        const revsIsMap = revs && typeof revs === 'object' && !Array.isArray(revs);
        const pid = String(parentId);
        const parent = (revsIsMap && revs[pid]) ? revs[pid] : null;
        if (!parent || !parent.score) return null;
        const ps = parent.score;
        const bpm = (p2b && p2b.bpm) ? p2b.bpm : (Number(bpmFallback) || 120);
        if (_isBeatScore(ps)){
          try { return _scoreBeatToSec(ps, bpm); }
          catch(e){ return H2SProject.deepClone(ps); }
        }
        return H2SProject.deepClone(ps);
      }

      function _recomputeClipMetaFromBeatScore(clip, scoreBeat){
        const meta0 = (clip && clip.meta) ? clip.meta : {};
        if (H2SProject && typeof H2SProject.recomputeClipMetaFromScoreBeat === 'function' && clip){
          try { H2SProject.recomputeClipMetaFromScoreBeat(clip); return; } catch(e){}
        }
        let count = 0;
        let minP = null;
        let maxP = null;
        let spanBeat = 0;
        const tracks = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
        for (const t of tracks){
          const notes = t && Array.isArray(t.notes) ? t.notes : [];
          for (const n of notes){
            if (!n) continue;
            count += 1;
            const p = Number(n.pitch);
            if (isFinite(p)){
              if (minP == null || p < minP) minP = p;
              if (maxP == null || p > maxP) maxP = p;
            }
            const end = (Number(n.startBeat) || 0) + (Number(n.durationBeat) || 0);
            if (isFinite(end) && end > spanBeat) spanBeat = end;
          }
        }
        if (clip){
          clip.meta = {
            notes: count,
            pitchMin: minP,
            pitchMax: maxP,
            spanBeat: spanBeat,
            sourceTempoBpm: (meta0 && meta0.sourceTempoBpm != null) ? meta0.sourceTempoBpm : ((scoreBeat && scoreBeat.tempo_bpm != null) ? scoreBeat.tempo_bpm : null)
          };
        }
      }


      // Implementation object: methods are copied from app.js modal editor section.
      const impl = {
        // Provide accessors similar to app.js
        get project(){ return getProject(); },
        get state(){ return getState(); },
        _runtimeApp(){
          return (H2SApp || (root && root.H2SApp) || null);
        },
        render(){
          try { render(); } catch(e){}
        },

        // Ensure Tone.js is available in the browser.
        // - In Node tests there is no `document`, so this must be guarded.
        // - Default: try local vendor only. CDN only if window.H2S_ALLOW_CDN_TONE === true.
        async ensureTone(){
          const r = (typeof window !== 'undefined') ? window : global;
          if (r && r.Tone) return true;
          if (typeof document === 'undefined') return false;

          // If a loader helper exists on the page, try it first.
          if (r && typeof r.__ensureToneLoaded === 'function'){
            try { await r.__ensureToneLoaded(); } catch(e){}
            if (r.Tone) return true;
          }

          const SRC_LOCAL = '/static/pianoroll/vendor/tone/Tone.js';
          const SRC_CDN = 'https://cdn.jsdelivr.net/npm/tone@14.8.49/build/Tone.js';
          const sources = [SRC_LOCAL];
          if (r && r.H2S_ALLOW_CDN_TONE === true) sources.push(SRC_CDN);

          return await new Promise((resolve) => {
            try {
              // If a script is already present, wait for it.
              const scripts = Array.from(document.scripts || []);
              const existing = scripts.find(s => (s.src || '').includes('Tone.js') || (s.src || '').toLowerCase().includes('tone'));
              if (existing){
                if (r.Tone) return resolve(true);
                existing.addEventListener('load', () => resolve(!!r.Tone));
                existing.addEventListener('error', () => resolve(false));
                setTimeout(() => resolve(!!r.Tone), 2500);
                return;
              }

              let idx = 0;
              let toId = 0;
              const tryNext = () => {
                if (r.Tone) return resolve(true);
                if (idx >= sources.length) return resolve(false);
                if (toId) clearTimeout(toId);
                const s = document.createElement('script');
                s.src = sources[idx++];
                s.async = true;
                s.onload = () => resolve(!!r.Tone);
                s.onerror = () => tryNext();
                document.head.appendChild(s);
                toId = setTimeout(() => resolve(!!r.Tone), 3000);
              };
              tryNext();
            } catch(e){
              resolve(false);
            }
          });
        },
    openClipEditor(clipId){
      const clip = _findClip(this.project, clipId);
      if (!clip) return;

      const p2b = getProjectV2 && getProjectV2();
      const cV2 = p2b && p2b.clips && clipId ? p2b.clips[clipId] : null;
      const audioGuard = (H2SProject && typeof H2SProject.clipKind === 'function')
        ? (H2SProject.clipKind(cV2 || clip) === 'audio')
        : (clip.kind === 'audio');
      if (audioGuard){
        return;
      }

      const _perfOpen = _h2sDevPerfTimingEnabled();
      const _perfW = _perfOpen && typeof performance !== 'undefined';
      if (_perfW){
        this._h2sOpenPerf = { pendingFirstDraw: true, t0: performance.now(), clipId: String(clipId) };
      }

      const bpm = (p2b && p2b.bpm) ? p2b.bpm : (this.project && this.project.bpm ? this.project.bpm : 120);
      const projectWantsBeat = !!(
        (p2b && (p2b.timebase === 'beat' || Number(p2b.version) === 2)) ||
        (this.project && (this.project.timebase === 'beat' || Number(this.project.version) === 2))
      );
      const clipScoreIsBeat = _isBeatScore(clip.score);

      // Editor always operates on a seconds-score draft to preserve the existing interaction feel.
      // If the stored score is beats, we convert beats->seconds on open, and seconds->beats on save.
      let savedScoreSec;
      if (clipScoreIsBeat){
        try { savedScoreSec = _scoreBeatToSec(clip.score, bpm); } catch(e){ savedScoreSec = H2SProject.deepClone(clip.score); }
      } else {
        savedScoreSec = H2SProject.deepClone(clip.score);
      }
      savedScoreSec = H2SProject.ensureScoreIds(H2SProject.deepClone(savedScoreSec));

      this.state.modal.show = true;
      this.state.modal.clipId = clipId;
      this.state.modal.savedScore = H2SProject.deepClone(savedScoreSec);
      this.state.modal.draftScore = H2SProject.deepClone(savedScoreSec);
      this.state.modal.dirty = false;
      if (typeof window !== 'undefined' && window.H2SProjectLastUndo && typeof window.H2SProjectLastUndo.clear === 'function'){
        window.H2SProjectLastUndo.clear('editor');
      }
      this.modalEnsureDraftScoreNoteIds();

      // T3-4: ghost + patch summary (revision UI bridge) — parent revision score under current head
      try{
        this.state.modal.ghostScore = _ghostScoreFromClipParentRevision(p2b, clipId, bpm);
      }catch(e){
        this.state.modal.ghostScore = null;
      }

      try{
        const el = (typeof document !== 'undefined') ? document.getElementById('patchSummary') : null;
        const agent = clip && clip.meta && clip.meta.agent;
        if (el){
          if (agent && agent.patchSummary) el.textContent = JSON.stringify(agent.patchSummary, null, 2);
          else if (agent && typeof agent.patchOps === 'number') el.textContent = JSON.stringify({ ops: agent.patchOps }, null, 2);
          else el.textContent = '(none)';
        }
      }catch(e){}

      if (_perfW) this._h2sOpenPerf.tAfterScorePrep = performance.now();

      // PR-4/PR-6b: Editor Optimize UI — preset, prompt, status line
      try{
        if (typeof document !== 'undefined' && $){
          const app = (root && root.H2SApp) ? root.H2SApp : null;
          const sel = $('#editorOptimizePreset');
          if (sel && app && typeof app.getOptimizePresetForClip === 'function'){
            const preset = app.getOptimizePresetForClip(clipId);
            sel.value = (preset != null && preset !== '') ? String(preset) : '';
          }
          const promptEl = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePrompt') : null;
          if (promptEl && app && typeof app.getOptimizeOptions === 'function'){
            const opts = app.getOptimizeOptions(clipId);
            const stored = (opts && opts.userPrompt != null && typeof opts.userPrompt === 'string') ? opts.userPrompt : '';
            promptEl.value = stored;
          }
          const statusEl = $('#editorOptStatus');
          if (statusEl) statusEl.textContent = _editorOptStatusText(clip.meta && clip.meta.agent) || '';
        }
      }catch(e){}

      // PR-5: Editor revision UI — Rev/Parent labels and Undo Optimize button state
      try{
        if (typeof document !== 'undefined' && $){
          const revEl = $('#editorRevId');
          const parentEl = $('#editorParentRevId');
          const undoStatusEl = $('#editorUndoStatus');
          const undoBtn = $('#btnEditorUndoOptimize');
          if (revEl) revEl.textContent = _shortRev(clip.revisionId);
          if (parentEl) parentEl.textContent = _shortRev(clip.parentRevisionId);
          const canUndo = !!(clip.parentRevisionId && String(clip.parentRevisionId).trim());
          if (undoBtn){
            undoBtn.disabled = !canUndo;
          }
          if (undoStatusEl) undoStatusEl.textContent = canUndo ? '' : 'No previous revision';
        }
      }catch(e){}

      // PR-7a-3: Populate LLM Settings from H2S_LLM_CONFIG; if missing, show warning and disable Save/Reset
      try{
        if (typeof document !== 'undefined' && $){
          const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG) ? globalThis.H2S_LLM_CONFIG : null;
          const baseEl = document.getElementById('editorLlmBaseUrl');
          const modelEl = document.getElementById('editorLlmModel');
          const modelSelectEl = document.getElementById('editorLlmModelSelect');
          const gatewayPresetEl = document.getElementById('editorLlmGatewayPreset');
          const tokenEl = document.getElementById('editorLlmAuthToken');
          const velocityOnlyEl = document.getElementById('editorLlmVelocityOnly');
          const saveBtn = document.getElementById('btnEditorLlmSave');
          const resetBtn = document.getElementById('btnEditorLlmReset');
          const testBtn = document.getElementById('btnEditorLlmTest');
          const loadModelsBtn = document.getElementById('btnEditorLlmLoadModels');
          const modelLoadStatusEl = document.getElementById('editorLlmModelLoadStatus');
          const warnEl = document.getElementById('editorLlmConfigWarning');
          const statusEl = document.getElementById('editorLlmConfigStatus');
          const testStatusEl = document.getElementById('editorLlmTestStatus');
          // PR-8J/8K: Populate Model select dropdown from defaults (fallback to hardcoded list)
          if (modelSelectEl){
            modelSelectEl.innerHTML = '<option value="">' + _t('editor.selectModel') + '</option>';
            try{
              const defaults = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_DEFAULTS) ? globalThis.H2S_LLM_DEFAULTS : null;
              const suggestions = (defaults && Array.isArray(defaults.modelSuggestions)) ? defaults.modelSuggestions : ['gpt-4o-mini', 'gpt-4.1-mini', 'deepseek-chat', 'deepseek-reasoner', 'deepseek/deepseek-chat', 'deepseek/deepseek-reasoner'];
              for (var i = 0; i < suggestions.length; i++){
                var opt = document.createElement('option');
                opt.value = suggestions[i];
                opt.textContent = suggestions[i];
                modelSelectEl.appendChild(opt);
              }
            }catch(_){}
          }
          const defaultsObj = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_DEFAULTS) ? globalThis.H2S_LLM_DEFAULTS : null;
          const runtimePreset = (defaultsObj && typeof defaultsObj.gatewayPresetDefault === 'string') ? String(defaultsObj.gatewayPresetDefault).toLowerCase() : 'custom';
          const DEEPSEEK_URL = 'https://api.deepseek.com/v1';
          const OLLAMA_URL = 'http://localhost:11434/v1';

          if (api && typeof api.loadLlmConfig === 'function'){
            const cfg = api.loadLlmConfig();
            let baseVal = (cfg && typeof cfg.baseUrl === 'string') ? cfg.baseUrl : '';
            let modelVal = (cfg && typeof cfg.model === 'string') ? cfg.model : '';
            let presetVal = 'custom';

            if (baseVal){
              if (baseVal === DEEPSEEK_URL) presetVal = 'deepseek';
              else if (baseVal === OLLAMA_URL) presetVal = 'ollama';
            } else {
              if (runtimePreset === 'deepseek'){
                presetVal = 'deepseek';
                baseVal = DEEPSEEK_URL;
                if (!modelVal) modelVal = 'deepseek-chat';
              } else if (runtimePreset === 'ollama'){
                presetVal = 'ollama';
                baseVal = OLLAMA_URL;
              }
            }

            if (baseEl) baseEl.value = baseVal;
            if (modelEl) modelEl.value = modelVal;
            if (gatewayPresetEl) gatewayPresetEl.value = presetVal;
            if (tokenEl) tokenEl.value = (cfg && typeof cfg.authToken === 'string') ? cfg.authToken : '';
            // PR-8D: Populate velocity-only checkbox (default true if missing)
            if (velocityOnlyEl) velocityOnlyEl.checked = (cfg && typeof cfg.velocityOnly === 'boolean') ? cfg.velocityOnly : true;
            if (statusEl) statusEl.textContent = '';
            if (testStatusEl) testStatusEl.textContent = '';
            if (modelLoadStatusEl) modelLoadStatusEl.textContent = '';
            if (warnEl) { warnEl.style.display = 'none'; warnEl.textContent = ''; }
            if (saveBtn) saveBtn.disabled = false;
            if (resetBtn) resetBtn.disabled = false;
            const hasClient = typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CLIENT && typeof globalThis.H2S_LLM_CLIENT.listModels === 'function';
            if (testBtn) testBtn.disabled = !(typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CLIENT && typeof globalThis.H2S_LLM_CLIENT.callChatCompletions === 'function');
            if (loadModelsBtn) loadModelsBtn.disabled = !hasClient;
          } else {
            if (baseEl) baseEl.value = '';
            if (modelEl) modelEl.value = '';
            if (tokenEl) tokenEl.value = '';
            // PR-8D: Default checkbox to checked if module not loaded
            if (velocityOnlyEl) velocityOnlyEl.checked = true;
            if (statusEl) statusEl.textContent = '';
            if (testStatusEl) testStatusEl.textContent = '';
            if (modelLoadStatusEl) modelLoadStatusEl.textContent = '';
            if (gatewayPresetEl) gatewayPresetEl.value = 'custom';
            if (warnEl) { warnEl.style.display = 'block'; warnEl.textContent = _t('editor.llmConfigNotLoaded'); }
            if (saveBtn) saveBtn.disabled = true;
            if (resetBtn) resetBtn.disabled = true;
            if (testBtn) testBtn.disabled = true;
            if (loadModelsBtn) loadModelsBtn.disabled = true;
          }
          // PR-8C: Load LLM debug data on modal open
          loadLlmDebugUI();
          // Bind Gateway Preset change handler on every modal open (ensures handler fires when preset changes)
          const g = (typeof window !== 'undefined') ? window : global;
          if (g) g.__h2s_editor_handlers = g.__h2s_editor_handlers || {};
          const H = g ? g.__h2s_editor_handlers : {};
          const applyPresetFill = function(presetValue){
            const doc = typeof document !== 'undefined' ? document : null;
            if (!doc) return;
            const b = doc.getElementById('editorLlmBaseUrl');
            const m = doc.getElementById('editorLlmModel');
            if (presetValue === 'deepseek'){
              if (b) b.value = 'https://api.deepseek.com/v1';
              if (m){
                const cur = (m.value != null) ? String(m.value).trim() : '';
                if (!cur) m.value = 'deepseek-chat';
              }
            } else if (presetValue === 'ollama'){
              if (b) b.value = 'http://localhost:11434/v1';
            }
          };
          if (!H.onLlmGatewayPresetChange){
            H.onLlmGatewayPresetChange = function(ev){
              try{
                const val = (ev.target && ev.target.value) ? String(ev.target.value) : 'custom';
                applyPresetFill(val);
              }catch(e){}
            };
          }
          if (gatewayPresetEl){
            gatewayPresetEl.removeEventListener('change', H.onLlmGatewayPresetChange, true);
            gatewayPresetEl.addEventListener('change', H.onLlmGatewayPresetChange, true);
            // Prefill if preset is deepseek/ollama but Base URL is still empty (covers UI default edge case)
            if (baseEl){
              const pv = (gatewayPresetEl.value && String(gatewayPresetEl.value)) ? String(gatewayPresetEl.value) : '';
              const baseEmpty = !(baseEl.value != null && String(baseEl.value).trim());
              if ((pv === 'deepseek' || pv === 'ollama') && baseEmpty) applyPresetFill(pv);
            }
          }
        }
      }catch(e){}

      // Remember source timebase for save boundary.
      this.state.modal._sourceClipWasBeat = !!clipScoreIsBeat;
      this.state.modal._projectWantsBeat = !!projectWantsBeat;

      // Keep snap memory in sync
      const snapV = this.modalGetSnapValue();
      if (snapV !== 'off') this.state.modal.snapLastNonOff = snapV;
      this.state.modal.cursorSec = 0;
      this.state.modal.selectedNoteId = null;
      this.state.modal.selectedNoteIds = null;
      this.state.modal.selectedCell = null;
      this.state.modal.selection = (H2SEditorSelection && typeof H2SEditorSelection.emptySelection === 'function')
        ? H2SEditorSelection.emptySelection()
        : { noteRefs: [], tool: 'pointer' };
      this.modalSyncLegacySelectionFromRefs();
      this.state.modal.marquee = null;
      this.state.modal.mode = 'none';
      try{
        const tz0 = (typeof localStorage !== 'undefined') ? Number(localStorage.getItem('h2s_editor_time_zoom') || '1') : 1;
        this.state.modal.timeZoom = (H2SEditorCoords && typeof H2SEditorCoords.clampTimeZoom === 'function')
          ? H2SEditorCoords.clampTimeZoom(tz0)
          : (isFinite(tz0) && tz0 > 0 ? tz0 : 1);
      }catch(_tz){ this.state.modal.timeZoom = 1; }

      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const center = Math.round((st.minPitch + st.maxPitch) / 2);
      this.state.modal.pitchCenter = H2SProject.clamp(center, 0, 127);
      $('#rngPitchCenter').value = this.state.modal.pitchCenter;

      // Large/dense clips: default velocity lane collapsed (modalDraw velocity phase is costly at high note counts).
      // Prefer clip.meta when present; otherwise scoreStats.
      const _meta = clip && clip.meta ? clip.meta : null;
      const _noteSig = (_meta && typeof _meta.notes === 'number') ? _meta.notes : st.count;
      const _spanSig = (_meta && typeof _meta.spanSec === 'number' && isFinite(_meta.spanSec)) ? _meta.spanSec : st.spanSec;
      const _VEL_COLLAPSE_MIN_NOTES = 250;
      const _VEL_COLLAPSE_MIN_SPAN_SEC = 30;
      this.state.modal.velocityLaneCollapsed = (_noteSig >= _VEL_COLLAPSE_MIN_NOTES) || (_spanSig >= _VEL_COLLAPSE_MIN_SPAN_SEC);

      // Pitch zoom (visual size). Remember across sessions.
      // Levels: 1.0 -> normal, 1.25 -> bigger default, 1.5 -> extra big.
      try{
        const z0 = (typeof localStorage !== 'undefined') ? Number(localStorage.getItem('h2s_editor_pitch_zoom') || '1.25') : 1.25;
        const z = (isFinite(z0) && z0 > 0) ? z0 : 1.25;
        this.state.modal.pitchZoom = z;
      }catch(e){ this.state.modal.pitchZoom = 1.25; }

      $('#modalTitle').textContent = (_t('editor.editingName') || 'Editing: {name}').replace('{name}', clip.name || '');
      $('#modalSub').textContent = `${_t('editor.notes')} ${st.count} | ${_t('editor.pitch')} ${H2SProject.midiToName(st.minPitch)}..${H2SProject.midiToName(st.maxPitch)} | ${_t('editor.span')} ${fmtSec(st.spanSec)}`;
      $('#modal').classList.add('show');
      $('#modal').setAttribute('aria-hidden', 'false');

      if (H2SEditorModalResize && typeof H2SEditorModalResize.attach === 'function'){
        try{
          H2SEditorModalResize.attach($('#modal'), () => {
            this.modalResizeCanvasToContent();
            this.modalRequestDraw();
          });
        }catch(_mr){}
      }

      $('#editorStatus').textContent = _t('editor.tipSnap');

      if (_perfW) this._h2sOpenPerf.tBeforeRightPanel = performance.now();
      if (_perfW){
        const _t = performance.now();
        this.modalUpdateRightPanel();
        this._h2sOpenPerf.rightPanelFirstMs = performance.now() - _t;
      } else {
        this.modalUpdateRightPanel();
      }
      if (_perfW){
        const _t = performance.now();
        this.modalResizeCanvasToContent();
        this._h2sOpenPerf.resizeCanvasMs = performance.now() - _t;
      } else {
        this.modalResizeCanvasToContent();
      }
      if (_perfW){
        const _t = performance.now();
        this.modalAutoScrollPitchToCenter && this.modalAutoScrollPitchToCenter();
        this._h2sOpenPerf.autoScrollMs = performance.now() - _t;
      } else {
        this.modalAutoScrollPitchToCenter && this.modalAutoScrollPitchToCenter();
      }
      if (_perfW){
        const _t = performance.now();
        this.modalSetupVelocityScrollSync();
        this._h2sOpenPerf.velocitySyncMs = performance.now() - _t;
      } else {
        this.modalSetupVelocityScrollSync();
      }
      if (_perfW){
        const _t = performance.now();
        this.modalRequestDraw();
        this._h2sOpenPerf.requestDrawScheduleMs = performance.now() - _t;
        this._h2sOpenPerf.tAfterRequestDraw = performance.now();
      } else {
        this.modalRequestDraw();
      }
      if (_perfW){
        const _t = performance.now();
        this.modalBindControls();
        this._h2sOpenPerf.bindControlsMs = performance.now() - _t;
      } else {
        this.modalBindControls();
      }
      if (_perfW){
        const _t = performance.now();
        this.modalUpdateEditorOptimizeUI();
        this._h2sOpenPerf.optimizeUiMs = performance.now() - _t;
        this._h2sOpenPerf.openSyncTotalMs = performance.now() - this._h2sOpenPerf.t0;
      } else {
        this.modalUpdateEditorOptimizeUI();
      }
      this.modalBindClipEditControlsV1();
      this.modalLoadAutoSplitPanel();
      this.modalUpdateSelectionUI();
      this.modalUpdateTimeZoomLabel();
      log(`Open editor: ${clip.name}`);
    },

    closeModal(save){
      this.modalEndEdgeScroll();
      if (!this.state.modal.show) return;
      this.modalStop();

      const clipId = this.state.modal.clipId;
      const clip = _findClip(this.project, clipId);

      const p2b = ((typeof getProjectV2 === 'function') ? getProjectV2() : null) || (((this.project && (this.project.timebase === 'beat' || Number(this.project.version) === 2))) ? this.project : null);
      const bpm = (p2b && p2b.bpm) ? p2b.bpm : (this.project && this.project.bpm ? this.project.bpm : 120);
      const wantsBeatNow = !!(p2b && (p2b.timebase === 'beat' || Number(p2b.version) === 2));
      const storeAsBeat = !!(wantsBeatNow || this.state.modal._sourceClipWasBeat || this.state.modal._projectWantsBeat || _isBeatScore(clip && clip.score));



      if (save && clip){
        if (storeAsBeat){
          // seconds draft -> beats score (normalize-on-write; no grid snap)
          const draftSec = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
          let scoreBeat = _scoreSecToBeat(draftSec, bpm);

          // Best-effort normalize/clamp in case importer produced weird values.
          if (scoreBeat && Array.isArray(scoreBeat.tracks)) {
            for (const t of scoreBeat.tracks){
              const notes = t && Array.isArray(t.notes) ? t.notes : [];
              for (const n of notes){
                if (!n) continue;
                n.startBeat = _normalizeBeat(Math.max(0, Number(n.startBeat) || 0));
                n.durationBeat = _normalizeBeat(Math.max(0, Number(n.durationBeat) || 0));
                // keep pitch/vel in range
                n.pitch = H2SProject.clamp(Number(n.pitch) || 0, 0, 127);
                n.velocity = H2SProject.clamp(Number(n.velocity) || 80, 1, 127);
              }
            }
          }

          // Write back: always update the opened (legacy) clip object for immediate UI refresh.
          clip.score = scoreBeat;
          _recomputeClipMetaFromBeatScore(clip, scoreBeat);

          // If v2 exists, also write into ProjectDoc v2 clip map and persist via commitV2.
          if (wantsBeatNow && p2b && p2b.clips && p2b.clips[clipId]) {
            try {
              const c2 = p2b.clips[clipId];
              c2.score = scoreBeat;
              _recomputeClipMetaFromBeatScore(c2, scoreBeat);
            } catch(e){}
          }

          // Persist preference: if commitV2 exists and we can resolve a v2 project, always use it.
          if (typeof commitV2 === 'function') {
            let p2save = null;
            try { p2save = (typeof getProjectV2 === 'function') ? getProjectV2() : null; } catch(e) { p2save = null; }
            if (!p2save) p2save = p2b;
            if (p2save) {
              commitV2(p2save, 'editor_save');
            } else if (typeof persistFromV1 === 'function') {
              persistFromV1('editor_save_legacy');
            } else {
              persist();
            }
          } else if (typeof persistFromV1 === 'function') {
            persistFromV1('editor_save_legacy');
          } else {
            persist();
          }

          this.render();
          log('Saved clip changes (beats).');
        } else {
          // Legacy seconds storage (v1)
          clip.score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
          const st = H2SProject.scoreStats(clip.score);
          clip.meta = { notes: st.count, pitchMin: st.minPitch, pitchMax: st.maxPitch, spanSec: st.spanSec };
          persist();
          this.render();
          log('Saved clip changes.');
        }
      } else {
        log('Canceled clip changes.');
      }

      this.state.modal.show = false;
      this.state.modal.clipId = null;
      this.state.modal.draftScore = null;
      this.state.modal.savedScore = null;
      if (typeof window !== 'undefined' && window.H2SProjectLastUndo && typeof window.H2SProjectLastUndo.clear === 'function'){
        window.H2SProjectLastUndo.clear('editor');
      }
      this.state.modal.selectedNoteId = null;
      this.state.modal.selectedNoteIds = null;
      this.state.modal.selectedCell = null;
      this.state.modal.selection = (H2SEditorSelection && H2SEditorSelection.emptySelection)
        ? H2SEditorSelection.emptySelection()
        : { noteRefs: [], tool: 'pointer' };
      this.modalSyncLegacySelectionFromRefs();
      this.state.modal.marquee = null;
      this.state.modal.mode = 'none';
      this.state.modal._sourceClipWasBeat = false;
      this.state.modal._projectWantsBeat = false;

      if (this._h2sOpenPerf && this._h2sOpenPerf.pendingFirstDraw) this._h2sOpenPerf = null;

      $('#modal').classList.remove('show');
      $('#modal').setAttribute('aria-hidden', 'true');
    },

    modalTogglePlay(){
      if (this.state.modal.isPlaying) this.modalStop();
      else this.modalPlay();
    },

    modalGetSnapValue(){
      const el = $('#selSnap');
      return el ? String(el.value) : '16';
    },

    modalSetSnapValue(v, opts){
      const el = $('#selSnap');
      if (!el) return;
      const val = String(v);
      el.value = val;
      if (val !== 'off'){
        this.state.modal.snapLastNonOff = val;
      }
      if (!opts || !opts.silent){
        $('#editorStatus').textContent = (_t('editor.snapStatusFmt') || 'Snap = {val}  (Q toggle, [ ] grid, Alt bypass)').replace('{val}', val === 'off' ? _t('snap.off') : ('1/' + val));
      }
      this.modalRequestDraw();
    },

    modalToggleSnap(){
      const cur = this.modalGetSnapValue();
      if (cur !== 'off'){
        this.state.modal.snapLastNonOff = cur;
        this.modalSetSnapValue('off');
      }else{
        const restore = this.state.modal.snapLastNonOff || '16';
        this.modalSetSnapValue(restore);
      }
    },

    modalAdjustSnap(dir){
      // dir: +1 -> finer (bigger denom), -1 -> coarser (smaller denom)
      const order = [4, 8, 16, 32, 64];
      let cur = this.modalGetSnapValue();
      if (cur === 'off'){
        cur = this.state.modal.snapLastNonOff || '16';
      }
      let denom = Number(cur);
      if (!Number.isFinite(denom) || denom <= 0){
        denom = 16;
      }
      let i = order.indexOf(denom);
      if (i === -1) i = 2; // default 16
      i = Math.max(0, Math.min(order.length - 1, i + dir));
      this.modalSetSnapValue(String(order[i]));
    },

    modalSnapSec(){
      const v = this.modalGetSnapValue();
      const bpm = this.project.bpm || 120;
      const beat = 60 / bpm; // quarter note
      if (v === 'off') return 0;
      const denom = Number(v);
      // denom=16 -> 1/16 note = beat*(4/16)=beat/4
      return beat * (4 / denom);
    },

    modalQuantize(x, ev){
      if (ev && ev.altKey) return x;
      const g = this.modalSnapSec();
      if (!g || g <= 0) return x;
      return Math.round(x / g) * g;
    },

    modalResizeCanvasToContent(){
      const wrap = $('#canvasWrap');
      const canvas = $('#canvas');
      const gridWrap = $('.editorGridWrap') || wrap;
      const velocityCanvas = $('#velocityCanvas');
      const velocityLaneWrap = $('#velocityLaneWrap');
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const spareBeats = 8 * 60 / (this.project.bpm || 120);
      const span = Math.max(4, st.spanSec + spareBeats);
      const w = (H2SEditorCoords && typeof H2SEditorCoords.contentWidthForSpan === 'function')
        ? H2SEditorCoords.contentWidthForSpan(span, this.state.modal)
        : Math.max(1200, Math.ceil(span * this.modalEffectivePxPerSec()) + 140);

      const gridAreaH = (gridWrap && gridWrap.clientHeight > 0) ? gridWrap.clientHeight : wrap.clientHeight;
      const wrapH = Math.max(320, gridAreaH - 2);

      // Visual row size (zoom)
      const ROW_H = Math.max(12, Math.round(16 * (Number(this.state.modal.pitchZoom || 1))));
      this.state.modal.rowH = ROW_H;

      // A short melody is not a smaller instrument. Keep the full MIDI range
      // available and frame the melody by scrolling, not cropping the canvas.
      this.state.modal.usePitchVScroll = true;
      this.state.modal.pitchViewRows = PITCH_ROWS_FULL;

      // Keep a stable coordinate system for dragging through every octave.
      canvas.width = w;
      canvas.height = Math.max(wrapH, PITCH_PAD_T + PITCH_PAD_B + PITCH_ROWS_FULL * ROW_H);
      canvas.style.width = w + 'px';
      canvas.style.height = canvas.height + 'px';

      // Velocity lane: match grid width; height from state; HiDPI
      if (velocityCanvas && velocityLaneWrap){
        const collapsed = !!this.state.modal.velocityLaneCollapsed;
        velocityLaneWrap.classList.toggle('collapsed', collapsed);
        $('#velocitySplitter').classList.toggle('collapsed', collapsed);
        if (!collapsed){
          const vh = Math.max(48, Math.min(200, Number(this.state.modal.velocityLaneHeight) || 80));
          const cssH = vh - 22;
          const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
          velocityCanvas.width = Math.round(w * dpr);
          velocityCanvas.height = Math.round(cssH * dpr);
          velocityCanvas.style.width = w + 'px';
          velocityCanvas.style.height = cssH + 'px';
          this.state.modal.velocityLaneCssW = w;
          this.state.modal.velocityLaneCssH = cssH;
          velocityLaneWrap.style.height = vh + 'px';
        }
      }
    },

    // When vertical pitch scrolling is enabled, scroll so pitchCenter sits near the viewport center.
    modalSetupVelocityScrollSync(){
      if (typeof document === 'undefined' || !$) return;
      const gridWrap = $('.editorGridWrap');
      const velWrap = $('.editorVelocityLaneCanvasWrap');
      if (!gridWrap || !velWrap || gridWrap.__h2s_vel_scroll_synced) return;
      gridWrap.__h2s_vel_scroll_synced = true;
      gridWrap.addEventListener('scroll', () => {
        if (velWrap) velWrap.scrollLeft = gridWrap.scrollLeft;
      });
    },

    modalAutoScrollPitchToCenter(){
      if (!this.state.modal.show) return;
      if (!this.state.modal.usePitchVScroll) return;
      const gridWrap = $('.editorGridWrap');
      const canvas = $('#canvas');
      if (!gridWrap || !canvas) return;
      const rowH = Number(this.state.modal.rowH) || 16;
      const pitch = (this.state.modal.pitchCenter != null) ? Number(this.state.modal.pitchCenter) : 60;
      const y = (this.state.modal.padT || PITCH_PAD_T) + (127 - pitch) * rowH;
      const target = y - (gridWrap.clientHeight / 2);
      const maxScroll = Math.max(0, (canvas.height || 0) - gridWrap.clientHeight);
      gridWrap.scrollTop = Math.max(0, Math.min(maxScroll, target));
    },

    modalUpdateRightPanel(){
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      $('#kvClipNotes').textContent = String(st.count);
      $('#kvClipPitch').textContent = `${H2SProject.midiToName(st.minPitch)}..${H2SProject.midiToName(st.maxPitch)}`;
      $('#kvClipSpan').textContent = fmtSec(st.spanSec);
      $('#pillCursor').textContent = (_t('editor.cursorFmt') || 'Cursor: {sec}').replace('{sec}', fmtSec(this.state.modal.cursorSec));
      $('#pillSnap').textContent = $('#selSnap').value === 'off' ? _t('editor.snapOff') : (_t('editor.snapFmt') || 'Snap 1/{n}').replace('{n}', $('#selSnap').value);
      if (typeof this.modalUpdateSelectionUI === 'function') this.modalUpdateSelectionUI();
    },

    // PR-4/PR-6b: Update Editor Optimize preset, prompt, and status from current clip (e.g. after Optimize).
    modalUpdateEditorOptimizeUI(){
      if (typeof document === 'undefined' || !$) return;
      const clipId = this.state.modal && this.state.modal.clipId;
      if (!clipId) return;
      const app = (root && root.H2SApp) ? root.H2SApp : null;
      const p2 = getProjectV2 && getProjectV2();
      const clip = (p2 && p2.clips && p2.clips[clipId]) ? p2.clips[clipId] : null;
      try{
        const sel = $('#editorOptimizePreset');
        if (sel && app && typeof app.getOptimizePresetForClip === 'function'){
          const preset = app.getOptimizePresetForClip(clipId);
          sel.value = (preset != null && preset !== '') ? String(preset) : '';
        }
        const opts = app && typeof app.getOptimizeOptions === 'function' ? app.getOptimizeOptions(clipId) : null;
        const promptEl = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePrompt') : null;
        if (promptEl && document.activeElement !== promptEl){
          promptEl.value = (opts && opts.userPrompt != null && typeof opts.userPrompt === 'string') ? opts.userPrompt : '';
        }
        const intent = (opts && opts.intent && typeof opts.intent === 'object') ? opts.intent : { fixPitch: false, tightenRhythm: false, reduceOutliers: false };
        const normalizedIntent = {
          fixPitch: !!intent.fixPitch,
          tightenRhythm: !!intent.tightenRhythm,
          reduceOutliers: !!intent.reduceOutliers
        };
        // Quick Optimize intent currently supports only one active goal at a time.
        if (normalizedIntent.fixPitch) {
          normalizedIntent.tightenRhythm = false;
          normalizedIntent.reduceOutliers = false;
        } else if (normalizedIntent.tightenRhythm) {
          normalizedIntent.reduceOutliers = false;
        }
        const fixPitchEl = (typeof document !== 'undefined') ? document.getElementById('qoptFixPitch') : null;
        const tightenRhythmEl = (typeof document !== 'undefined') ? document.getElementById('qoptTightenRhythm') : null;
        const reduceOutliersEl = (typeof document !== 'undefined') ? document.getElementById('qoptReduceOutliers') : null;
        if (fixPitchEl) fixPitchEl.checked = normalizedIntent.fixPitch;
        if (tightenRhythmEl) tightenRhythmEl.checked = normalizedIntent.tightenRhythm;
        if (reduceOutliersEl) reduceOutliersEl.checked = normalizedIntent.reduceOutliers;
        this._selectedTemplateId = (opts && opts.templateId != null && String(opts.templateId).trim()) ? String(opts.templateId).trim() : null;
        if (!this._selectedTemplateId){
          if (normalizedIntent.fixPitch) this._selectedTemplateId = 'fix_pitch_v1';
          else if (normalizedIntent.tightenRhythm) this._selectedTemplateId = 'tighten_rhythm_v1';
          else if (normalizedIntent.reduceOutliers) this._selectedTemplateId = 'clean_outliers_v1';
        }
        _syncQuickOptimizeTemplateButtons(this._selectedTemplateId);
        const templateLabelEl = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizeTemplateLabel') : null;
        if (templateLabelEl) {
          const tmpl = this._selectedTemplateId && TEMPLATES_V1_UI[this._selectedTemplateId] ? TEMPLATES_V1_UI[this._selectedTemplateId] : null;
          const lbl = tmpl ? (_t('editor.template') + ': ' + (tmpl.labelKey ? _t(tmpl.labelKey) : tmpl.label)) : (_t('editor.template') + ': ' + _t('editor.templateCustom'));
          templateLabelEl.textContent = lbl;
        }
        const statusEl = $('#editorOptStatus');
        if (statusEl) statusEl.textContent = (clip && clip.meta && clip.meta.agent) ? (_editorOptStatusText(clip.meta.agent) || '') : '';
        updateEditorOptimizeDetailsVisibilityFromClip(clipId, clip);
        const quickPresetEl = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizePreset') : null;
        const quickModeEl = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizeMode') : null;
        const quickModelEl = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizeModel') : null;
        if (quickPresetEl && app && typeof app.getOptimizePresetForClip === 'function'){
          const preset = app.getOptimizePresetForClip(clipId);
          quickPresetEl.value = (preset != null && preset !== '') ? String(preset) : 'llm_v0';
        }
        try{
          const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG && typeof globalThis.H2S_LLM_CONFIG.loadLlmConfig === 'function') ? globalThis.H2S_LLM_CONFIG : null;
          if (api){
            const cfg = api.loadLlmConfig();
            if (quickModeEl) quickModeEl.textContent = (cfg && typeof cfg.velocityOnly === 'boolean' && !cfg.velocityOnly) ? ((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.full') : 'Full mode') : ((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.safe') : 'Safe mode');
            if (quickModelEl) quickModelEl.textContent = (cfg && cfg.model && typeof cfg.model === 'string' && cfg.model.trim()) ? ((_t('editor.modelFmt') || 'Model: {model}').replace('{model}', cfg.model)) : _t('editor.modelUnset');
          } else {
            if (quickModeEl) quickModeEl.textContent = (typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.safe') : 'Safe mode';
            if (quickModelEl) quickModelEl.textContent = _t('editor.modelUnset');
          }
        }catch(_){
          if (quickModeEl) quickModeEl.textContent = (typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.safe') : 'Safe mode';
          if (quickModelEl) quickModelEl.textContent = 'Model: (unset)';
        }
        const quickSummaryEl = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizeSummary') : null;
        if (quickSummaryEl){
          const ps = (clip && clip.meta && clip.meta.agent && clip.meta.agent.patchSummary) || null;
          quickSummaryEl.textContent = ps ? _formatPatchTypeSummary(ps) : ((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.noResultYet') : '(no result yet)');
        }
      }catch(e){}
    },

    // PR-5: Update Rev/Parent labels and Undo Optimize button from current clip.
    modalUpdateEditorRevisionUI(){
      if (typeof document === 'undefined' || !$) return;
      const clipId = this.state.modal && this.state.modal.clipId;
      if (!clipId) return;
      const p2 = getProjectV2 && getProjectV2();
      const clip = (p2 && p2.clips && p2.clips[clipId]) ? p2.clips[clipId] : null;
      if (!clip) return;
      try{
        const revEl = $('#editorRevId');
        const parentEl = $('#editorParentRevId');
        const undoStatusEl = $('#editorUndoStatus');
        const undoBtn = $('#btnEditorUndoOptimize');
        if (revEl) revEl.textContent = _shortRev(clip.revisionId);
        if (parentEl) parentEl.textContent = _shortRev(clip.parentRevisionId);
        const canUndo = !!(clip.parentRevisionId && String(clip.parentRevisionId).trim());
        if (undoBtn) undoBtn.disabled = !canUndo;
        if (undoStatusEl) undoStatusEl.textContent = canUndo ? '' : 'No previous revision';
      }catch(e){}
    },

    // PR-5: Reload editor draft from current clip (e.g. after rollback); redraw and update revision/optimize UI.
    modalRefreshDraftFromClip(){
      if (typeof document === 'undefined' || !$) return;
      const clipId = this.state.modal && this.state.modal.clipId;
      if (!clipId) return;
      const p2 = getProjectV2 && getProjectV2();
      const bpm = (p2 && p2.bpm) ? p2.bpm : (this.project && this.project.bpm) ? this.project.bpm : 120;
      const clip = (p2 && p2.clips && p2.clips[clipId]) ? p2.clips[clipId] : null;
      if (!clip || !clip.score) return;
      try{
        let draftSec;
        if (_isBeatScore(clip.score)){
          try { draftSec = _scoreBeatToSec(clip.score, bpm); } catch(e){ draftSec = H2SProject.deepClone(clip.score); }
        } else {
          draftSec = H2SProject.deepClone(clip.score);
        }
        this.state.modal.draftScore = H2SProject.deepClone(draftSec);
        this.state.modal.savedScore = H2SProject.deepClone(draftSec);
        this.modalSyncGhostFromClipParent();
        this.modalUpdateRightPanel();
        this.modalResizeCanvasToContent();
        this.modalAutoScrollPitchToCenter && this.modalAutoScrollPitchToCenter();
        this.modalRequestDraw();
        this.modalUpdateEditorOptimizeUI();
        this.modalUpdateEditorRevisionUI();
      }catch(e){}
    },

    /** Keep ghost overlay aligned with current head's parent revision (same-session optimize / revision changes). */
    modalSyncGhostFromClipParent(){
      if (!this.state.modal || !this.state.modal.show) return;
      const clipId = this.state.modal.clipId;
      if (!clipId){
        this.state.modal.ghostScore = null;
        return;
      }
      try{
        const p2 = getProjectV2 && getProjectV2();
        const bpm = (p2 && p2.bpm) ? p2.bpm : (this.project && this.project.bpm) ? this.project.bpm : 120;
        this.state.modal.ghostScore = _ghostScoreFromClipParentRevision(p2, clipId, bpm);
      }catch(e){
        this.state.modal.ghostScore = null;
      }
    },

    modalRequestDraw(){
      // coalesce draws
      if (this.state.modal.raf) return;
      this.state.modal.raf = requestAnimationFrame(() => {
        this.state.modal.raf = 0;
        this.modalDraw();
      });
    },

    modalDraw(){
      if (!this.state.modal.show){
        if (this._h2sOpenPerf && this._h2sOpenPerf.pendingFirstDraw) this._h2sOpenPerf = null;
        return;
      }
      if (_h2sDevPerfTimingEnabled() && this._h2sDragPerf){
        const _dm = this.state.modal.mode;
        if (_dm === 'drag_note' || _dm === 'resize_note' || _dm === 'drag_velocity' || _dm === 'resize_velocity_lane'){
          this._h2sDragPerf.modalDrawCount = (this._h2sDragPerf.modalDrawCount || 0) + 1;
        }
      }
      if (_h2sDevPerfTimingEnabled() && this.state.modal.isPlaying){
        this._playbackPerfModalDrawCount = (this._playbackPerfModalDrawCount || 0) + 1;
      }
      const _openPerfFirstDraw = !!(this._h2sOpenPerf && this._h2sOpenPerf.pendingFirstDraw);
      let _drawEnter = 0;
      if (_openPerfFirstDraw && typeof performance !== 'undefined'){
        const op = this._h2sOpenPerf;
        const tAfter = op.tAfterRequestDraw;
        op.rafDelayMs = (typeof tAfter === 'number') ? (performance.now() - tAfter) : 0;
        _drawEnter = performance.now();
      }
      const _perf = _h2sDevPerfTimingEnabled();
      const _perfT0 = _perf && typeof performance !== 'undefined' ? performance.now() : 0;
      let _mark = _perfT0;
      function _split(){
        if (!_perf || typeof performance === 'undefined') return 0;
        const t = performance.now();
        const d = t - _mark;
        _mark = t;
        return d;
      }
      const canvas = $('#canvas');
      const ctx = canvas.getContext('2d');
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const msScoreStats = _split();

      // Determine pitch window
      const pitchWin = this.modalPitchWindow();
      const pitchMin = pitchWin.pitchMin;
      const pitchMax = pitchWin.pitchMax;

      const padL = (H2SEditorCoords && H2SEditorCoords.padL) ? H2SEditorCoords.padL(this.state.modal) : this.state.modal.padL;
      const padT = (H2SEditorCoords && H2SEditorCoords.padT) ? H2SEditorCoords.padT(this.state.modal) : this.state.modal.padT;

      // row height
      // We keep a stable row height (controlled by pitch zoom) and vary how many
      // rows we display in no-scroll mode.
      const totalRows = (pitchMax - pitchMin + 1);
      const rowH = Math.max(10, Number(this.state.modal.rowH) || 16);

      // background
      ctx.clearRect(0,0,canvas.width,canvas.height);
      // fill gradient
      const g = ctx.createLinearGradient(0,0,0,canvas.height);
      g.addColorStop(0,'rgba(255,255,255,.02)');
      g.addColorStop(1,'rgba(0,0,0,.20)');
      ctx.fillStyle = g;
      ctx.fillRect(0,0,canvas.width,canvas.height);

      // grid
      const pxPerSec = this.modalEffectivePxPerSec();
      const Coords = H2SEditorCoords;
      const gridSec = this.modalSnapSec() || (60/(this.project.bpm||120))/4; // fallback 1/16
      const gridPx = gridSec * pxPerSec;

      // vertical rows
      for (let i=0; i<=totalRows; i++){
        const y = padT + i * rowH + 0.5;
        ctx.strokeStyle = (i % 12 === 0) ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.06)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // time grid
      const startX = padL;
      const endX = canvas.width;
      let k = 0;
      for (let x = startX; x <= endX; x += gridPx){
        const strong = (k % 4 === 0);
        ctx.strokeStyle = strong ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.06)';
        ctx.beginPath();
        ctx.moveTo(Math.floor(x)+0.5, 0);
        ctx.lineTo(Math.floor(x)+0.5, canvas.height);
        ctx.stroke();
        k += 1;
      }

      // labels (left)
      ctx.fillStyle = 'rgba(255,255,255,.65)';
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      for (let p = pitchMax; p >= pitchMin; p--){
        const y = padT + (pitchMax - p) * rowH;
        if (p % 12 === 0){
          ctx.fillText(H2SProject.midiToName(p), 10, y + rowH - 4);
        }
      }

      // selected cell highlight
      if (this.state.modal.selectedCell){
        const cell = this.state.modal.selectedCell;
        if (cell.pitch >= pitchMin && cell.pitch <= pitchMax){
          const x = Coords ? Coords.timeToX(cell.startSec, this.state.modal) : (padL + cell.startSec * pxPerSec);
          const y = Coords ? Coords.pitchToY(cell.pitch, this.state.modal, pitchMin, pitchMax) : (padT + (pitchMax - cell.pitch) * rowH);
          ctx.fillStyle = 'rgba(59,130,246,.10)';
          ctx.fillRect(x, y, gridPx, rowH);
          ctx.strokeStyle = 'rgba(96,165,250,.35)';
          ctx.strokeRect(x+0.5, y+0.5, gridPx-1, rowH-1);
        }
      }
      const msGridBg = _split();

      // notes
      // ghost overlay (faint fill; skip while notes are selected to avoid false "all highlighted" look)
      const selCount = (this.state.modal.selection && this.state.modal.selection.noteRefs)
        ? this.state.modal.selection.noteRefs.length : 0;
      if (this.state.modal.ghostScore && !selCount){
        const gnotes = [];
        const gscore = this.state.modal.ghostScore;
        if (gscore && gscore.tracks){
          for (const gt of gscore.tracks){
            for (const gn of (gt.notes || [])) gnotes.push(gn);
          }
        }
        ctx.save();
        ctx.lineWidth = 1;
        for (const n of gnotes){
          if (n.pitch < pitchMin || n.pitch > pitchMax) continue;
          const x = Coords ? Coords.timeToX(n.start, this.state.modal) : (padL + n.start * pxPerSec);
          const y = Coords ? Coords.pitchToY(n.pitch, this.state.modal, pitchMin, pitchMax) : (padT + (pitchMax - n.pitch) * rowH + 1);
          const w = Coords ? Math.max(6, Number(n.duration) * Coords.effectivePxPerSec(this.state.modal)) : Math.max(6, n.duration * pxPerSec);
          const h = rowH - 2;
          const gx = x - 1.5;
          const gy = y - 1.5;
          const gw = w + 3;
          const gh = h + 3;
          ctx.beginPath(); // isolate each ghost so fill/stroke apply once (no alpha stacking)
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          roundRect(ctx, gx, gy, gw, gh, 7);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
      const msGhost = _split();

      this.modalSyncLegacySelectionFromRefs();
      const scoreForDraw = this.state.modal.draftScore;
      let notesCount = 0;
      if (scoreForDraw && scoreForDraw.tracks){
        for (const tr0 of scoreForDraw.tracks){
          notesCount += (tr0 && tr0.notes ? tr0.notes.length : 0);
        }
      }
      const msModalAllNotes = _split();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.beginPath(); // reset path so blue fill/stroke don't repaint ghost rects
      const drawNoteRect = (n, selected) => {
        if (n.pitch < pitchMin || n.pitch > pitchMax) return;
        const x = Coords ? Coords.timeToX(n.start, this.state.modal) : (padL + n.start * pxPerSec);
        const y = Coords ? Coords.pitchToY(n.pitch, this.state.modal, pitchMin, pitchMax) : (padT + (pitchMax - n.pitch) * rowH + 1);
        const w = Coords ? Math.max(6, Number(n.duration) * Coords.effectivePxPerSec(this.state.modal)) : Math.max(6, n.duration * pxPerSec);
        const h = rowH - 2;
        ctx.beginPath(); // each note is its own path — otherwise fill/stroke repaint every prior rect
        if (selected){
          ctx.fillStyle = 'rgba(249, 115, 22, 0.98)';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          roundRect(ctx, x - 1, y - 1, w + 2, h + 2, 6);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(37, 99, 235, 0.88)';
          ctx.strokeStyle = 'rgba(30, 64, 175, 0.95)';
          ctx.lineWidth = 1;
          roundRect(ctx, x, y, w, h, 6);
          ctx.fill();
          ctx.stroke();
        }
        const handles = this.modalResizeZoneWidths(w);
        ctx.fillStyle = selected ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.18)';
        ctx.fillRect(x, y, handles.left, h);
        ctx.fillRect(x + w - handles.right, y, handles.right, h);
      };
      const drawAllNotes = () => {
        if (!scoreForDraw || !scoreForDraw.tracks) return;
        for (const tr of scoreForDraw.tracks){
          if (!tr) continue;
          const tid = String(tr.id != null ? tr.id : '');
          const trackNotes = tr.notes || [];
          for (let ni = 0; ni < trackNotes.length; ni++){
            const n = trackNotes[ni];
            if (!n) continue;
            if (!this.modalIsNoteRefSelected(n.id, tid, ni)){
              drawNoteRect(n, false);
            }
          }
        }
        for (const tr of scoreForDraw.tracks){
          if (!tr) continue;
          const tid = String(tr.id != null ? tr.id : '');
          const trackNotes = tr.notes || [];
          for (let ni = 0; ni < trackNotes.length; ni++){
            const n = trackNotes[ni];
            if (!n) continue;
            if (this.modalIsNoteRefSelected(n.id, tid, ni)){
              drawNoteRect(n, true);
            }
          }
        }
      };
      drawAllNotes();
      const msNoteBodies = _split();

      // playhead (cursor) — when playing, overlay div is used; avoid double playhead
      if (!this.state.modal.isPlaying){
        const cx = Coords ? Coords.timeToX(this.state.modal.cursorSec, this.state.modal) : (padL + this.state.modal.cursorSec * pxPerSec);
        ctx.strokeStyle = 'rgba(239,68,68,.95)';
        ctx.beginPath();
        ctx.moveTo(Math.floor(cx)+0.5, 0);
        ctx.lineTo(Math.floor(cx)+0.5, canvas.height);
        ctx.stroke();
      }

      // top text
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`Cursor: ${fmtSec(this.state.modal.cursorSec)} (click empty grid to move; click note to select)`, 10, 14);
      const msCanvasTail = _split();

      this.modalDrawVelocityLane();
      const msVelocityLane = _split();
      this.modalUpdateMarqueeOverlay();

      // Skip right-panel stats during active drag/resize/velocity interactions (hot path).
      // Next draw after pointerup runs with mode 'none' and refreshes the panel.
      const _m = this.state.modal.mode;
      const _skipRightPanel =
        _m === 'drag_note' || _m === 'resize_note' || _m === 'drag_velocity' || _m === 'resize_velocity_lane';
      if (!_skipRightPanel){
        if (_openPerfFirstDraw && typeof performance !== 'undefined'){
          const _rp0 = performance.now();
          this.modalUpdateRightPanel();
          if (this._h2sOpenPerf) this._h2sOpenPerf.rightPanelInFirstDrawMs = performance.now() - _rp0;
        } else {
          this.modalUpdateRightPanel();
        }
      }
      const msRightPanel = _split();

      if (_openPerfFirstDraw && typeof performance !== 'undefined' && this._h2sOpenPerf){
        const op = this._h2sOpenPerf;
        op.firstDrawTotalMs = performance.now() - _drawEnter;
        op.pendingFirstDraw = false;
        const t0 = op.t0;
        const tAsp = op.tAfterScorePrep;
        const tBrp = op.tBeforeRightPanel;
        console.log('[H2S perf] openClipEditor (one-time)', {
          clipId: op.clipId,
          scorePrepMs: (typeof tAsp === 'number' && typeof t0 === 'number') ? Number((tAsp - t0).toFixed(3)) : null,
          uiPrepMs: (typeof tBrp === 'number' && typeof tAsp === 'number') ? Number((tBrp - tAsp).toFixed(3)) : null,
          rightPanelFirstMs: Number((op.rightPanelFirstMs || 0).toFixed(3)),
          resizeCanvasMs: Number((op.resizeCanvasMs || 0).toFixed(3)),
          autoScrollMs: Number((op.autoScrollMs || 0).toFixed(3)),
          velocitySyncMs: Number((op.velocitySyncMs || 0).toFixed(3)),
          requestDrawScheduleMs: Number((op.requestDrawScheduleMs || 0).toFixed(3)),
          rafDelayMs: Number((op.rafDelayMs || 0).toFixed(3)),
          bindControlsMs: Number((op.bindControlsMs || 0).toFixed(3)),
          optimizeUiMs: Number((op.optimizeUiMs || 0).toFixed(3)),
          openSyncTotalMs: Number((op.openSyncTotalMs || 0).toFixed(3)),
          firstDrawTotalMs: Number((op.firstDrawTotalMs || 0).toFixed(3)),
          rightPanelInFirstDrawMs: Number((op.rightPanelInFirstDrawMs || 0).toFixed(3)),
          endToEndMs: Number((performance.now() - t0).toFixed(3)),
        });
        this._h2sOpenPerf = null;
      }

      if (_perf && typeof performance !== 'undefined' && !_openPerfFirstDraw){
        const total = performance.now() - _perfT0;
        console.log('[H2S perf] modalDraw phases (ms)', {
          total: Number(total.toFixed(3)),
          scoreStats: Number(msScoreStats.toFixed(3)),
          gridBg: Number(msGridBg.toFixed(3)),
          ghostNotes: Number(msGhost.toFixed(3)),
          modalAllNotes: Number(msModalAllNotes.toFixed(3)),
          noteBodies: Number(msNoteBodies.toFixed(3)),
          canvasTail: Number(msCanvasTail.toFixed(3)),
          velocityLane: Number(msVelocityLane.toFixed(3)),
          rightPanel: Number(msRightPanel.toFixed(3)),
          notesCount: notesCount,
        });
      }
    },

    modalDrawVelocityLane(){
      if (!this.state.modal.show) return;
      if (!!this.state.modal.velocityLaneCollapsed) return;
      const vCanvas = $('#velocityCanvas');
      if (!vCanvas) return;

      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
      const cssW = this.state.modal.velocityLaneCssW != null ? this.state.modal.velocityLaneCssW : 1200;
      const cssH = this.state.modal.velocityLaneCssH != null ? this.state.modal.velocityLaneCssH : 48;

      vCanvas.style.width = cssW + 'px';
      vCanvas.style.height = cssH + 'px';
      vCanvas.width = Math.round(cssW * dpr);
      vCanvas.height = Math.round(cssH * dpr);

      const ctx = vCanvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#12161c';
      ctx.fillRect(0, 0, cssW, cssH);

      const padL = this.state.modal.padL;
      const pxPerSec = this.modalEffectivePxPerSec();
      const laneH = cssH;
      const padV = 4;
      const drawH = Math.max(4, laneH - padV);
      const scoreForVel = this.state.modal.draftScore;

      const clampBarW = (x) => H2SProject.clamp(x, 6, 14);
      if (scoreForVel && scoreForVel.tracks){
        for (const tr of scoreForVel.tracks){
          if (!tr) continue;
          const tid = String(tr.id != null ? tr.id : '');
          const trackNotes = tr.notes || [];
          for (let ni = 0; ni < trackNotes.length; ni++){
            const n = trackNotes[ni];
            if (!n) continue;
            const vel = H2SProject.clamp(Math.round(Number(n.velocity) ?? 100), 1, 127);
            const noteX = padL + n.start * pxPerSec;
            const noteW = n.duration * pxPerSec;
            const barW = clampBarW(Math.max(0, noteW - 2));
            const barX = noteX + (noteW - barW) / 2;
            const barHeight = (vel / 127) * drawH;
            const barY = laneH - barHeight - padV / 2;
            const selected = this.modalIsNoteRefSelected(n.id, tid, ni);
            ctx.beginPath();
            ctx.fillStyle = selected ? 'rgba(249, 115, 22, 0.98)' : 'rgba(37, 99, 235, 0.68)';
            ctx.strokeStyle = selected ? '#ffffff' : 'rgba(30, 64, 175, 0.65)';
            ctx.lineWidth = selected ? 2 : 1;
            roundRect(ctx, barX, barY, barW, Math.max(2, barHeight), 4);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      const lbl = $('#velocityLaneLabel');
      if (lbl){
        let v = null;
        const m = this.state.modal;
        const selId = m.selectedNoteId;
        if (m.mode === 'drag_velocity' && m.drag.noteId){
          const found = this.modalFindNoteById(m.drag.noteId);
          if (found) v = H2SProject.clamp(Math.round(Number(found.note.velocity) ?? 100), 1, 127);
        } else if (selId){
          const found = this.modalFindNoteById(selId);
          if (found) v = H2SProject.clamp(Math.round(Number(found.note.velocity) ?? 100), 1, 127);
        }
        lbl.textContent = v != null ? ('Vel: ' + v) : 'Vel: —';
      }
    },

    modalAllNotes(){
      const score = this.state.modal.draftScore;
      const out = [];
      if (!score || !score.tracks) return out;
      for (const t of score.tracks){
        if (!t) continue;
        const notes = t.notes || [];
        for (let ni = 0; ni < notes.length; ni++){
          const n = notes[ni];
          if (n) {
            n._trackId = String(t.id != null ? t.id : '');
            n._noteIndex = ni;
          }
          out.push(n);
        }
      }
      return out;
    },

    modalFindNoteById(id, trackId){
      const score = this.state.modal.draftScore;
      if (!score || !score.tracks) return null;
      for (const t of score.tracks){
        if (trackId && String(t.id) !== String(trackId)) continue;
        const idx = (t.notes || []).findIndex(n => n && n.id === id);
        if (idx >= 0) return { track:t, note:t.notes[idx], index: idx };
      }
      return null;
    },

    modalResizeZoneWidths(noteWidthPx){
      const w = Math.max(1, Number(noteWidthPx) || 1);
      const MIN_EDGE = 2;
      const MAX_EDGE = 10;
      const TARGET_MOVE = 6;
      let edge = Math.floor((w - TARGET_MOVE) / 2);
      edge = H2SProject.clamp(edge, MIN_EDGE, MAX_EDGE);
      // Keep at least 1px center move zone for very narrow notes.
      if ((edge * 2) >= w) edge = Math.max(1, Math.floor((w - 1) / 2));
      return { left: edge, right: edge };
    },

    modalEffectivePxPerSec(){
      const m = this.state.modal;
      if (H2SEditorCoords && typeof H2SEditorCoords.effectivePxPerSec === 'function'){
        return H2SEditorCoords.effectivePxPerSec(m);
      }
      const base = m && m.pxPerSec != null ? Number(m.pxPerSec) : 180;
      const tz = m && m.timeZoom != null ? Number(m.timeZoom) : 1;
      return base * (isFinite(tz) && tz > 0 ? tz : 1);
    },

    modalPitchWindow(){
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      if (H2SEditorCoords && typeof H2SEditorCoords.resolvePitchWindow === 'function'){
        return H2SEditorCoords.resolvePitchWindow(this.state.modal, st);
      }
      const m = this.state.modal;
      const useVScroll = !!m.usePitchVScroll;
      if (useVScroll) return { pitchMin: 0, pitchMax: 127, useVScroll: true };
      const rows = m.pitchViewRows != null ? Number(m.pitchViewRows) : 36;
      const range = st.maxPitch - st.minPitch + 1;
      let pitchMin;
      let pitchMax;
      if (range <= rows){
        const pad = 2;
        pitchMin = Math.max(0, st.minPitch - pad);
        pitchMax = Math.min(127, st.maxPitch + pad);
      } else {
        const half = Math.floor(rows / 2);
        const c = m.pitchCenter != null ? Number(m.pitchCenter) : 60;
        pitchMin = H2SProject.clamp(c - half, 0, 127 - rows);
        pitchMax = pitchMin + rows;
      }
      return { pitchMin, pitchMax, useVScroll: false };
    },

    modalSyncLegacySelectionFromRefs(){
      const sel = this.state.modal.selection;
      let refs = sel && Array.isArray(sel.noteRefs) ? sel.noteRefs : [];
      if (H2SEditorSelection && typeof H2SEditorSelection.normalizeNoteRefs === 'function' && refs.length){
        const score = this.state.modal.draftScore;
        refs = H2SEditorSelection.normalizeNoteRefs(score, refs);
        if (sel) sel.noteRefs = refs;
      }
      if (H2SEditorSelection && typeof H2SEditorSelection.buildSelectionHighlightSet === 'function'){
        this.state.modal._selectionHighlightKeys = H2SEditorSelection.buildSelectionHighlightSet(refs);
      } else {
        this.state.modal._selectionHighlightKeys = null;
      }
      if (!refs.length){
        this.state.modal.selectedNoteId = null;
        this.state.modal.selectedNoteIds = null;
        return;
      }
      if (refs.length === 1){
        this.state.modal.selectedNoteId = refs[0].noteId;
        this.state.modal.selectedNoteIds = null;
        return;
      }
      this.state.modal.selectedNoteId = refs[0].noteId;
      this.state.modal.selectedNoteIds = refs.map((r) => String(r.noteId));
    },

    modalEnsureDraftScoreNoteIds(){
      const score = this.state.modal.draftScore;
      if (!score || !H2SProject || typeof H2SProject.ensureScoreIds !== 'function') return;
      const needsFix = H2SEditorSelection
        && typeof H2SEditorSelection.scoreHasDuplicateNoteIds === 'function'
        && H2SEditorSelection.scoreHasDuplicateNoteIds(score);
      if (needsFix){
        try { H2SProject.ensureScoreIds(score); } catch(_e){}
        const refs = this.state.modal.selection && this.state.modal.selection.noteRefs;
        if (refs && refs.length && H2SEditorSelection.normalizeNoteRefs){
          this.state.modal.selection.noteRefs = H2SEditorSelection.normalizeNoteRefs(score, refs);
        }
      }
    },

    modalIsNoteRefSelected(noteId, trackId, noteIndex){
      if (noteIndex == null || noteIndex === '') return false;
      const tid = String(trackId != null ? trackId : '');
      const ni = Number(noteIndex);
      const keys = this.state.modal._selectionHighlightKeys;
      if (keys && keys.size){
        if (H2SEditorSelection && typeof H2SEditorSelection.selectionHighlightKey === 'function'){
          if (keys.has(H2SEditorSelection.selectionHighlightKey(tid, ni))) return true;
        } else if (keys.has(tid + '\0i:' + String(ni))){
          return true;
        }
      }
      const refs = (this.state.modal.selection && this.state.modal.selection.noteRefs) || [];
      for (let i = 0; i < refs.length; i++){
        const r = refs[i];
        if (!r || String(r.trackId) !== tid) continue;
        if (r.noteIndex != null && r.noteIndex !== '' && Number(r.noteIndex) === ni) return true;
      }
      return false;
    },

    modalCanvasPointFromEvent(ev){
      const canvas = $('#canvas');
      const gridWrap = $('.editorGridWrap');
      if (H2SEditorCoords && typeof H2SEditorCoords.eventToCanvasPx === 'function'){
        return H2SEditorCoords.eventToCanvasPx(ev, canvas, gridWrap);
      }
      if (!canvas || !ev) return { px: 0, py: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width ? (canvas.width / rect.width) : 1;
      const scaleY = rect.height ? (canvas.height / rect.height) : 1;
      return {
        px: (ev.clientX - rect.left) * scaleX,
        py: (ev.clientY - rect.top) * scaleY,
      };
    },

    modalUpdateSelectionUI(){
      this.modalSyncLegacySelectionFromRefs();
      if (typeof document === 'undefined' || !$) return;
      const refs = (this.state.modal.selection && this.state.modal.selection.noteRefs) || [];
      const kv = $('#kvClipSelection');
      if (kv) {
        const n = refs.length;
        const fmt = n === 1 ? _t('editor.selectionCountOne') : _t('editor.selectionCount');
        kv.textContent = (fmt || '{n}').replace('{n}', String(n));
      }
      const hasSel = refs.length > 0;
      const hasClip = !!(H2SEditorSelection && refs.length);
      const copyBtn = $('#btnEditorCopyNotes');
      const pasteBtn = $('#btnEditorPasteNotes');
      const extractBtn = $('#btnEditorExtractClip');
      const dupBtn = $('#btnEditorDuplicateClip');
      if (copyBtn) copyBtn.disabled = !hasSel;
      if (pasteBtn) pasteBtn.disabled = !this.state.modal.noteClipboard;
      if (extractBtn) extractBtn.disabled = !hasClip;
      if (dupBtn) dupBtn.disabled = !hasClip;
      const tool = (this.state.modal.selection && this.state.modal.selection.tool) || 'pointer';
      const ptrBtn = $('#btnEditorToolPointer');
      const marBtn = $('#btnEditorToolMarquee');
      if (ptrBtn) ptrBtn.classList.toggle('primary', tool === 'pointer');
      if (marBtn) marBtn.classList.toggle('primary', tool === 'marquee');
    },

    modalUpdateTimeZoomLabel(){
      if (typeof document === 'undefined' || !$) return;
      const tz = this.state.modal.timeZoom != null ? Number(this.state.modal.timeZoom) : 1;
      const pill = $('#pillTimeZoom');
      if (pill) pill.textContent = Math.round((isFinite(tz) ? tz : 1) * 100) + '%';
    },

    modalApplyTimeZoomDelta(delta){
      const Coords = H2SEditorCoords;
      const m = this.state.modal;
      const cur = m.timeZoom != null ? Number(m.timeZoom) : 1;
      const next = Coords && typeof Coords.clampTimeZoom === 'function'
        ? Coords.clampTimeZoom(cur + delta)
        : Math.max(0.25, Math.min(4, cur + delta));
      if (Math.abs(next - cur) < 0.001) return;
      const canvas = $('#canvas');
      const gridWrap = $('.editorGridWrap');
      if (Coords && gridWrap && canvas && typeof Coords.scrollLeftForZoomAnchor === 'function'){
        const rect = canvas.getBoundingClientRect();
        const anchorX = rect.left + gridWrap.clientWidth / 2;
        gridWrap.scrollLeft = Coords.scrollLeftForZoomAnchor(gridWrap, m, anchorX, canvas, next);
      }
      m.timeZoom = next;
      try { localStorage.setItem('h2s_editor_time_zoom', String(next)); } catch(_e){}
      this.modalUpdateTimeZoomLabel();
      this.modalResizeCanvasToContent();
      this.modalRequestDraw();
    },

    modalFitTimeWidth(){
      const Coords = H2SEditorCoords;
      const gridWrap = $('.editorGridWrap');
      const st = H2SProject.scoreStats(this.state.modal.draftScore);
      const span = Math.max(4, st.spanSec);
      if (!Coords || !gridWrap) return;
      const next = Coords.timeZoomForFitSpan(span, gridWrap.clientWidth, this.state.modal);
      this.state.modal.timeZoom = next;
      try { localStorage.setItem('h2s_editor_time_zoom', String(next)); } catch(_e){}
      this.modalUpdateTimeZoomLabel();
      gridWrap.scrollLeft = 0;
      this.modalResizeCanvasToContent();
      this.modalRequestDraw();
    },

    modalSetSelectionTool(tool){
      if (!this.state.modal.selection) this.state.modal.selection = { noteRefs: [], tool: 'pointer' };
      this.state.modal.selection.tool = tool === 'marquee' ? 'marquee' : 'pointer';
      this.modalUpdateSelectionUI();
    },

    modalUpdateMarqueeOverlay(){
      if (typeof document === 'undefined' || !$) return;
      const overlay = $('#editorMarqueeOverlay');
      const canvas = $('#canvas');
      if (!overlay || !canvas) return;
      const mq = this.state.modal.marquee;
      if (!mq){
        overlay.classList.remove('show');
        overlay.style.cssText = '';
        return;
      }
      const x0 = Math.min(mq.x0, mq.x1);
      const y0 = Math.min(mq.y0, mq.y1);
      const x1 = Math.max(mq.x0, mq.x1);
      const y1 = Math.max(mq.y0, mq.y1);
      const cssW = canvas.clientWidth || canvas.width;
      const cssH = canvas.clientHeight || canvas.height;
      const scaleX = canvas.width ? cssW / canvas.width : 1;
      const scaleY = canvas.height ? cssH / canvas.height : 1;
      overlay.classList.add('show');
      overlay.style.left = (x0 * scaleX) + 'px';
      overlay.style.top = (y0 * scaleY) + 'px';
      overlay.style.width = Math.max(1, (x1 - x0) * scaleX) + 'px';
      overlay.style.height = Math.max(1, (y1 - y0) * scaleY) + 'px';
    },

    modalLoadAutoSplitPanel(){
      if (!H2SClipAutoSplit || typeof H2SClipAutoSplit.loadPrefs !== 'function') return;
      if (typeof document === 'undefined' || !$) return;
      const prefs = H2SClipAutoSplit.loadPrefs();
      const chkPhrase = $('#chkAutoSplitPhrase');
      const chkPitch = $('#chkAutoSplitPitchRange');
      const chkBar = $('#chkAutoSplitBar');
      const inpGap = $('#inpAutoSplitGap');
      const inpMax = $('#inpAutoSplitMaxDur');
      if (chkPhrase) chkPhrase.checked = prefs.splitByPhrase !== false;
      if (chkPitch) chkPitch.checked = !!prefs.splitByPitchRange;
      if (chkBar) chkBar.checked = !!prefs.splitByBar;
      if (inpGap) inpGap.value = String(prefs.minGapSec);
      if (inpMax) inpMax.value = String(prefs.maxDurationSec);
    },

    modalSaveAutoSplitPrefsFromPanel(){
      if (!H2SClipAutoSplit || typeof H2SClipAutoSplit.savePrefs !== 'function') return null;
      const chkPhrase = $('#chkAutoSplitPhrase');
      const chkPitch = $('#chkAutoSplitPitchRange');
      const chkBar = $('#chkAutoSplitBar');
      const inpGap = $('#inpAutoSplitGap');
      const inpMax = $('#inpAutoSplitMaxDur');
      const prefs = {
        splitByPhrase: !!(chkPhrase && chkPhrase.checked),
        minGapSec: inpGap ? Number(inpGap.value) : H2SClipAutoSplit.DEFAULT_PREFS.minGapSec,
        maxDurationSec: inpMax ? Number(inpMax.value) : H2SClipAutoSplit.DEFAULT_PREFS.maxDurationSec,
        splitByPitchRange: !!(chkPitch && chkPitch.checked),
        splitByBar: !!(chkBar && chkBar.checked),
        maxBarsPerSegment: H2SClipAutoSplit.DEFAULT_PREFS.maxBarsPerSegment,
        suppressWeakFragments: H2SClipAutoSplit.DEFAULT_PREFS.suppressWeakFragments,
      };
      H2SClipAutoSplit.savePrefs(prefs);
      return prefs;
    },

    modalSaveDraftToClip(){
      const clipId = this.state.modal.clipId;
      const clip = _findClip(this.project, clipId);
      if (!clip) return false;
      const p2b = ((typeof getProjectV2 === 'function') ? getProjectV2() : null) || null;
      const bpm = (p2b && p2b.bpm) ? p2b.bpm : (this.project && this.project.bpm ? this.project.bpm : 120);
      const wantsBeatNow = !!(p2b && (p2b.timebase === 'beat' || Number(p2b.version) === 2));
      const storeAsBeat = !!(wantsBeatNow || this.state.modal._sourceClipWasBeat || this.state.modal._projectWantsBeat || _isBeatScore(clip.score));
      if (storeAsBeat){
        const draftSec = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
        let scoreBeat = _scoreSecToBeat(draftSec, bpm);
        clip.score = scoreBeat;
        _recomputeClipMetaFromBeatScore(clip, scoreBeat);
        if (wantsBeatNow && p2b && p2b.clips && p2b.clips[clipId]){
          try{
            p2b.clips[clipId].score = scoreBeat;
            _recomputeClipMetaFromBeatScore(p2b.clips[clipId], scoreBeat);
          }catch(_e){}
        }
        if (typeof commitV2 === 'function'){
          let p2save = null;
          try { p2save = getProjectV2(); } catch(_e){ p2save = p2b; }
          if (p2save) commitV2(p2save, 'editor_save');
          else persist();
        } else persist();
      } else {
        clip.score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
        const st = H2SProject.scoreStats(clip.score);
        clip.meta = Object.assign({}, clip.meta || {}, { notes: st.count, pitchMin: st.minPitch, pitchMax: st.maxPitch, spanSec: st.spanSec });
        persist();
      }
      this.state.modal.savedScore = H2SProject.deepClone(this.state.modal.draftScore);
      this.state.modal.dirty = false;
      this.render();
      return true;
    },

    modalCaptureEditorUndo(label, extra){
      if (this._editorUndoRestoring) return;
      const Undo = (typeof window !== 'undefined' && window.H2SProjectLastUndo) ? window.H2SProjectLastUndo : null;
      if (!Undo || typeof Undo.capture !== 'function') return;
      const m = this.state.modal;
      if (!m || !m.show || !m.draftScore) return;
      const ui = {
        selection: m.selection ? H2SProject.deepClone(m.selection) : { noteRefs: [], tool: 'pointer' },
        selectedNoteId: m.selectedNoteId != null ? m.selectedNoteId : null,
        selectedNoteIds: m.selectedNoteIds ? H2SProject.deepClone(m.selectedNoteIds) : null,
        selectedCell: m.selectedCell ? H2SProject.deepClone(m.selectedCell) : null,
        cursorSec: m.cursorSec,
      };
      const meta = { label: label || 'editor_edit', ui };
      if (extra && extra.mergeKey != null) meta.mergeKey = String(extra.mergeKey);
      Undo.capture('editor', m.draftScore, meta);
    },

    modalUndoLastEdit(){
      const Undo = (typeof window !== 'undefined' && window.H2SProjectLastUndo) ? window.H2SProjectLastUndo : null;
      if (!Undo || typeof Undo.consume !== 'function') return false;
      const slot = Undo.consume('editor');
      if (!slot || !slot.snapshot) return false;
      const _t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k, fb) => (fb != null ? fb : k);
      this._editorUndoRestoring = true;
      try {
        this.state.modal.draftScore = H2SProject.deepClone(slot.snapshot);
        if (slot.ui) {
          const ui = slot.ui;
          this.state.modal.selection = ui.selection
            ? H2SProject.deepClone(ui.selection)
            : ((H2SEditorSelection && H2SEditorSelection.emptySelection) ? H2SEditorSelection.emptySelection() : { noteRefs: [], tool: 'pointer' });
          this.state.modal.selectedNoteId = ui.selectedNoteId != null ? ui.selectedNoteId : null;
          this.state.modal.selectedNoteIds = ui.selectedNoteIds ? H2SProject.deepClone(ui.selectedNoteIds) : null;
          this.state.modal.selectedCell = ui.selectedCell ? H2SProject.deepClone(ui.selectedCell) : null;
          if (ui.cursorSec != null && Number.isFinite(Number(ui.cursorSec))) this.state.modal.cursorSec = Number(ui.cursorSec);
        }
        const saved = this.state.modal.savedScore;
        this.state.modal.dirty = !!(saved && JSON.stringify(this.state.modal.draftScore) !== JSON.stringify(saved));
        this.modalSyncLegacySelectionFromRefs();
        this.modalUpdateSelectionUI();
        this.modalRequestDraw();
        const remaining = (Undo.depth && typeof Undo.depth === 'function') ? Undo.depth('editor') : 0;
        try {
          const msg = remaining > 0
            ? _t('editor.undoDoneMore', 'Undid. {n} more step(s) available.').replace(/\{n\}/g, String(remaining))
            : _t('editor.undoDone', 'Undid last note edit.');
          $('#editorStatus').textContent = msg;
        } catch(_e){}
      } finally {
        this._editorUndoRestoring = false;
      }
      return true;
    },

    modalCopySelection(){
      if (!H2SEditorSelection) return;
      const refs = this.state.modal.selection && this.state.modal.selection.noteRefs;
      if (!refs || !refs.length) return;
      const extracted = H2SEditorSelection.extractNotesToScore(this.state.modal.draftScore, this.state.modal.selection);
      if (!extracted || !extracted.score) return;
      this.state.modal.noteClipboard = H2SProject.deepClone(extracted.score);
      this.modalUpdateSelectionUI();
      try { $('#editorStatus').textContent = (_t('editor.statusCopied') || 'Copied {n} note(s).').replace('{n}', String(refs.length)); } catch(_e){}
    },

    modalPasteNotes(){
      const clip = this.state.modal.noteClipboard;
      if (!clip || !clip.tracks) return;
      this.modalCaptureEditorUndo('paste_notes');
      const score = this.state.modal.draftScore;
      if (!score || !Array.isArray(score.tracks) || !score.tracks.length) return;
      const cursor = Number(this.state.modal.cursorSec || 0);
      const pastedRefs = [];
      for (const srcTr of clip.tracks){
        const destTr = score.tracks.find((t) => t && String(t.id) === String(srcTr.id)) || score.tracks[0];
        if (!destTr.notes) destTr.notes = [];
        for (const n of (srcTr.notes || [])){
          const newId = (H2SProject && typeof H2SProject.uid === 'function') ? H2SProject.uid('n_') : ('n_' + Math.random().toString(16).slice(2, 10));
          const copy = {
            id: newId,
            pitch: n.pitch,
            start: cursor + Number(n.start || 0),
            duration: n.duration,
            velocity: n.velocity,
          };
          destTr.notes.push(copy);
          pastedRefs.push({ trackId: String(destTr.id), noteId: newId, noteIndex: destTr.notes.length - 1 });
        }
        destTr.notes.sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
      }
      this.state.modal.selection = { noteRefs: pastedRefs, tool: (this.state.modal.selection && this.state.modal.selection.tool) || 'pointer' };
      this.modalSyncLegacySelectionFromRefs();
      this.state.modal.dirty = true;
      this.modalUpdateSelectionUI();
      this.modalRequestDraw();
      try { $('#editorStatus').textContent = (_t('editor.statusPasted') || 'Pasted {n} note(s).').replace('{n}', String(pastedRefs.length)); } catch(_e){}
    },

    modalDuplicateSelectionToNewClip(){
      if (!H2SEditorSelection) return;
      const app = this._runtimeApp();
      if (!app) return;
      const refs = this.state.modal.selection && this.state.modal.selection.noteRefs;
      if (!refs || !refs.length) return;
      const clipId = this.state.modal.clipId;
      const extracted = H2SEditorSelection.extractNotesToScore(this.state.modal.draftScore, this.state.modal.selection, {
        preserveStart: true,
        singleTrack: true,
      });
      if (!extracted || !extracted.score) return;
      const srcClip = _findClip(this.project, clipId);
      const baseName = (srcClip && srcClip.name) ? String(srcClip.name) + ' (selection)' : 'Selection';
      const placement = _resolveSourceClipPlacement(this.project, clipId, app);
      const placeTrackIndex = placement.trackIndex + 1;
      _ensureTimelineTrackIndex(app, placeTrackIndex);
      if (typeof app._materializeScoreDocToTimeline === 'function'){
        app._materializeScoreDocToTimeline(H2SProject.ensureScoreIds(extracted.score), {
          baseName,
          placeStartSec: placement.startSec,
          placeTrackIndex,
          forceSingleClip: true,
        });
      }
      try { $('#editorStatus').textContent = _t('editor.statusDuplicateClip'); } catch(_e){}
    },

    modalExtractSelectionToNewClip(){
      if (!H2SEditorSelection) return;
      const app = this._runtimeApp();
      if (!app) return;
      const refs = this.state.modal.selection && this.state.modal.selection.noteRefs;
      if (!refs || !refs.length) return;
      if (this.state.modal.dirty){
        const ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
          ? window.confirm(_t('editor.confirmExtractSave'))
          : true;
        if (!ok) return;
        if (!this.modalSaveDraftToClip()) return;
      }
      const clipId = this.state.modal.clipId;
      const extracted = H2SEditorSelection.extractNotesToScore(this.state.modal.draftScore, this.state.modal.selection, {
        preserveStart: true,
        singleTrack: true,
      });
      if (!extracted || !extracted.score) return;
      const srcClip = _findClip(this.project, clipId);
      const baseName = (srcClip && srcClip.name) ? String(srcClip.name) + ' (extract)' : 'Extract';
      const placement = _resolveSourceClipPlacement(this.project, clipId, app);
      const placeTrackIndex = placement.trackIndex + 1;
      _ensureTimelineTrackIndex(app, placeTrackIndex);
      this.modalCaptureEditorUndo('extract_notes');
      this.state.modal.draftScore = H2SEditorSelection.removeSelectedNotesFromScore(this.state.modal.draftScore, this.state.modal.selection);
      this.state.modal.selection = H2SEditorSelection.emptySelection();
      this.modalSyncLegacySelectionFromRefs();
      this.state.modal.dirty = true;
      this.modalSaveDraftToClip();
      if (typeof app._materializeScoreDocToTimeline === 'function'){
        app._materializeScoreDocToTimeline(H2SProject.ensureScoreIds(extracted.score), {
          baseName,
          placeStartSec: placement.startSec,
          placeTrackIndex,
          forceSingleClip: true,
        });
      }
      this.modalUpdateSelectionUI();
      this.modalResizeCanvasToContent();
      this.modalRequestDraw();
      try { $('#editorStatus').textContent = _t('editor.statusExtractClip'); } catch(_e){}
    },

    modalAutoSplitCurrentClip(){
      if (!H2SClipAutoSplit) return;
      const app = this._runtimeApp();
      if (!app) return;
      const clipId = this.state.modal.clipId;
      const clip = _findClip(this.project, clipId);
      if (!clip) return;
      if (this.state.modal.dirty){
        const ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
          ? window.confirm(_t('editor.confirmSplitSave'))
          : true;
        if (!ok) return;
        this.modalSaveDraftToClip();
      }
      const prefs = this.modalSaveAutoSplitPrefsFromPanel() || H2SClipAutoSplit.loadPrefs();
      const p2b = getProjectV2 && getProjectV2();
      const bpm = (p2b && p2b.bpm) ? p2b.bpm : (this.project && this.project.bpm ? this.project.bpm : 120);
      let scoreForSplit = clip.score;
      if (_isBeatScore(clip.score)){
        try { scoreForSplit = _scoreBeatToSec(clip.score, bpm); } catch(_e){ scoreForSplit = H2SProject.deepClone(clip.score); }
      } else {
        scoreForSplit = H2SProject.deepClone(clip.score);
      }
      scoreForSplit = H2SProject.ensureScoreIds(scoreForSplit);
      const plan = H2SClipAutoSplit.planClipSegments(scoreForSplit, prefs);
      if (!plan || plan.length <= 1){
        try { $('#editorStatus').textContent = _t('editor.statusNoSplitNeeded'); } catch(_e){}
        return;
      }
      const Preview = (typeof window !== 'undefined') ? window.H2SClipSplitPreview : null;
      let confirmMsg = (_t('editor.confirmSplitClip') || '').replace('{n}', String(plan.length));
      if (Preview && typeof Preview.summarizePlan === 'function' && typeof Preview.formatPlanSummaryText === 'function'){
        const summary = Preview.summarizePlan(plan, H2SProject);
        confirmMsg = confirmMsg + '\n\n' + Preview.formatPlanSummaryText(summary);
      }
      const okSplit = (typeof window !== 'undefined' && typeof window.confirm === 'function')
        ? window.confirm(confirmMsg)
        : true;
      if (!okSplit) return;
      this.closeModal(false);
      if (typeof app.autoSplitClipById === 'function'){
        app.autoSplitClipById(clipId, { skipConfirm: true, prefs, captureUndo: true });
        try { $('#editorStatus').textContent = (_t('editor.statusSplitDone') || '').replace('{n}', String(plan.length)); } catch(_e){}
        return;
      }
      const baseName = (clip.name || 'Clip').replace(/ · \d+$/, '').replace(/ \(extract\)$/, '').replace(/ \(selection\)$/, '');
      const inst = (this.project.instances || []).find((x) => x && x.clipId === clipId);
      const playheadSec = inst ? Number(inst.startSec || 0) : Number(this.project.ui.playheadSec || 0);
      const placeTrackIndex = inst ? Math.floor(Number(inst.trackIndex) || 0) : (typeof app.resolveDefaultPlacementTrackIndex === 'function' ? app.resolveDefaultPlacementTrackIndex() : 0);
      this.project.instances = (this.project.instances || []).filter((i) => i && i.clipId !== clipId);
      this.project.clips = (this.project.clips || []).filter((c) => c && c.id !== clipId);
      persist();
      if (typeof app._materializeScoreDocToTimeline === 'function'){
        app._materializeScoreDocToTimeline(scoreForSplit, {
          autoSplit: true,
          baseName,
          playheadSec,
          placeTrackIndex,
          prefs,
        });
      }
      try { $('#editorStatus').textContent = (_t('editor.statusSplitDone') || '').replace('{n}', String(plan.length)); } catch(_e2){}
    },

    modalBindClipEditControlsV1(){
      if (!this.__isBrowser) return;
      const g = (typeof window !== 'undefined') ? window : global;
      if (g && g.__h2s_clip_edit_controls_v1) return;
      if (g) g.__h2s_clip_edit_controls_v1 = true;
      const doc = document;
      const bind = (id, fn) => {
        const el = doc.getElementById(id);
        if (!el) return;
        el.addEventListener('click', (ev) => {
          ev.preventDefault();
          const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
          if (!rt) return;
          fn.call(rt, ev);
        });
      };
      bind('btnEditorToolPointer', function(){ this.modalSetSelectionTool('pointer'); });
      bind('btnEditorToolMarquee', function(){ this.modalSetSelectionTool('marquee'); });
      bind('btnEditorTimeZoomIn', function(){ this.modalApplyTimeZoomDelta(0.15); });
      bind('btnEditorTimeZoomOut', function(){ this.modalApplyTimeZoomDelta(-0.15); });
      bind('btnEditorTimeFitWidth', function(){ this.modalFitTimeWidth(); });
      bind('btnEditorCopyNotes', function(){ this.modalCopySelection(); });
      bind('btnEditorPasteNotes', function(){ this.modalPasteNotes(); });
      bind('btnEditorExtractClip', function(){ this.modalExtractSelectionToNewClip(); });
      bind('btnEditorDuplicateClip', function(){ this.modalDuplicateSelectionToNewClip(); });
      bind('btnEditorAutoSplitNow', function(){ this.modalAutoSplitCurrentClip(); });
      ['chkAutoSplitPhrase', 'chkAutoSplitPitchRange', 'chkAutoSplitBar', 'inpAutoSplitGap', 'inpAutoSplitMaxDur'].forEach((id) => {
        const el = doc.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
          const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
          if (rt && typeof rt.modalSaveAutoSplitPrefsFromPanel === 'function') rt.modalSaveAutoSplitPrefsFromPanel();
        });
      });
    },


    // ---- Insert/Delete note controls (buttons + keyboard) ----
    modalBindControls(){
      if (!this.__isBrowser) return;

      // Use a global guard because EditorRuntime instances can be recreated on re-render.
      const g = (typeof window !== 'undefined') ? window : global;
      if (g && g.__h2s_editor_controls_bound) return;
      if (g) g.__h2s_editor_controls_bound = true;

      // Store handler refs on global so we can de-dup even if runtime is recreated.
      g.__h2s_editor_handlers = g.__h2s_editor_handlers || {};
      const H = g.__h2s_editor_handlers;

      const getBtn = (ids) => {
        for (const id of ids){
          const el = (typeof document !== 'undefined') ? document.getElementById(id) : null;
          if (el) return el;
        }
        return null;
      };

      // PR-6d: disable/enable all optimize controls during async action; null-safe
      const setOptimizeControlsDisabled = (disabled) => {
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc) return;
        const ids = ['editorOptimizePreset', 'editorOptimizePrompt', 'btnEditorOptimize', 'btnEditorRegenerateOptimize', 'btnEditorUndoOptimize', 'btnEditorResetOptimizePrompt', 'editorQuickOptimizePreset', 'btnEditorQuickOptimize', 'qoptFixPitch', 'qoptTightenRhythm', 'qoptReduceOutliers'];
        for (const id of ids) {
          const el = doc.getElementById(id);
          if (!el) continue;
          if (id === 'editorOptimizePrompt') el.readOnly = !!disabled;
          else el.disabled = !!disabled;
        }
      };
      // PR-B2-min: Read intent + preset + prompt from Quick Optimize UI for setOptimizeOptions
      const enforceSingleQuickOptimizeSelection = (changedId) => {
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc) return;
        const ids = ['qoptFixPitch', 'qoptTightenRhythm', 'qoptReduceOutliers'];
        if (changedId){
          const changed = doc.getElementById(changedId);
          if (changed && changed.checked){
            for (const id of ids){
              if (id === changedId) continue;
              const el = doc.getElementById(id);
              if (el) el.checked = false;
            }
            return;
          }
        }
        // Canonicalize externally-set states (e.g. templates or stored options).
        const firstChecked = ids.find((id) => {
          const el = doc.getElementById(id);
          return !!(el && el.checked);
        });
        if (!firstChecked) return;
        for (const id of ids){
          if (id === firstChecked) continue;
          const el = doc.getElementById(id);
          if (el) el.checked = false;
        }
      };
      const readOptimizeOptionsFromUI = () => {
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc) return { requestedPresetId: null, userPrompt: null, intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: false }, plan: null, _assistantExecutionPlanSnapshot: null };
        enforceSingleQuickOptimizeSelection();
        const sel = doc.getElementById('editorOptimizePreset') || doc.getElementById('editorQuickOptimizePreset');
        const promptEl = doc.getElementById('editorOptimizePrompt');
        const fixPitch = doc.getElementById('qoptFixPitch');
        const tightenRhythm = doc.getElementById('qoptTightenRhythm');
        const reduceOutliers = doc.getElementById('qoptReduceOutliers');
        const presetId = (sel && sel.value) ? String(sel.value).trim() : null;
        const promptRaw = (promptEl && promptEl.value != null) ? String(promptEl.value) : '';
        const promptVal = (promptRaw.trim() !== '') ? promptRaw.trim() : null;
        const intent = {
          fixPitch: !!(fixPitch && fixPitch.checked),
          tightenRhythm: !!(tightenRhythm && tightenRhythm.checked),
          reduceOutliers: !!(reduceOutliers && reduceOutliers.checked)
        };
        const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
        const rt = (g && g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
        const app = (g && g.H2SApp) ? g.H2SApp : null;
        const clipId = rt && rt.state.modal && rt.state.modal.clipId;
        let templateId = (rt && rt._selectedTemplateId != null && String(rt._selectedTemplateId).trim()) ? String(rt._selectedTemplateId).trim() : null;
        if (!templateId && clipId && app && typeof app.getOptimizeOptions === 'function') {
          const stored = app.getOptimizeOptions(clipId);
          templateId = (stored && stored.templateId != null && String(stored.templateId).trim()) ? String(stored.templateId).trim() : null;
        }
        let velocityShapeNoteIds = null;
        const modal = rt && rt.state && rt.state.modal;
        if (modal && modal.selection && Array.isArray(modal.selection.noteRefs) && modal.selection.noteRefs.length){
          velocityShapeNoteIds = modal.selection.noteRefs.map(function(r){ return String(r.noteId); });
        } else if (modal){
          if (modal.selectedNoteIds && modal.selectedNoteIds.length >= 2){
            velocityShapeNoteIds = modal.selectedNoteIds.slice().map(function(id){ return String(id); });
          } else if (modal.selectedNoteId){
            velocityShapeNoteIds = [String(modal.selectedNoteId)];
          }
        }
        return {
          requestedPresetId: presetId || null,
          userPrompt: promptVal,
          intent,
          templateId: templateId || null,
          velocityShapeNoteIds,
          localTransposeNoteIds: velocityShapeNoteIds,
          rhythmNoteIds: velocityShapeNoteIds,
          plan: null,
          _assistantExecutionPlanSnapshot: null,
        };
      };
      const setEditorOptStatus = (text) => {
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc) return;
        const el = doc.getElementById('editorOptStatus');
        if (el) el.textContent = text || '';
      };
      const setEditorOptimizeDetailsVisible = (visible) => {
        if (typeof document === 'undefined') return;
        const btns = [
          document.getElementById('btnEditorOptimizeDetails'),
          document.getElementById('btnEditorOptimizeDetailsStatus'),
        ];
        for (const btn of btns){
          if (!btn) continue;
          if (visible) btn.classList.remove('hidden');
          else btn.classList.add('hidden');
        }
      };
      const updateEditorOptimizeDetailsVisibilityFromClip = (clipId, clip) => {
        const app = (typeof globalThis !== 'undefined' && globalThis.H2SApp) ? globalThis.H2SApp : null;
        const snap = app && app._lastOptimizeSnapshot ? app._lastOptimizeSnapshot : null;
        const snapHasRes = !!(snap && snap.res && snap.clipId != null);
        const hasResult = snapHasRes
          || !!(clip && clip.meta && clip.meta.agent && clip.meta.agent.patchSummary);
        setEditorOptimizeDetailsVisible(hasResult);
      };
      const openLastOptimizeDetailsFromEditor = () => {
        try {
          const app = (typeof globalThis !== 'undefined' && globalThis.H2SApp) ? globalThis.H2SApp : null;
          if (app && typeof app._openLastOptimizeDetails === 'function'){
            app._openLastOptimizeDetails();
            return;
          }
          if (typeof document !== 'undefined'){
            const btn = document.getElementById('btnLastOptimizeDetails');
            if (btn && typeof btn.click === 'function') btn.click();
          }
        } catch (_e) {}
      };
      // PR-B4b: Actionable quality gate message (model-unset hint when applicable).
      const getQualityGateFailureMessage = (forStatus) => {
        let modelHint = '';
        try {
          const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG && typeof globalThis.H2S_LLM_CONFIG.loadLlmConfig === 'function') ? globalThis.H2S_LLM_CONFIG : null;
          if (api) {
            const cfg = api.loadLlmConfig();
            const m = (cfg && cfg.model != null) ? String(cfg.model).trim() : '';
            if (!m) modelHint = 'Model is unset — open Advanced → LLM Settings to choose a model. ';
          }
        } catch (_) {}
        const t = (typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
        const base = t('opt.lowQualityVelocityOnly');
        if (forStatus) return modelHint + t('opt.lowQualityShort');
        return modelHint + base;
      };
      const getFriendlyRejectionMessage = (reason, detail, forStatus) => {
        const t = (typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
        const reasonStr = (reason != null && typeof reason === 'string') ? reason.trim() : '';
        const detailStr = (detail != null && typeof detail === 'string') ? detail.trim() : '';
        if (reasonStr !== 'patch_rejected') return '';
        if (detailStr === 'quality_velocity_only') return getQualityGateFailureMessage(forStatus);
        const map = {
          'no meaningful outlier cleanup': 'opt.rejectDetail.noMeaningfulOutlierCleanup',
          'too aggressive cleanup': 'opt.rejectDetail.tooAggressiveCleanup',
          'missing pitch change for Fix Pitch': 'opt.rejectDetail.missingPitchChangeFixPitch',
          'missing timing change for Tighten Rhythm': 'opt.rejectDetail.missingTimingChangeTightenRhythm',
          'pitch change too broad for Fix Pitch': 'opt.rejectDetail.pitchChangeTooBroadFixPitch',
          'quality_velocity_only': 'opt.rejectDetail.qualityVelocityOnly',
        };
        const key = map[detailStr];
        if (key){
          const mapped = t(key);
          if (mapped !== key) return mapped;
        }
        return detailStr || '';
      };
      // PR-7b-3: Map llm_v0 internal failure reasons to user-friendly text (UI layer only).
      const llmFriendlyReason = (reason) => {
        const r = (reason != null && typeof reason === 'string') ? reason : '';
        if (/llm_config_missing|llm_client_not_loaded/i.test(r)) return 'Please configure Base URL and Model in Advanced → LLM Settings.';
        if (/unsupported_request/i.test(r)) return 'This optimize request is not supported here.';
        if (/truncated_generation|finish_reason_length/i.test(r)) {
          const msg = t('lastOpt.fail.truncated_generation');
          return msg !== 'lastOpt.fail.truncated_generation' ? msg : 'AI output was truncated, so nothing was applied. Retry, or choose a shorter clip.';
        }
        if (/llm_no_valid_json/i.test(r)) return 'LLM response did not contain a valid JSON patch.';
        if (/quality_velocity_only/i.test(r)) return getQualityGateFailureMessage(true);
        if (/request input is too large|request is too large|413/i.test(r)) return 'The AI request is too large. Try selecting a shorter clip or clearing assistant history.';
        if (/patch_rejected|ops_not_array|op\[/.test(r)) return 'Patch validation failed (LLM output not accepted).';
        if (/timeout|request timeout/i.test(r)) return 'LLM request timed out.';
        if (/401|403|Unauthorized/i.test(r)) return 'Unauthorized (check token).';
        if (/404|not found/i.test(r)) return 'Endpoint not found (check Base URL).';
        if (r) return r;
        return 'LLM optimize failed.';
      };
      // PR-8G: Mode label for llm_v0 status (read from stored LLM config; no new persistence).
      const getLlmModeLabel = (presetId) => {
        if (presetId !== 'llm_v0') return '';
        try {
          const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG && typeof globalThis.H2S_LLM_CONFIG.loadLlmConfig === 'function') ? globalThis.H2S_LLM_CONFIG : null;
          if (!api) return '';
          const cfg = api.loadLlmConfig();
          const safeMode = (cfg && typeof cfg.velocityOnly === 'boolean') ? cfg.velocityOnly : true;
          const t = (typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') ? window.I18N.t.bind(window.I18N) : function(k){ return k; };
          return safeMode ? (' [' + t('opt.safe') + ']') : (' [' + t('opt.full') + ']');
        } catch (_) { return ''; }
      };
      const statusFromResult = (res, clip, presetId) => {
        if (!res) return '';
        if (res.ok) {
          const ps = clip && clip.meta && clip.meta.agent && clip.meta.agent.patchSummary;
          const preset = (ps && (ps.executedPreset || ps.executedSource)) ? String(ps.executedPreset || ps.executedSource) : '';
          const promptSrc = (ps && ps.executedUserPromptSource) ? String(ps.executedUserPromptSource) : 'default';
          if (preset === 'llm_v0') {
            const modeLabel = getLlmModeLabel('llm_v0');
            const byOp = (ps && ps.byOp && typeof ps.byOp === 'object') ? ps.byOp : {};
            const opTypes = Object.keys(byOp).filter(function(k){ return byOp[k] > 0; }).join(', ') || 'setNote';
            const ops = res.ops ?? 0;
            let line = 'ok, ops=' + ops + ' (' + opTypes + ')' + modeLabel;
            const cfg = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG && typeof globalThis.H2S_LLM_CONFIG.loadLlmConfig === 'function') ? globalThis.H2S_LLM_CONFIG.loadLlmConfig() : null;
            const safeMode = (cfg && typeof cfg.velocityOnly === 'boolean') ? cfg.velocityOnly : true;
            if (safeMode) line += ' ' + ((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.velocityOnly') : 'velocity-only');
            return line;
          }
          return 'ok, ops=' + (res.ops ?? 0) + ' (preset=' + preset + ', prompt=' + promptSrc + ')';
        }
        if (presetId === 'llm_v0') {
          const detail = (res.detail != null && typeof res.detail === 'string') ? res.detail : '';
          const isSafeModeRejection = res.reason === 'patch_rejected' && (detail.indexOf('disallowed_op') >= 0 || detail.indexOf('disallowed_field') >= 0);
          const friendlyRejection = getFriendlyRejectionMessage(res.reason, detail, true);
          let msg;
          if (isSafeModeRejection) msg = 'Safe mode rejected non-velocity changes. Turn off Safe mode to allow pitch/timing edits.';
          else if (friendlyRejection) msg = friendlyRejection;
          else msg = llmFriendlyReason(res.reason);
          return 'failed: ' + msg + getLlmModeLabel('llm_v0');
        }
        const ps = res.patchSummary;
        if (ps && String(ps.executedPreset || '') === 'llm_v0') return 'failed: ' + llmFriendlyReason(res.reason) + getLlmModeLabel('llm_v0');
        return 'failed: ' + (res.reason || 'unknown');
      };

      const btnInsert = getBtn(['btnInsertNote','insertNoteBtn','btnInsertNoteBtn']);
      const btnDelete = getBtn(['btnDeleteNote','btnDeleteNoteBtn','deleteNoteBtn']);

      // Click: insert
      if (btnInsert){
        if (!H.onInsertClick){
          H.onInsertClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              // Guard against duplicate click events in the same tick.
              const now = Date.now();
              if (H._lastInsertAt && (now - H._lastInsertAt) < 30) return;
              H._lastInsertAt = now;
              // Use the latest runtime instance (H2SApp.editorRt) if available.
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              rt.modalInsertNote();
            }catch(e){}
          };
        }
        btnInsert.removeEventListener('click', H.onInsertClick, true);
        btnInsert.addEventListener('click', H.onInsertClick, true);
      }

      // Click: delete
      if (btnDelete){
        if (!H.onDeleteClick){
          H.onDeleteClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              rt.modalDeleteSelectedNote();
            }catch(e){}
          };
        }
        btnDelete.removeEventListener('click', H.onDeleteClick, true);
        btnDelete.addEventListener('click', H.onDeleteClick, true);
      }

      // PR-4/PR-6b/PR-6d: Click Optimize — read preset + prompt, persist, run (no override), show result, disable during run
      const btnOptimize = getBtn(['btnEditorOptimize', 'editorOptimizeBtn']);
      const btnEditorOptimizeDetails = (typeof document !== 'undefined') ? document.getElementById('btnEditorOptimizeDetails') : null;
      const btnEditorOptimizeDetailsStatus = (typeof document !== 'undefined') ? document.getElementById('btnEditorOptimizeDetailsStatus') : null;
      const btnEditorOptimizeDetailsDebug = (typeof document !== 'undefined') ? document.getElementById('btnEditorOptimizeDetailsDebug') : null;
      const bindEditorOptimizeDetailsClick = (btn) => {
        if (!btn) return;
        if (!H.onEditorOptimizeDetailsClick){
          H.onEditorOptimizeDetailsClick = (ev) => {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (_e) {}
            openLastOptimizeDetailsFromEditor();
          };
        }
        btn.removeEventListener('click', H.onEditorOptimizeDetailsClick, true);
        btn.addEventListener('click', H.onEditorOptimizeDetailsClick, true);
      };
      bindEditorOptimizeDetailsClick(btnEditorOptimizeDetails);
      bindEditorOptimizeDetailsClick(btnEditorOptimizeDetailsStatus);
      bindEditorOptimizeDetailsClick(btnEditorOptimizeDetailsDebug);
      if (btnOptimize){
        if (!H.onOptimizeClick){
          H.onOptimizeClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              const clipId = rt.state.modal && rt.state.modal.clipId;
              if (!clipId) return;
              const app = g.H2SApp;
              if (!app || typeof app.optimizeClip !== 'function') return;
              const opts = readOptimizeOptionsFromUI();
              if (app.setOptimizeOptions) app.setOptimizeOptions(opts, clipId);
              const presetId = opts.requestedPresetId;
              setEditorOptStatus('running...');
              setOptimizeControlsDisabled(true);
              Promise.resolve(app.optimizeClip(clipId)).then(function(res){
                if (res && res.ok && (res.ops != null && res.ops > 0)){
                  rt.modalRefreshDraftFromClip();
                } else {
                  try{ rt.modalUpdateEditorOptimizeUI(); rt.modalUpdateEditorRevisionUI(); }catch(e){}
                }
                const p2 = getProjectV2 && getProjectV2();
                const clip = (p2 && p2.clips && p2.clips[clipId]) ? p2.clips[clipId] : null;
                setEditorOptStatus(statusFromResult(res, clip, presetId));
                updateEditorOptimizeDetailsVisibilityFromClip(clipId, clip);
                const el = (typeof document !== 'undefined') ? document.getElementById('patchSummary') : null;
                if (el && clip && clip.meta && clip.meta.agent){
                  if (clip.meta.agent.patchSummary) el.textContent = JSON.stringify(clip.meta.agent.patchSummary, null, 2);
                  else if (typeof clip.meta.agent.patchOps === 'number') el.textContent = JSON.stringify({ ops: clip.meta.agent.patchOps }, null, 2);
                }
                const ps = (res && res.patchSummary) || (clip && clip.meta && clip.meta.agent && clip.meta.agent.patchSummary);
                const summaryEl = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizeSummary') : null;
                if (summaryEl){
                  if (res && res.ok) summaryEl.textContent = _formatPatchTypeSummary(ps);
                  else if (res && res.reason === 'patch_rejected'){
                    const qgMsg = getFriendlyRejectionMessage(res.reason, res.detail, false) || llmFriendlyReason(res.reason);
                    const tmplMeta = ps && _formatPromptMetaSuffix(ps) ? _formatPromptMetaSuffix(ps) : '';
                    summaryEl.textContent = qgMsg + (tmplMeta ? (' | ' + tmplMeta) : '');
                  }
                  else summaryEl.textContent = ps && _formatPromptMetaSuffix(ps) ? (((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.noResultYet') : '(no result yet)') + ' | ' + _formatPromptMetaSuffix(ps)) : ((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.noResultYet') : '(no result yet)');
                }
                // PR-8C: Save LLM debug data if present (llm_v0 only)
                if (typeof saveLlmDebug === 'function' && presetId === 'llm_v0' && res && res.llmDebug){
                  saveLlmDebug(clipId, res.llmDebug);
                }
              }).catch(function(err){
                const selPreset = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePreset') : null;
                const presetIdErr = (selPreset && selPreset.value) ? String(selPreset.value).trim() : null;
                if (presetIdErr === 'llm_v0') setEditorOptStatus('failed: ' + llmFriendlyReason(err && err.message) + getLlmModeLabel('llm_v0'));
                else setEditorOptStatus('failed: ' + (err && err.message ? err.message : 'error'));
                const p2 = getProjectV2 && getProjectV2();
                const clip = (p2 && p2.clips && p2.clips[clipId]) ? p2.clips[clipId] : null;
                updateEditorOptimizeDetailsVisibilityFromClip(clipId, clip);
              }).finally(function(){ setOptimizeControlsDisabled(false); });
            }catch(e){}
          };
        }
        btnOptimize.removeEventListener('click', H.onOptimizeClick, true);
        btnOptimize.addEventListener('click', H.onOptimizeClick, true);
      }

      // Persist-on-edit: prompt textarea — update stored userPrompt on input/blur (bound once)
      const promptTextarea = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePrompt') : null;
      if (promptTextarea){
        if (!H.onPromptInputOrBlur){
          H.onPromptInputOrBlur = () => {
            try{
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
              const clipId = rt && rt.state.modal && rt.state.modal.clipId;
              if (!clipId) return;
              const app = g.H2SApp;
              if (!app || typeof app.setOptimizeOptions !== 'function') return;
              const opts = readOptimizeOptionsFromUI();
              app.setOptimizeOptions(opts, clipId);
            }catch(e){}
          };
        }
        promptTextarea.removeEventListener('input', H.onPromptInputOrBlur, true);
        promptTextarea.removeEventListener('blur', H.onPromptInputOrBlur, true);
        promptTextarea.addEventListener('input', H.onPromptInputOrBlur, true);
        promptTextarea.addEventListener('blur', H.onPromptInputOrBlur, true);
      }

      // PR-4/PR-6b: Preset dropdown change — store preset + current prompt per clip
      const selPreset = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePreset') : null;
      if (selPreset){
        if (!H.onPresetChange){
          H.onPresetChange = (ev) => {
            try{
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              const clipId = rt.state.modal && rt.state.modal.clipId;
              if (!clipId) return;
              const app = g.H2SApp;
              if (!app || typeof app.setOptimizeOptions !== 'function') return;
              const opts = readOptimizeOptionsFromUI();
              opts.requestedPresetId = (ev.target && ev.target.value) ? String(ev.target.value).trim() || null : null;
              app.setOptimizeOptions(opts, clipId);
            }catch(e){}
          };
        }
        selPreset.removeEventListener('change', H.onPresetChange);
        selPreset.addEventListener('change', H.onPresetChange);
      }

      // PR-B1: Quick Optimize — sync preset to main, reuse btnEditorOptimize (no new optimize path)
      const quickPresetSel = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizePreset') : null;
      const btnQuickOptimize = (typeof document !== 'undefined') ? document.getElementById('btnEditorQuickOptimize') : null;
      if (quickPresetSel){
        if (!H.onQuickPresetChange){
          H.onQuickPresetChange = (ev) => {
            try{
              const mainSel = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePreset') : null;
              const val = (ev.target && ev.target.value != null) ? String(ev.target.value) : '';
              if (mainSel){ mainSel.value = val; mainSel.dispatchEvent(new Event('change', { bubbles: true })); }
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
              if (rt && typeof rt.modalUpdateEditorOptimizeUI === 'function') rt.modalUpdateEditorOptimizeUI();
            }catch(e){}
          };
        }
        quickPresetSel.removeEventListener('change', H.onQuickPresetChange, true);
        quickPresetSel.addEventListener('change', H.onQuickPresetChange, true);
      }
      if (btnQuickOptimize){
        if (!H.onQuickOptimizeClick){
          H.onQuickOptimizeClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const quickSel = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizePreset') : null;
              const mainSel = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePreset') : null;
              const val = (quickSel && quickSel.value != null) ? String(quickSel.value) : '';
              if (mainSel){ mainSel.value = val; }
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
              const app = g.H2SApp;
              const clipId = rt && rt.state.modal && rt.state.modal.clipId;
              if (clipId && app && app.setOptimizeOptions) app.setOptimizeOptions(readOptimizeOptionsFromUI(), clipId);
              const btnOpt = (typeof document !== 'undefined') ? document.getElementById('btnEditorOptimize') : null;
              if (btnOpt) btnOpt.click();
            }catch(e){}
          };
        }
        btnQuickOptimize.removeEventListener('click', H.onQuickOptimizeClick, true);
        btnQuickOptimize.addEventListener('click', H.onQuickOptimizeClick, true);
      }

      // PR-E2: Template buttons — set templateId, intent, prompt, preset llm_v0; persist; no auto-run
      const templatesContainer = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizeTemplates') : null;
      if (templatesContainer && !H.onTemplateButtonClick){
        H.onTemplateButtonClick = (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-template-id]') : null;
          if (!btn) return;
          const templateId = btn.getAttribute('data-template-id');
          if (!templateId || !TEMPLATES_V1_UI[templateId]) return;
          const tmpl = TEMPLATES_V1_UI[templateId];
          const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
          const clipId = rt && rt.state.modal && rt.state.modal.clipId;
          if (!clipId) return;
          const app = g.H2SApp;
          if (!app || typeof app.setOptimizeOptions !== 'function') return;
          try {
            ev.preventDefault();
            ev.stopPropagation();
            const quickPresetEl = document.getElementById('editorQuickOptimizePreset');
            const mainPresetEl = document.getElementById('editorOptimizePreset');
            if (rt) rt._selectedTemplateId = templateId;
            _syncQuickOptimizeTemplateButtons(templateId);
            if (quickPresetEl) quickPresetEl.value = 'llm_v0';
            if (mainPresetEl) mainPresetEl.value = 'llm_v0';
            const fixPitchEl = document.getElementById('qoptFixPitch');
            const tightenRhythmEl = document.getElementById('qoptTightenRhythm');
            const reduceOutliersEl = document.getElementById('qoptReduceOutliers');
            if (fixPitchEl) fixPitchEl.checked = !!tmpl.intent.fixPitch;
            if (tightenRhythmEl) tightenRhythmEl.checked = !!tmpl.intent.tightenRhythm;
            if (reduceOutliersEl) reduceOutliersEl.checked = !!tmpl.intent.reduceOutliers;
            enforceSingleQuickOptimizeSelection();
            const promptEl = document.getElementById('editorOptimizePrompt');
            if (promptEl) promptEl.value = tmpl.seed || '';
            const opts = readOptimizeOptionsFromUI();
            opts.templateId = templateId;
            app.setOptimizeOptions(opts, clipId);
            const labelEl = document.getElementById('editorQuickOptimizeTemplateLabel');
            if (labelEl) labelEl.textContent = 'Template: ' + tmpl.label;
          } catch (e) {}
        };
      }
      if (templatesContainer && H.onTemplateButtonClick){
        templatesContainer.removeEventListener('click', H.onTemplateButtonClick, true);
        templatesContainer.addEventListener('click', H.onTemplateButtonClick, true);
      }

      // PR-B2-min: Intent checkboxes — persist on change (bound once)
      const intentCheckboxIds = ['qoptFixPitch', 'qoptTightenRhythm', 'qoptReduceOutliers'];
      const intentEls = intentCheckboxIds.map(function(id){
        return (typeof document !== 'undefined') ? document.getElementById(id) : null;
      }).filter(Boolean);
      if (intentEls.length > 0){
        // Always replace with a fresh handler bound to the current runtime closure.
        if (H.onIntentCheckboxChange){
          for (const el of intentEls){
            el.removeEventListener('change', H.onIntentCheckboxChange, true);
            el.removeEventListener('click', H.onIntentCheckboxChange, true);
          }
        }
        H.onIntentCheckboxChange = (ev) => {
          try{
            const changedId = ev && ev.target && ev.target.id ? String(ev.target.id) : null;
            enforceSingleQuickOptimizeSelection(changedId);
            const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
            const clipId = rt && rt.state.modal && rt.state.modal.clipId;
            if (!clipId) return;
            const app = g.H2SApp;
            if (!app || typeof app.setOptimizeOptions !== 'function') return;
            const opts = readOptimizeOptionsFromUI();
            app.setOptimizeOptions(opts, clipId);
          }catch(e){}
        };
        for (const el of intentEls){
          el.addEventListener('change', H.onIntentCheckboxChange, true);
          el.addEventListener('click', H.onIntentCheckboxChange, true);
        }
      }

      // PR-5/PR-6b/PR-6d: Undo Optimize (Rollback) — disable during run, refresh UI, status
      const btnUndo = getBtn(['btnEditorUndoOptimize', 'editorUndoOptimizeBtn']);
      if (btnUndo){
        if (!H.onUndoClick){
          H.onUndoClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              const clipId = rt.state.modal && rt.state.modal.clipId;
              if (!clipId) return;
              const app = g.H2SApp;
              if (!app || typeof app.rollbackClipRevision !== 'function') return;
              setEditorOptStatus('running...');
              setOptimizeControlsDisabled(true);
              try {
                const res = app.rollbackClipRevision(clipId);
                setEditorOptStatus(res && res.ok ? 'ok (rollback)' : ('failed: ' + (res && res.reason ? res.reason : 'Rollback failed')));
                if (res && res.ok && res.changed) rt.modalRefreshDraftFromClip();
              } finally {
                setOptimizeControlsDisabled(false);
              }
            }catch(e){ setEditorOptStatus('failed: ' + (e && e.message ? e.message : 'error')); setOptimizeControlsDisabled(false); }
          };
        }
        btnUndo.removeEventListener('click', H.onUndoClick, true);
        btnUndo.addEventListener('click', H.onUndoClick, true);
      }

      // PR-6b/PR-6d: Regenerate — one-shot override, disable during run, status from patchSummary
      const btnRegenerate = (typeof document !== 'undefined') ? document.getElementById('btnEditorRegenerateOptimize') : null;
      if (btnRegenerate){
        if (!H.onRegenerateClick){
          H.onRegenerateClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              const clipId = rt.state.modal && rt.state.modal.clipId;
              if (!clipId) return;
              const app = g.H2SApp;
              if (!app || typeof app.optimizeClip !== 'function') return;
              const opts = readOptimizeOptionsFromUI();
              if (app.setOptimizeOptions) app.setOptimizeOptions(opts, clipId);
              const presetId = opts.requestedPresetId;
              setEditorOptStatus('running...');
              setOptimizeControlsDisabled(true);
              Promise.resolve(app.optimizeClip(clipId, opts)).then(function(res){
                if (res && res.ok && (res.ops != null && res.ops > 0)){
                  rt.modalRefreshDraftFromClip();
                } else {
                  try{ rt.modalUpdateEditorOptimizeUI(); rt.modalUpdateEditorRevisionUI(); }catch(e){}
                }
                const p2 = getProjectV2 && getProjectV2();
                const clip = (p2 && p2.clips && p2.clips[clipId]) ? p2.clips[clipId] : null;
                setEditorOptStatus(statusFromResult(res, clip, presetId));
                updateEditorOptimizeDetailsVisibilityFromClip(clipId, clip);
                const ps = (res && res.patchSummary) || (clip && clip.meta && clip.meta.agent && clip.meta.agent.patchSummary);
                const summaryEl = (typeof document !== 'undefined') ? document.getElementById('editorQuickOptimizeSummary') : null;
                if (summaryEl){
                  if (res && res.ok) summaryEl.textContent = _formatPatchTypeSummary(ps);
                  else if (res && res.reason === 'patch_rejected'){
                    const qgMsg = getFriendlyRejectionMessage(res.reason, res.detail, false) || llmFriendlyReason(res.reason);
                    const tmplMeta = ps && _formatPromptMetaSuffix(ps) ? _formatPromptMetaSuffix(ps) : '';
                    summaryEl.textContent = qgMsg + (tmplMeta ? (' | ' + tmplMeta) : '');
                  }
                  else summaryEl.textContent = ps && _formatPromptMetaSuffix(ps) ? (((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.noResultYet') : '(no result yet)') + ' | ' + _formatPromptMetaSuffix(ps)) : ((typeof window !== 'undefined' && window.I18N && window.I18N.t) ? window.I18N.t('opt.noResultYet') : '(no result yet)');
                }
                // PR-8C: Save LLM debug data if present (llm_v0 only)
                if (typeof saveLlmDebug === 'function' && presetId === 'llm_v0' && res && res.llmDebug){
                  saveLlmDebug(clipId, res.llmDebug);
                }
              }).catch(function(err){
                const selPreset = (typeof document !== 'undefined') ? document.getElementById('editorOptimizePreset') : null;
                const presetIdErr = (selPreset && selPreset.value) ? String(selPreset.value).trim() : null;
                if (presetIdErr === 'llm_v0') setEditorOptStatus('failed: ' + llmFriendlyReason(err && err.message) + getLlmModeLabel('llm_v0'));
                else setEditorOptStatus('failed: ' + (err && err.message ? err.message : 'error'));
                const p2 = getProjectV2 && getProjectV2();
                const clip = (p2 && p2.clips && p2.clips[clipId]) ? p2.clips[clipId] : null;
                updateEditorOptimizeDetailsVisibilityFromClip(clipId, clip);
              }).finally(function(){ setOptimizeControlsDisabled(false); });
            }catch(e){}
          };
        }
        btnRegenerate.removeEventListener('click', H.onRegenerateClick, true);
        btnRegenerate.addEventListener('click', H.onRegenerateClick, true);
      }

      // PR-6b: Reset to default prompt — clear prompt UI and persist (preset unchanged)
      const btnResetPrompt = (typeof document !== 'undefined') ? document.getElementById('btnEditorResetOptimizePrompt') : null;
      if (btnResetPrompt){
        if (!H.onResetPromptClick){
          H.onResetPromptClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : this;
              const clipId = rt.state.modal && rt.state.modal.clipId;
              if (!clipId) return;
              const app = g.H2SApp;
              const promptEl = document.getElementById('editorOptimizePrompt');
              if (promptEl) promptEl.value = '';
              const opts = readOptimizeOptionsFromUI();
              opts.userPrompt = null;
              if (app && app.setOptimizeOptions) app.setOptimizeOptions(opts, clipId);
            }catch(e){}
          };
        }
        btnResetPrompt.removeEventListener('click', H.onResetPromptClick, true);
        btnResetPrompt.addEventListener('click', H.onResetPromptClick, true);
      }

      // PR-7a-3: LLM Settings Save — write to hum2song_studio_llm_config; show "Saved"
      const btnLlmSave = (typeof document !== 'undefined') ? document.getElementById('btnEditorLlmSave') : null;
      if (btnLlmSave){
        if (!H.onLlmSaveClick){
          H.onLlmSaveClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG) ? globalThis.H2S_LLM_CONFIG : null;
              if (!api || typeof api.saveLlmConfig !== 'function') return;
              const doc = typeof document !== 'undefined' ? document : null;
              if (!doc) return;
              const baseEl = doc.getElementById('editorLlmBaseUrl');
              const modelEl = doc.getElementById('editorLlmModel');
              const tokenEl = doc.getElementById('editorLlmAuthToken');
              const velocityOnlyEl = doc.getElementById('editorLlmVelocityOnly');
              const statusEl = doc.getElementById('editorLlmConfigStatus');
              const baseUrl = (baseEl && baseEl.value != null) ? String(baseEl.value) : '';
              const model = (modelEl && modelEl.value != null) ? String(modelEl.value) : '';
              const authToken = (tokenEl && tokenEl.value != null) ? String(tokenEl.value) : '';
              // PR-8D: Include velocityOnly checkbox value in save
              const velocityOnly = (velocityOnlyEl && velocityOnlyEl.checked === true) ? true : false;
              api.saveLlmConfig({ baseUrl: baseUrl, model: model, authToken: authToken, velocityOnly: velocityOnly });
              if (statusEl) statusEl.textContent = 'Saved';
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
              if (rt && typeof rt.modalUpdateEditorOptimizeUI === 'function') rt.modalUpdateEditorOptimizeUI();
            }catch(e){}
          };
        }
        btnLlmSave.removeEventListener('click', H.onLlmSaveClick, true);
        btnLlmSave.addEventListener('click', H.onLlmSaveClick, true);
      }

      // PR-7a-3: LLM Settings Reset — resetLlmConfig(); set inputs to runtime defaults; show "Config reset"
      const btnLlmReset = (typeof document !== 'undefined') ? document.getElementById('btnEditorLlmReset') : null;
      if (btnLlmReset){
        if (!H.onLlmResetClick){
          H.onLlmResetClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG) ? globalThis.H2S_LLM_CONFIG : null;
              if (!api || typeof api.resetLlmConfig !== 'function') return;
              const defaults = api.resetLlmConfig();
              const doc = typeof document !== 'undefined' ? document : null;
              if (doc){
                const baseEl = doc.getElementById('editorLlmBaseUrl');
                const modelEl = doc.getElementById('editorLlmModel');
                const tokenEl = doc.getElementById('editorLlmAuthToken');
                const velocityOnlyEl = doc.getElementById('editorLlmVelocityOnly');
                const modelSelectEl = doc.getElementById('editorLlmModelSelect');
                const statusEl = doc.getElementById('editorLlmConfigStatus');
                // PR-8J: Set inputs to runtime defaults (not empty)
                if (baseEl) baseEl.value = (defaults && typeof defaults.baseUrl === 'string') ? defaults.baseUrl : '';
                if (modelEl) modelEl.value = (defaults && typeof defaults.model === 'string') ? defaults.model : '';
                if (tokenEl) tokenEl.value = '';
                if (velocityOnlyEl) velocityOnlyEl.checked = (defaults && typeof defaults.velocityOnly === 'boolean') ? defaults.velocityOnly : true;
                if (modelSelectEl) modelSelectEl.value = '';
                if (statusEl) statusEl.textContent = 'Config reset';
              }
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
              if (rt && typeof rt.modalUpdateEditorOptimizeUI === 'function') rt.modalUpdateEditorOptimizeUI();
            }catch(e){}
          };
        }
        btnLlmReset.removeEventListener('click', H.onLlmResetClick, true);
        btnLlmReset.addEventListener('click', H.onLlmResetClick, true);
      }

      // PR-8J: Model select dropdown — selecting an option sets the text input value
      const modelSelectEl = (typeof document !== 'undefined') ? document.getElementById('editorLlmModelSelect') : null;
      if (modelSelectEl){
        if (!H.onLlmModelSelectChange){
          H.onLlmModelSelectChange = (ev) => {
            try{
              const doc = typeof document !== 'undefined' ? document : null;
              if (!doc) return;
              const modelEl = doc.getElementById('editorLlmModel');
              const selectedValue = (ev.target && ev.target.value) ? String(ev.target.value) : '';
              if (modelEl && selectedValue) modelEl.value = selectedValue;
            }catch(e){}
          };
        }
        modelSelectEl.removeEventListener('change', H.onLlmModelSelectChange, true);
        modelSelectEl.addEventListener('change', H.onLlmModelSelectChange, true);
      }

      // PR-8M: Gateway Preset select — auto-fill Base URL (and optional Model) without saving
      const gatewayPresetEl = (typeof document !== 'undefined') ? document.getElementById('editorLlmGatewayPreset') : null;
      if (gatewayPresetEl){
        if (!H.onLlmGatewayPresetChange){
          H.onLlmGatewayPresetChange = (ev) => {
            try{
              const doc = typeof document !== 'undefined' ? document : null;
              if (!doc) return;
              const baseEl = doc.getElementById('editorLlmBaseUrl');
              const modelEl = doc.getElementById('editorLlmModel');
              const val = (ev.target && ev.target.value) ? String(ev.target.value) : 'custom';
              if (val === 'deepseek'){
                if (baseEl) baseEl.value = 'https://api.deepseek.com/v1';
                if (modelEl){
                  const currentModel = (modelEl.value != null) ? String(modelEl.value).trim() : '';
                  if (!currentModel) modelEl.value = 'deepseek-chat';
                }
              } else if (val === 'ollama'){
                if (baseEl) baseEl.value = 'http://localhost:11434/v1';
              } else {
                // Custom: do not change existing values
              }
            }catch(e){}
          };
        }
        gatewayPresetEl.removeEventListener('change', H.onLlmGatewayPresetChange, true);
        gatewayPresetEl.addEventListener('change', H.onLlmGatewayPresetChange, true);
      }

      // PR-8C: Clear Debug — remove localStorage key and clear UI
      const btnLlmDebugClear = (typeof document !== 'undefined') ? document.getElementById('btnEditorLlmDebugClear') : null;
      if (btnLlmDebugClear){
        if (!H.onLlmDebugClearClick){
          H.onLlmDebugClearClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              if (typeof localStorage !== 'undefined'){
                try { localStorage.removeItem('hum2song_studio_llm_debug_last'); } catch(_){}
              }
              const doc = typeof document !== 'undefined' ? document : null;
              if (doc){
                const rawEl = doc.getElementById('editorLlmDebugRaw');
                const extractedEl = doc.getElementById('editorLlmDebugExtracted');
                const errorsEl = doc.getElementById('editorLlmDebugErrors');
                if (rawEl) rawEl.value = '';
                if (extractedEl) extractedEl.value = '';
                if (errorsEl) errorsEl.value = '';
              }
            }catch(e){}
          };
        }
        btnLlmDebugClear.removeEventListener('click', H.onLlmDebugClearClick, true);
        btnLlmDebugClear.addEventListener('click', H.onLlmDebugClearClick, true);
      }

      // PR-7b-3: Test Connection — ping gateway with current inputs; show friendly status (no revision, no secrets).
      const btnLlmTest = (typeof document !== 'undefined') ? document.getElementById('btnEditorLlmTest') : null;
      if (btnLlmTest){
        if (!H.onLlmTestClick){
          H.onLlmTestClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const doc = typeof document !== 'undefined' ? document : null;
              if (!doc) return;
              const testStatusEl = doc.getElementById('editorLlmTestStatus');
              const setTestStatus = (txt) => { if (testStatusEl) testStatusEl.textContent = txt || ''; };
              const api = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CONFIG) ? globalThis.H2S_LLM_CONFIG : null;
              const client = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CLIENT) ? globalThis.H2S_LLM_CLIENT : null;
              if (!api || typeof api.loadLlmConfig !== 'function' || !client || typeof client.callChatCompletions !== 'function'){
                setTestStatus(_t('editor.llmConfigNotLoaded'));
                return;
              }
              const baseEl = doc.getElementById('editorLlmBaseUrl');
              const modelEl = doc.getElementById('editorLlmModel');
              const tokenEl = doc.getElementById('editorLlmAuthToken');
              const baseUrl = (baseEl && baseEl.value != null) ? String(baseEl.value).trim() : '';
              const model = (modelEl && modelEl.value != null) ? String(modelEl.value).trim() : '';
              const authToken = (tokenEl && tokenEl.value != null) ? String(tokenEl.value) : '';
              if (!baseUrl || !model){
                setTestStatus(_t('editor.pleaseSetBaseUrlAndModel'));
                return;
              }
              setTestStatus('Testing...');
              const cfg = { baseUrl: baseUrl, model: model, authToken: authToken };
              const messages = [
                { role: 'system', content: 'Reply with exactly: ok' },
                { role: 'user', content: 'ping' },
              ];
              client.callChatCompletions(cfg, messages, { timeoutMs: 8000 })
                .then(function(){
                  setTestStatus('Connection OK');
                })
                .catch(function(err){
                  const msg = (err && err.message) ? String(err.message) : '';
                  if (/401|403|Unauthorized/i.test(msg)) setTestStatus(_t('editor.unauthorized'));
                  else if (/404|not found/i.test(msg)) setTestStatus(_t('editor.endpointNotFound'));
                  else if (/timeout|request timeout/i.test(msg)) setTestStatus(_t('editor.timeout'));
                  else setTestStatus('Connection failed');
                });
            }catch(e){}
          };
        }
        btnLlmTest.removeEventListener('click', H.onLlmTestClick, true);
        btnLlmTest.addEventListener('click', H.onLlmTestClick, true);
      }

      // PR-8I: Load Models — GET /v1/models, populate datalist (no Save required; use editorLlmModelLoadStatus only).
      const btnLlmLoadModels = (typeof document !== 'undefined') ? document.getElementById('btnEditorLlmLoadModels') : null;
      if (btnLlmLoadModels){
        if (!H.onLlmLoadModelsClick){
          H.onLlmLoadModelsClick = (ev) => {
            try{
              ev.preventDefault();
              ev.stopPropagation();
              const doc = typeof document !== 'undefined' ? document : null;
              if (!doc) return;
              const statusEl = doc.getElementById('editorLlmModelLoadStatus');
              const setStatus = (txt) => { if (statusEl) statusEl.textContent = txt || ''; };
              const client = (typeof globalThis !== 'undefined' && globalThis.H2S_LLM_CLIENT) ? globalThis.H2S_LLM_CLIENT : null;
              if (!client || typeof client.listModels !== 'function'){
                setStatus(_t('editor.llmConfigNotLoaded'));
                return;
              }
              const baseEl = doc.getElementById('editorLlmBaseUrl');
              const tokenEl = doc.getElementById('editorLlmAuthToken');
              const baseUrl = (baseEl && baseEl.value != null) ? String(baseEl.value).trim() : '';
              const authToken = (tokenEl && tokenEl.value != null) ? String(tokenEl.value) : '';
              if (!baseUrl){
                setStatus(_t('editor.pleaseSetBaseUrl'));
                return;
              }
              setStatus(_t('common.loading'));
              const cfg = { baseUrl: baseUrl, authToken: authToken };
              client.listModels(cfg, { timeoutMs: 8000 })
                .then(function(res){
                  const ids = (res && Array.isArray(res.ids)) ? res.ids : [];
                  const cap = 200;
                  const listEl = doc.getElementById('editorLlmModelList');
                  if (listEl){
                    listEl.innerHTML = '';
                    for (var i = 0; i < ids.length && i < cap; i++){
                      var opt = doc.createElement('option');
                      opt.value = ids[i];
                      listEl.appendChild(opt);
                    }
                  }
                  // PR-8J: Also refresh select dropdown with first 50 loaded models (keep placeholder at top)
                  const selectEl = doc.getElementById('editorLlmModelSelect');
                  if (selectEl){
                    const currentValue = selectEl.value;
                    selectEl.innerHTML = '<option value="">' + _t('editor.selectModel') + '</option>';
                    const selectCap = 50;
                    for (var j = 0; j < ids.length && j < selectCap; j++){
                      var opt2 = doc.createElement('option');
                      opt2.value = ids[j];
                      opt2.textContent = ids[j];
                      selectEl.appendChild(opt2);
                    }
                    if (currentValue) selectEl.value = currentValue;
                  }
                  setStatus((_t('editor.loadedModels') || 'Loaded {n} models').replace('{n}', ids.length));
                })
                .catch(function(err){
                  const msg = (err && err.message) ? String(err.message) : '';
                  if (/401|403|Unauthorized/i.test(msg)) setStatus(_t('editor.unauthorized'));
                  else if (/404|not found/i.test(msg)) setStatus(_t('editor.endpointNotFound'));
                  else if (/timeout|request timeout/i.test(msg)) setStatus(_t('editor.timeout'));
                  else setStatus(_t('editor.failedLoadModels'));
                });
            }catch(e){}
          };
        }
        btnLlmLoadModels.removeEventListener('click', H.onLlmLoadModelsClick, true);
        btnLlmLoadModels.addEventListener('click', H.onLlmLoadModelsClick, true);
      }

      // Keyboard: Delete/Backspace remove selected note; Insert adds note.
      if (typeof document !== 'undefined'){
        if (!H.onKeyDown){
          H.onKeyDown = (ev) => {
            try{
              const t = ev.target || document.activeElement;
              if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
              const rt = (g.H2SApp && g.H2SApp.editorRt) ? g.H2SApp.editorRt : null;
              if (!rt || !rt.state || !rt.state.modal || !rt.state.modal.show) return;
              const k = String(ev.key || '');
              if (k === 'Delete' || k === 'Backspace'){
                ev.preventDefault();
                ev.stopPropagation();
                rt.modalDeleteSelectedNotes();
                return;
              }
              if (k === 'Escape'){
                const refs = rt.state.modal.selection && rt.state.modal.selection.noteRefs;
                const hadSelection = (refs && refs.length > 0) || !!rt.state.modal.marquee || !!rt.state.modal.selectedNoteId;
                if (!hadSelection) return;
                ev.preventDefault();
                ev.stopPropagation();
                rt.state.modal.selection = (H2SEditorSelection && H2SEditorSelection.emptySelection)
                  ? H2SEditorSelection.emptySelection()
                  : { noteRefs: [], tool: 'pointer' };
                rt.state.modal.marquee = null;
                rt.modalSyncLegacySelectionFromRefs();
                rt.modalUpdateSelectionUI();
                rt.modalRequestDraw();
                return;
              }
              if ((k === 'a' || k === 'A') && (ev.ctrlKey || ev.metaKey)){
                ev.preventDefault();
                ev.stopPropagation();
                if (H2SEditorSelection && typeof H2SEditorSelection.collectAllNoteRefs === 'function'){
                  rt.state.modal.selection = {
                    noteRefs: H2SEditorSelection.collectAllNoteRefs(rt.state.modal.draftScore),
                    tool: (rt.state.modal.selection && rt.state.modal.selection.tool) || 'pointer',
                  };
                  rt.modalSyncLegacySelectionFromRefs();
                  rt.modalUpdateSelectionUI();
                  rt.modalRequestDraw();
                }
                return;
              }
              if ((k === 'c' || k === 'C') && (ev.ctrlKey || ev.metaKey)){
                ev.preventDefault();
                ev.stopPropagation();
                rt.modalCopySelection();
                return;
              }
              if ((k === 'z' || k === 'Z') && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey){
                ev.preventDefault();
                ev.stopPropagation();
                rt.modalUndoLastEdit();
                return;
              }
              if ((k === 'v' || k === 'V') && (ev.ctrlKey || ev.metaKey)){
                ev.preventDefault();
                ev.stopPropagation();
                rt.modalPasteNotes();
                return;
              }
              if ((k === 'z' || k === 'Z') && !ev.ctrlKey && !ev.metaKey && !ev.altKey){
                ev.preventDefault();
                const levels = [1.0, 1.25, 1.5];
                const cur = Number(rt.state.modal.pitchZoom || 1.25);
                let idx = levels.findIndex(v => Math.abs(v - cur) < 0.001);
                if (idx < 0) idx = 1;
                const next = levels[(idx + 1) % levels.length];
                rt.state.modal.pitchZoom = next;
                try { localStorage.setItem('h2s_editor_pitch_zoom', String(next)); } catch(e){}
                rt.modalResizeCanvasToContent();
                rt.modalAutoScrollPitchToCenter();
                rt.modalRequestDraw();
                try{ $('#editorStatus').textContent = (_t('editor.pitchZoomFmt') || 'Pitch zoom = {n}x (press Z to cycle)').replace('{n}', next); }catch(e){}
                return;
              }
              if (k === 'Insert'){
                ev.preventDefault();
                rt.modalInsertNote();
                return;
              }
            }catch(e){}
          };
        }
        document.removeEventListener('keydown', H.onKeyDown, true);
        document.addEventListener('keydown', H.onKeyDown, true);
      }
    },

    modalInsertNote(){
      if (!this.state.modal.show) return;
      const score = this.state.modal.draftScore;
      if (!score || !Array.isArray(score.tracks) || score.tracks.length === 0){
        try { $('#editorStatus').textContent = 'Cannot insert: no track.'; } catch(e){}
        return;
      }
      this.modalCaptureEditorUndo('insert_note');
      const t = score.tracks[0];
      t.notes = Array.isArray(t.notes) ? t.notes : [];

      const bpm = (this.project && this.project.bpm) ? this.project.bpm : 120;
      const cell = this.state.modal.selectedCell;
      const startSec = cell ? Number(cell.startSec) : Number(this.state.modal.cursorSec || 0);
      const pitch = cell ? Number(cell.pitch) : Number(this.state.modal.pitchCenter || 60);

      const durSec = Math.max(0.05, (this.modalSnapSec() || (60 / bpm) / 4)); // default ~1/16
      const startQ = Math.max(0, this.modalQuantize(Math.max(0, startSec), null));

      const makeId = () => {
        if (H2SProject && typeof H2SProject.makeId === 'function') return H2SProject.makeId('note');
        return 'note_' + Math.random().toString(16).slice(2, 10);
      };

      const note = {
        id: makeId(),
        pitch: H2SProject ? H2SProject.clamp(Math.round(pitch), 0, 127) : Math.max(0, Math.min(127, Math.round(pitch))),
        velocity: 90,
        start: startQ,
        duration: durSec
      };

      t.notes.push(note);
      // Keep notes in time order for predictable hit-test / rendering.
      t.notes.sort((a,b) => (Number(a.start)||0) - (Number(b.start)||0));

      this.state.modal.selection = {
        noteRefs: [{ trackId: String(t.id), noteId: String(note.id), noteIndex: t.notes.length - 1 }],
        tool: 'pointer',
      };
      this.modalSyncLegacySelectionFromRefs();
      this.state.modal.selectedCell = null;
      this.state.modal.dirty = true;
      try { $('#editorStatus').textContent = `Inserted note ${note.id} @ ${fmtSec(note.start)}.`; } catch(e){}
      this.modalRequestDraw();
    },

    modalDeleteSelectedNotes(){
      if (!this.state.modal.show) return;
      const refs = this.state.modal.selection && this.state.modal.selection.noteRefs;
      if (refs && refs.length && H2SEditorSelection){
        this.modalCaptureEditorUndo('delete_notes');
        const res = H2SEditorSelection.deleteSelectedNotes(this.state.modal.draftScore, this.state.modal.selection);
        this.state.modal.draftScore = res.score;
        this.state.modal.selection = H2SEditorSelection.emptySelection();
        this.modalSyncLegacySelectionFromRefs();
        this.state.modal.dirty = true;
        this.modalUpdateSelectionUI();
        try { $('#editorStatus').textContent = (_t('editor.statusDeleted') || '').replace('{n}', String(res.deleted)); } catch(e){}
        this.modalRequestDraw();
        return;
      }
      const id = this.state.modal.selectedNoteId;
      if (!id){
        try { $('#editorStatus').textContent = _t('editor.statusNoNoteSelected'); } catch(e){}
        return;
      }
      const found = this.modalFindNoteById(id);
      if (!found) {
        this.state.modal.selectedNoteId = null;
        try { $('#editorStatus').textContent = _t('editor.statusNoteNotFound'); } catch(e){}
        return;
      }
      this.modalCaptureEditorUndo('delete_note');
      try{
        found.track.notes.splice(found.index, 1);
      }catch(e){}
      this.state.modal.selectedNoteId = null;
      this.state.modal.selection = (H2SEditorSelection && H2SEditorSelection.emptySelection)
        ? H2SEditorSelection.emptySelection()
        : { noteRefs: [], tool: 'pointer' };
      this.state.modal.dirty = true;
      this.modalUpdateSelectionUI();
      try { $('#editorStatus').textContent = 'Deleted note.'; } catch(e){}
      this.modalRequestDraw();
    },

    modalDeleteSelectedNote(){
      this.modalDeleteSelectedNotes();
    },

    modalHitTest(px, py){
      const Coords = H2SEditorCoords;
      const padL = Coords ? Coords.padL(this.state.modal) : this.state.modal.padL;
      const padT = Coords ? Coords.padT(this.state.modal) : this.state.modal.padT;
      const pxPerSec = this.modalEffectivePxPerSec();
      const rowH = this.state.modal.rowH;
      const pitchWin = this.modalPitchWindow();
      const pitchMin = pitchWin.pitchMin;
      const pitchMax = pitchWin.pitchMax;

      const score = this.state.modal.draftScore;
      if (!score || !score.tracks) return null;
      for (let ti = score.tracks.length - 1; ti >= 0; ti--){
        const tr = score.tracks[ti];
        const notes = tr && tr.notes ? tr.notes : [];
        for (let i = notes.length - 1; i >= 0; i--){
          const n = notes[i];
          if (!n || !n.id) continue;
          if (n.pitch < pitchMin || n.pitch > pitchMax) continue;
          const x = Coords ? Coords.timeToX(n.start, this.state.modal) : (padL + n.start * pxPerSec);
          const y = Coords ? Coords.pitchToY(n.pitch, this.state.modal, pitchMin, pitchMax) : (padT + (pitchMax - n.pitch) * rowH + 1);
          const w = Coords ? Math.max(6, Number(n.duration) * Coords.effectivePxPerSec(this.state.modal)) : Math.max(6, n.duration * pxPerSec);
          const h = rowH - 2;
          if (px >= x && px <= x+w && py >= y && py <= y+h){
            const handles = this.modalResizeZoneWidths(w);
            if (px < x + handles.left) return { type:'resize_left', noteId:n.id, trackId: tr.id, noteIndex: i };
            if (px >= x + w - handles.right) return { type:'resize', noteId:n.id, trackId: tr.id, noteIndex: i };
            return { type:'note', noteId:n.id, trackId: tr.id, noteIndex: i };
          }
        }
      }
      return null;
    },

    modalCursorForHit(hit){
      if (!hit || !hit.type) return '';
      if (hit.type === 'resize' || hit.type === 'resize_left') return 'ew-resize';
      if (hit.type === 'note') return 'move';
      return '';
    },

    modalSetCanvasCursor(cursor){
      const canvas = $('#canvas');
      if (!canvas || !canvas.style) return;
      const next = String(cursor || '');
      if (canvas.style.cursor !== next) canvas.style.cursor = next;
    },

    modalUpdateHoverCursor(ev){
      const m = this.state.modal;
      if (!m || !m.show) return;
      const canvas = $('#canvas');
      if (!canvas || typeof canvas.getBoundingClientRect !== 'function'){
        this.modalSetCanvasCursor('');
        return;
      }
      if (m.mode === 'resize_note'){
        this.modalSetCanvasCursor('ew-resize');
        return;
      }
      if (m.mode === 'drag_note'){
        this.modalSetCanvasCursor('move');
        return;
      }
      if (m.mode !== 'none'){
        this.modalSetCanvasCursor('');
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const cx = Number(ev && ev.clientX);
      const cy = Number(ev && ev.clientY);
      const inside = Number.isFinite(cx) && Number.isFinite(cy) &&
        cx >= rect.left && cx <= rect.right &&
        cy >= rect.top && cy <= rect.bottom;
      if (!inside){
        this.modalSetCanvasCursor('');
        return;
      }
      const pt = this.modalCanvasPointFromEvent(ev);
      const px = pt.px;
      const py = pt.py;
      const hit = this.modalHitTest(px, py);
      const tool = (m.selection && m.selection.tool) || 'pointer';
      if (!hit && (tool === 'marquee' || tool === 'pointer')){
        this.modalSetCanvasCursor('crosshair');
        return;
      }
      this.modalSetCanvasCursor(this.modalCursorForHit(hit));
    },

    modalVelocityHitTest(pxCss, pyCss){
      const vCanvas = $('#velocityCanvas');
      if (!vCanvas) return null;
      const padL = this.state.modal.padL;
      const pxPerSec = this.modalEffectivePxPerSec();
      const laneH = this.state.modal.velocityLaneCssH != null ? this.state.modal.velocityLaneCssH : 48;
      const padV = 4;
      const drawH = Math.max(4, laneH - padV);
      if (pyCss < 0 || pyCss > laneH) return null;

      const clampBarW = (x) => H2SProject.clamp(x, 6, 14);
      const notes = this.modalAllNotes();
      for (let i = notes.length - 1; i >= 0; i--){
        const n = notes[i];
        const vel = H2SProject.clamp(Math.round(Number(n.velocity) ?? 100), 1, 127);
        const noteX = padL + n.start * pxPerSec;
        const noteW = n.duration * pxPerSec;
        const barW = clampBarW(Math.max(0, noteW - 2));
        const barX = noteX + (noteW - barW) / 2;
        const barHeight = (vel / 127) * drawH;
        const barY = laneH - barHeight - padV / 2;
        if (pxCss >= barX && pxCss <= barX + barW && pyCss >= barY && pyCss <= laneH) return { type:'velocity', noteId:n.id };
      }
      return null;
    },

    /** Dev-only (hum2song_studio_dev_perf_timing): one summary per clip-editor playback session */
    _logClipEditorPlaybackPerfSummary(){
      if (!_h2sDevPerfTimingEnabled()) return;
      if (typeof performance === 'undefined' || typeof performance.now !== 'function') return;
      const n = this._playbackPerfTickCount || 0;
      const sum = this._playbackPerfTickSum || 0;
      const max = this._playbackPerfTickMax || 0;
      const d = this._playbackPerfModalDrawCount || 0;
      if (!n && !d) return;
      try{
        console.log('[H2S perf] clipEditor playback session', {
          rafTicks: n,
          tickAvgMs: n ? Number((sum / n).toFixed(4)) : 0,
          tickMaxMs: Number(max.toFixed(4)),
          tickTotalMs: Number(sum.toFixed(3)),
          modalDrawCallsWhilePlaying: d,
        });
      }catch(e){}
      this._playbackPerfTickSum = 0;
      this._playbackPerfTickCount = 0;
      this._playbackPerfTickMax = 0;
      this._playbackPerfModalDrawCount = 0;
    },

// ---- Playback inside modal (Clip Editor) ----
modalTogglePlay(){
  if (!this.state.modal.show) return;
  if (this.state.modal.isPlaying || this._modalPlayPending) return this.modalStop();
  return this.modalPlay();
},

async modalPlay(){

  const _mpLog = _h2sDevPerfTimingEnabled();

  if (!this.state.modal.show){
    if (_mpLog){
      try{
        console.log('[H2S perf] clipEditor modalPlay setup', { outcome: 'earlyExit', reason: 'modalHidden' });
      }catch(e){}
    }
    return;
  }
  if (this.state.modal.isPlaying || this._modalPlayPending){
    this.modalStop();
    if (_mpLog){
      try{
        console.log('[H2S perf] clipEditor modalPlay setup', { outcome: 'earlyExit', reason: 'wasPlaying_stoppedFirst' });
      }catch(e){}
    }
    return;
  }

  const _mpT0 = _mpLog ? _perfClipNow() : 0;

  const session = this._modalPlaySession = (this._modalPlaySession || 0) + 1;
  this._modalPlayPending = true;
  const ok = await this.ensureTone();
  if (session !== this._modalPlaySession || !this.state.modal.show) return;
  const _mpAfterEnsure = _mpLog ? _perfClipNow() : 0;
  if (!ok){
    if (_mpLog){
      try{
        console.log('[H2S perf] clipEditor modalPlay setup', {
          outcome: 'ensureToneFailed',
          totalMs: Number((_mpAfterEnsure - _mpT0).toFixed(3)),
          ensureToneMs: Number((_mpAfterEnsure - _mpT0).toFixed(3)),
        });
      }catch(e){}
    }
    this._modalPlayPending = false;
    alert('Tone.js not available.');
    return;
  }

  let _mpAfterToneStart = 0;
  let _mpAfterScore = 0;
  let _mpAfterSynth = 0;
  let _mpAfterTransportReset = 0;
  let _mpAfterSchedule = 0;
  let score;
  let startAt;
  let maxT = 0;

  try{
    // IMPORTANT: Tone.start() must be called from a user gesture (button click).
    // modalPlay() is invoked by the Play button handler, so we can await safely here.
    try { await Tone.start(); } catch(e){}
    if (session !== this._modalPlaySession || !this.state.modal.show) return;
    this._modalPlayPending = false;
    _mpAfterToneStart = _mpLog ? _perfClipNow() : 0;

    score = H2SProject.ensureScoreIds(H2SProject.deepClone(this.state.modal.draftScore));
    startAt = this.state.modal.cursorSec || 0;
    this._modalPlaybackStart = startAt;
    _mpAfterScore = _mpLog ? _perfClipNow() : 0;

    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    this.state.modal.synth = synth;
    _mpAfterSynth = _mpLog ? _perfClipNow() : 0;

    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.seconds = 0;
    Tone.Transport.bpm.value = this.project.bpm || 120;
    _mpAfterTransportReset = _mpLog ? _perfClipNow() : 0;

    maxT = 0;
    for (const tr of (score.tracks || [])){
      for (const n of (tr.notes || [])){
        const end = (Number(n.start)||0) + (Number(n.duration)||0);
        if (end <= startAt) continue;
        const rel = Math.max(0, (Number(n.start)||0) - startAt);
        const dur = Math.max(0, end - Math.max(startAt, Number(n.start)||0));
        maxT = Math.max(maxT, rel + dur);
	        Tone.Transport.schedule((time) => {
	          const pitch = H2SProject.clamp(Math.round((n.pitch || 60)), 0, 127);
	          // Accept either MIDI velocity (1..127) or normalized (0..1)
	          let vel = Number(n.velocity);
	          if (!isFinite(vel)) vel = 0.8;
	          if (vel > 1.01) vel = H2SProject.clamp(vel, 1, 127) / 127;
	          else vel = H2SProject.clamp(vel, 0.05, 1.0);
	          synth.triggerAttackRelease(Tone.Frequency(pitch, "midi"), dur, time, vel);
	        }, rel);
      }
    }
    _mpAfterSchedule = _mpLog ? _perfClipNow() : 0;
  }catch(e){
    if (_mpLog){
      try{
        console.log('[H2S perf] clipEditor modalPlay setup', {
          outcome: 'throw',
          message: String(e && e.message),
          totalMs: Number((_perfClipNow() - _mpT0).toFixed(3)),
        });
      }catch(_){}
    }
    throw e;
  }

  // If no notes after cursor, treat as a no-op but still reset cursor to 0 for UX.
  if (!(maxT > 0)){
    this.modalStop(true);
    let _mpDrawErr = null;
    try{
      this.modalRequestDraw();
    }catch(e){
      _mpDrawErr = e;
    }finally{
      if (_mpLog){
        const _mpEnd = _perfClipNow();
        try{
          console.log('[H2S perf] clipEditor modalPlay setup', {
            outcome: _mpDrawErr ? 'modalRequestDrawThrew' : 'noNotesAfterCursor',
            drawError: _mpDrawErr ? String(_mpDrawErr && _mpDrawErr.message) : undefined,
            totalMs: Number((_mpEnd - _mpT0).toFixed(3)),
            ensureToneMs: Number((_mpAfterEnsure - _mpT0).toFixed(3)),
            toneStartMs: Number((_mpAfterToneStart - _mpAfterEnsure).toFixed(3)),
            scorePrepMs: Number((_mpAfterScore - _mpAfterToneStart).toFixed(3)),
            synthMs: Number((_mpAfterSynth - _mpAfterScore).toFixed(3)),
            transportResetMs: Number((_mpAfterTransportReset - _mpAfterSynth).toFixed(3)),
            scheduleMs: Number((_mpAfterSchedule - _mpAfterTransportReset).toFixed(3)),
          });
        }catch(e){}
      }
    }
    if (_mpDrawErr) throw _mpDrawErr;
    return;
  }

  Tone.Transport.start("+0.05");
  const _mpAfterTransportStart = _mpLog ? _perfClipNow() : 0;
  this.state.modal.isPlaying = true;
  this._playbackPerfTickSum = 0;
  this._playbackPerfTickCount = 0;
  this._playbackPerfTickMax = 0;
  this._playbackPerfModalDrawCount = 0;
  try{ $('#editorStatus').textContent = 'Playing...'; }catch(e){}

  // Show DOM playhead overlay (lightweight; avoids full modalDraw per frame)
  const phEl = $('#editorPlayhead');
  if (phEl){
    phEl.style.display = 'block';
    const padL = this.state.modal.padL != null ? this.state.modal.padL : 60;
    phEl.style.left = (padL + startAt * this.modalEffectivePxPerSec()) + 'px';
  }

  // One-time redraw to clear stale canvas playhead (modalDraw skips playhead when isPlaying)
  let _mpDrawErr2 = null;
  try{
    this.modalRequestDraw();
  }catch(e){
    _mpDrawErr2 = e;
  }finally{
    if (_mpLog){
      const _mpEnd = _perfClipNow();
      try{
        console.log('[H2S perf] clipEditor modalPlay setup', {
          outcome: _mpDrawErr2 ? 'modalRequestDrawThrew' : 'playing',
          drawError: _mpDrawErr2 ? String(_mpDrawErr2 && _mpDrawErr2.message) : undefined,
          totalMs: Number((_mpEnd - _mpT0).toFixed(3)),
          ensureToneMs: Number((_mpAfterEnsure - _mpT0).toFixed(3)),
          toneStartMs: Number((_mpAfterToneStart - _mpAfterEnsure).toFixed(3)),
          scorePrepMs: Number((_mpAfterScore - _mpAfterToneStart).toFixed(3)),
          synthMs: Number((_mpAfterSynth - _mpAfterScore).toFixed(3)),
          transportResetMs: Number((_mpAfterTransportReset - _mpAfterSynth).toFixed(3)),
          scheduleMs: Number((_mpAfterSchedule - _mpAfterTransportReset).toFixed(3)),
          transportStartMs: Number((_mpAfterTransportStart - _mpAfterSchedule).toFixed(3)),
          startUiSyncMs: Number((_mpEnd - _mpAfterTransportStart).toFixed(3)),
        });
      }catch(e){}
    }
  }
  if (_mpDrawErr2) throw _mpDrawErr2;

  // progress ticker (uses closure vars; do NOT reference them elsewhere)
  const tick = () => {
    if (!this.state.modal.isPlaying || session !== this._modalPlaySession) return;
    const _perfPb = _h2sDevPerfTimingEnabled() && typeof performance !== 'undefined' && typeof performance.now === 'function';
    const t0 = _perfPb ? performance.now() : 0;
    const sec = startAt + (Tone.Transport.seconds || 0);
    this.state.modal.cursorSec = sec;
    try{ $('#pillCursor').textContent = `Cursor: ${fmtSec(sec)}`; }catch(e){}
    // Update overlay only — no modalRequestDraw per frame
    const ph = $('#editorPlayhead');
    if (ph){
      const pad = this.state.modal.padL != null ? this.state.modal.padL : 60;
      const pps = this.modalEffectivePxPerSec();
      ph.style.left = (pad + sec * pps) + 'px';
    }
    if (_perfPb){
      const dt = performance.now() - t0;
      this._playbackPerfTickSum = (this._playbackPerfTickSum || 0) + dt;
      this._playbackPerfTickCount = (this._playbackPerfTickCount || 0) + 1;
      if (dt > (this._playbackPerfTickMax || 0)) this._playbackPerfTickMax = dt;
    }

    // Auto-stop when finished, and reset to start.
    if ((Tone.Transport.seconds || 0) >= maxT){
      this.modalStop(true);
      return;
    }
    this._modalRAF = requestAnimationFrame(tick);
  };
  this._modalRAF = requestAnimationFrame(tick);
},
    modalEndEdgeScroll(){
      if(this._editorEdgeRAF)cancelAnimationFrame(this._editorEdgeRAF);
      this._editorEdgeRAF=0;this._editorEdgePointer=null;
    },

    modalUpdateEdgeScroll(ev){
      const m=this.state.modal;
      if(!m.show || !['drag_note','resize_note'].includes(m.mode)){this.modalEndEdgeScroll();return;}
      this._editorEdgePointer={clientX:ev.clientX,clientY:ev.clientY,pointerId:ev.pointerId,altKey:ev.altKey,shiftKey:ev.shiftKey,buttons:ev.buttons};
      if(this._editorEdgeRAF || this._editorEdgeTicking)return;
      let previous=performance.now();
      const tick=now=>{
        this._editorEdgeRAF=0;
        const p=this._editorEdgePointer,grid=$('.editorGridWrap'),canvas=$('#canvas');
        if(!p || !grid || !m.show || !['drag_note','resize_note'].includes(m.mode)){this.modalEndEdgeScroll();return;}
        const b=grid.getBoundingClientRect(),margin=36,dt=Math.min(40,now-previous)/1000;previous=now;
        const velocity=(pos,lo,hi)=>pos<lo+margin?-Math.min(600,(lo+margin-pos)*18):pos>hi-margin?Math.min(600,(pos-hi+margin)*18):0;
        const vx=velocity(p.clientX,b.left+(m.padL || 60),b.left+grid.clientWidth);
        const vy=m.mode==='drag_note'?velocity(p.clientY,b.top,b.top+grid.clientHeight):0;
        if(vx>0 && grid.scrollLeft+grid.clientWidth>=canvas.width-100)this.modalResizeCanvasToContent();
        const oldX=grid.scrollLeft,oldY=grid.scrollTop;
        grid.scrollLeft+=vx*dt;grid.scrollTop+=vy*dt;
        if(grid.scrollLeft!==oldX || grid.scrollTop!==oldY){
          this._editorEdgeTicking=true;
          try{this.modalPointerMove(p);}finally{this._editorEdgeTicking=false;}
        }
        if(this._editorEdgePointer && !this._editorEdgeRAF)this._editorEdgeRAF=requestAnimationFrame(tick);
      };
      this._editorEdgeRAF=requestAnimationFrame(tick);
    },

    modalPointerDown(ev){
      if (!this.state.modal.show) return;
      const target = ev.target;
      const isVelocityCanvas = target && target.id === 'velocityCanvas';
      const isSplitter = target && (target.id === 'velocitySplitter' || target.closest && target.closest('#velocitySplitter'));

      if (isSplitter){
        if (ev.detail === 2){
          this.state.modal.velocityLaneCollapsed = !this.state.modal.velocityLaneCollapsed;
          this.modalResizeCanvasToContent();
          this.modalRequestDraw();
          return;
        }
        this.state.modal.mode = 'resize_velocity_lane';
        this.state.modal.drag.startY = ev.clientY;
        this.state.modal.drag.origLaneHeight = this.state.modal.velocityLaneHeight;
        _h2sDragPerfSessionBegin(this, 'resize_velocity_lane');
        return;
      }

      if (isVelocityCanvas){
        const vCanvas = $('#velocityCanvas');
        if (!vCanvas) return;
        const rect = vCanvas.getBoundingClientRect();
        const pxCss = ev.clientX - rect.left;
        const pyCss = ev.clientY - rect.top;
        const hit = this.modalVelocityHitTest(pxCss, pyCss);
        if (hit){
          const draggedNoteId = hit.noteId;
          const currentSelectedIds = (this.state.modal.selectedNoteIds && this.state.modal.selectedNoteIds.length >= 2)
            ? this.state.modal.selectedNoteIds
            : (this.state.modal.selectedNoteId ? [this.state.modal.selectedNoteId] : []);
          let targets;
          if (currentSelectedIds.length >= 2 && currentSelectedIds.indexOf(draggedNoteId) >= 0){
            targets = currentSelectedIds;
          } else {
            targets = [draggedNoteId];
            this.state.modal.selectedNoteId = draggedNoteId;
            this.state.modal.selectedNoteIds = null;
          }
          this._velDragTargets = targets;
          const found = this.modalFindNoteById(draggedNoteId);
          if (!found) return;
          this.modalCaptureEditorUndo('edit_velocity', { mergeKey: 'velocity:' + String(draggedNoteId) });
          const v0 = H2SProject.clamp(Math.round(Number(found.note.velocity) ?? 100), 1, 127);
          this.state.modal.drag.noteId = draggedNoteId;
          this.state.modal.drag.startY = pyCss;
          this.state.modal.drag.origVelocity = v0;
          this.state.modal.mode = 'drag_velocity';
          _h2sDragPerfSessionBegin(this, 'drag_velocity');
          $('#editorStatus').textContent = 'Drag to set velocity...';
          this.modalRequestDraw();
          return;
        }
        return;
      }

      const canvas = $('#canvas');
      const pt = this.modalCanvasPointFromEvent(ev);
      const px = pt.px;
      const py = pt.py;
      const tool = (this.state.modal.selection && this.state.modal.selection.tool) || 'pointer';

      // HIT TEST FIRST (fix: note operations have priority)
      const hit = this.modalHitTest(px, py);
      if (hit){
        const ref = {
          trackId: String(hit.trackId),
          noteId: String(hit.noteId),
          noteIndex: hit.noteIndex != null ? hit.noteIndex : undefined,
        };
        if (ev.shiftKey && H2SEditorSelection){
          const base = (this.state.modal.selection && this.state.modal.selection.noteRefs) || [];
          this.state.modal.selection = {
            noteRefs: H2SEditorSelection.toggleNoteRef(base, ref),
            tool,
          };
        } else {
          this.state.modal.selection = { noteRefs: [ref], tool };
        }
        this.modalSyncLegacySelectionFromRefs();
        this.state.modal.selectedCell = null;
        this.modalUpdateSelectionUI();

        const found = this.modalFindNoteById(hit.noteId, hit.trackId);
        if (!found) return;

        const n = found.note;
        this.state.modal.drag.noteId = hit.noteId;
        this.state.modal.drag.startX = px;
        this.state.modal.drag.startY = py;
        this.state.modal.drag.origStart = n.start;
        this.state.modal.drag.origPitch = n.pitch;
        this.state.modal.drag.origDur = n.duration;
        this.state.modal.drag.resizeEdge = (hit.type === 'resize_left') ? 'left' : (hit.type === 'resize') ? 'right' : undefined;
        this.state.modal.drag.pxPerSec = this.modalEffectivePxPerSec();

        this.modalCaptureEditorUndo(
          (hit.type === 'resize' || hit.type === 'resize_left') ? 'resize_note' : 'drag_note',
          { mergeKey: 'move:' + String(hit.noteId) + ':' + String(hit.type) },
        );
        this.state.modal.mode = (hit.type === 'resize' || hit.type === 'resize_left') ? 'resize_note' : 'drag_note';
        if(canvas && ev.pointerId!=null)canvas.setPointerCapture(ev.pointerId);
        this.modalUpdateEdgeScroll(ev);
        _h2sDragPerfSessionBegin(this, this.state.modal.mode);
        $('#editorStatus').textContent = (hit.type === 'resize' || hit.type === 'resize_left') ? 'Resize note...' : 'Drag note...';
        this.modalRequestDraw();
        return;
      }

      if (tool === 'marquee' || tool === 'pointer'){
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (canvas && typeof canvas.setPointerCapture === 'function' && ev.pointerId != null){
          try { canvas.setPointerCapture(ev.pointerId); } catch(_e){}
        }
        this.state.modal.mode = 'marquee';
        this.state.modal.marquee = { x0: px, y0: py, x1: px, y1: py, fromPointer: tool === 'pointer' };
        _h2sDragPerfSessionBegin(this, 'marquee');
        this.modalUpdateMarqueeOverlay();
        return;
      }

      // Click empty -> move cursor + set selected cell (legacy path; pointer/marquee use drag above)
      const Coords = H2SEditorCoords;
      const padL = Coords ? Coords.padL(this.state.modal) : this.state.modal.padL;
      const padT = Coords ? Coords.padT(this.state.modal) : this.state.modal.padT;
      const pxPerSec = this.modalEffectivePxPerSec();

      // time
      let tSec = Coords ? Coords.xToTime(px, this.state.modal) : ((px - padL) / pxPerSec);
      tSec = Math.max(0, tSec);
      tSec = this.modalQuantize(tSec, ev);
      this.modalSeek(tSec);

      // pitch from y
      const pitchWin = this.modalPitchWindow();
      const pitchMin = pitchWin.pitchMin;
      const pitchMax = pitchWin.pitchMax;
      const rowH = this.state.modal.rowH;
      const pitch = Coords
        ? Coords.yToPitch(py, this.state.modal, pitchMin, pitchMax)
        : H2SProject.clamp(pitchMax - Math.floor((py - padT) / rowH), 0, 127);

      this.state.modal.selection = (H2SEditorSelection && H2SEditorSelection.emptySelection)
        ? H2SEditorSelection.emptySelection()
        : { noteRefs: [], tool: 'pointer' };
      this.modalSyncLegacySelectionFromRefs();
      this.state.modal.selectedNoteId = null;
      this.state.modal.selectedCell = { startSec: tSec, pitch };
      this.modalUpdateSelectionUI();

      $('#editorStatus').textContent = `Cursor moved to ${fmtSec(tSec)}; selected cell pitch ${H2SProject.midiToName(pitch)}.`;
      this.modalRequestDraw();
    },

    modalPointerMove(ev){
      if (!this.state.modal.show) return;
      const m = this.state.modal;
      if(m.mode==='drag_note' || m.mode==='resize_note')this.modalUpdateEdgeScroll(ev);
      this.modalUpdateHoverCursor(ev);
      const _sess = this._h2sDragPerf;
      const _track = _h2sDevPerfTimingEnabled() && _sess && (m.mode === 'resize_velocity_lane' || m.mode === 'drag_velocity' || m.mode === 'drag_note' || m.mode === 'resize_note');
      const _tMove0 = _track ? _perfClipNow() : 0;
      try{
      if (m.mode === 'resize_velocity_lane'){
        const dy = ev.clientY - m.drag.startY;
        let h = Math.max(48, Math.min(200, (m.drag.origLaneHeight || 80) + dy));
        this.state.modal.velocityLaneHeight = h;
        this.modalResizeCanvasToContent();
        this.modalRequestDraw();
        return;
      }

      if (m.mode === 'drag_velocity'){
        const vCanvas = $('#velocityCanvas');
        if (!vCanvas) return;
        const rect = vCanvas.getBoundingClientRect();
        const pyCss = ev.clientY - rect.top;
        const laneH = this.state.modal.velocityLaneCssH != null ? this.state.modal.velocityLaneCssH : 48;
        const step = ev.shiftKey ? 4 : 1;
        let v = Math.round(127 * (1 - pyCss / laneH));
        v = H2SProject.clamp(v, 1, 127);
        if (step > 1) v = Math.round(v / step) * step;
        v = H2SProject.clamp(v, 1, 127);
        const targets = this._velDragTargets || [m.drag.noteId];
        for (const id of targets){
          const found = this.modalFindNoteById(id);
          if (found) found.note.velocity = v;
        }
        m.dirty = true;
        $('#editorStatus').textContent = 'Vel: ' + v;
        this.modalRequestDraw();
        return;
      }

      if (m.mode === 'marquee'){
        const pt = this.modalCanvasPointFromEvent(ev);
        if (m.marquee){
          m.marquee.x1 = pt.px;
          m.marquee.y1 = pt.py;
        }
        this.modalUpdateMarqueeOverlay();
        this.modalSetCanvasCursor('crosshair');
        return;
      }

      if (m.mode !== 'drag_note' && m.mode !== 'resize_note') return;

      const pt = this.modalCanvasPointFromEvent(ev);
      const px = pt.px;
      const py = pt.py;

      const found = this.modalFindNoteById(m.drag.noteId);
      if (!found) return;

      // derive pitch window for mapping y->pitch
      let pitchMin = 0;
      let pitchMax = 127;
      if (!m.usePitchVScroll){
        const st = H2SProject.scoreStats(this.state.modal.draftScore);
        const rows = m.pitchViewRows;
        const range = st.maxPitch - st.minPitch + 1;
        if (range <= rows){
          const pad = 2;
          pitchMin = Math.max(0, st.minPitch - pad);
          pitchMax = Math.min(127, st.maxPitch + pad);
        } else {
          const half = Math.floor(rows / 2);
          const c = m.pitchCenter;
          pitchMin = H2SProject.clamp(c - half, 0, 127 - rows);
          pitchMax = pitchMin + rows;
        }
      }

      const dx = px - m.drag.startX;
      const dy = py - m.drag.startY;

      const secDelta = dx / (m.drag.pxPerSec || this.modalEffectivePxPerSec());
      const pitchDelta = -Math.round(dy / m.rowH);

      if (m.mode === 'drag_note'){
        let ns = m.drag.origStart + secDelta;
        ns = Math.max(0, ns);
        ns = this.modalQuantize(ns, ev);
        let np = m.drag.origPitch + pitchDelta;
        np = H2SProject.clamp(np, 0, 127);
        found.note.start = ns;
        found.note.pitch = np;
        m.dirty = true;
        $('#editorStatus').textContent = `Drag: start ${fmtSec(ns)} pitch ${H2SProject.midiToName(np)}`;
      } else {
        const edge = m.drag.resizeEdge || 'right';
        if (edge === 'right'){
          let nd = m.drag.origDur + secDelta;
          nd = Math.max(0.05, nd);
          const g = (ev && ev.altKey) ? 0 : this.modalSnapSec();
          if (g && g > 0) nd = Math.max(g, Math.round(nd / g) * g);
          found.note.duration = nd;
          m.dirty = true;
          $('#editorStatus').textContent = `Resize: duration ${fmtSec(nd)}`;
        } else {
          const end = m.drag.origStart + m.drag.origDur;
          let nd = m.drag.origDur - secDelta;
          nd = Math.max(0.05, nd);
          const g = (ev && ev.altKey) ? 0 : this.modalSnapSec();
          if (g && g > 0) nd = Math.max(g, Math.round(nd / g) * g);
          let ns = end - nd;
          if (ns < 0){
            ns = 0;
            nd = end - ns;
            nd = Math.max(0.05, nd);
            if (g && g > 0) nd = Math.max(g, Math.round(nd / g) * g);
            ns = end - nd;
          }
          found.note.start = ns;
          found.note.duration = nd;
          m.dirty = true;
          $('#editorStatus').textContent = `Resize: start ${fmtSec(ns)} duration ${fmtSec(nd)}`;
        }
      }

      this.modalRequestDraw();
      } finally {
        if (_track && _tMove0){
          const dt = _perfClipNow() - _tMove0;
          _sess.moveCount++;
          _sess.moveTotalMs += dt;
          if (dt > _sess.moveMaxMs) _sess.moveMaxMs = dt;
        }
      }
    },

    modalPointerUp(ev){
      this.modalEndEdgeScroll();
      if (!this.state.modal.show) return;
      const m = this.state.modal;
      const canvas = $('#canvas');
      if (canvas && typeof canvas.releasePointerCapture === 'function' && ev && ev.pointerId != null){
        try {
          if (canvas.hasPointerCapture && canvas.hasPointerCapture(ev.pointerId)){
            canvas.releasePointerCapture(ev.pointerId);
          }
        } catch(_e){}
      }
      if (m.mode === 'marquee'){
        _h2sDragPerfSessionEnd(this);
        const mq = m.marquee;
        m.mode = 'none';
        m.marquee = null;
        const activeTool = (m.selection && m.selection.tool) || 'pointer';
        const MARQUEE_CLICK_PX = 5;
        const dx = mq ? Math.abs(mq.x1 - mq.x0) : 0;
        const dy = mq ? Math.abs(mq.y1 - mq.y0) : 0;
        const isClick = dx < MARQUEE_CLICK_PX && dy < MARQUEE_CLICK_PX;

        if (mq && mq.fromPointer && isClick && activeTool === 'pointer'){
          const Coords = H2SEditorCoords;
          let tSec = Coords ? Coords.xToTime(mq.x0, m) : ((mq.x0 - (m.padL || 60)) / this.modalEffectivePxPerSec());
          tSec = Math.max(0, tSec);
          tSec = this.modalQuantize(tSec, ev);
          this.modalSeek(tSec);
          const pitchWin = this.modalPitchWindow();
          const pitch = Coords
            ? Coords.yToPitch(mq.y0, m, pitchWin.pitchMin, pitchWin.pitchMax)
            : H2SProject.clamp(pitchWin.pitchMax - Math.floor((mq.y0 - (m.padT || 20)) / m.rowH), 0, 127);
          if (!ev || !ev.shiftKey){
            m.selection = (H2SEditorSelection && H2SEditorSelection.emptySelection)
              ? H2SEditorSelection.emptySelection()
              : { noteRefs: [], tool: activeTool };
            m.selectedNoteId = null;
          }
          m.selectedCell = { startSec: tSec, pitch };
          this.modalSyncLegacySelectionFromRefs();
          this.modalUpdateSelectionUI();
          this.modalUpdateMarqueeOverlay();
          try { $('#editorStatus').textContent = `Cursor moved to ${fmtSec(tSec)}; selected cell pitch ${H2SProject.midiToName(pitch)}.`; } catch(_e){}
          this.modalRequestDraw();
          return;
        }

        if (mq && H2SEditorSelection && H2SEditorCoords){
          this.modalEnsureDraftScoreNoteIds();
          if (H2SProject && typeof H2SProject.ensureScoreIds === 'function'){
            try { H2SProject.ensureScoreIds(m.draftScore); } catch(_e){}
          }
          const rect = {
            x0: Math.min(mq.x0, mq.x1),
            y0: Math.min(mq.y0, mq.y1),
            x1: Math.max(mq.x0, mq.x1),
            y1: Math.max(mq.y0, mq.y1),
          };
          const pitchWin = this.modalPitchWindow();
          let hits = isClick ? [] : H2SEditorSelection.notesInRect(m.draftScore, rect, H2SEditorCoords, m, pitchWin);
          if (hits.length && typeof H2SEditorSelection.normalizeNoteRefs === 'function'){
            hits = H2SEditorSelection.normalizeNoteRefs(m.draftScore, hits);
          }
          if (ev && ev.shiftKey && m.selection && m.selection.noteRefs){
            hits = H2SEditorSelection.mergeNoteRefs(m.selection.noteRefs, hits, false);
          } else if (isClick && !ev.shiftKey){
            hits = [];
          }
          m.selection = { noteRefs: hits, tool: activeTool };
          this.modalSyncLegacySelectionFromRefs();
          this.modalUpdateSelectionUI();
          try { $('#editorStatus').textContent = hits.length
            ? (_t('editor.statusSelected') || '').replace('{n}', String(hits.length))
            : _t('editor.statusNoNotesInSelection'); } catch(_e){}
        }
        this.modalUpdateMarqueeOverlay();
        this.modalRequestDraw();
        return;
      }
      if (m.mode === 'drag_note' || m.mode === 'resize_note' || m.mode === 'drag_velocity' || m.mode === 'resize_velocity_lane'){
        _h2sDragPerfSessionEnd(this);
        m.mode = 'none';
        try { $('#editorStatus').textContent = 'Ready.'; } catch(e){}
        this.modalRequestDraw();
      }
    },

    modalSeek(seconds){
      const playing=this.state.modal.isPlaying || this._modalPlayPending;
      this.modalStop();
      this.state.modal.cursorSec=Math.max(0,Number(seconds)||0);
      this.modalRequestDraw();
      if(playing)return this.modalPlay();
    },

    modalStop(reset=false){
  this._modalPlaySession=(this._modalPlaySession || 0)+1;
  this._modalPlayPending=false;
  if(this.state.modal.isPlaying && window.Tone){
    this.state.modal.cursorSec=(this._modalPlaybackStart || 0)+(Tone.Transport.seconds || 0);
  }
  if(reset)this.state.modal.cursorSec=0;
  const _msLog = _h2sDevPerfTimingEnabled();
  if (!this.state.modal.show){
    if (_msLog){
      try{
        console.log('[H2S perf] clipEditor modalStop cleanup', { outcome: 'earlyExit', reason: 'modalHidden' });
      }catch(e){}
    }
    return;
  }

  const _msT0 = _msLog ? _perfClipNow() : 0;
  let _msAfterRafSummary = _msT0;
  let _msAfterCancelRaf = _msT0;
  let _msAfterModalPart = _msT0;
  let _msAfterTransport = _msT0;
  let _msAfterOverlay = _msT0;
  let _msDrawErr = null;

  try{
    this._logClipEditorPlaybackPerfSummary();
    _msAfterRafSummary = _msLog ? _perfClipNow() : 0;

    // Cancel UI tick
    if (this._modalRAF){
      try{ cancelAnimationFrame(this._modalRAF); }catch(_){}
      this._modalRAF = null;
    }
    _msAfterCancelRaf = _msLog ? _perfClipNow() : 0;

    // Stop scheduled notes
    if (this._modalPart){
      try{ this._modalPart.dispose(); }catch(_){}
      this._modalPart = null;
    }
    _msAfterModalPart = _msLog ? _perfClipNow() : 0;

    if (window.Tone){
      try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(_){}
    }
    _msAfterTransport = _msLog ? _perfClipNow() : 0;

    if(this.state.modal.synth){
      try{this.state.modal.synth.releaseAll();this.state.modal.synth.dispose();}catch(_){}
      this.state.modal.synth=null;
    }
    this.state.modal.isPlaying = false;
    $('#editorStatus').textContent = 'Stopped.';
    // Hide DOM overlay so canvas playhead is shown again
    const phEl = $('#editorPlayhead');
    if (phEl) phEl.style.display = 'none';
    _msAfterOverlay = _msLog ? _perfClipNow() : 0;

    try{
      this.modalRequestDraw();
    }catch(e){
      _msDrawErr = e;
    }
  }finally{
    if (_msLog){
      const _msEndWall = _perfClipNow();
      try{
        console.log('[H2S perf] clipEditor modalStop cleanup', {
          outcome: _msDrawErr ? 'modalRequestDrawThrew' : 'ok',
          drawError: _msDrawErr ? String(_msDrawErr && _msDrawErr.message) : undefined,
          totalMs: Number((_msEndWall - _msT0).toFixed(3)),
          rafSessionLogMs: Number((_msAfterRafSummary - _msT0).toFixed(3)),
          cancelRafMs: Number((_msAfterCancelRaf - _msAfterRafSummary).toFixed(3)),
          modalPartDisposeMs: Number((_msAfterModalPart - _msAfterCancelRaf).toFixed(3)),
          transportStopCancelMs: Number((_msAfterTransport - _msAfterModalPart).toFixed(3)),
          stopUiOverlayMs: Number((_msAfterOverlay - _msAfterTransport).toFixed(3)),
          modalRequestDrawScheduleMs: Number((_msEndWall - _msAfterOverlay).toFixed(3)),
        });
      }catch(e){}
    }
  }
  if (_msDrawErr) throw _msDrawErr;
},

      };

      // Sanity: in Node, we don't have document; avoid accidental usage.
      impl.__isBrowser = (typeof document !== 'undefined');
      if(typeof window!=='undefined' && typeof window.addEventListener==='function'){
        const endGesture=()=>{impl.modalEndEdgeScroll();if(impl.state.modal.show && ['drag_note','resize_note'].includes(impl.state.modal.mode))impl.modalPointerUp();};
        window.addEventListener('blur',endGesture);
        window.addEventListener('pointercancel',endGesture);
      }

      // Expose injected helpers for debugging (optional)
      impl.__deps = { H2SProject, persist, log, render, $, $$, fmtSec, escapeHtml };

      // Rebind free function identifiers used by copied code via closure:
      // - H2SProject, persist, log, $, $$, fmtSec, escapeHtml are in closure scope.
      return impl;
    }

    return { create };
  }

  const api = factory();
  // attach
  if(typeof module !== 'undefined' && module.exports){
    module.exports = api;
  } else {
    global.H2SEditorRuntime = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
