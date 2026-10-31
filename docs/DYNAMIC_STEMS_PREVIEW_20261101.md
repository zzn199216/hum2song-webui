# Content-dependent stems and compressed previews — 2026-11-01

Based on Studio `2f20541` / the deployed `7885600` editor. Retains the three
separation choices, Suno's existing path, opt-in transcription, canonical beats,
source-origin placement, quiet recovery and original audio.

The editor imports only each stem's `audio` artifact (MP3 for the new runner).
Optional `transcriptionSource` points to an owned lossless server artifact and is
never downloaded for browser import. MIDI/ScoreDoc remain the editable result.
Quiet restoration preserves the actual filename/MIME instead of wrapping MP3
bytes as WAV. Related uncertain parts are folded, recoverable and excluded from
automatic MIDI. Dynamic category labels are available in Chinese/English/Japanese.

Status, result and artifact GET bridge requests retry transient read failures
with bounded attempts/deadlines, always retaining the same job. Creation/debit
requests are never retried by this helper; authentication failures remain visible.

The complete frontend suite passed, including new dynamic-category/preview and
read-recovery tests. Model, codec, service/browser acceptance and release state
are recorded in Cloud's corresponding dynamic-stem report; these local checks do
not establish production acceptance. Cache version: `dynamic-stems-preview-v8`.
