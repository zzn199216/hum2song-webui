/* Hum2Song Studio — single precedence order for Assistant deterministic NL narrowing.
   Used by app.js _aiAssistSend only; keeps rhythm → transpose → velocity testable in one place.

   Not a broad NL framework — delegates to existing slice narrowers.
*/
(function(root){
  'use strict';

  /** Documented order: first match wins (see docs/DAW_AGENT_PHASE1_BASELINE.md). */
  const PHASE1_ASSISTANT_NARROW_ORDER = Object.freeze([
    'rhythm_tighten_loosen',
    'local_transpose',
    'velocity_shape',
  ]);

  /**
   * Core routing (rhythm → transpose → velocity). Does not depend on H2SPhase1AssistantNarrow.
   * Used by resolvePhase1AssistantIntentFromText and by app.js when the narrow bundle is missing or throws.
   * @param {object} r — global/window (expects slice narrowers on r)
   * @returns {{ branch: string, intent: object } | null}
   */
  function resolvePhase1AssistantIntentFromTextInline(r, text){
    if (!r || text == null || typeof text !== 'string') return null;
    const R = r.H2SRhythmTightenLoosen;
    if (R && typeof R.narrowRhythmIntentFromText === 'function'){
      const n = R.narrowRhythmIntentFromText(text);
      if (n && n.mode) return { branch: 'rhythm_tighten_loosen', intent: n };
    }
    const LT = r.H2SLocalTranspose;
    if (LT && typeof LT.narrowLocalTransposeIntentFromText === 'function'){
      const n = LT.narrowLocalTransposeIntentFromText(text);
      if (n && isFinite(Number(n.semitone_delta))) return { branch: 'local_transpose', intent: n };
    }
    const VS = r.H2SVelocityShape;
    if (VS && typeof VS.narrowVelocityShapeIntentFromText === 'function'){
      const n = VS.narrowVelocityShapeIntentFromText(text);
      if (n && n.mode) return { branch: 'velocity_shape', intent: n };
    }
    return null;
  }

  /**
   * @returns {{ branch: string, intent: object } | null}
   */
  function resolvePhase1AssistantIntentFromText(text){
    return resolvePhase1AssistantIntentFromTextInline(root, text);
  }

  const API = {
    PHASE1_ASSISTANT_NARROW_ORDER,
    resolvePhase1AssistantIntentFromText,
    resolvePhase1AssistantIntentFromTextInline,
  };

  root.H2SPhase1AssistantNarrow = API;
  if (typeof module !== 'undefined' && module.exports){
    module.exports = API;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
