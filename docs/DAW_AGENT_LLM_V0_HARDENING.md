# LLM optimize (`llm_v0`) — bounded hardening (post–Phase-1 freeze)

This doc describes **small** observability additions for the existing **`llm_v0`** path. It does **not** change deterministic Phase-1 presets (`velocity_shape`, `local_transpose`, `rhythm_tighten_loosen`).

## What this covers

- **`patchSummary.llm`** on `llm_v0` runs: `{ outcome, ... }` where **`outcome`** is a bounded string (e.g. `applied`, `no_op`, `rejected_validation`, `rejected_safe_mode`, `rejected_quality`, `failed_extract`, `failed_config`, `failed_apply`, `rejected_semantic`, `failed_request`, …).
- **Top-level `llmOutcome`** on the optimize result (duplicate of `patchSummary.llm.outcome` for quick inspection).
- **Explicit `patchSummary`** on more rejection branches (safe mode, schema validation, JSON extract failure) so failures are not “empty” at the summary layer.

### Outcome contract (intended meanings)

| `outcome` | When it is set |
|-----------|----------------|
| `applied` | Patch validated, applied, revision updated, project committed per existing `llm_v0` wiring. |
| `no_op` | Valid JSON with **`ops.length === 0`** (no revision created for that path). |
| `rejected_safe_mode` | Velocity-only mode: disallowed op types or pitch/start/duration fields on `setNote`. |
| `rejected_validation` | `validatePatch` failed (schema / clip constraints). |
| `rejected_quality` | Full mode + pitch/rhythm intent: patch is **velocity-only** when pitch/timing edits are required. |
| `rejected_semantic` | Patch applied to a scratch score but **semantic sanity gate** rejected the result: `applyPatchToClip` sets **`semanticReject: true`**, or the first error string uses the established **`semantic_*` code prefix** (same codes the gate emits). |
| `failed_apply` | Apply failed for any other reason (e.g. missing project API, or a non-semantic error that does **not** match the rule above). |
| `failed_revision` | Apply succeeded but `beginNewClipRevision` failed. |
| `failed_extract` | No JSON object extracted from the model response (after retry when applicable). |
| `failed_config` | LLM config missing/invalid (e.g. no base URL / model). |
| `failed_client` | LLM client not loaded. |
| `failed_request` | Network/exception path from the chat-completions call (message mapped into failure summary). |

**Guaranteed today (contract tests):** on `llm_v0` results that carry **`patchSummary.llm`**, **`llmOutcome` === `patchSummary.llm.outcome`**, **`executionPath` === `'llm'`**, and **`patchSummary.phase1Deterministic` is absent** — deterministic Phase-1 metadata is **not** merged into LLM runs.

### Retry / attempt observability (`llm_v0` only, after at least one LLM attempt)

When the optimize run reaches the async **`attemptOnce`** path (config + client OK), the final result includes bounded retry metadata on **`llmDebug`** and duplicated on **`patchSummary.llm`**:

| Field | Meaning |
|-------|---------|
| **`totalAttempts`** | Number of LLM calls made (1 or 2 today). Same as **`attemptCount`** (kept for compatibility). |
| **`finalAttemptIndex`** | Which attempt produced the **returned** `patchSummary` / outcome (`1` or `2`). |
| **`attemptSummaries`** | Up to **8** rows: `{ attemptIndex, reason, outcome }` per attempt (`outcome` = `patchSummary.llm.outcome` for that attempt when present). No raw prompts. |

**How to read it:** The **last** row in **`attemptSummaries`** matches the **final** `llmOutcome` / `patchSummary.llm.outcome`. Earlier rows describe failed or superseded attempts when a retry ran (JSON/validation retry only).

**Not guaranteed on these fields:** Early synchronous failures (**`failed_config`**, **`llm_client_not_loaded`**, etc.) return **before** any LLM attempt — they typically have **no** `llmDebug` / no retry block. **`llmDebug.rawText` / `extractedJson`** still reflect the **final** attempt only (existing behavior).

**Assistant / debug UI:** `_sanitizeLlmDebugForAssistantTrace` passes through **`totalAttempts`**, **`finalAttemptIndex`**, and a capped **`attemptSummaries`** (no prompt bodies).

**Not guaranteed:** stability of raw error strings beyond the **`outcome`** bucket; prompt quality; model behavior.

**`rejected_semantic` vs `failed_apply`:** Primary signal is **`applied.semanticReject === true`** from `applyPatchToClip`. Secondary (compat): first error string **starts with** `semantic_` (matches semantic gate codes). Arbitrary messages that mention “semantic” elsewhere are **not** treated as semantic rejection.

**Remaining limitation:** A non-semantic failure whose first error string incorrectly starts with `semantic_` would still map to `rejected_semantic` — avoid that prefix outside the semantic gate.

## What this does NOT cover

- Prompt redesign, new templates, or new presets.
- Merging LLM traces into **`patchSummary.phase1Deterministic`** (Phase-1 metadata stays deterministic-only).
- Changing **`commitV2` vs `setProjectFromV2`** wiring.

## How this differs from Phase-1 deterministic

| | Phase-1 deterministic presets | `llm_v0` |
|--|-------------------------------|----------|
| Metadata | `patchSummary.phase1Deterministic` | `patchSummary.llm` |
| `executionPath` | `velocity_shape` / `local_transpose` / `rhythm_tighten_loosen` | `llm` |
| Source | Narrowers + deterministic patch builders | LLM JSON → validate → apply |

## Tests

- `scripts/tests/llm_v0_optimize_hardening.test.js` (mocked LLM; no network).
