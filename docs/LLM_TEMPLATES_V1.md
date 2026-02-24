# LLM TemplateSpec v1 (PR-E1)

Internal doc for TemplateSpec foundation and promptVersion tracking.

## TemplateSpec fields

Each template in the v1 registry has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique template identifier |
| `label` | string | Human-readable label |
| `promptVersion` | string | Version string for reproducibility (e.g. `tmpl_v1.fix_pitch`) |
| `intent` | object | `{ fixPitch, tightenRhythm, reduceOutliers }` flags |
| `seed` | string | One-line seed text for prompt construction |
| `directives` | object | Additional directives (reserved for PR-E3) |

## v1 template ids + intent mapping + seed

| Template ID | Intent | One-line seed |
|-------------|--------|---------------|
| `fix_pitch_v1` | fixPitch: true | Correct wrong notes; fix pitch errors. |
| `tighten_rhythm_v1` | tightenRhythm: true | Align timing; tighten rhythm. |
| `clean_outliers_v1` | reduceOutliers: true | Smooth extreme values; reduce outliers. |
| `bluesy_v1` | tightenRhythm: true | Add subtle blues inflection to timing and dynamics. |

## promptMeta in patchSummary

When optimize runs, `patchSummary.promptMeta` is populated with:

- `templateId`: template id if `optsIn.templateId` matched the registry; else `null`
- `promptVersion`: template's promptVersion if matched; else `'manual_v0'`
- `intent`: `optsIn.intent` or `null`

This metadata is recorded for:
- llm_v0 success / ops===0
- safe presets success / ops===0
- patch_rejected (quality gate) failures

Used for reproducibility and traceability; does not affect prompt construction in PR-E1.
