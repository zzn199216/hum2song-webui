# Export Flatten JSON (T3-0)

This patch adds an **"Export Flatten JSON"** button (injected next to **Export Project JSON**).

## What it exports

Downloads a JSON bundle:

```json
{
  "kind": "hum2song_flatten_bundle",
  "version": 1,
  "exportedAt": 0,
  "project": { "version": 2, "timebase": "beat", "...": "..." },
  "flatten": { "bpm": 120, "tracks": [ { "trackId": "...", "notes": [ ... ] } ] }
}
```

## One-time wiring

Add this script tag in `static/pianoroll/index.html` **before** `app.js`:

```html
<script src="/static/pianoroll/controllers/export_flatten_controller.js"></script>
```

Recommended placement (near the bottom, just before app.js):

```html
<script src="/static/pianoroll/controllers/editor_runtime.js"></script>
<script src="/static/pianoroll/controllers/export_flatten_controller.js"></script>
<script src="/static/pianoroll/app.js"></script>
```

## Tests

No new tests are required for this patch.
