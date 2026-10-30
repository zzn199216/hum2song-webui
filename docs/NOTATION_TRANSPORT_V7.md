# Notation transport v7 — 2026-09-25

Published application commit: `26fa2e387a9f8ff4fdd977665d7929af712e9afa`, asset version `clip-notation-v7-20260925`.
Base and rollback: `502a8dc1b8c4c6613319770344d488975a147654`, v6.

The user's final transport contract supersedes v6's Stop-retains-position behavior:

- Play toggles play/pause. Pause retains the shared `cursorSec`.
- Explicit Stop invokes `modalStop(true)` and resets the shared cursor.
- Internal `modalStop()` calls retain the edit cursor; they must not reset it when selecting/editing/exporting.
- Roll and notation seeking use the same transport state. Notation blank-space clicks interpolate real SVG anchors; the green cap supports horizontal dragging without stealing notehead pitch gestures.
- A session counter invalidates pending audio startup and old frame callbacks. Active synths and transport callbacks are cleaned up on stop. Sustained notes resume with only their remaining duration.

Exact-package browser checks passed for seeking both notation modes, pause/resume, Stop, async cancellation, rapid seeks, sustained-note continuation, natural end, page following and clean export. Pitch-drag regressions passed with audible frequencies, preserved page/unaffected row identities, zero blank frames, Esc/undo/redo. PDF and project save isolation checks passed. Complete frontend suite passed during packaging.

Deployed through exact-base atomic Studio delta helper, verified live/rollback pointers, artifact hashes, six changed public assets, 782 untouched static files, backend files and shared runtime links. Authenticated and anonymous live Cloud gates passed; no production project saves or processing jobs were used for QA.

The accompanying CN Cloud Web release `5cec4ff-studio-space-20260925` adds a persistent collapse button above the iframe. Collapse/expand preserves the editor iframe and gains roughly 106 px desktop / 251 px mobile height in the QA viewports. Cloud API/Core and processing code remain unchanged. Details and evidence paths are recorded in the Cloud repository's `docs/deploy/2026-09-25-studio-seek-and-space.md`.
