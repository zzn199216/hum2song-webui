# DAW agent — Phase-1 deterministic baseline

**Freeze handoff (short):** `docs/DAW_AGENT_PHASE1_FREEZE_SNAPSHOT.md` — what is in/out of the Phase-1 baseline, test entry points, and next-step hints.

This document describes the **current** deterministic optimize path (no LLM in these slices). It is a **narrow** contract for debugging and regression tests, not a full product spec.

## Scope

Three presets share one metadata pattern (`patchSummary.phase1Deterministic` via `H2SPhase1DeterministicMeta`):

| Preset ID | Capability | Edits allowed |
|-----------|------------|----------------|
| `velocity_shape` | Velocity shaping | `setNote` with **velocity** only |
| `local_transpose` | Local transpose | `setNote` with **pitch** only |
| `rhythm_tighten_loosen` | Rhythm tighten / loosen / even | `setNote` with **startBeat** and/or **durationBeat** only |

**Not in Phase-1:** add/delete notes, track/clip structure changes, density/harmony/accompaniment, phrase rewriting, humanize/swing expansion, import pipeline behavior.

## Target scope

- If the UI passes non-empty `*NoteIds` for that slice (`velocityShapeNoteIds`, `localTransposeNoteIds`, `rhythmNoteIds`), only those notes are candidates.
- Otherwise the **whole clip** score is the target (`targetScope: whole_clip` in metadata).
- Empty target → `ops === 0` (no revision).

## Intent sources (`intentSource`)

| Value | Meaning |
|-------|---------|
| `explicit_options` | Structured intent came from options (e.g. inspector / programmatic). |
| `narrowed_from_prompt` | Matched from `userPrompt` text by the slice’s small deterministic narrowers. |
| `preset_default` | No explicit intent and no matching phrase → slice-specific defaults (see below). |

`patchSummary.phase1Deterministic.presetDefaultDescription` is set **only** when `intentSource === preset_default`, so preset-only behavior is visible in metadata.

## Preset defaults (no prompt / no explicit intent)

- **velocity_shape:** `mode=more_even`, `strength=medium` (see `describePhase1PresetDefault('velocity_shape')`).
- **local_transpose:** `semitone_delta=+1` (clamped ±12; pitch clamped 0–127).
- **rhythm_tighten_loosen:** `mode=tighten`, `strength=medium`.

## Assistant dock: narrowing precedence

Free-text in the Assistant uses **one** deterministic branch per message, in this order (first match wins):

1. `rhythm_tighten_loosen` — `H2SRhythmTightenLoosen.narrowRhythmIntentFromText`
2. `local_transpose` — `H2SLocalTranspose.narrowLocalTransposeIntentFromText`
3. `velocity_shape` — `H2SVelocityShape.narrowVelocityShapeIntentFromText`

Implementation: `static/pianoroll/core/phase1_assistant_narrow.js` (`H2SPhase1AssistantNarrow`), used by `app.js` `_aiAssistSend` via `_resolvePhase1AssistantIntentForSend`.

**Availability / fallback:** `_aiAssistSend` tries `resolvePhase1AssistantIntentFromText` first; if it throws or the entry point is missing, it uses `resolvePhase1AssistantIntentFromTextInline` on the API object when present; if the whole narrow bundle is absent, a **minimal duplicate** in `app.js` (`_resolvePhase1AssistantIntentAppFallback`) runs the same rhythm → transpose → velocity order. Keep that duplicate aligned with `resolvePhase1AssistantIntentFromTextInline`.

**Why order matters:** e.g. “make this more even rhythmically” must resolve to **rhythm** (`even`), not velocity dynamics (“more even”). “Make this tighter” is intentionally classified as **rhythm** (not transpose/velocity).

## No-op (`ops === 0`)

- **No new clip revision** when the built patch has zero ops.
- The optimize call still returns **`patchSummary`** (including `phase1Deterministic` for these presets) so runs are inspectable without reading `clip.meta` only.
- Typical reasons: already at clamp, grid-aligned rhythm with no effective delta, or empty target.

## Successful apply (`ops > 0`)

- Normal patch validation + `applyPatch` + `beginNewClipRevision` (existing project rules).
- The optimize **return value** includes **`patchSummary`** (same payload written to `clip.meta.agent.patchSummary`) for deterministic runs, so tests and callers can read metadata without scraping the clip only.

## Regression tests

- Shared contract: `scripts/tests/phase1_deterministic_contract.test.js`
- Assistant precedence: `scripts/tests/phase1_assistant_precedence.test.js`
- Assistant fallback / inline: `scripts/tests/phase1_assistant_fallback.test.js`
- Per-slice: `scripts/tests/velocity_shape.test.js`, `local_transpose.test.js`, `rhythm_tighten_loosen.test.js`

## Freeze-readiness (Phase-1 baseline)

**What “freeze-ready” means here:** the three deterministic presets behave consistently under tests, expose interpretable `patchSummary.phase1Deterministic` + `executionPath`, respect revision rules (`ops===0` → no new revision), and the Assistant-style narrowing → `optimizeClip` path can be exercised without the full browser shell.

**End-to-end smoke (higher-level):** `scripts/tests/phase1_freeze_e2e_smoke.test.js` — phrase → `H2SPhase1AssistantNarrow` → options shaped like an Assistant run → `optimizeClip`; one success path per slice, a no-op case, and a prompt-only velocity case (`narrowed_from_prompt`). This **does not** replace contract or per-slice tests; it adds a thin whole-pipeline check.

**Intentionally out of scope for this baseline:** LLM optimize (`llm_v0`), import/transcription, UI/DOM Assistant dock, broad phrase coverage, Phase-2+ capabilities (density, harmony, etc.).

**Known small risks (unchanged):** slice scripts must load before narrow/optimize; `app.js` `_resolvePhase1AssistantIntentAppFallback` must stay aligned with `resolvePhase1AssistantIntentFromTextInline`; cache or script-order mistakes can still break routing in production until caught by CI.

## Invariants (unchanged)

- ProjectDoc v2, **beats** as timeline truth for score; BPM single source of truth for tempo.
- Do not bypass `validatePatch` / semantic gates; `ops===0` must not create a revision.
- Import vs optimize paths stay separate; no architectural change to `commitV2` vs `setProjectFromV2` here.
