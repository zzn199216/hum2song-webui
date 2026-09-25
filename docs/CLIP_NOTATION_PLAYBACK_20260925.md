# Score playback cursor and view tabs

Base: `217ce8ce035e3302305c315f9066c6c2e57def43` (production v4).
Release marker: `clip-notation-v5-20260925`.

Staff and numbered notation now draw a lightweight vertical playhead with a
triangle cap for each visible sounding system. Playback uses the existing
editor cursor/audio transport time; it does not start another clock or alter
MIDI. Position interpolates between actual engraved event anchors, including
rests and measure ends, so proportional notation spacing remains accurate.
The first voice leads automatic scrolling at system transitions, including
virtualized page boundaries. Manual scrolling within a system is not pulled
back every frame. Stop, close and view changes hide the markers; idle has no
animation loop. Playback overlays are excluded from score serialization.

The three view tabs now have individual surfaces, borders and rounded corners,
10 px desktop / 7 px narrow-screen gaps, and a distinct selected state. Existing
ARIA tab semantics, keyboard navigation and mobile wrapping are preserved.

## Verification

- Real audio transport advances staff and numbered playheads without engraving
  the score again; deterministic probes verify rest progress, system transitions,
  later-page scrolling, stop cleanup, view switching and unchanged MIDI.
- Desktop and 390 px tab gaps verified; staff screenshot visually inspected.
- Existing 943-note pagination and local-drag tests pass, including zero blank
  frames, preserved unaffected systems, oscillator pitches, Esc and undo/redo.
- Full frontend suite and both notation PDF exports pass.
- Exact packaged candidate, signed-in CN gate and live anonymous CN/COM gates
  are release checks. Static Studio delta only; no provider jobs or backend changes.
