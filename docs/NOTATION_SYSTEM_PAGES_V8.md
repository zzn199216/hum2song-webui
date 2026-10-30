# Complete time systems and score size — v8

Released on 2026-09-25 under the user's ongoing verify-and-deploy authorization.

- Application commit: `6ed8f21d84e14c8f85edd48b5f68d1bba7c1f74d`.
- Asset marker: `clip-notation-v8-20260925`.
- Exact production base and retained rollback: `26fa2e387a9f8ff4fdd977665d7929af712e9afa-clip-notation-v7-20260925`.
- Artifact SHA-256: `c342f1e2a70f724c4015a0dc906ab379d25bad67c3804a5412ac8ff348a986c8`.

## Contract

All visible voices covering the same measure range form a complete system. Pagination keeps the system together; a screen page can grow taller than A4. A system is labeled with its measure range and simultaneous voice count, and the persistent pager also shows the page's measure range. Multiple complete short systems may share a page, with separate system labels.

Fixed A4 exports preserve complete systems where possible. If one system cannot fit, its chunks explicitly identify the shared time range and continuation index; a continuation is never mixed with the following time system.

Score size has 50/60/75/90/100/110/125/150 percent choices, shared by staff and numbered views and remembered locally. It affects screen layout only, not notes, timing or export paper size. Smaller sizes reflow more measures across the available width. On a narrow screen, enlargement can require horizontal score scrolling to maintain legibility. SVG and page-slot geometry scale together; seeking and pitch dragging use the actual SVG transform. Resizing preserves the current time range where possible.

## Verification and release evidence

- Full frontend suite passed, including the new pure-layout regression for 1/3/7/12 voices, three widths, both modes, tall pages and A4 continuations.
- Real-renderer 64-case layout and 8-case incremental patch comparisons passed; source note identities and clean export coordinates were retained.
- 943-note pagination regression passed: lazy mounted pages, zero idle class mutations, page reuse, later-page pitch drag/undo/redo and no default-size horizontal overflow at 390/1000/1920 px.
- Exact packaged preview passed seven-voice grouping and 50% sizing (1448 to 724 px), scaled pitch gestures, scaled seeking and size retention between clip openings.
- Exact-package playback/pause/stop/seek, rapid seek cancellation, pitch audition with zero blank frames, undo/redo, PDF generation and project/audio/revision/precision isolation passed.
- Browser harness corrections wait for rest highlighting to settle and reopen a notation view before selecting its hidden size control. Early harness failures were rerun; successful results are recorded separately.
- Signed candidate, signed production and anonymous CN/COM browser checks passed. Production grouping and size controls were verified without saving cloud projects or submitting processing jobs.
- Published static assets match the package; 783 untouched static files and backend files match rollback. Data, virtual environment and SoundFont links are preserved. Web/API/Core PIDs remained unchanged; only Studio restarted.
- Release used exact-base delta checks, artifact hash verification, dry run and atomic cutover, retaining one rollback version. No remote Git push, migrations, dependency installs or paid jobs were performed.

Evidence: `output/audit/groups-*`, `output/playwright/groups-*`, `output/playwright/group-layout.log`, `group-patch.log`, `group-pagination.log` and `system-size-*.png`. This record is a post-release documentation commit; the immutable application release remains the commit above.
