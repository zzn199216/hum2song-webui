# CN Studio Suno source precision fix — 2026-10-01

Product commit: `cac67b2577c7ab2cac28f0ecd9454e2b6eb638fe`.
Cache version: `suno-source-precision-v1-20261001`.

## Behavior

Cloud playback copies previously reused the original Core asset identity while
submitting browser-decoded duration. The observed browser duration was 118.44 s;
Core metadata was 118.4 s. A strict complete-source check can reject this before
provider submission. Production showed input requests returning 422 without a
new task; the exact response body was not captured.

Local audio now stages its actual bytes through the existing source preparation
route, then submits the returned source identity and canonical duration together.
Original Cloud identity remains trace metadata. Full-source files retain their
original bytes; partial selections retain the existing PCM WAV crop path and
timeline alignment. Stable source keys preserve retry reuse. A source above the
existing 20 MB cap fails visibly before upload/submission.

Errors now appear above the separation controls in a red, 13 px status block,
with automatic scrolling and an accessible alert. Partial stem import failures
also produce a visible warning instead of unconditional completion text.

## Verification and release

- Complete frontend suite passed, including a behavioral test of the actual App
  method for 118.44/118.4 precision, prepared canonical duration, retry keys,
  partial crops, local files, missing files, and oversize files.
- Local and deployed controller checks passed nine error cases across
  1440×1000, 1440×720, and 390×700. Every status was visible and buttons recovered;
  no business writes, authenticated requests, or paid provider calls occurred.
- CN public Studio iframe loaded the new assets; editor controls were ready and
  there was no horizontal overflow. Native confirmation was dismissed without
  submitting a paid job. No signed-in paid end-to-end generation was performed.
- Public Studio assets, CN shell, and API health returned HTTP 200. Source/client
  bridge files outside the change remained byte-identical to the previous release.
- Global Studio did not render in the independent browser, consistent with the
  previously recorded limitation; no Global browser acceptance is claimed.

Active release:
`/opt/hum2song/studio/releases/cac67b2577c7ab2cac28f0ecd9454e2b6eb638fe-suno-source-precision-v1-20261001-r2`.

Rollback release:
`/opt/hum2song/studio/releases/1a70b52c4810cb1f437e1ebac6b077c268c8839f-suno-separation-confirm-v1-20261001`.

The first cutover automatically returned to the previous release because an
additional file hash check compared Git LF bytes against packaged CRLF bytes.
All five changed runtime files were then verified to equal the committed content
after newline normalization. The second cutover verified their exact artifact
hashes and succeeded. Artifact SHA-256:
`434aeba089da1278239ac91c67bc59cf24223c6c3b2b1ca7035fb91e4b59fe9a`.

Only Studio restarted. Cloud remained at `3024024-compose-midi-20261001`; Web,
API, Core, and Linggan process IDs and the shared data directory were preserved.
Evidence is in the ignored `output/deploy/suno-source-fix-*` and
`output/playwright/suno-source-fix/` directories of the
`hum2song-humming-compose-cn` worktree.

## Balance patch remains held

The separate chat “修复分轨额度扣减逻辑” still ends at its commit-only milestone.
The earlier 10,000-credit grant was completed; it must not be repeated. Its
trial/paid mixed-charge patch is not deployed. Previously identified duplicate
request and refund/lease race blockers have no subsequent correction in that
chat. This Studio release includes no billing or membership changes.
