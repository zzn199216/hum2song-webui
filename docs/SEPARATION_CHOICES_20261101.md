# Three separation choices — 2026-11-01

The waveform editor now presents **Vocal separation / Multitrack separation / Suno stems** as three mutually exclusive choices on the left. The redundant intent dropdown is hidden. On mobile the processing options appear below the choices.

The existing Suno provider uses `type: "split_stem"`; it is already the multitrack path. Selecting Suno clears incompatible combined transcription, shows its existing **30 audio credits** cost, and uses the existing advanced-stem callback. Ordinary separation keeps the existing audio-only / separation-and-transcription paths and rates. Returning from Suno restores the ordinary options. Busy state prevents switching; retry submission keys and selected audio offsets remain intact.

## Source and published releases

- Studio implementation: `78856001236b97ceb952e64b7fb1e29270c6daa2`, cache version `separation-choices-v7`.
- CN/shared Studio current: `/opt/hum2song/studio/releases/78856001236b97ceb952e64b7fb1e29270c6daa2-separation-choices-20261101`.
- Studio rollback: `/opt/hum2song/studio/releases/992b510909eea0b0df59cdeab3e90e13acbdf471-startup-cache-cn-20261101`.
- Studio archive SHA-256: `203469d324ca33b21177f5d65faa7e4612ce59a750ec669039354d5578b524da`.
- GLOBAL Web published source: `e0ab5c9f483cca8005d6a75c6093e338743f4f20`, based strictly on live `a78fd99`; only the vendored Studio startup snapshot changed.
- GLOBAL Web current: `/opt/hum2song/web-global/releases/e0ab5c9-separation-choices-global-20261101`.
- GLOBAL Web rollback: `/opt/hum2song/web-global/releases/a78fd99-voice-shell-global-web-20261101`.
- GLOBAL snapshot version: `b6a788b6214ed8181826`, bound to Studio `7885600`.
- GLOBAL archive SHA-256: `4a58d430485771e4bebdc7043c3d46bc0a31fb3b2a5ab82a5f53026e4ec7d3ea`.
- The same snapshot change was cherry-picked as `b6ebc29` onto the ongoing GLOBAL branch after `f53cf0e`, preserving its other work. **That branch's unrelated Voice changes were not deployed by this release.** Future GLOBAL releases must retain this snapshot or regenerate from a newer Studio source.

CN and GLOBAL share editor source, but GLOBAL serves a frozen startup snapshot through its same-origin `/ui` proxy. Updating CN Studio alone does not update that snapshot. No auth, account, payment, pricing, provider, model, or project schema was changed here.

## Acceptance

- Complete Studio frontend suite passed, including separation dispatch, retry/busy guards, source timing, adapter/billing contracts, editor/numeric/timeline regressions.
- Startup bundling reduced 72 classic scripts to two verified content-addressed bundles.
- GLOBAL: 473 Web tests passed; one root cold Web build with shared-contract validation, lint and types passed.
- Published assets tested in six browser cases: CN Chinese and GLOBAL English/Japanese, each at 1366 and 375 pixels. Each reached ready state with `separation-choices-v7`; screenshots were inspected.
- Three choice labels, selected state, Suno 30-credit wording, hidden incompatible option, restored ordinary option, and zero document horizontal overflow passed. Ordinary vocal+transcription and Suno dispatched to the appropriate controlled callbacks; a start=1s/duration=2s selection remained unchanged.
- No JavaScript page exceptions occurred. Existing CN initial-navigation `postMessage` origin warnings and browser autoplay/DOM notices were observed; this release does not claim to resolve those unrelated notices.
- Browser processing callbacks were controlled fixtures. No production paid inference, purchase, debit, account mutation, or new cloud-save transaction was performed. This is UI/dispatch acceptance, not a new model-quality or billing-settlement certification.
- GLOBAL recreated all 27 public page snapshots. Its API release and PID stayed unchanged. CN Cloud Web/API/Core were not restarted by this Studio release. No release pruning occurred; rollback directories remain available.

GLOBAL's first cutover automatically rolled back when the public-shell helper was absent from the application-only release. The unchanged helper was then supplied explicitly, the same verified candidate redeployed, all 27 snapshots generated, and the live browser matrix passed. The final receipt is `/opt/hum2song/ops/e0ab5c9-separation-choices-global-20261101/receipt.json`; the prior Web environment is backed up beside it. To roll back Web, atomically restore its previous symlink and backed-up `voice-shell-release.env` together, restart only `hum2song-web-global`, and verify `/ui`, public pages and API health. Studio rollback needs only its prior symlink and Studio service restart. Never roll back account/job databases for this UI release.

## Local evidence

- Studio ignored `output/separation-choices-tests.log`, `output/separation-choices-package.log`, `output/separation-choices-deploy.log`.
- GLOBAL isolated checkout: `W:/CodexData/Home/worktrees/separation-snapshot-global/hum2song-cloud`; ignored `output/verification/last-run.json` and `output/separation-choices/package.json`.
- Browser evidence: `C:/Users/666/.codex/visualizations/2026/10/30/01a18e43-f58f-79f0-b383-81e7321ab2a1/stem-choices-live.log` and `stem-choices-live-<host>-<language>-<width>.png`.
