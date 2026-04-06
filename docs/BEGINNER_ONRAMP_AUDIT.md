# Hum2Song Beginner Onramp Audit

## 1. Current run path

- **Shape:** Single **FastAPI** application (`app.py`) started with **Uvicorn**; the **Hum2Song Studio** UI and static assets are served from the same process (no separate frontend dev server required for normal use).
- **Documented startup (root `README.md` / `README_CHS.md`):**
  1. Install **Python 3.11+** (README environment section).
  2. Create and activate a **venv**, then `pip install -r requirements.txt` (from repository root).
  3. Run **`uvicorn app:app`** from the **project root** (README explicitly notes this is required for correct imports).
  4. Open **Swagger** at `http://127.0.0.1:8000/docs` and **Studio** at `http://127.0.0.1:8000/ui`.
- **Runtime wiring:** `app.py` mounts `static/` at `/static`, serves Studio from `static/pianoroll/index.html` at `/ui`, and includes routers under `routers/` (e.g. generation, health). Configuration is loaded via `core/config.py` from environment variables and an optional root `.env` (see `.env.example`).
- **Manual environment setup:** **Yes.** Beyond Python/pip, the README already states **FFmpeg** and **FluidSynth** must be on **PATH** (Windows-oriented docs). **Additionally**, audio synthesis requires a **SoundFont** file: default path is `assets/piano.sf2` per `core/config.py`, but **`assets/` is largely gitignored** and `assets/README.txt` instructs users to **download and rename** a `.sf2` manually—this step is **not** in the README Quick Start, so a beginner can complete pip/uvicorn and still fail at generation time.
- **Optional / secondary:** **Node.js** is used for frontend test runners (`scripts/run_frontend_all_tests.js` and related scripts per README)—**not** required to run the server or open Studio. **LLM Optimize** is optional and documented separately (`docs/LLM_GATEWAY_QUICKSTART.md`). **Sampler instruments** need extra sample assets (`docs/INSTRUMENT_LIBRARY.md`)—optional for basic Studio use.
- **Docker:** A root **`Dockerfile`** exists (installs `ffmpeg`, `fluidsynth`, etc., then `pip install` and `uvicorn`). There is **no `docker-compose` file** in-repo, and the **README Quick Start does not use Docker**—local install is the primary documented path. Note: Dockerfile uses **Python 3.10** while README asks for **3.11+** (minor inconsistency for anyone comparing both paths).
- **Diagnostics:** `GET /api/v1/health` (`routers/health.py`) reports `soundfont_exists`, `fluidsynth`, and `ffmpeg` checks—useful for a beginner to see what is missing after the server starts.

## 2. Main beginner-friction points

**Must-fix class (blockers for “it actually works” end-to-end):**

- **Hidden SoundFont step:** Core pipeline synthesis (`core/synthesizer.py`) fails without a valid `.sf2`; README Quick Start does not mention `assets/README.txt` or copying `piano.sf2`.
- **External binaries:** FluidSynth and FFmpeg must be installed and discoverable; errors may appear only when exporting or synthesizing, not at `uvicorn` startup.
- **Technical baseline:** Creating a venv, using a shell, and running `pip` / `uvicorn` already assumes comfort with a terminal—high friction for non-technical users.
- **Heavy Python install:** `requirements.txt` includes **Demucs** (pulls **PyTorch**-class dependencies). First-time `pip install` can be long, large on disk, and intimidating—often unnecessary if the user only wants the default Studio/API path without stem separation.

**Nice-to-have / secondary friction:**

- README examples are **PowerShell-first**; macOS/Linux users must translate paths and activation.
- **Optional** LLM setup (`docs/LLM_GATEWAY_QUICKSTART.md`) adds cognitive load but is not required to open `/ui`.
- Frontend **tests** require Node; contributors may confuse “run the app” with “run tests.”

## 3. Realistic onboarding options

### Option A: First-run checklist + README / quickstart alignment

- **What it is:** A short, ordered “before you generate audio” checklist (Python → venv → pip → FFmpeg → FluidSynth → **SoundFont → `assets/piano.sf2`**) and a single pointer to **`GET /api/v1/health`** to verify `checks`. Optionally a dedicated `docs/` quickstart page linked from the README landing section.
- **Why it is attractive:** Matches the **current** architecture (no new runtime behavior); fixes the **largest documentation gap** (SoundFont) with minimal scope; reuses existing health diagnostics.
- **Why it is risky / costly:** Easy to let the doc grow; must stay disciplined so it does not duplicate every README section.
- **Estimated implementation scope:** **Small**

### Option B: One-command local bootstrap script (e.g. PowerShell + optional POSIX shell)

- **What it is:** A script that creates/activates venv, runs `pip install -r requirements.txt`, and prints or runs a **preflight** summary (e.g. suggest opening `/api/v1/health` or wrapping `curl`).
- **Why it is attractive:** Reduces copy-paste errors and gives beginners a **single obvious** entry command after clone.
- **Why it is risky / costly:** Must be maintained for OS differences; can give a false sense of “done” if SoundFont and binaries are still missing; scripting policy varies by contributor comfort.
- **Estimated implementation scope:** **Small to medium**

### Option C: Document / polish the existing Docker path (optional later track)

- **What it is:** Treat the existing **`Dockerfile`** as an **optional** path: document `docker build` / `docker run`, volume-mount for `assets/` (SoundFont), and port mapping. Could add `docker-compose.yml` **later** for one-liner ergonomics.
- **Why it is attractive:** Bundles **ffmpeg** and **fluidsynth** in the image (reduces host install pain); familiar to some open-source users.
- **Why it is risky / costly:** SoundFont still not bundled by license/repo policy; README vs Dockerfile **Python version** mismatch should be resolved; image size and build time remain high; still not a true “one-click” desktop app.
- **Estimated implementation scope:** **Medium** (documentation-first); **larger** if adding compose and tested volume conventions.

## 4. Recommended first step

**Recommend Option A first:** align the **README (and optionally one short `docs/` quickstart)** with a **minimal first-run checklist** that includes the **SoundFont** step and points to **`/api/v1/health`** for verification.

**Why first:** The repo already exposes everything needed to **self-diagnose** (health endpoint) and the **dominant failure mode** for someone who followed the README is **missing `assets/piano.sf2` and/or binaries**—not missing Uvicorn instructions. Fixing visibility there has the best **ROI** without packaging, installers, or architectural bets. Option B can follow naturally once the canonical steps are clear. Option C remains a reasonable **deferred** track for users who prefer containers, after docs are honest about SoundFont and volumes.

## 5. What should NOT be done first

- **Jumping to a full installer, MSIX/AppImage, or Electron wrapper** before the documented path matches reality (especially SoundFont + binary prerequisites).
- **A broad packaging or “rewrite the stack” effort** (e.g. mandatory Docker-first) without first reducing **documentation and discoverability** friction.
- **Splitting or slimming `requirements.txt` (e.g. optional Demucs)** as part of “onboarding”**—**that is valuable but blurs into **product/pipeline** decisions; treat as a separate initiative unless scoped narrowly.
- **Mixing onboarding work with unrelated product features** (new Studio capabilities, scoring changes, etc.).

## 6. Success criteria for the recommended step

- A new visitor can find **in one place** the full ordered steps: clone → Python/venv → `pip install` → **`assets/piano.sf2` (with pointer to `assets/README.txt`)** → FFmpeg + FluidSynth on PATH → `uvicorn app:app` → open `/ui`.
- After starting the server, the user is told to open **`/api/v1/health`** (or linked from README) and can interpret **`checks.soundfont_exists`**, **`checks.fluidsynth`**, and **`checks.ffmpeg`**.
- It is explicit that **Node** is for **tests**, not for running Studio in the browser.
- The doc stays **short**; heavy or optional topics (LLM gateway, instrument samples, Demucs/stem separation) are linked, not inlined in the first-run path.

## 7. Open questions

- **SoundFont redistribution:** Can a specific free SoundFont be linked or documented as the default download, without license issues, to remove ambiguity?
- **Target audience OS:** Is Windows still the primary audience for written instructions, or should macOS/Linux parity be first-class in the same quickstart?
- **`requirements.txt` weight:** Should optional stem/Demucs dependencies move to an extras file in a **future** change (outside this doc-only onboarding step)?
