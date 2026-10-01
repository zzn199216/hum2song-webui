# Vector score PDF export - 2026-10-02

Prepared from active Studio commit `4bd3d7925a6a4be39345e9adb629995d4b8a3b1f`.
Cache marker: `notation-vector-pdf-v2-20261002`. Release evidence is appended after deployment.

## Problem and final change

The previous exporter rasterized every page at 1588 x 2246 pixels, encoded PNG synchronously and made jsPDF decode/compress it again. A 720-note, 12-page score took 14,015 ms (staff) / 11,582 ms (numbered) after engraving, with timer gaps up to 1.3 seconds. Closing/switching the preview only ignored old results, and external waits had no deadline.

The final implementation directly converts the existing engraved SVG into PDF paths, lines and Unicode text using pinned, self-hosted svg2pdf.js 2.8.1 plus existing jsPDF 4.2.1. It has no score rasterization, image encoding or image PDF fallback. Chinese text uses bundled SIL OFL fonts; music symbols retain VexFlow outlines. The export model, notation layout and canonical project data remain unchanged.

Additional recovery behavior:
- Generate one page at a time and show progress, yielding between pages.
- Abort obsolete work on close/format change; bound library/font/converter waits.
- Cache the last completed PDF and frozen preview by score/settings/BPM/title/format/language. Source edits invalidate it.
- Show retry for internal errors, including internal AbortError failures; only explicit user cancellation is silent. Never enable partial PDF downloads.
- Attach download anchors to the DOM and keep their temporary URLs alive for 60 seconds.
- Font bytes are reused in memory and by the browser HTTP cache. Dependencies are warmed when the note editor opens. The common font uses a lossless gzip transport copy (1.59 MB instead of 2.54 MB) with a raw TTF fallback for browsers without DecompressionStream. This changes font transfer only; PDF pages remain vectors. Extended CJK text loads its larger font only when required. No runtime external CDN is used.

The existing manual-split regression test normalizes CRLF before matching an LF delimiter, so a fresh Windows checkout can run its existing assertions. No splitting behavior changes. Release marker assertions were aligned to the new asset version.

## Research

- [svg2pdf.js](https://github.com/yWorks/svg2pdf.js): browser SVG to PDF conversion, custom-font support, compatible with jsPDF 4.
- [jsPDF documentation](https://parallax.github.io/jsPDF/docs/index.html): custom TTF embedding for Unicode text; standard PDF fonts alone cannot preserve Chinese.
- [Noto CJK](https://github.com/notofonts/noto-cjk): reusable CJK fonts under SIL OFL. Derived font source hashes and reproducible build instructions are in `scripts/build_score_pdf_fonts.py` and vendor README.

Browser-native printing would preserve vector SVG but require a print/save dialog. Re-engravement through MusicXML/LilyPond would add a separate engraving backend. Direct SVG conversion preserves the accepted pagination and one-click PDF download.

## Validation

- Complete Studio frontend suite passes, including vector-only export, progress, cancellation, font cache/fallback, converter/font/library failure, bounded waits and retry tests.
- Real editor click-to-downloaded-file checks: 12 pages, 720 source notes; staff about 1.21 seconds / 507,762 bytes; numbered about 0.77 seconds / 105,969 bytes. First text-font load is an additional one-time network cost on a cold browser.
- PDF parser checks on every page: exact A4 dimensions, zero image objects, vector path commands, searchable Chinese text and musical symbols. Staff has 34,623 path commands / 240 text operations; numbered has 1,758 / 1,260.
- Seven-voice long-chord/tie, Bb bass-clef fixture: 6 staff pages / 9 numbered pages, extended CJK title preserved. PDF images remain zero. Chinese, flats/sharps and continuation labels parse and render correctly.
- 30-page / 1,920-note stress export including engraving: about 1.94 seconds staff / 1.19 seconds numbered, PDF sizes about 1.21 MB / 206 KB.
- Browser tests pass cached reopen, draft invalidation, injected converter failure/retry, explicit cancel, format races and unchanged canonical project JSON.
- Exported PDFs were rendered and inspected for staff lines, beams, rests, accidentals, long ties, numbered notation, chords and CJK text. Successful export paths have no library/font warnings.

QA files remain under `output/playwright/` and are excluded from the release. No paid generation, processing job, migration or project save was submitted.
