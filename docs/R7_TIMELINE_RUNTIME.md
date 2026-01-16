# R7 TimelineRuntime (Pure Logic) - Integration Guide

This patch adds **pure JS** modules that make Timeline logic testable:

- `static/pianoroll/core/timeline_math.js`
- `static/pianoroll/controllers/timeline_runtime.js`
- Node unit test: `scripts/run_frontend_timeline_unit_tests.js`

## What this patch DOES NOT do (yet)
It does not overwrite your existing `timeline_controller.js` automatically, because your repo is ahead and we want to avoid regressions.
Instead, you integrate in **two small steps** below, then we can safely do the full extraction.

## Step 1: Load scripts in `static/pianoroll/index.html`
Make sure these are loaded **before** `timeline_controller.js`:

```html
<script src="/static/pianoroll/core/timeline_math.js"></script>
<script src="/static/pianoroll/controllers/timeline_runtime.js"></script>
```

## Step 2: Wire runtime inside `timeline_controller.js` (minimal change)
Where you compute drag preview startSec from pointerX, replace that math with runtime:

```js
const Rt = window.H2STimelineRuntime;
const MathLib = window.H2STimelineMath;

// on pointerdown:
state._drag = Rt.beginDrag({
  pxPerSec: state.ui.pxPerSec,
  pointerX: ev.clientX - laneLeftPx,
  instStartSec: inst.startSec,
});

// on pointermove:
const gridSec = state.ui.gridSec || 0;
const bypass = !!state.ui.snapBypass;
const out = Rt.updateDrag(state._drag, { pointerX: ev.clientX - laneLeftPx, gridSec, bypass });
inst.startSec = out.previewStartSec; // (or preview only, commit on up)

// on pointerup:
const end = Rt.endDrag(state._drag);
inst.startSec = end.committedStartSec;
state._drag = null;
```

Once you upload your current `timeline_controller.js`, I can produce the full **drop-in replacement** that extracts all math and keeps behavior identical.

## Running tests
Run existing all tests plus new unit tests:

```bash
node scripts/run_frontend_all_tests.js
node scripts/run_frontend_timeline_unit_tests.js
```
