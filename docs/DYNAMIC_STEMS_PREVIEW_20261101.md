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

Production update: deployed to the shared Studio on 2026-11-01 after explicit
user authorization, together with both regional APIs/Web and the dedicated
multistem Worker. The active release is
`d9b071dbb76c6ea537f82e6c8f6e407afe0f9522-dynamic-preview-v8-20261101`; rollback
is the previous `7885600` editor. Live API/bridge imports, native MP3 decode,
manual/bundled MIDI, duplicate requests, folded restoration, cloud save/load,
page reload and mobile checks passed. Cloud's
`docs/ops/DYNAMIC_STEMS_RELEASE_20261101.md` records the complete release,
preserved services and account/refund acceptance. No Git push was performed.
