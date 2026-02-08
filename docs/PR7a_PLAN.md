# PR-7a Plan Package: LLM configuration scaffold (Phase 0 — no code)

**Baseline:** PR-5 and PR-6 accepted; tag `baseline-pr5`.  
**Scope:** Phase 0 only. No code changes in this deliverable.

---

## 1. Implementation Plan (Step-by-step)

### Step 7a-1: Repo hygiene + docs

- **.env.example**  
  Add placeholder variables only (no real secrets). Suggested keys: e.g. `LLM_BASE_URL=`, `LLM_MODEL=`, `LLM_AUTH_TOKEN=` (or similar). Keep existing keys (APP_ENV, UPLOAD_DIR, etc.). Values must be empty or example placeholders (e.g. `https://your-gateway/v1`).  
  **Important:** `.env.example` is mainly for gateway/proxy or future backend usage. The frontend build/runtime does **not** automatically read a `.env` file in the repo unless the build system explicitly injects it. Do not imply that putting provider keys in the repo folder is safe.

- **.gitignore**  
  Ensure `.env`, `.env.local`, and common `.env.*.local` are ignored. Repo already has `.env` and `.env.*`; add explicit `.env.local` and `.env.*.local` if not already covered by `.env.*`, so that local overrides are never committed.

- **README / docs**  
  Update `README.md` (and optionally a short doc in `docs/`) to:
  - Explain **gateway-first** setup: recommend an OpenAI-compatible endpoint (e.g. local or self-hosted proxy) so the browser never stores a provider “real key”.
  - State that the frontend stores only: base URL, model, and optional gateway auth token (not the provider key).
  - Add a short **security notes** section: do not put provider API keys in the browser; use a gateway or backend proxy; keep `.env` and `.env.local` out of version control.

All changes in 7a-1 are repo hygiene and documentation only; no frontend runtime or Node test code.

---

### Step 7a-2: Node-safe config module (no UI, no network)

- **New localStorage key (do not touch existing):**  
  `hum2song_studio_llm_config`  
  Existing key `hum2song_studio_opt_options_by_clip` must not be changed or referenced by this step.

- **New module** (e.g. `static/pianoroll/llm_config.js`):
  - Export a small API: e.g. `loadLlmConfig()`, `saveLlmConfig(config)`, `resetLlmConfig()`.
  - Shape of config: `{ baseUrl, model, authToken }` (or equivalent; values string or null/empty).
  - **Node-safe:** no top-level access to `window`, `document`, or `localStorage`. All reads/writes to `localStorage` must be inside functions, guarded by `typeof localStorage !== 'undefined'` (or equivalent), so that Node tests that require the module do not throw at load time.
  - No network calls. No logging of `authToken` or any secret (log only presence/absence or length if needed).

- **Integration:**  
  No UI and no wiring into Optimize flow yet. **NOT DOING:** Do not require/import `llm_config.js` from Node tests. The module will be **browser-loaded via a script tag** in Step 7a-3, not imported by the Node test runner. No changes to `app.js`, `agent_controller.js`, or timeline/timebase.

---

### Step 7a-3: UI in Optimize panel (Advanced section)

- **Location:**  
  Optimize panel in the clip editor modal. Place the new controls inside or immediately after the existing **Advanced** `<details>` block (which currently contains Rev/Parent) in `static/pianoroll/index.html`. Use the same pattern as existing editor controls (ids, class names) so that existing styles and scripts keep working.

- **New inputs (all optional from a storage perspective):**
  - **Base URL** (text input; placeholder e.g. OpenAI-compatible endpoint).
  - **Model** (text input; placeholder e.g. model name).
  - **Auth Token** (input `type="password"`; placeholder only, no default value).

- **Buttons:**
  - **Save** — reads current values from the three inputs, calls the 7a-2 save API (e.g. `saveLlmConfig({ baseUrl, model, authToken })`), then updates status (e.g. “Saved” or “Config saved”) in a small status element. Do not log token values.
  - **Reset** — calls the 7a-2 reset API (clears only the LLM config key), then clears the three input values in the UI and updates status (e.g. “Config reset”). Must not clear `hum2song_studio_opt_options_by_clip` or any other key.

- **Initial state:**  
  On open of the Advanced section (or when the modal opens), populate the three inputs from the 7a-2 load API. If a value is missing, use empty string. Use `document.getElementById` (or equivalent) only when `document` is defined; guard all DOM access so that Node tests that load the same code path do not run DOM-dependent code at top level.

- **Regression:**  
  Ensure global keydown handlers (in `static/pianoroll/app.js` and any in `editor_runtime.js`) do not swallow Backspace/Delete when focus is in the new inputs. The existing guard using `ev.composedPath()` (or target) for INPUT/TEXTAREA/contenteditable must apply to these new fields; add a regression check in the verification checklist (e.g. focus each new input, type, Backspace/Delete).

- **Scope:**  
  Only add the new form + Save/Reset + wiring to the 7a-2 module. Do not change Optimize/Rollback/Regenerate/Reset-to-default-prompt behavior, and do not change timeline or timebase logic.

---

## 2. File Change List (per step)

### Step 7a-1

| Action   | File path |
|----------|-----------|
| Modify   | `.env.example` — add LLM placeholders (e.g. `LLM_BASE_URL`, `LLM_MODEL`, `LLM_AUTH_TOKEN`) |
| Modify   | `.gitignore` — ensure `.env`, `.env.local`, `.env.*.local` are ignored (add lines if not already covered) |
| Modify   | `README.md` — add “Gateway-first setup” and “Security notes” for LLM config |
| Optional | `docs/` — add or update a short doc (e.g. `docs/LLM_CONFIG.md`) for gateway-first and security |

### Step 7a-2

| Action | File path |
|--------|-----------|
| Create | `static/pianoroll/llm_config.js` — load/save/reset for key `hum2song_studio_llm_config`; Node-safe, no top-level `window`/`document`/`localStorage`; no network; no logging of secrets |

No other files in 7a-2. Do not modify `static/pianoroll/app.js`, `agent_controller.js`, or any timeline/project core.

### Step 7a-3

| Action | File path |
|--------|-----------|
| Modify | `static/pianoroll/index.html` — inside or next to the existing Advanced `<details>`, add: three inputs (Base URL, Model, Auth Token password), Save button, Reset button, and a small status element for “Saved” / “Config reset” |
| Modify | `static/pianoroll/controllers/editor_runtime.js` — in the same place where other editor controls are bound (e.g. `modalBindControls`): bind Save/Reset to the 7a-2 API; on modal open (or when Advanced is first shown), populate the three inputs from `loadLlmConfig()`; all `getElementById` and DOM access guarded for null and for `document` existence |
| Optional | Ensure the script that loads the Optimize/editor UI loads `llm_config.js` (e.g. add a `<script>` in `static/pianoroll/index.html` for `llm_config.js` if it is not already loaded via a bundle) |

No changes to `app.js` keydown logic except to confirm the existing composedPath guard already covers the new inputs (no code change if so). No changes to timeline or project.js timebase/beats logic.

---

## 3. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Node-safe import** — Top-level use of `window`/`document`/`localStorage` in a new or modified module causes Node tests to throw when they require that module. | In `llm_config.js` and any new code: no access to `window`, `document`, or `localStorage` at top level. Use functions that check `typeof localStorage !== 'undefined'` (and similar for `document`) before use. In Node, those functions return safe defaults (e.g. empty config or no-op save). |
| **Key leakage** — Accidentally logging or exposing the auth token (e.g. in status text, console, or error messages). | Do not log `authToken` or include it in any user-visible string. Log only “token set”/“token cleared” or length. In UI status, show only “Saved” / “Config reset”, not the token. |
| **Global keydown swallowing Backspace/Delete** — New inputs (Base URL, Model, Auth Token) get focus but Backspace/Delete are captured by app.js or editor_runtime.js and trigger delete-note or other shortcuts. | Rely on the existing guard in `app.js` that uses `ev.composedPath()` (or target) to skip handling when the target is INPUT/TEXTAREA/contenteditable. Confirm the new inputs are standard `<input>`/`<textarea>` so they are covered. In 7a-3 verification, manually test Backspace/Delete in each new field. If any handler runs before the guard, add the same guard there (no change to timeline or beats logic). |
| **Touching timeline/timebase or v2 beats-only** | Do not add or change code in `timeline_controller.js`, `timeline_math.js`, or project timebase/beats storage. Do not introduce seconds as source of truth. LLM config is separate from project document. |
| **Breaking existing Optimize behavior** | Do not change `hum2song_studio_opt_options_by_clip`, preset/prompt flow, or Optimize/Rollback/Regenerate/Reset-to-default-prompt logic. New UI is additive in the Advanced section; Save/Reset only touch `hum2song_studio_llm_config`. |

---

## 4. Acceptance / Verification Checklist (per step)

### Step 7a-1

- **Automated**
  - Run: `node scripts/run_frontend_all_tests.js` — must pass (no runtime change in 7a-1).
  - Run: `pytest -q` (from repo root) — must pass if present.
- **Manual**
  - Confirm `.env.example` contains only placeholders and no real secrets.
  - Confirm `.gitignore` lists `.env`, `.env.local`, and `.env.*.local` (or equivalent) so they are not committed.
  - Read README (and docs) for gateway-first and security notes and confirm they are clear.

### Step 7a-2

- **Automated**
  - Run: `node scripts/run_frontend_all_tests.js` — must pass. Do **not** add Node tests that require/import `llm_config.js`; the module is loaded in the browser via script tag only.
  - Run: `pytest -q` if present — must pass.
- **Manual**
  - (Optional) In browser console, call `loadLlmConfig()`, `saveLlmConfig({...})`, `resetLlmConfig()` and confirm localStorage key `hum2song_studio_llm_config` appears/updates/clears and that no other key (e.g. opt options) is modified.

### Step 7a-3

- **Automated**
  - Run: `node scripts/run_frontend_all_tests.js` — must pass.
  - Run: `pytest -q` if present — must pass.
- **Manual**
  - Open a clip, open Optimize panel, expand Advanced. Confirm Base URL, Model, Auth Token (password) and Save/Reset are visible.
  - **Save:** Enter values, click Save. Status shows “Saved” (or equivalent). Hard refresh (Ctrl+F5). Re-open the same panel; confirm the three inputs are restored from localStorage (auth token masked but restored).
  - **Reset:** Click Reset. Confirm the three inputs are cleared and status shows “Config reset”. Confirm in Application > Local Storage that `hum2song_studio_llm_config` is removed and `hum2song_studio_opt_options_by_clip` is unchanged.
  - **Backspace/Delete:** Focus each new input, type a few characters, press Backspace and Delete. Confirm characters are deleted and no note or other shortcut fires (composedPath regression check).
  - **Existing behavior:** Run Optimize, Rollback, Regenerate, Reset-to-default-prompt once each. Confirm they still behave as before (no change in preset/prompt persistence, revision, or status).

---

## 5. Rollback Plan

- **Step 7a-1**  
  Revert changes to `.env.example`, `.gitignore`, and `README.md` (and any new doc in `docs/`). No runtime or test code is changed, so no further rollback.

- **Step 7a-2**  
  Remove the new file `static/pianoroll/llm_config.js`. Remove any script tag or reference that loads it (if added). Re-run `node scripts/run_frontend_all_tests.js` and `pytest -q`. No change was made to PR-5/PR-6 behavior (opt options key and Optimize flow untouched).

- **Step 7a-3**  
  Revert changes to `static/pianoroll/index.html` (remove the new Advanced LLM form and buttons) and to `static/pianoroll/controllers/editor_runtime.js` (remove Save/Reset bindings and any call to load/save/reset LLM config). If a script tag for `llm_config.js` was added in 7a-3, remove it only if it was added in 7a-3; if it was added in 7a-2, consider leaving it for future use or remove and then remove `llm_config.js` as in 7a-2 rollback. Re-run frontend tests and manual checks; Optimize/Rollback/Regenerate/Reset-to-default-prompt and preset/prompt persistence must behave as after PR-6.

---

*End of Phase 0 Plan Package. No code implementation in this document.*
