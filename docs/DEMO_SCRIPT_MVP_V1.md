# Hum2Song Studio — MVP v1 Demo Script (~2 min)

Reproducible demo path for MVP v1. Step-by-step, single page.

---

## Pre-requisites

1. **Start backend**
   ```powershell
   uvicorn app:app
   ```

2. **Open Studio UI**  
   [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)

---

## Step 1: Record → Use last recording → Editor auto-opens

1. Click **Record**, hum or sing for ~3 seconds, click **Stop** (same button toggles).
2. Click **Use last recording**.
3. Observe status progression: *Uploading* → *Processing (task...)* → *Fetching* → *Creating clip* → *Done*.
4. If "Auto-open editor after import" is enabled (default on), the Clip Editor opens with the new clip.

---

## Step 2: Quick Optimize templates

1. In the Clip Editor, locate the **Quick Optimize** section.
2. Click **Fix Pitch** under Templates.
3. Click **Run Optimize**.
4. Confirm the summary shows: `Template: fix_pitch_v1` and `tmpl_v1.fix_pitch.r1`.
5. *(Optional)* Click **Tighten Rhythm** → **Run Optimize** → confirm version `tmpl_v1.tighten_rhythm.r1`.

---

## Step 3: Export MIDI (with mute)

1. Ensure your project has at least two tracks with clips on the timeline.
2. Mute a track by clicking the **M** button on that track header.
3. Click **Export MIDI** (in Inspector → Actions).
4. Save `hum2song.mid` and open in a DAW or player.
5. Verify the muted track has no notes in the exported file.

---

## Step 4 (optional): History rollback

1. In Inspector → **Clip Details**, select a clip that has revision history.
2. Use **History** controls: **Rollback**, **Use**, or **A–B** to navigate revision chain.
3. Confirm you can switch between revisions and see clip content change.

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| **Export MIDI 404** | Restart uvicorn. Verify [http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json) includes `/export/midi`. Make sure you are running the updated backend from the correct repo root. |
| **Mic permission denied** | Grant microphone permission in the browser when prompted. |
| **Tone loads locally** | Studio loads Tone.js from `/static/pianoroll/vendor/tone/Tone.js` by default. CDN fallback only if `window.H2S_ALLOW_CDN_TONE === true`. |
