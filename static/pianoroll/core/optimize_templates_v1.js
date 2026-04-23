/* Hum2Song Studio MVP - core/optimize_templates_v1.js (INFRA-1a)
   Single shared source of truth for built-in optimize templates.
   No ES modules; exposes window.H2S_OPTIMIZE_TEMPLATES_V1 and window.H2S_OPTIMIZE_TEMPLATES_V1_MAP.
*/
(function(){
  'use strict';

  const ROOT = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined') ? globalThis : {};

  /** Ordered array of built-in templates. Do not change ids, labels, intents, seeds, or promptVersions. */
  const OPTIMIZE_TEMPLATES_V1 = [
    {
      id: 'fix_pitch_v1',
      label: 'Fix Pitch',
      labelKey: 'editor.fixPitch',
      promptVersion: 'tmpl_v1.fix_pitch.r1',
      intent: { fixPitch: true, tightenRhythm: false, reduceOutliers: false },
      seed: 'Correct pitch errors while keeping the melody recognizable. Prefer small pitch adjustments; do not rewrite the phrase.',
      directives: {},
    },
    {
      id: 'tighten_rhythm_v1',
      label: 'Tighten Rhythm',
      labelKey: 'editor.tightenRhythm',
      promptVersion: 'tmpl_v1.tighten_rhythm.r1',
      intent: { fixPitch: false, tightenRhythm: true, reduceOutliers: false },
      seed: 'Align note starts and durations to a steadier groove while keeping pitches unchanged. Prefer small timing adjustments and consistent note lengths; do not rewrite the melody.',
      directives: {},
    },
    {
      id: 'clean_outliers_v1',
      label: 'Clean Outliers',
      labelKey: 'editor.cleanOutliers',
      promptVersion: 'tmpl_v1.clean_outliers',
      intent: { fixPitch: false, tightenRhythm: false, reduceOutliers: true },
      seed: 'Smooth extreme values; reduce outliers.',
      directives: {},
    },
    {
      id: 'bluesy_v1',
      label: 'Bluesy',
      labelKey: 'editor.bluesy',
      promptVersion: 'tmpl_v1.bluesy',
      intent: { fixPitch: false, tightenRhythm: true, reduceOutliers: false },
      seed: 'Add subtle blues inflection to timing and dynamics.',
      directives: {},
    },
  ];

  const MAP = {};
  for (let i = 0; i < OPTIMIZE_TEMPLATES_V1.length; i++){
    const t = OPTIMIZE_TEMPLATES_V1[i];
    if (t && t.id) MAP[t.id] = t;
  }

  ROOT.H2S_OPTIMIZE_TEMPLATES_V1 = OPTIMIZE_TEMPLATES_V1;
  ROOT.H2S_OPTIMIZE_TEMPLATES_V1_MAP = MAP;
})();
