# Numbered-notation dragging and local engraving

Base: `bfca71f966d31babafd69e805b8720c58d18e2bd` (production v3).
Release marker: `clip-notation-v4-20260925`.

Numbered notation now shares the staff pointer-capture gesture, note selection,
MIDI pitch update, audition, cancellation and single-gesture history. Numbered
steps use 12 SVG pixels per scale degree, staff steps remain 5. The selected key
and chromatic offset are respected; MIDI pitch stays within 0–127. The number,
accidental and octave dots are re-engraved while the pointer remains held.

The visible flash had a concrete cause: every pitch change replaced the surface
with empty page slots, then queued engraving for a later animation frame. Page
slots now remain mounted, and visible content is replaced only after engraving.
The renderer groups each voice/system into one SVG group and reuses unchanged
groups and their hit targets. A system is the safe update boundary because ties
can cross measures and beams/accidental state couple notes. Only affected systems
are engraved offscreen and patched synchronously into the existing page SVG.
Gesture geometry is held stable until release; layout can then expand ledger-line
spacing if needed. Mutating a cached page removes its prior key so cancel/undo
cannot retrieve edited content under the original score's cache key.

## Verification

- `notation_local_edit.browser.js`: real visible-glyph drags in both modes;
  immediate selection; C4 → E4 → C5 oscillator frequencies verified at the real
  AudioContext; numbered digit 1 → 3; zero blank sampled animation frames; same
  page SVG and unchanged system nodes retained; Esc and single undo/redo verified.
- `notation_patch.browser.js`: eight width/clef/mode combinations with long tied
  chords spanning systems/pages. Patched ink (excluding generated IDs and hit
  targets) and source-hit registry match a complete fresh engraving. Unaffected
  tail systems retain node identity.
- Existing 64-case real renderer suite, 943-note pagination/navigation/reflow,
  piano-roll edge dragging, save isolation, PDF exports, and full frontend suite
  pass. Audio processing, separation, persistence schema and backend are unchanged.

Release from the exact active base with atomic Studio delta cutover and v3 rollback.
Validate candidate/live signed-in CN and anonymous CN/COM entry gates without
creating provider jobs or writing production projects.
