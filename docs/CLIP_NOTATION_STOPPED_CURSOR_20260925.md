# Keep the stopped score cursor

Base: f230de4feaadf3dc94b9a4a2d223f091c8314340 (production v5).
Release marker: clip-notation-v6-20260925.

Manual Stop now clears sounding-note highlights but draws a stationary notation
cursor at the same shared cursorSec used by the piano roll. No idle animation or
automatic scroll runs. Selecting a note updates this stationary position; closing
or switching to the roll still hides notation. Playback resumes from the existing
transport cursor. The original transport's end-of-clip reset behavior is unchanged.

The actual-transport browser regression checks staff and numbered stop/resume,
retained nonzero position, zero marker mutations during an idle interval, later
page stop, rests, page following, export exclusion, and unchanged MIDI.
Use the exact-base Studio delta workflow with signed-in CN and anonymous CN/COM
entry checks; no processing jobs or backend changes.
