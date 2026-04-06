# Hum2Song DAW AI Agent Phase-1 Audit

**Update:** The three whitelist capabilities below are **implemented** deterministically in-tree. For a concise freeze / handoff view (included vs not, tests, risks), see **`docs/DAW_AGENT_PHASE1_FREEZE_SNAPSHOT.md`**. This audit remains useful for integration history and contracts; where it disagrees with the snapshot on **current** behavior, prefer the snapshot + `docs/DAW_AGENT_PHASE1_BASELINE.md`.

This document is a **read-only audit** of the current `hum2song-mvp` Studio codebase (browser `static/pianoroll/`, tests under `scripts/tests/`) as of the audit date. It proposes **small, controlled** Phase-1 agent capabilities aligned with existing **ProjectDoc v2 (beats-only)** truth, **BPM as single timebase**, and the **patch → clip revision → persist** pipeline already used by Optimize.

---

## 1. Current integration points in the existing codebase

### Good candidates (agent should plug in here)

| Area | Location | Role |
|------|----------|------|
| **Patch format & application** | `static/pianoroll/core/agent_patch.js` | `H2SAgentPatch.validatePatch`, `applyPatchToClip`, `invertAppliedPatch`, `summarizeAppliedPatch`. Defines allowed ops: `addNote`, `deleteNote`, `moveNote`, `setNote`. Enforces beats-domain edits; **no seconds in storage**. Applies `semanticSanityGate` after apply (caps on ops count, delete ratio, notes/beat, span growth, tiny-duration ratio). |
| **Optimize / LLM gateway** | `static/pianoroll/controllers/agent_controller.js` | `H2SAgentController.create`, `optimizeClip`, `_runLlmV0Optimize`, `buildPseudoAgentPatch`, `_buildPatchFromPreset`, intent + template plumbing (`buildDirectivesBlock`, `collectClipNoteRowsForLlm`). Already encodes **structured intent** (`fixPitch`, `tightenRhythm`, `reduceOutliers`), **safe mode** (velocity-only ops), and **empty-patch no-op** behavior. |
| **Project mutations & revisions** | `static/pianoroll/project.js` | `beginNewClipRevision`, `rollbackClipRevision`, `recomputeClipMetaFromScoreBeat`, `ensureScoreBeatIds`, `normalizeBeat` / `TIMEBASE`, `createClipFromScoreBeat`, `flatten`, `checkProjectV2Invariants`. Revision snapshots live on `clip.revisions` for undo/ghost compare (see smoke test expectations). |
| **App shell & persistence** | `static/pianoroll/app.js` | `getProjectV2`, `setProjectFromV2` (writes LS + rebuilds v1 view + `render`), `commitV2` (currently **alias**: `commitV2(projectV2, reason)` → `setProjectFromV2(projectV2)`), `optimizeClip` (delegates to `agentCtrl`), `rollbackClipRevision`, `setOptimizeOptions` / `getOptimizeOptions`, `runCommand` (`optimize_clip`, `rollback_clip`). **Agent wiring** in `init()`: passes `getProjectV2`, `setProjectFromV2`, `persist`, `render`, `getOptimizeOptions` into `H2SAgentController.create`. |
| **Editor persistence (same v2 truth)** | `static/pianoroll/controllers/editor_runtime.js` | Uses injected `commitV2` / score write paths that ultimately update ProjectDoc v2 and persist—**parallel** to Optimize, not a substitute for patch validation. |
| **Regression harness** | `scripts/tests/agent_patchsummary_smoke.test.js` | Node-safe smoke: `AgentController.create`, `optimizeClip`, expectations on `revisionId` / `parentRevisionId`, `clip.meta.agent`, parent revision score for ghost overlay. Good template for future invariant tests. |

### Canonical patch/revision chain (as implemented today)

For **Optimize** (preset, pseudo, or LLM), the live path is:

1. `H2SAgentPatch.validatePatch(patch, clip)`
2. `H2SAgentPatch.applyPatchToClip(clip, patch, { project })` (internally validates again)
3. `H2SProject.beginNewClipRevision(project, clipId, …)`
4. Copy `applied.clip.score` onto head clip, `recomputeClipMetaFromScoreBeat`
5. `opts.setProjectFromV2(project)` — persists v2 and refreshes UI

Optional: `opts.commitV2` is **invoked only if provided** (`agent_controller.js`); **`app.init` does not pass `commitV2` into `H2SAgentController.create`**, so persistence for Optimize is effectively **`setProjectFromV2` only**. The user-facing “sacred” sequence should be read as **logical** steps: `commitV2` on the app object is redundant with `setProjectFromV2` when both receive the same v2 object (see `app.js` `commitV2` implementation).

**Empty ops (`ops.length === 0`):** both the LLM path and the preset path **return early with success and `noChanges` / `empty_ops`** and **do not** call `beginNewClipRevision` or `setProjectFromV2` for that no-op (`agent_controller.js` around the `opsN === 0` branches). This matches the invariant **ops===0 must not create a new revision**.

### Import flow vs optimize/patch flow (keep separate)

| Import / ingest | Optimize / agent |
|-----------------|------------------|
| `app.js` `uploadFileAndGenerate`, clip creation via `H2SProject.createClipFromScore`, timeline placement, **`persist()`** which builds v2 via `_projectV1ToV2` while **merging v2-only fields** from previous blob | Mutates **existing** `project.clips[clipId]` score through **AgentPatch** + **revision**, then **`setProjectFromV2(project)`** |
| Goal: bring external audio/score **into** the doc | Goal: **controlled edit** of an in-doc clip with audit trail |

**Do not** route import normalization through the agent patch pipeline; **do not** treat `persist()`-from-v1 as the agent’s primary write path—agent edits should stay on **`getProjectV2()` → patch → `setProjectFromV2`**.

### Places that should **not** be primary agent entry points

- **Raw `persist()`** without a coherent v2 head clip (risk of v1→v2 merge obscuring agent-only fields unless `_projectV2` is authoritative).
- **Direct score mutation** on `clip.score` **without** `validatePatch` / `applyPatchToClip` / revision (bypasses audit, semantic gate, and inverse metadata).
- **Playback/export only**: `static/pianoroll/controllers/audio_controller.js` `flattenProjectToEvents` / `H2SProject.flatten` — useful for **acceptance listening tests**, not for mutating project truth.
- **Vocal separation / transcription** code paths (product direction paused per project note)—not listed here by file to avoid scope creep; agent should not depend on them for Phase-1.

---

## 2. Recommended Phase-1 capability whitelist

Three capabilities that map cleanly to **existing patch ops** and existing **gates** (with capability-specific tightening later).

### `velocity_shape`

- **user-facing intent:** “Make the selection louder/softer,” “accent the melody,” “even out dynamics.”
- **recommended scope:** `setNote` with **`velocity` only**; optionally restrict to **selected noteIds** or notes with `startBeat` in `[regionStartBeat, regionEndBeat)` after deterministic resolution.
- **why Phase-1:** Matches **`PRESET_IDS.DYNAMICS_*`**, **`safeMode`** enforcement in `_runLlmV0Optimize` (velocity-only allowed), and **semanticSanityGate** (no structural change). Lowest risk of pitch/timing drift.
- **main risks:** Over-compression of dynamics; touching too many notes at once (mitigate with **max ops** and **region** limits in intent, not just LLM).

### `local_transpose`

- **user-facing intent:** “Transpose this phrase up/down a semitone (or N semitones).”
- **recommended scope:** `setNote` with **`pitch` only**; small **bounded** delta (e.g. ±12 semitones) enforced in a thin **intent post-processor** before patch generation; same note set as above.
- **why Phase-1:** Single field family; no rhythm change; **no seconds**; easy to verify (pitch ± delta). `validatePatch` already bounds pitch 0–127.
- **main risks:** Harmonic nonsense is **musical**, not structural—mitigate with **user-confirmed delta** and **small default**; avoid `addNote`/`deleteNote` in v1 of this capability.

### `rhythm_tighten_loosen`

- **user-facing intent:** “Tighten timing,” “slightly looser feel,” “nudge toward grid.”
- **recommended scope:** Prefer **`moveNote`** (`deltaBeat`) and/or **`setNote`** with **`startBeat` / `durationBeat` only**; **no pitch** in the same patch if intent is pure rhythm (enforce like `safeMode` but for rhythm-only).
- **why Phase-1:** Aligns with existing **`tightenRhythm`** intent and directives in `buildDirectivesBlock`; uses the same ops the LLM path already documents.
- **main risks:** **`semanticSanityGate`** (span growth, density, delete ratio); accidental large moves; **velocity-only quality gate** when pitch/rhythm intent is on—rhythm capability must **not** be confused with that gate. Prefer **deterministic** grid nudges for first implementation where possible.

---

## 3. Explicit Phase-1 blacklist / deferred capabilities

| Capability | Why defer |
|------------|-----------|
| “Make this a chorus / bridge / drop” | Requires **section semantics**, form labels, and large-scale note generation—not in schema; would push `addNote`/`deleteNote` and blow semantic gates. |
| “Make it catchier / more emotional / better” | Unbounded aesthetic goal; no verifiable acceptance. |
| “Generate accompaniment / harmonies / second voice” | Multi-voice **structure** + `addNote` heavy; conflicts with **small local edits** and density limits (`MAX_NOTES_PER_BEAT`). |
| “Rewrite the whole section/song” | Mass delete/add; violates **controlled edit** and **delete ratio** / **span growth** guards. |
| Large **density** change (“more notes”, “fill space”) | Triggers **semantic** density and span checks; high hallucination risk. |
| **Phrase variation** / **motivic transform** | Needs musical judgment + multi-note correlated edits; harder to test than independent local ops. |
| **Project-level** instance moves, tempo map, global BPM automation | Phase-1 should stay **clip score**-local; BPM is **single project truth**—changing it is a **different** product action than clip edit. |
| **Persistent seconds** as edit truth | Violates ProjectDoc v2 contract (`docs/PROJECTDOC_V2_BEATS_SPEC.md`). |

---

## 4. Controlled edit action contract draft

Below, **target_scope** is always resolved to **concrete `noteId`s** inside **one `clipId`** before ops are built.

### `velocity_shape`

| Field | Definition |
|-------|------------|
| **target_scope** | `{ clipId, noteIds: string[] }` with optional `{ startBeatMin, startBeatMax }` filter applied **deterministically** to restrict `noteIds`. |
| **allowed_ops** | `setNote` with **only** `velocity` (and required `noteId`). |
| **forbidden_ops** | `addNote`, `deleteNote`, `moveNote`, `setNote` with `pitch`, `startBeat`, or `durationBeat`. |
| **required_constraints** | Every `noteId` must exist in `clip.score`; patch `ops.length ≤ N` (N configured per product, ≤ `SEMANTIC_LIMITS.MAX_OPS`). |
| **expected invariants** | `project.bpm` unchanged; clip **beats-only** score; `recomputeClipMetaFromScoreBeat` consistent; no new revision if **ops.length === 0**. |
| **failure / abort** | `validatePatch` failure; semantic gate failure; empty target note set; user abort. |
| **acceptance signals** | Monotonic or bounded velocity change per intent; `summarizeAppliedPatch` shows velocity deltas; **rollback** restores parent revision. |

### `local_transpose`

| Field | Definition |
|-------|------------|
| **target_scope** | `{ clipId, noteIds, deltaSemitones: integer in [-12,12] }` (hard cap in agent layer). |
| **allowed_ops** | `setNote` with **only** `pitch` (computed per note from previous pitch + delta, clamped 0–127). |
| **forbidden_ops** | `moveNote`; `setNote` timing/velocity fields; `addNote`/`deleteNote` in Phase-1. |
| **required_constraints** | All `noteId`s exist; **single shared delta** for the whole patch (simplest, testable). |
| **expected invariants** | Same as above; note count unchanged. |
| **failure / abort** | Any op touching non-target noteId; pitch clamp changing intended musical interval (surface warning—optional). |
| **acceptance signals** | All target pitches shift by **exactly** `deltaSemitones` modulo clamp at boundaries; inverse patch restores. |

### `rhythm_tighten_loosen`

| Field | Definition |
|-------|------------|
| **target_scope** | `{ clipId, noteIds, mode: 'tighten'|'loosen', strength: 0–1 }` mapped to **max `abs(deltaBeat)`** per note or grid snap strength. |
| **allowed_ops** | **`setNote` with `startBeat` and/or `durationBeat` only** in the shipped deterministic implementation (`moveNote` not used there). |
| **forbidden_ops** | `setNote.pitch`; `addNote`/`deleteNote` (Phase-1 strict mode). |
| **required_constraints** | `startBeat ≥ 0`, `durationBeat > 0` after edit; per-op delta caps; optional **grid** in beats (e.g. 1/16) from `project.bpm`-derived snap in **processor**, not LLM-invented seconds. |
| **expected invariants** | Pitches unchanged (verify by comparing before/after for targeted notes); span growth within **`SEMANTIC_LIMITS`** or stricter product cap. |
| **failure / abort** | `semanticSanityGate` error; validation error; zero net change → **no revision** (do not emit spurious ops—strip no-ops before submit). |
| **acceptance signals** | Timing deltas within cap; ghost overlay vs parent revision shows only timing moves. |

---

## 5. Natural-language narrowing strategy

Goal: **small, explicit structured intent** before any patch JSON is produced—**not** a full NLP system.

**Recommended pipeline (Phase-1 realistic):**

1. **Resolve scope (deterministic):**  
   - **Clip:** from `selectedClipId` / active inspector / last optimized clip (product rule).  
   - **Notes:** from piano-roll selection if present; else “all notes in clip” only if user confirms; else abort with “select notes or region.”

2. **Map utterance → `capability_id` with a tiny keyword/regex tier + disambiguation:**  
   - Loud/soft/velocity/dynamics → `velocity_shape`  
   - Up/down/semitone/transpose/key → `local_transpose`  
   - Tight/loose/rush/drag/grid/timing → `rhythm_tighten_loosen`  

3. **Extract parameters:**  
   - **Strength:** 0–1 or { low, medium, high } → mapped to numeric caps (velocity delta range, max `abs(deltaBeat)`, transpose delta).  
   - **Direction:** up/down; tighten vs loosen.  
   - **Hard constraints from UI toggles:** e.g. “rhythm only” disables pitch ops at the **contract** layer (mirrors `safeMode` idea).

4. **Optional LLM (only if needed):**  
   - LLM output is **not** free-form score; it should output **only** a **filled `AgentPatch`-compatible JSON** that has been **pre-filtered** by allowed op types, or (better) **deterministic codegen** from structured intent with **no LLM** for Phase-1 vertical slice.

5. **Reject:**  
   - Multi-sentence “arrangement” requests → respond with “out of scope; pick one: transpose, dynamics, or timing.”

---

## 6. Regression and acceptance plan

### Fixed natural-language regression cases (intent-level)

| # | User phrase (example) | Expected `capability_id` | Expected rejection / defer |
|---|-------------------------|--------------------------|----------------------------|
| 1 | “Softer in the selected bars” | `velocity_shape` | — |
| 2 | “Transpose selection up one semitone” | `local_transpose`, delta +1 | — |
| 3 | “Tighten the timing a little” | `rhythm_tighten_loosen`, tighten | — |
| 4 | “Make this a huge chorus drop” | — | Defer (blacklist) |
| 5 | “Add harmony notes under the melody” | — | Defer |
| 6 | “Do nothing” / empty selection with no op | — | No patch; **no revision** |

### Structural acceptance checks (engineering)

- **Patch:** `H2SAgentPatch.validatePatch` passes; `applyPatchToClip` returns `ok`; **semanticSanityGate** passes (or stricter pre-check prevents failure).
- **Revision:** After non-empty patch, `beginNewClipRevision` succeeds; `parentRevisionId ===` previous `revisionId` (see `agent_patchsummary_smoke.test.js`).
- **Meta:** `recomputeClipMetaFromScoreBeat` matches note counts and `spanBeat`.
- **Persistence:** `setProjectFromV2` returns ok; reload from LS (or `getProjectV2`) sees same score.
- **Invariant:** `H2SProject.checkProjectV2Invariants` (or subset) on saved doc—no `spanSec`, no `playheadSec` in v2 ui path.

### Revision / patch safety checks

- **Rollback:** `rollbackClipRevision` restores playable state; parent revision score exists for diff/ghost.
- **Inverse metadata:** `appliedPatch` / `inversePatch` from `applyPatchToClip` available for future undo UX (already produced in `agent_patch.js`).

### No-op behavior

- **Zero ops** after filtering: must **not** call `beginNewClipRevision`; must match existing Optimize behavior for `empty_ops`.

### Rollback expectations

- User can undo to **parent revision** after a bad-sounding but valid edit; invalid patch **never** lands on head.

---

## 7. Recommended first vertical slice

**Historical note (pre-implementation):** The original recommendation was to ship **`velocity_shape` → `local_transpose` → `rhythm_tighten_loosen`** in that order. **As implemented**, all three deterministic slices exist; use **`docs/DAW_AGENT_PHASE1_FREEZE_SNAPSHOT.md`** for current handoff truth.

**First (end-to-end): `velocity_shape`**

- **Why first:** Narrowest op surface (`setNote.velocity` only); strongest alignment with existing **`DYNAMICS_*` presets**, **`safeMode`** validation in `agent_controller.js`, and **`semanticSanityGate`** (no add/delete). Easiest **deterministic** implementation (skip LLM entirely for slice-1). Easiest tests (velocity bounds, no-op, rollback).

**Second:** `local_transpose` — single-parameter family; still no rhythm side effects.

**Third:** `rhythm_tighten_loosen` — higher interaction with **`semanticSanityGate`** and user-perceptual acceptance; build after the first two prove the pipeline.

---

## 8. Open questions

1. **Selection model:** Does Phase-1 assume **note-id multi-select** from the piano roll only, or also **beat-range** selection on the timeline? (Affects `target_scope` resolution; codebase has clip-level optimize today, not a unified “selection bus” for the agent.)

2. **LLM vs deterministic:** Should the first shipped Phase-1 feature be **100% deterministic** (recommended for `velocity_shape`), with LLM reserved for later prompts?

3. **`commitV2` wiring:** Should `H2SAgentController` optionally accept `commitV2: (p2, reason) => app.commitV2(p2, reason)` for consistency with the documented **validate → apply → revision → setProjectFromV2 → commitV2** narrative, or is **`setProjectFromV2` alone** the intentional persist hook? (Today, **`commitV2` is not passed** into `create()`.)

---

*End of audit.*
