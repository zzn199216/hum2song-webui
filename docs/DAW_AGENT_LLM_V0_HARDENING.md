# LLM optimize (`llm_v0`) — bounded hardening (post–Phase-1 freeze)

This doc describes **small** observability additions for the existing **`llm_v0`** path. It does **not** change deterministic Phase-1 presets (`velocity_shape`, `local_transpose`, `rhythm_tighten_loosen`).

## What this covers

- **`patchSummary.llm`** on `llm_v0` runs: `{ outcome, ... }` where **`outcome`** is a bounded string (e.g. `applied`, `no_op`, `rejected_validation`, `rejected_safe_mode`, `rejected_quality`, `failed_extract`, `failed_config`, `failed_apply`, `rejected_semantic`, `failed_request`, …).
- **Top-level `llmOutcome`** on the optimize result (duplicate of `patchSummary.llm.outcome` for quick inspection).
- **Explicit `patchSummary`** on more rejection branches (safe mode, schema validation, JSON extract failure) so failures are not “empty” at the summary layer.

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
