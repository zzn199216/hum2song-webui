# Studio public-page repair — 2026-10-31

Baseline reviewed: `ae44e7b`. The independent test-workflow commit `0d5b0fe` remains intact.

## Changes

- Keep the editor hidden until runtime initialization and the selected language dictionary have both finished. Announce `H2S_STUDIO_UI_STATE` version 1 to the embedding Cloud page; a late bridge ping receives the current state.
- Failed/slow startup shows a retry action instead of untranslated controls. Late successful loading can recover; errors after readiness never cover an existing editing session.
- Phone layouts use a collapsed assistant by default, a separate mobile preference, bounded panel dimensions and a vertically scrollable editor. The assistant header supports Enter/Space and exposes `aria-expanded`.
- Reapply translation to dynamically created timeline snap options, which previously retained their raw keys even after the dictionary loaded.
- Bump versioned frontend resources to `interface-ready-v1`, including the matching existing asset assertions.

## Local verification

- `node scripts/test-changed.js plan --base ae44e7b`
- `node scripts/test-changed.js run --base ae44e7b`: full frontend suite passed, including startup ordering, error/retry/recovery, syntax, multistem timing and existing audio/editor contracts.
- Isolated Chromium with a local static server and Cloud dev server: at 375 px the iframe is 349 px wide with no horizontal document overflow; assistant starts collapsed and keyboard expansion works.
- Delayed the actual locale JSON request by 5 seconds: only the loading view was visible until readiness. Aborted locale requests: error shown, retry succeeded once requests were allowed.
- No model inference, real audio generation, payment, production mutation or deployment was performed. Static-fixture API 404 responses are expected and do not represent live acceptance.

## Release coordination

Ship with the corresponding Cloud public-page repair. Deploy Studio first (the new state message is additive for the old Cloud), then Cloud Web/API together. New Cloud intentionally waits for the new ready signal; deploying it against the old Studio would leave the loading/retry view visible. Roll back Cloud first if restoring an older Studio.

Use versioned artifacts and atomic release switches under the existing runbooks. Repeat the affected browser smoke against the deployed revisions. This document does not authorize deployment or paid calls.
