# Creative Wild Set — `clean_outliers` (open-ended log)

**Purpose:** Capture **high-variance**, real-world, or creative inputs where a fixed core set is not enough. This is **not** a benchmark and **not** a fixed N; add rows as you collect evidence.

**How to use:** One row per sample you care about. Prefer **honest** “what it damaged” notes—this sheet is for learning failure modes, not for scoring marketing wins.

---

## Entry template (copy block per sample)

| Field | Content |
|-------|---------|
| **Sample ID** | W-___ (e.g. W-2026-03-29-01) |
| **Source / origin** | e.g. live hum import, internal test clip, anonymized user snippet |
| **Short clip description** | Length, rough pitch range, genre/vibe if relevant |
| **User intent / creative context** | What the user wanted (cleanup, demo, noisy room, etc.) |
| **Why this sample is interesting** | What makes it wild or non-core |
| **What `clean_outliers` helped with** | Concrete (e.g. removed X, softened Y) |
| **What it damaged** | Concrete (e.g. killed pick-up notes, flattened dynamics) |
| **Overall usefulness (1–5)** | 1 = harmful or useless, 5 = would ship as-is for this class |
| **Trust (1–5)** | 1 = would not run again, 5 = would trust on similar takes |
| **Disposition** | **Keep** / **Investigate** / **Reject** |
| **Notes** | Free text: follow-ups, links to issues, paired clips |

---

## Log (append rows below)

| Sample ID | Source | Clip summary | Intent / context | Why interesting | Helped | Damaged | Use 1–5 | Trust 1–5 | Disposition | Notes |
|-----------|--------|--------------|------------------|-----------------|--------|---------|---------|-----------|-------------|-------|
| _example_ | _—_ | _—_ | _—_ | _—_ | _—_ | _—_ | _ | _ | _Investigate_ | _—_ |
| | | | | | | | | | | |
| | | | | | | | | | | |

---

## How this differs from Core Regression

- **Core** = same cases, same bar, regression detection.  
- **Wild** = explore **space** of reality; patterns here justify **investigation**, not single-shot prompt edits.

When several wild entries show the **same** harm under similar context, promote a **minimal** reproduction into the Core set (new case) before changing behavior.
