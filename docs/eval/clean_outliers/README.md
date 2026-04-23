# `clean_outliers` evaluation package

Minimal structure to judge **quality with evidence** before changing prompts or directives for the `clean_outliers_v1` / `reduceOutliers` path.

## How to use this (workflow)

1. **Core Regression Set** (`CORE_REGRESSION_SET.md`)  
   - Run the same small clips + procedure **before and after** any change that could affect optimize/LLM behavior.  
   - Goal: catch **regressions** in baseline safety and predictable cases.  
   - Fill **Result** and **Notes** per case; do not “tune from” a single run.

2. **Creative Wild Set** (`CREATIVE_WILD_SET.md`)  
   - Use for **real humming imports, odd phrases, or messy takes** where fixed cases are not enough.  
   - Goal: see **variance**, failure modes, and whether the feature is **worth shipping** for messy input.  
   - This is **not** a fixed benchmark; it is a **logging sheet** for samples you care about.

3. **When to change prompts/directives**  
   - Only when **repeated** evidence (core + wild) shows a **stable** failure pattern (same harm or same miss across similar contexts).  
   - Avoid one-off tuning from a single bad clip.

## Evaluation rubric (practical)

Score each run **holistically** (not only note-count). Use 1–5 where helpful; the point is consistent labels, not precision.

| Dimension | What to look for |
|-----------|------------------|
| **Baseline safety** | No crashes, patch applies, revision/undo still make sense; no nonsense mass deletes unless clearly justified by intent. |
| **Musical usefulness** | Stray/wrong notes or obvious glitches are reduced **without** killing the phrase the user cared about. |
| **Over-edit risk** | Melody thinned, contour destroyed, or “cleaned” into a different song; dynamics gutted without need. |
| **Under-edit risk** | Obvious lone spike or stray hit left untouched when the task implied fixing it. |
| **Would a user keep using this?** | Honest gut check: would you accept, tweak slightly, or hit Undo and distrust the tool? |

**Quick outcome labels**

- **Pass** — Fits intent; any edits are defensible; you’d trust a repeat run on similar material.  
- **Suspicious** — Mixed: some good, some harm, or inconsistent; needs another sample or human listen.  
- **Fail** — Wrong notes removed, melody damaged, or clearly worse than baseline for the stated intent.

## Files in this folder

| File | Purpose |
|------|---------|
| `CORE_REGRESSION_SET.md` | Fixed ~8–10 cases for regression guarding |
| `CREATIVE_WILD_SET.md` | Open-ended sample log (not a benchmark) |

## Scope note

This package is **evaluation structure only**. It does not change app behavior. Template IDs and beats-only rules follow project docs (e.g. `PROJECTDOC_V2_BEATS_SPEC.md`, `LLM_TEMPLATES_V1.md`).
