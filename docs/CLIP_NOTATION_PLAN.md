# Clip notation workspace

Scope: one editable clip, three interchangeable views (piano roll, staff, numbered notation). Audio clips retain their waveform. No changes to Cloud membership, processing services, production or deployment.

## Design

- Keep the music central: a calm paper surface inside the existing dark editor, a segmented view switch, persistent transport, contextual note controls, and an explicit export preview.
- The editor's seconds-based `modal.draftScore` remains the shared editable draft. ProjectDoc v2 persists beats using project BPM through the existing save/revision boundary.
- Add/delete/pitch/timing/velocity edits use stable track + note IDs and the existing undo mechanism. Switching views never quantizes stored music.
- Store per-clip view/key/clef/display-grid preferences in `clip.meta.notation`, separately from notes. Save applies them; Cancel discards them.
- A pure adapter builds a quantized display copy, inserts rests, partitions overlapping voices without dropping notes, and splits tied notes at bar boundaries. Approximation is disclosed in the UI. Every rendered fragment maps back to its original note(s).
- Reuse locally bundled VexFlow for staff engraving. Numbered notation shares the same duration/voice model. Do not embed a second application's playback, document or history state.
- Preview pages and PDF use the same frozen SVG page set. PDF rendering and downloads are local; no audio/user content leaves the browser. SVG download is also available.

## Implementation and acceptance

1. Pure notation and edit adapter: rests, chords, voices, ties, key spelling, bounds and no mutation.
2. Shared-draft editor integration: pitch/timing/duration/velocity, insert/delete, keyboard selection, undo/redo, view preferences, playback highlighting.
3. Timeline thumbnails follow the saved clip view while preserving time alignment and audio behavior.
4. Single-clip paginated export preview, PDF and SVG; keyboard-accessible dialogs and responsive toolbar.
5. Node regression suite plus real-browser checks: switch/edit/undo/redo/save/reopen/cancel; inspect both scores, thumbnail, export and narrow viewport. Check source note equality on display-only actions.

No commit, push or deployment is included. Known notation scope: conventional equal-tempered pitches and a selectable binary display grid; expressive/irregular timing remains intact in the underlying clip and is marked as approximated on the score.

## Implemented and verified (2026-09-25)

- All five implementation/acceptance steps above are complete for this local version. See `CLIP_NOTATION_VERIFICATION.md` for evidence, launch instructions, and limits.
- Named pitch and conventional note duration selectors supplement exact beat/velocity controls. Common actions remain visible; existing detailed tools are expandable.
- Untouched notes retain their original beat precision when another note is saved. Real note edits snapshot the prior clip head using the existing revision API; view-only saves do not create a new musical revision.

## Direct pitch gestures and audition

- Staff noteheads drag vertically through diatonic staff positions in the selected key. Preserve the source note's chromatic offset, exact timing and velocity. Existing semitone controls remain available for accidentals.
- Capture the pointer on the persistent score surface, independently of SVG re-engraving. One committed gesture creates one undo entry; returning to the starting pitch, Escape, pointer cancellation or focus loss creates none. Tied fragments edit the same source note.
- Both staff and roll gestures preview the initial pitch and each changed pitch. A shared on/off button controls preview; release, cancellation, view switching and editor close silence it. Preview is a quiet synthetic tone in the existing audio context, not a track-instrument sampler.
- The piano roll has an aligned, horizontally pinned black/white keyboard with C-octave labels, pitch tooltips, keyboard activation and pointer glissando. Audition never changes score, cursor or history.
- Keep UI-only legacy note annotations out of the engraving cache key so selection does not trigger expensive layout.
- Interaction reference: FL Studio's preview keyboard (official manual): https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll.htm
