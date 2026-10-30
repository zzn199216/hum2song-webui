# Chord tie and responsive score correction

Base: production `4df98c9ab775c2e49c0688889182bd34c25b79e7`.
Release marker: `clip-notation-v2-20260925`.

## Failure and correction

The real production renderer throws `BadArguments: Tied notes must have same number of indices` when a chord crosses a system/page boundary. A partial VexFlow StaveTie defaulted the omitted index array to `[0]`, while the explicitly supplied side had multiple chord indices. Supply matching arrays for both partial-tie directions. Full ties and source MIDI remain unchanged.

The earlier chord tests did not cover partial multi-note ties at a system boundary. The new real-browser regression reproduces that exact exception against the old renderer, then covers incoming/outgoing ties, multi-system and multi-page chords, adjacent pitches, both clefs, and a 1,024-note polyphonic score.

## Screen and export layouts

Editing uses a continuous score whose width follows the notation surface. Measures reflow into more or fewer systems at a constant symbol size. ResizeObserver handles modal resizing, maximize/restore, responsive windows and tool-panel changes; width participates in the render cache. The score no longer occupies a fixed A4 column centered in a wide editor.

Export remains separately paginated 794 × 1123 A4 SVG/PDF. Reflow does not quantize, transpose or persist source notes. MIDI reconciliation, piano roll, audio, separation and backend code are unchanged.

## Verification

- `scripts/tests/notation_layout.browser.js`, run via Playwright CLI against a local Studio preview: 64 real-renderer cases, all source note IDs retained, finite SVG output, fixed print geometry, fewer systems at wider screen widths, unchanged source JSON.
- Real modal resize at 1920/1000/390 pixels: available-width layout, no score-surface overflow, unchanged notes/dirty state, visible glyph drag and undo.
- Existing save-isolation and PDF export browser regression, plus the complete frontend suite, are release gates.
- Only the Studio delta is deployed from the exact current base. The prior release is retained for rollback; Cloud Web/API/Worker and shared runtime assets are not changed.
