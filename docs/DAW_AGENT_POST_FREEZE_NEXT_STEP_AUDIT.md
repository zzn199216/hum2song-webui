# Hum2Song Post-Freeze Next-Step Audit

**Status:** Read-only planning audit (post-freeze). Does not change code. Grounded in `docs/DAW_AGENT_PHASE1_FREEZE_SNAPSHOT.md`, `docs/DAW_AGENT_PHASE1_BASELINE.md`, and `docs/DAW_AGENT_PHASE1_AUDIT.md`.

---

## 1. Current frozen baseline assumptions

The following are treated as **stable enough to build on** without reopening Phase-1 design:

- **Three deterministic optimize presets:** `velocity_shape`, `local_transpose`, `rhythm_tighten_loosen` — each with a narrow `setNote` field family, beats-only score edits, and shared **`patchSummary.phase1Deterministic`** metadata (`H2SPhase1DeterministicMeta`).
- **Regression + smoke:** contract tests, Assistant precedence/fallback tests, per-slice tests, and **`phase1_freeze_e2e_smoke.test.js`** (phrase → narrow → `optimizeClip` in Node).
- **Assistant deterministic routing:** `phase1_assistant_narrow.js` + **`app.js`** fallback aligned with **`resolvePhase1AssistantIntentFromTextInline`**.
- **Patch/revision rules:** `validatePatch` → apply → `beginNewClipRevision` when `ops > 0`; **`ops === 0` → no revision**; interpretable **`patchSummary`** on returns.
- **Explicit boundary:** **`llm_v0`** and import/transcription are **not** part of the Phase-1 freeze contract (`DAW_AGENT_PHASE1_BASELINE.md`).

---

## 2. Realistic next-step options

### Option A — Bounded LLM optimize hardening (same preset, clearer contract)

**What it is:** Improve **reliability, observability, and tests** around the existing **`llm_v0`** path in `agent_controller.js` (`_runLlmV0Optimize`): rejection reasons, **`patchSummary`** / execution trace consistency, safe-mode and quality-gate behavior, and a small set of **deterministic or scripted** regression cases — **without** changing Phase-1 presets or merging LLM metadata into **`phase1Deterministic`**.

**Why attractive:** The LLM path is already integrated; the freeze docs call it out as adjacent but outside Phase-1. Hardening it respects “don’t blur deterministic Phase-1 with LLM” by **making the boundary explicit in behavior and tests** (e.g. `executionPath: 'llm'` vs Phase-1 paths). Uses existing patch/revision gates.

**Why risky:** LLM nondeterminism and external config (model, base URL) complicate CI; risk of scope creep into “make the LLM smarter” instead of “make failures and successes legible.”

---

### Option B — Phase-2 planning artifact (one next capability, spec + guardrails only)

**What it is:** Produce a **short written spec** (and optionally a **placeholder preset id** reserved in docs only) for **one** next capability (e.g. density or a constrained structural edit) with explicit **allowlist ops**, **semantic limits**, **target scope**, and **flag / separate preset** strategy — **no implementation** until reviewed.

**Why attractive:** Product direction is chosen before code; avoids “fourth Phase-1 slice” arriving by accident; aligns with freeze snapshot’s “Phase-2 behind flags or separate presets.”

**Why risky:** Spec work can stall; temptation to over-specify or bundle multiple features; still does not improve shipped behavior until implementation starts.

---

### Option C — CI / browser smoke for real Assistant `_aiAssistSend`

**What it is:** Add a **minimal** automated check (e.g. headless browser or existing test harness) that loads **`index.html` script order**, exercises **`_aiAssistSend`** / Run path enough to prove **narrow + optimize** in a real DOM context — addressing the known gap that Node E2E smoke does not run **`app.js`** Assistant directly (`DAW_AGENT_PHASE1_FREEZE_SNAPSHOT.md`).

**Why attractive:** Closes the highest **operational** fragility (script order / global wiring) with a thin end-to-end check.

**Why risky:** Flaky tests, maintenance cost, may duplicate `ai_assist_dock.test.js` unless scoped narrowly; not a substitute for LLM or Phase-2 product work.

---

## 3. Recommended next step

**Choose Option A — bounded LLM optimize hardening first.**

**Why first**

1. **Same repo reality:** `agent_controller.js` already implements **`llm_v0`** alongside deterministic presets; users can hit LLM optimize without a separate product initiative. Improving **failure clarity**, **traceability**, and **regression coverage** for that path increases overall Studio trust **without** expanding Phase-1 surface area.
2. **Reinforces the freeze boundary:** Phase-1 stays **`patchSummary.phase1Deterministic`** + fixed `executionPath` values; LLM stays on **`executionPath: 'llm'`** (or equivalent) with its own summary fields — documented and tested so the two are never confused in code or UX.
3. **Lower coordination cost than Option B:** Does not require locking a Phase-2 product decision; fits “small acceptance criteria” below.
4. **Option C** remains a strong **second** follow-on if Assistant wiring regressions appear in production. **Option B** fits when the team is ready to name **one** next capability with sign-off.

---

## 4. What should not be done immediately

- **Add a fourth Phase-1-style deterministic capability** without a new spec, tests, and baseline doc update (explicitly warned in `DAW_AGENT_PHASE1_FREEZE_SNAPSHOT.md`).
- **Large refactors** of `optimizeClip`, revision chains, or **`commitV2` vs `setProjectFromV2`** (deferred per freeze docs).
- **Merge LLM outputs into `phase1Deterministic`** or reuse Phase-1 preset ids for nondeterministic behavior — blurs the frozen contract.
- **Broad NL / Assistant dock redesign** as the “next” step — out of scope for a narrow engineering follow-on.
- **Vocal separation / transcription** as the mainline agent path — paused per audit assumptions; keep import vs optimize separate.
- **“Use AI more”** without concrete gates, tests, and trace fields — invites unbounded scope.

---

## 5. Success criteria for the recommended next step

For **Option A (LLM optimize hardening)**, success is **small and verifiable**:

1. **Documentation:** A short note (could live in `DAW_AGENT_PHASE1_BASELINE.md` or a sibling doc) stating how **`llm_v0`** differs from Phase-1 deterministic paths in **`patchSummary`** / **`executionPath`** — no requirement to merge with **`phase1Deterministic`**.
2. **Tests:** At least one **new or extended** Node regression that asserts stable outcomes for **controlled inputs** (e.g. mock LLM response, or existing harness) covering: reject path (`ops === 0`, no revision), and success path (ops > 0, revision, **`patchSummary`** fields present). Existing **`regression_templates_directives.test.js`** / **`agent_patchsummary_smoke.test.js`** may be extended rather than duplicating.
3. **Observability:** Failed or rejected LLM optimize runs expose a **consistent** reason chain in **`patchSummary`** or return object (no silent no-op without metadata).
4. **Invariant preserved:** Deterministic Phase-1 tests (**`scripts/run_frontend_all_tests.js`** Phase-1 suite) remain green **unchanged** in intent; no change to Phase-1 preset behavior unless fixing a demonstrable bug.

If these are met, the next step can hand off to **Option C** (browser smoke) or **Option B** (Phase-2 spec) without blocking on each other.

---

## 6. Open questions

1. **CI policy for LLM:** Will automated tests **mock** the LLM entirely, or run optional integration jobs with secrets? This affects how strict Option A’s regression can be in default CI.
2. **Product priority:** Is user-visible improvement to **LLM optimize** or to **new edit types** (Phase-2) more important for the next quarter? This decides whether Option B should follow A immediately or later.
3. **`commitV2`:** Is unifying **`commitV2`** with **`setProjectFromV2`** for Optimize ever a goal, or permanently “nice to have”? (Audit notes app does not pass **`commitV2`** into the agent.) Affects whether any future hardening touches persistence.

---

**Follow-up (implemented as a first slice):** bounded `llm_v0` observability — see `docs/DAW_AGENT_LLM_V0_HARDENING.md` and `scripts/tests/llm_v0_optimize_hardening.test.js`.

*End of post-freeze next-step audit.*
