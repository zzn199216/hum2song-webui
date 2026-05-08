# Developer notes

## Node.js

You **do not** need Node.js to run the server or Studio. Node is only for frontend checks:

```powershell
node scripts/run_frontend_all_tests.js
```

## Backend tests (optional)

```powershell
pytest -q
```

## Docker

Root [`Dockerfile`](../Dockerfile) installs FFmpeg, FluidSynth, and Python dependencies. You must still provide a **SoundFont** (e.g. mount or copy into `assets/`). The image uses **Python 3.10**; local development recommends **3.11+**. There is no `docker-compose` in this repo.

## LLM Optimize (Studio)

Use an OpenAI-compatible **gateway**; do not put provider API keys in the browser for public deployments. See [LLM_GATEWAY_QUICKSTART.md](LLM_GATEWAY_QUICKSTART.md).

## Studio details

- Optional sampler instruments: [INSTRUMENT_LIBRARY.md](INSTRUMENT_LIBRARY.md)
- E2E checklist: [STUDIO_E2E_CHECKLIST.md](STUDIO_E2E_CHECKLIST.md)
- Tone.js loads from `/static/pianoroll/vendor/tone/Tone.js` by default; CDN only if `window.H2S_ALLOW_CDN_TONE === true`.
- In Full mode, enabling Fix Pitch or Tighten Rhythm may reject velocity-only patches once (quality gate).

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Health shows missing SoundFont / FluidSynth / FFmpeg | [BEGINNER_FIRST_RUN_CHECKLIST.md](BEGINNER_FIRST_RUN_CHECKLIST.md) |
| Export / MIDI route returns 404 | `python scripts/check_export_routes.py`; restart Uvicorn after code changes |
| Dependency warnings (e.g. Python 3.13) | Often harmless for MVP usage |

## Screenshots (maintainers)

Studio screenshots live under `docs/images/` — e.g. `en/studio-overview.png`, `zh/studio-overview.png`. Use **English** UI for `en` and **Chinese** UI for `zh` when the shot includes lots of chrome text; mostly-visual views can be shared.
