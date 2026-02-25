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

---

## Template Tuning Guide (PR-E6a)

Guide for prompt/template iteration: reproducible, engineering-driven.

### 1. Success criteria (by patchSummary flags)

| Template | Success criteria |
|----------|------------------|
| **Fix Pitch** | `hasPitchChange` true; preserve melody contour; avoid full rewrite; avoid large pitch jumps |
| **Tighten Rhythm** | `hasTimingChange` true; avoid chaotic moves; keep groove consistent |
| **Clean Outliers** | `hasStructuralChange` allowed; avoid over-deleting; keep main melodic line |
| **Bluesy** | `hasPitchChange` true (micro-tones/bends); tasteful; preserve contour |

### 2. Common failures and how to tune

| Failure mode | Tuning lever |
|--------------|--------------|
| **Gate fail (velocity-only)** | Strengthen required-ops wording in DIRECTIVES; explicit "include setNote with pitch" or "include moveNote" |
| **Over-edit / rewrite** | Add "small edits", edit budget, contour constraint; "prefer minimal ops" |
| **Too many deletes** | Cap delete ratio; prefer soften/velocity before delete; "avoid deleteNote unless glitch" |
| **Rhythm becomes messy** | Constrain move magnitude; duration stability; "avoid large deltaBeat" |

### 3. Versioning rules

- **Bump `promptVersion`** on any behavioral change: `tmpl_v1.fix_pitch.r1`, `tmpl_v1.fix_pitch.r2`, etc.
- **Keep `templateId` stable**; only `promptVersion` changes.
- Enables A/B comparison and rollback without UI changes.

### 4. Suggested standard test clips

| Clip type | Purpose |
|-----------|---------|
| (1) Mostly in-tune | Low-change baseline; should yield ops≈0 or minimal |
| (2) Pitchy / out-of-key | Fix Pitch target; expect hasPitchChange true |
| (3) Rhythm jitter / noisy outliers | Tighten Rhythm + Clean Outliers; expect hasTimingChange and limited structuralChange |
