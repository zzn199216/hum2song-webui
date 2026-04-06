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
| `rejected_semantic` | Patch applied to a scratch score but **semantic sanity gate** rejected the result (error text contains `semantic`). |
| `failed_apply` | Apply failed for a **non-semantic** reason (first apply error string does **not** contain `semantic`). |
| `failed_revision` | Apply succeeded but `beginNewClipRevision` failed. |
| `failed_extract` | No JSON object extracted from the model response (after retry when applicable). |
| `failed_config` | LLM config missing/invalid (e.g. no base URL / model). |
| `failed_client` | LLM client not loaded. |
| `failed_request` | Network/exception path from the chat-completions call (message mapped into failure summary). |

**Guaranteed today (contract tests):** on `llm_v0` results that carry **`patchSummary.llm`**, **`llmOutcome` === `patchSummary.llm.outcome`**, **`executionPath` === `'llm'`**, and **`patchSummary.phase1Deterministic` is absent** — deterministic Phase-1 metadata is **not** merged into LLM runs.

**Not guaranteed:** stability of raw error strings beyond the **`outcome`** bucket; prompt quality; model behavior. **`failed_apply` vs `rejected_semantic`** is determined by a substring check on the first apply error (see `failed_apply` / `rejected_semantic` rows).

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
