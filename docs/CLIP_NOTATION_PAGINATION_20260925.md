# Paginated editing and bounded score rendering

Production base: `c56ba8b0848b9eb5147a5801e1c8f0e67a068c4b`.
Release marker: `clip-notation-v3-20260925`.

The continuous SVG introduced in v2 hid page boundaries and re-engraved every
note after each pitch edit. Idle playback highlighting also touched every note
class on every animation frame.

Screen scores now use responsive-width pages with visible gaps, page footers,
and a persistent current/total page indicator with previous/next navigation.
Layout planning is separate from engraving. Only pages near the viewport are
mounted; one missing page is engraved per animation frame. A four-page cache
reuses unchanged pages across navigation and edits. Selection and playback use
mounted hit targets and update changed classes only. Idle highlighting has no
animation loop. Cache entries include score rows, notation settings, meter,
width and title. Closing releases page nodes and queued work.

PDF/SVG export continues to render the complete A4 score independently of the
screen's mounted pages. MIDI, revision/save semantics, piano-roll behavior,
audio processing, separation providers and backend code are unchanged.

## Evidence

- Complete frontend contract/editor/timeline suite passed.
- `notation_layout.browser.js`: 64 real VexFlow cases, including 1,024 notes,
  both clefs, staff/numbered, 360/900/1700 widths and A4. All source identities
  remain present. Lazy last-page identities equal those of complete rendering.
- `notation_pagination.browser.js`: 943 notes; bounded mounted pages, zero idle
  class mutations, cached page reuse, playback highlight lifecycle, later-page
  drag/undo/redo, first/last-page navigation, 390/1000/1920 resize, unchanged MIDI.
- Real visible-notehead clicking/dragging and piano-roll edge scrolling passed.
- Save-isolation regression preserves untouched note precision, other clips,
  audio waveforms, project extensions, and the existing revision contract.
- Staff and numbered PDF exports produce valid PDFs with unchanged source data.
- Local Chrome benchmark at width 1700, same synthetic 943-note input: old
  full-score first render 343 ms, warm runs 185/156/126 ms; new first visible
  page 78 ms, warm runs 45/42/39 ms. Engraved SVG elements reduced from 8,317
  to 2,976 for this fixture. These are local measurements, not device guarantees.

Release uses the exact active Studio base and atomic delta deployment. Verify
artifact hashes, unchanged backend/runtime links, anonymous CN/COM and signed-in
CN entry gates; retain v2 for rollback. Do not run provider jobs or restart Cloud.
