# Hum2Song Studio — E2E Checklist

Deterministic checklist for validating Studio UI and LLM Optimize flow. Use this for PR verification or onboarding.

---

## 1. Frontend hard gate

```powershell
node scripts/run_frontend_all_tests.js
```

All tests must pass before merge.

---

## Controls

| Key / Button | Action | Note |
|--------------|--------|------|
| **R** | Record toggle | Start or stop recording |
| **P** | Play / Pause | Button only (no keybinding) |
| **S** | Stop + Reset to start | Visible only while playing; resets playhead to 0. Does **not** stop recording |

Recording is controlled only by R or the Record button. S stops playback and resets the playhead; use R to stop recording.

---

## 2. Manual E2E (deterministic)

1. **Start server**
   ```powershell
   uvicorn app:app
   ```

2. **Open Studio UI**  
   Navigate to [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)

3. **Configure model** (if unset)  
   Expand **Advanced** → **LLM Settings**. Set Base URL and Model. Save.

4. **Run Quick Optimize**  
   - Select a clip, open Clip Editor  
   - Choose Preset (e.g. LLM v0)  
   - Optionally enable Goals (Fix Pitch, Tighten Rhythm, Reduce Outliers)  
   - Click **Run Optimize**

5. **Confirm summary updates**  
   - Result summary shows: pitch/timing/structure ✓ or velocity-only  
   - Status line reflects success or failure

6. **Quality gate (if applicable)**  
   - In Full mode with Fix Pitch or Tighten Rhythm enabled, if the model returns velocity-only: one retry occurs; if still velocity-only, failure is shown.  
   - Confirm actionable guidance appears in the summary.  
   - Confirm **[Turn off Tighten Rhythm]** link works: unchecks the goal and persists options, **without** triggering another optimize run.

7. **Persist flow**  
   - When `ops > 0`, draft refreshes from the optimized clip.  
   - Click **Save** and confirm the optimized notes persist in the project.

---

## Phase C — Input MVP (Recording / Upload)

Full flow: Record → Generate clip → Auto-open editor → Quick Optimize.

1. **Open Studio UI**  
   Navigate to [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)

2. **Record and generate a clip**  
   - Click **Record**, hum/sing for ~3 seconds, click **Stop** (same button toggles)  
   - Timer counts up and waveform animates during recording  
   - Click **Use last recording**  
   - Observe status progression: Uploading → Processing (task...) → Fetching → Creating clip → Done

3. **S button**  
   - Appears only while playback is active (next to P). Stops playback and resets playhead to start (0).

4. **Cancel during import**  
   - If import is in progress, **Cancel** stops polling (client-side only; backend task may continue)

5. **Mic permission denied**  
   - If recording fails due to mic access, the UI shows a message; grant permission in the browser and retry

6. **Auto-open editor**  
   - Checkbox "Auto-open editor after import" (default on) opens the Clip Editor automatically when the clip is created  
   - Confirm the new clip is visible/selected and the editor opens  
   - Quick Optimize is immediately available in the editor

7. **Troubleshooting**  
   - **Model unset:** Advanced → LLM Settings → set Base URL and Model → Save  
   - **Quality gate fails:** Follow on-screen guidance or turn off Tighten Rhythm  
   - **Tone.js CDN blocked:** Studio loads Tone.js locally from `/static/pianoroll/vendor/tone/Tone.js` by default. CDN fallback exists only if `window.H2S_ALLOW_CDN_TONE === true` (set in console before first playback).  
   - **Waveform not showing during recording:** Refresh page and allow microphone permission when prompted.

---

## MVP Demo Path (~2 min)

For a quick reproducible demo, see **[docs/DEMO_SCRIPT_MVP_V1.md](DEMO_SCRIPT_MVP_V1.md)**:

- Record → Use last recording → Editor auto-opens
- Quick Optimize templates (Fix Pitch, Tighten Rhythm)
- Export MIDI with mute
- Optional: History rollback

---

## 3. Common issues

| Issue | Cause | Workaround |
|-------|-------|-------------|
| **Model unset** | Base URL or Model not configured | Advanced → LLM Settings → set Base URL and Model → Save |
| **Quality gate velocity-only failure** | Fix Pitch / Tighten Rhythm enabled but model returned only velocity changes | Use a stronger model, turn off Tighten Rhythm (or Fix Pitch), or add prompt: "fix pitch/timing, not just dynamics" |
| **Safe vs Full mode** | Safe mode allows only velocity changes; Full mode allows pitch/timing/structural edits | Advanced → LLM Settings → uncheck "Velocity-only (Safe mode)" for Full mode |
| **Tone.js CDN blocked** | Studio loads Tone locally by default | No action needed; CDN fallback only if `window.H2S_ALLOW_CDN_TONE === true` |

---

## 4. Security note

Do not store provider API keys in the browser. Use a gateway or backend proxy for production. See [docs/LLM_GATEWAY_QUICKSTART.md](LLM_GATEWAY_QUICKSTART.md).
