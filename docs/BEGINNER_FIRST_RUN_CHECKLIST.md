# Beginner first-run checklist

Short path to a **working local** Hum2Song MVP + Studio. For API details see the root `README.md`.

**If preflight, launch, or `beginner_install_audio_deps.bat` says something is missing:** open **`docs/BEGINNER_FIRST_RUN_CHECKLIST.md`** in your editor and go to **[Manual install (SoundFont, FluidSynth, FFmpeg)](#manual-install-soundfont-fluidsynth-ffmpeg)** — that section is the single place for the manual dependency path (we do not fully automate system tools).

**Recommended order**

1. **`python scripts/beginner_preflight.py`** — quick read-only check (Python, SoundFont, FluidSynth, FFmpeg; optional live health if a server is already up).
2. **Create a venv and install deps** (once): `pip install -r requirements.txt` (see §3).
3. **`python scripts/beginner_launch.py`** — starts the same stack as `uvicorn app:app` from the repo root, **waits until** `GET /api/v1/health` returns `ok: true` (or times out after ~45s), then prints **Studio**, **health**, and **API docs** URLs. Optional **`--open`** opens **Studio** in your default browser after readiness (or after the timeout, with a short notice).
4. If you did not use `--open`, open the URLs in your browser (or use **health** to confirm `checks`).

## 0. Quick preflight (optional)

From the **repository root**, you can run a **read-only** check before or after creating a venv (uses only Python’s standard library):

```powershell
python scripts/beginner_preflight.py
```

**What it does:** prints `[PASS]` / `[WARN]` / `[MISSING]` / `[SKIP]` for Python version, SoundFont (`SOUND_FONT_PATH` / `SF2_PATH` or default `assets/piano.sf2`), FluidSynth (`PATH` or `FLUIDSYNTH_PATH`), FFmpeg, and optionally `GET /api/v1/health` if the server is already running on `PORT` (default `8000`). It does **not** install packages or download files.

**Success:** exit code `0` and no `[MISSING]` lines for items you need for MIDI-to-audio. **If something fails:** read the lines above and fix prerequisites in the sections below; exit code `1` means a required item is missing.

## 1. Install prerequisites

| Item | Why | Notes |
|------|-----|--------|
| **Python 3.11+** | Runs the FastAPI server | Use a venv (see README). |
| **FFmpeg** on PATH | MP3 output and some conversions | Server starts without it; **MP3 / some flows fail** if missing when needed. |
| **FluidSynth** on PATH | MIDI → WAV synthesis | Or set `FLUIDSYNTH_PATH` in `.env` to the executable. |
| **SoundFont `.sf2`** | Required to render MIDI to audio | Default path: **`assets/piano.sf2`** (see [`assets/README.txt`](../assets/README.txt)). Override with `SOUND_FONT_PATH` / `SF2_PATH` in `.env`. |

**Optional:** Copy [`.env.example`](../.env.example) to `.env` and adjust paths.

**Not required to open the UI:** Node.js (only for `scripts/run_frontend_all_tests.js`), LLM gateway ([`docs/LLM_GATEWAY_QUICKSTART.md`](LLM_GATEWAY_QUICKSTART.md)), extra sampler samples ([`docs/INSTRUMENT_LIBRARY.md`](INSTRUMENT_LIBRARY.md)).

## Manual install (SoundFont, FluidSynth, FFmpeg)

Use this when automated helpers are not enough or when you prefer to install by hand. Scripts point here by path: **`docs/BEGINNER_FIRST_RUN_CHECKLIST.md`** (this file).

### SoundFont (`.sf2`)

1. Obtain a valid `.sf2` file (the repo does not ship one; see [`assets/README.txt`](../assets/README.txt) for guidance).
2. Place it at **`assets/piano.sf2`** in the project root, **or** set **`SOUND_FONT_PATH`** or **`SF2_PATH`** in `.env` to the full path of your `.sf2`.
3. Confirm the file exists on disk before expecting MIDI→audio to work.

### FluidSynth

FluidSynth must be a runnable **`fluidsynth`** (or **`fluidsynth.exe`**) on your **`PATH`**, unless you set **`FLUIDSYNTH_PATH`** in `.env` to the full path of the executable (common on Windows).

| Platform | Practical options |
|----------|-------------------|
| **Windows** | **Chocolatey:** `choco install fluidsynth -y` (requires Chocolatey). Optional helper from repo root: **`beginner_install_audio_deps.bat`** (tries Chocolatey / winget for FFmpeg; see that file’s output — it does **not** install a SoundFont). **Manual:** download a FluidSynth build you trust, then add its folder to PATH or set `FLUIDSYNTH_PATH`. |
| **macOS** | **Homebrew:** e.g. `brew install fluidsynth` |
| **Linux** | Use your distro package manager, e.g. `apt install fluidsynth` (name may vary). |

After installing, open a **new terminal**, run **`python scripts/beginner_preflight.py`**, and confirm FluidSynth is no longer `[MISSING]`.

### FFmpeg

FFmpeg must be **`ffmpeg`** on **`PATH`** for MP3 and some conversions (WAV may work without it in some paths).

| Platform | Practical options |
|----------|-------------------|
| **Windows** | **winget:** `winget install --id Gyan.FFmpeg -e` — **Chocolatey:** `choco install ffmpeg -y`. Optional: **`beginner_install_audio_deps.bat`**. |
| **macOS** | e.g. `brew install ffmpeg` |
| **Linux** | e.g. `apt install ffmpeg` |

The root **`Dockerfile`** also installs `ffmpeg` and `fluidsynth` inside the image; you still supply a SoundFont yourself.

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

Still from **project root**.

**Beginner launch helper (recommended):** runs preflight first, then `uvicorn app:app` (uses `./venv`’s Python if that folder exists).

```powershell
python scripts/beginner_launch.py
```

- **`--reload`** — pass `--reload` to uvicorn for local code changes.
- **`--skip-preflight`** — skip the doctor step (not recommended the first time).
- **`--open`** — after the server is **ready** (see below), open **Studio** (`/ui`) in the system default browser. If readiness is not confirmed within ~45s, the script still tries to open Studio and prints a short warning (you may need to refresh).

**What “ready” means:** the launch script polls `http://127.0.0.1:<PORT>/api/v1/health` until the JSON includes `"ok": true` (same endpoint as §5). First startup can take several seconds while Python imports the app.

**If the server never becomes ready:** check the terminal for import errors; confirm the port is free (`PORT` in `.env`, default `8000`); run **`python scripts/beginner_preflight.py`** again; or start manually with `uvicorn app:app` and open **health** yourself.

**Manual (equivalent):**

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

The Studio page shows a **dismissible “Getting started” bar** (first visit per browser) with the same high-level steps, **Copy** buttons for the preflight and launch commands (clipboard API with a simple fallback), a link to **`/api/v1/health`**, and a **More help** action that opens a compact in-browser summary (localized). After you dismiss the bar, **Beginner help** in the top bar still opens that same summary; inside that overlay you can use **Show getting started bar again** to clear the dismissal and bring the strip back (no need to clear site storage manually). The full checklist file remains in the repo as `docs/BEGINNER_FIRST_RUN_CHECKLIST.md`.

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
