/* Hum2Song Studio — shared metadata for Phase-1 deterministic optimize slices (velocity_shape, local_transpose).
   Plain script: root.H2SPhase1DeterministicMeta. Node tests: module.exports.

   Not a capability framework — only small, testable contract helpers.
*/
(function(root){
  'use strict';

  /** How the structured intent was chosen (debug / patchSummary). */
  const PHASE1_INTENT_SOURCE = {
    EXPLICIT_OPTIONS: 'explicit_options',
    NARROWED_FROM_PROMPT: 'narrowed_from_prompt',
    PRESET_DEFAULT: 'preset_default',
  };

  function describePhase1PresetDefault(capabilityId){
    const id = String(capabilityId || '');
    if (id === 'velocity_shape'){
      return 'Preset-only default: no explicit velocityShapeIntent and no matching userPrompt phrase → mode=more_even, strength=medium.';
    }
    if (id === 'local_transpose'){
      return 'Preset-only default: no explicit localTransposeIntent and no matching userPrompt phrase → semitone_delta=+1 (delta clamped to ±12; pitch clamped 0–127).';
    }
    return '';
  }

  /**
   * Unified patchSummary / trace payload for Phase-1 deterministic slices.
   * @param {{ capabilityId: string, intentResolved: object, noteIdsFilter: string[]|null, targetNoteCount: number, effectiveNoteCount: number, intentSource: string }} o
   */
  function buildPhase1DeterministicResolvedMeta(o){
    const capabilityId = String(o && o.capabilityId || '');
    const intentResolved = (o && o.intentResolved && typeof o.intentResolved === 'object') ? o.intentResolved : {};
    const noteFilter = (o && Array.isArray(o.noteIdsFilter) && o.noteIdsFilter.length > 0) ? o.noteIdsFilter.map(function(x){ return String(x); }) : null;
    const hasIds = noteFilter && noteFilter.length > 0;
    const PREVIEW_MAX = 12;
    const preview = hasIds ? noteFilter.slice(0, PREVIEW_MAX) : null;
    const intentSource = (o && o.intentSource != null && String(o.intentSource).trim())
      ? String(o.intentSource).trim()
      : PHASE1_INTENT_SOURCE.PRESET_DEFAULT;
    const targetNoteCount = (o && isFinite(Number(o.targetNoteCount))) ? Number(o.targetNoteCount) : 0;
    const effectiveNoteCount = (o && isFinite(Number(o.effectiveNoteCount))) ? Number(o.effectiveNoteCount) : 0;

    return {
      capabilityId,
      intentResolved,
      targetScope: hasIds ? 'note_ids' : 'whole_clip',
      noteIdsFilterPreview: preview,
      noteIdsFilterPreviewTruncated: hasIds && noteFilter.length > PREVIEW_MAX,
      targetNoteCount,
      effectiveNoteCount,
      intentSource,
      executionPath: capabilityId,
      presetDefaultDescription: intentSource === PHASE1_INTENT_SOURCE.PRESET_DEFAULT ? describePhase1PresetDefault(capabilityId) : null,
    };
  }

  const API = {
    PHASE1_INTENT_SOURCE,
    buildPhase1DeterministicResolvedMeta,
    describePhase1PresetDefault,
  };

  root.H2SPhase1DeterministicMeta = API;
  if (typeof module !== 'undefined' && module.exports){
    module.exports = API;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
