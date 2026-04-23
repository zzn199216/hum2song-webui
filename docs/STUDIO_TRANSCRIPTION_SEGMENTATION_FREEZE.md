# Transcription segmentation — freeze-point note

Concise baseline snapshot for Hum2Song Studio (experimental import path). **Not** final product behavior.

## 0. Studio-facing vocal separation (paused)

User-facing **experimental vocal separation** on import was **removed from the Studio UI** because current separation quality was not good enough (e.g. accompaniment nearly silent, empty Music track). Backend stem-separation code remains for **internal/research** use via API and config.

## 1. Current accepted baseline

Practical baseline is **“good enough for now”** to keep editing usable.

**Current direction (when dev flags are on):**

1. **Pitch split** (dev) — heuristic pitch-bucket multi-track split before clip creation.  
2. **Bar-aware segmentation first** — full score on shared bar-aligned boundaries (`segmentScoreDocByBarBoundaries`).  
3. **Then explode** — each time segment into per-track clips.  
4. **Then trim** sparse exploded parts to note extent (trim-to-note-extent).

This pipeline is **experimental** and gated by localStorage; default production import does not depend on it unless those flags are enabled.

## 2. Why this freeze point exists

- **Dense long clips** were too wide and too laggy to edit comfortably.  
- **Sparse exploded clips** had long empty leading space before trim.  
- The **segment-first-then-explode** flow plus trim **improved editability enough** to pause here before deeper “chapter/phrase” work.

## 3. Experimental flags / knobs (dev-only)

| localStorage key | Role |
|------------------|------|
| `hum2song_studio_dev_transcription_pitch_split` | Pitch-bucket split before explode. |
| `hum2song_studio_dev_transcription_bar_segment` | Full-score bar segmentation before explode (import wiring in `uploadFileAndGenerate`). |

**Tuning:** `maxBars = 2` in the bar-segmentation call site is an **aggressive manual-test setting**, not a final product default. Revisit before any release decision.

## 4. Factors to revisit for stronger chapter / phrase / movement-like segmentation

- **Bar/beat-aware boundary choice** — BPM and meter reliability; grid anchoring.  
- **Phrase-like boundary scoring** — gap + local activity; weights and window size.  
- **Long-note crossing policy** — forbid vs split vs forced; interaction with `maxBars`.  
- **`maxBars` / segment length** — balance editability vs musical continuity.  
- **Alignment across exploded tracks** — shared cuts vs per-track drift.  
- **Naming / ordering / visual grouping** — segment indices, track labels, timeline UX.  
- **Future stems / separation** — how segmentation interacts with vocal/accompaniment or instrument separation.  
- **Pipeline shape** — keep **segment first, then explode** vs alternatives; evidence from user testing.

## 5. Known limitation (subjective)

Phrase-aware **scoring** (gap + band activity) has **not** produced a **dramatic** subjective improvement yet. Behavior is **usable and deterministic**, but **not** the final musical segmentation design.

## 6. Future return point

When revisiting, **reinforce “segment first, then explode”** as the default mental model for aligned multi-track cuts, and consider moving **beyond** simple bar grids toward **musically weighted** boundaries (still deterministic, no ML required in early iterations).

## Document status

**Freeze-point doc only** — no behavioral guarantee; update when the pipeline or flags change.
