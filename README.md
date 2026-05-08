# Hum2Song

Hum2Song turns a short **humming or singing clip** into **MIDI and synthesized audio**: upload audio → pipeline (preprocess → pitch/audio-to-MIDI → synthesis) → download results.

This repository ships:

| Component | What it is |
|-----------|------------|
| **Backend API** | REST API for async jobs (`POST /generate`, poll, download). |
| **Hum2Song Studio** | Browser UI at `/ui` for recording/import, piano roll editing, and optional LLM-assisted optimization. |

**Languages:** this file is English. For Chinese, see **[README_CHS.md](README_CHS.md)**.

---

## Quick start (local)

Do these **from the repository root** so imports resolve correctly.

### 1. Prerequisites

| Requirement | Why |
|-------------|-----|
| **Python 3.11+** | Runs the FastAPI app. |
| **FFmpeg** on `PATH` | MP3 output and some conversions. |
| **FluidSynth** on `PATH` (or `FLUIDSYNTH_PATH` in `.env`) | MIDI → WAV/audio. |
| **SoundFont `.sf2`** | Required for MIDI→audio. Default file: **`assets/piano.sf2`** (not shipped in git — see [`assets/README.txt`](assets/README.txt)). |

Optional: copy [`.env.example`](.env.example) to `.env` and set `SOUND_FONT_PATH`, `FLUIDSYNTH_PATH`, or `PORT` as needed.

**Stuck on installing FFmpeg, FluidSynth, or a SoundFont?** Follow the step-by-step section **Manual install** in **[docs/BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md#manual-install-soundfont-fluidsynth-ffmpeg)**.

### 2. (Optional) Check your machine

Read-only checks; does not install anything:

```powershell
python scripts/beginner_preflight.py
```

### 3. Virtual environment and dependencies

**Windows (PowerShell):**

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

**macOS / Linux:**

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

First install may take several minutes (large ML/audio dependencies).

### 4. Start the server

**Recommended** (runs preflight, starts Uvicorn, waits until health is OK, then prints URLs):

```powershell
python scripts/beginner_launch.py
```

Useful flags: `--reload` (auto-reload on code changes), `--skip-preflight`, **`--open`** (open Studio in the browser when ready).

**Equivalent manual command:**

```powershell
uvicorn app:app
```

(Add `--reload` during development.)

### 5. Open in the browser

| Page | URL |
|------|-----|
| **Health / diagnostics** | [http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health) |
| **API docs (Swagger)** | [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) |
| **Hum2Song Studio** | [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui) |

Default port is **8000**; override with `PORT` in `.env` if needed.

**You do not need Node.js** to run the server or Studio. Node is only used for frontend test scripts (`scripts/run_frontend_all_tests.js`).

---

## Using Hum2Song Studio

1. Start the server and open **[http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)**.
2. **Record** a clip or **import** an audio file — supported formats include WAV, MP3, M4A, OGG, FLAC.
3. Edit in the **piano roll** as needed.
4. **Quick Optimize:** choose a preset and goals (e.g. Fix Pitch, Tighten Rhythm, Reduce Outliers), then run optimize.
5. **Advanced** (collapsed by default): custom prompt, regenerate, LLM settings, debug. LLM setup is optional; see [Gateway-first LLM](#gateway-first-llm-optional) below.

**Keyboard shortcuts:** **R** — toggle recording; **P** — play/pause; **S** — stop and reset playhead while playing (does not stop recording).

Optional sampler instruments (e.g. piano samples): [docs/INSTRUMENT_LIBRARY.md](docs/INSTRUMENT_LIBRARY.md).

Full Studio validation checklist: [docs/STUDIO_E2E_CHECKLIST.md](docs/STUDIO_E2E_CHECKLIST.md).

---

## HTTP API overview

Hum2Song exposes **two** API styles:

| Style | Status | Notes |
|-------|--------|--------|
| **Contract API (frozen)** | **Recommended** | `/generate`, `/tasks/{id}`, `/tasks/{id}/download?file_type=...` |
| **Legacy** | Compatibility only | `/api/v1/...` — may be removed later |

### Contract API (summary)

- **Task lifecycle:** `queued` → `running` → `completed` | `failed`
- **Timestamps:** UTC ISO-8601 ending with `Z` (example: `2025-12-15T10:00:00Z`)

**Create a job**

```http
POST /generate?output_format=mp3
Content-Type: multipart/form-data
```

Form field: `file` = audio file.

**Poll status**

```http
GET /tasks/{task_id}
```

**Download**

```http
GET /tasks/{task_id}/download?file_type=audio
GET /tasks/{task_id}/download?file_type=midi
```

Example (create job with curl):

```bash
curl -X POST "http://127.0.0.1:8000/generate?output_format=mp3" \
  -F "file=@./sample.wav"
```

Typical HTTP errors: `400` bad `file_type`; `404` missing task or file; `409` job not ready or type not available; `413` upload too large.

The Chinese README and historical copies include **full JSON examples** for responses; you can also try flows interactively at **`/docs`**.

---

## Gateway-first LLM (optional)

Studio’s **LLM Optimize** feature expects an **OpenAI-compatible** gateway URL (local proxy, LiteLLM, etc.). Do **not** put provider API keys in the browser for public deployments — use a gateway or server-side proxy.

Quick setup: **[docs/LLM_GATEWAY_QUICKSTART.md](docs/LLM_GATEWAY_QUICKSTART.md)**.

---

## Docker

A root [`Dockerfile`](Dockerfile) installs FFmpeg, FluidSynth, and Python dependencies. You must still supply a **SoundFont** (e.g. mount or copy into `assets/`). The image uses **Python 3.10**; local development above recommends **3.11+**. There is no `docker-compose` in this repo.

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Health shows missing SoundFont / FluidSynth / FFmpeg | Fix paths or install tools; see [BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md). |
| Export / MIDI route returns 404 | Run `python scripts/check_export_routes.py` and restart Uvicorn after code changes. |
| Dependency warnings (e.g. Python 3.13 deprecations) | Often harmless for MVP usage. |

More detail: **[docs/BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md)**.

---

## Tests

**Frontend (required for CI-style checks):**

```powershell
node scripts/run_frontend_all_tests.js
```

**Backend (optional):**

```powershell
pytest -q
```

---

## Documentation screenshots (for maintainers)

Screenshots are **not** included in the repo yet. If you want illustrations in this README, create a folder **`docs/images/`** and add files, then insert Markdown images here.

Suggested captures (filenames are suggestions):

| Suggested filename | What to capture |
|--------------------|-----------------|
| `docs/images/studio-overview.png` | Hum2Song Studio main screen after opening `/ui`. |
| `docs/images/api-docs-swagger.png` | Swagger UI at `/docs` (optional). |
| `docs/images/health-check.png` | JSON from `/api/v1/health` showing `checks` (optional). |

Example snippet to paste **after** files exist:

```markdown
![Hum2Song Studio overview](docs/images/studio-overview.png)
```

---

## More documentation

| Document | Topic |
|----------|--------|
| [docs/BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md) | First run, manual installs, verification |
| [docs/LLM_GATEWAY_QUICKSTART.md](docs/LLM_GATEWAY_QUICKSTART.md) | LLM gateway for Studio |
| [docs/INSTRUMENT_LIBRARY.md](docs/INSTRUMENT_LIBRARY.md) | Optional sampler instruments |
| [docs/STUDIO_E2E_CHECKLIST.md](docs/STUDIO_E2E_CHECKLIST.md) | Studio end-to-end checklist |
