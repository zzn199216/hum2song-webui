# Phase-1 deterministic DAW AI baseline — freeze snapshot

**Purpose:** Compact handoff for “what is frozen,” what is out of scope, and where to look next. This is **not** a full design spec — see `docs/DAW_AGENT_PHASE1_BASELINE.md` for baseline detail and `docs/DAW_AGENT_PHASE1_AUDIT.md` for historical integration context.

---

## What this freeze includes

- **Three deterministic optimize presets** (no LLM required for these paths):
  - `velocity_shape` — `setNote` **velocity** only  
  - `local_transpose` — `setNote` **pitch** only  
  - `rhythm_tighten_loosen` — `setNote` **startBeat** / **durationBeat** only (conservative timing regularization; **not** `moveNote` in the shipped implementation)
- **Shared metadata:** `patchSummary.phase1Deterministic` via `static/pianoroll/core/phase1_deterministic_meta.js` (`intentSource`, `executionPath`, `targetScope`, optional `presetDefaultDescription`).
- **Assistant deterministic routing:** `static/pianoroll/core/phase1_assistant_narrow.js` + `_resolvePhase1AssistantIntentForSend` / `_resolvePhase1AssistantIntentAppFallback` in `static/pianoroll/app.js` (rhythm → transpose → velocity; fallback if the narrow bundle is missing or throws).
- **Patch / revision discipline:** `validatePatch` → `applyPatchToClip` → `beginNewClipRevision` when `ops > 0`; **`ops === 0` does not create a revision**; returns interpretable `patchSummary` (including no-op).
- **Project truth:** ProjectDoc v2 **beats** for score timing; BPM as project tempo truth; no persistent seconds as score edit truth.

---

## What is explicitly NOT included

- New **capabilities** beyond the three above (no density edit, harmony, accompaniment, phrase rewrite, chorus/catchiness, etc.).
- **LLM optimize** (`llm_v0`) as part of this freeze definition — it exists in the app but is **outside** the deterministic Phase-1 baseline contract.
- **Import / transcription** pipeline as agent entry; keep import vs optimize paths separate.
- **Broad NL** or Assistant **UI** redesign.
- **`commitV2` vs `setProjectFromV2`** architecture resolution — intentionally unchanged here.

---

## Target scope (all three)

- Non-empty `velocityShapeNoteIds` / `localTransposeNoteIds` / `rhythmNoteIds` → only those notes (`targetScope: note_ids` when ids present).
- Else → whole clip (`targetScope: whole_clip`).
- Empty candidate set → `ops === 0`, no revision.

---

## `intentSource` (Phase-1 deterministic)

| Value | Meaning |
|-------|---------|
| `explicit_options` | Intent from options / Assistant card (structured). |
| `narrowed_from_prompt` | Resolved from `userPrompt` by slice narrowers. |
| `preset_default` | No explicit intent / no matching phrase → slice default (see `describePhase1PresetDefault`). |

---

## Preset defaults (no explicit intent, no matching phrase)

- **velocity_shape:** `more_even`, `medium` strength.  
- **local_transpose:** `+1` semitone (clamped ±12; pitch 0–127).  
- **rhythm_tighten_loosen:** `tighten`, `medium` strength.

---

## No-op vs revision

- **`ops === 0`:** No `beginNewClipRevision`; success return still carries **`patchSummary`** (e.g. `noChanges` / `empty_ops`) and **`phase1Deterministic`** where applicable.  
- **`ops > 0`:** New revision; **`patchSummary`** on return matches clip meta for deterministic runs.

---

## Assistant precedence & fallback (summary)

1. Rhythm narrow → 2. Transpose narrow → 3. Velocity narrow (first match wins).  
2. Try centralized `resolvePhase1AssistantIntentFromText`; on failure, `resolvePhase1AssistantIntentFromTextInline` if API exists; else **`_resolvePhase1AssistantIntentAppFallback`** in `app.js` (must stay aligned with inline).

---

## Test entry points (run under Node)

| Suite | Role |
|-------|------|
| `scripts/tests/phase1_deterministic_contract.test.js` | Shared Phase-1 contract |
| `scripts/tests/phase1_assistant_precedence.test.js` | Precedence |
| `scripts/tests/phase1_assistant_fallback.test.js` | Fallback / inline |
| `scripts/tests/phase1_freeze_e2e_smoke.test.js` | E2E phrase → narrow → `optimizeClip` |
| `scripts/tests/velocity_shape.test.js`, `local_transpose.test.js`, `rhythm_tighten_loosen.test.js` | Per-slice |
| `scripts/run_frontend_all_tests.js` | Aggregates the above with other frontend tests |

---

## Main remaining small risks

- **Script load order** in `static/pianoroll/index.html` (slice scripts before `phase1_assistant_narrow.js` before app behavior that depends on globals).  
- **Drift** between `_resolvePhase1AssistantIntentAppFallback` and `resolvePhase1AssistantIntentFromTextInline`.  
- **E2E smoke** does not execute real browser `app.js` `_aiAssistSend` — it mirrors narrow + `optimizeClip`.  
- **Audit doc** §7 “recommended first slice” reflected pre-implementation order; implementation order differed — use this snapshot + baseline as **current** truth.

---

## Recommended next step after freeze

**Do first**

1. Run `node scripts/run_frontend_all_tests.js` on a clean checkout before any agent-related merge.  
2. For any change under `static/pianoroll/controllers/agent_controller.js`, `static/pianoroll/core/agent_patch.js`, or Phase-1 cores, extend or run the **contract + smoke** tests above.  
3. Read this snapshot + `DAW_AGENT_PHASE1_BASELINE.md` before adding behavior so included / not-included boundaries stay clear.

**Avoid immediately (without a new spec / review)**

- Adding a **fourth** Phase-1-style capability “in passing.”  
- Large **refactors** of optimize, revision chains, or `commitV2` wiring.  
- **Expanding** NL phrase sets without tests and without updating baseline docs.

**Likely narrow follow-on engineering (not prescriptive):** Phase-2 features **behind explicit flags** or separate presets; or hardening **LLM** paths **without** conflating them with the deterministic Phase-1 contract — but product priority is out of scope for this document.

---

*This snapshot is a packaging aid for freeze handoff; it does not replace reading the code for edge cases.*
