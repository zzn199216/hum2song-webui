# Hum2Song Studio — E2E Checklist

Deterministic checklist for validating Studio UI and LLM Optimize flow. Use this for PR verification or onboarding.

---

## 1. Frontend hard gate

```powershell
node scripts/run_frontend_all_tests.js
```

All tests must pass before merge.

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

## 3. Common issues

| Issue | Cause | Workaround |
|-------|-------|-------------|
| **Model unset** | Base URL or Model not configured | Advanced → LLM Settings → set Base URL and Model → Save |
| **Quality gate velocity-only failure** | Fix Pitch / Tighten Rhythm enabled but model returned only velocity changes | Use a stronger model, turn off Tighten Rhythm (or Fix Pitch), or add prompt: "fix pitch/timing, not just dynamics" |
| **Safe vs Full mode** | Safe mode allows only velocity changes; Full mode allows pitch/timing/structural edits | Advanced → LLM Settings → uncheck "Velocity-only (Safe mode)" for Full mode |

---

## 4. Security note

Do not store provider API keys in the browser. Use a gateway or backend proxy for production. See [docs/LLM_GATEWAY_QUICKSTART.md](LLM_GATEWAY_QUICKSTART.md).
