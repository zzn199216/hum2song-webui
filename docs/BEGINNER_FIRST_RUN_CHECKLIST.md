# Beginner first-run checklist

Short path to a **working local** Hum2Song MVP + Studio. For API details see the root `README.md`.

## 1. Install prerequisites

| Item | Why | Notes |
|------|-----|--------|
| **Python 3.11+** | Runs the FastAPI server | Use a venv (see README). |
| **FFmpeg** on PATH | MP3 output and some conversions | Server starts without it; **MP3 / some flows fail** if missing when needed. |
| **FluidSynth** on PATH | MIDI → WAV synthesis | Or set `FLUIDSYNTH_PATH` in `.env` to the executable. |
| **SoundFont `.sf2`** | Required to render MIDI to audio | Default path: **`assets/piano.sf2`** (see [`assets/README.txt`](../assets/README.txt)). Override with `SOUND_FONT_PATH` / `SF2_PATH` in `.env`. |

**Optional:** Copy [`.env.example`](../.env.example) to `.env` and adjust paths.

**Not required to open the UI:** Node.js (only for `scripts/run_frontend_all_tests.js`), LLM gateway ([`docs/LLM_GATEWAY_QUICKSTART.md`](LLM_GATEWAY_QUICKSTART.md)), extra sampler samples ([`docs/INSTRUMENT_LIBRARY.md`](INSTRUMENT_LIBRARY.md)).

## 2. Place the SoundFont

1. Obtain a valid `.sf2` file (project does not ship one for license/size reasons).
2. Put it at **`assets/piano.sf2`** **or** set `SOUND_FONT_PATH` in `.env`.
3. If `assets/` has any other `*.sf2`, the app may fall back when the configured file is missing — prefer placing **`piano.sf2`** as documented.

## 3. Python environment and install

From the **repository root**:

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

First install may take **several minutes** and significant disk space (large ML/audio dependencies).

## 4. Start the server

Still from **project root**:

```powershell
uvicorn app:app
```

(Development: add `--reload` if you want auto-reload.)

## 5. Verify with the health endpoint

Open in a browser or HTTP client:

**`http://127.0.0.1:8000/api/v1/health`**

Inspect `checks`:

- **`soundfont_exists`** — `true` when the configured SoundFont file is present.
- **`fluidsynth`** — tool found (or valid `FLUIDSYNTH_PATH`).
- **`ffmpeg`** — tool found on PATH.

`ok` is `true` whenever the API is up; use the **`checks`** object to see what is missing for **audio generation**.

## 6. Confirm the app

- **Swagger:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Studio:** [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)

## 7. Common first-run issues

| Symptom | Likely cause |
|---------|----------------|
| Health shows `soundfont_exists: false` | No file at `assets/piano.sf2` (or wrong `SOUND_FONT_PATH`). |
| Health shows `fluidsynth: false` | FluidSynth not installed or not on PATH; set `FLUIDSYNTH_PATH` on Windows if needed. |
| Health shows `ffmpeg: false` | FFmpeg not on PATH; WAV output may still work; MP3 may fail. |
| Error when generating **audio** after MIDI | Missing SoundFont or FluidSynth; see `core/synthesizer.py` error messages. |
| `pip install` very slow / huge download | Expected: `requirements.txt` includes heavy packages (e.g. stem separation stack). |

## 8. Optional: Docker (secondary)

The repo has a root **`Dockerfile`** that installs FFmpeg, FluidSynth, and Python dependencies. You must still supply a SoundFont (e.g. bind-mount `assets/`). The image uses **Python 3.10**; local README recommends **3.11+**. There is **no** `docker-compose` here — this is **not** the primary onboarding path.
