# Instrument Library (Sampler Setup)

How to enable sampler instruments in the browser by installing sample assets locally.

---

## Overview

Hum2Song Studio supports sampler instruments (e.g. **Sampler: Piano**) in addition to built-in Tone.js synths. Sampler instruments use pre-recorded audio samples and are selected from the track instrument dropdown. Sample assets are **not bundled** in the repo; you must install them locally to use samplers.

---

## Where to place samples

Place sample files under:

```
/static/pianoroll/vendor/tonejs-instruments/samples/<instrument>/
```

Each pack expects a minimal set of samples (A1.mp3 … A6.mp3) for repitching. Example layout:

```
static/pianoroll/vendor/tonejs-instruments/samples/
├── piano/
│   ├── A1.mp3  … A6.mp3
├── strings/
│   ├── A1.mp3  … A6.mp3
├── bass/
│   ├── A1.mp3  … A6.mp3
├── guitar-acoustic/
│   ├── A1.mp3  … A6.mp3
└── guitar-electric/
    ├── A1.mp3  … A6.mp3
```

Samples are resolved relative to the site root. Example: with server at `http://127.0.0.1:8000`, the piano `A1` sample is fetched from:

```
http://127.0.0.1:8000/static/pianoroll/vendor/tonejs-instruments/samples/piano/A1.mp3
```

---

## Supported sampler packs (PR-INS2d)

| packId | Dropdown label | instrumentSubdir |
|--------|----------------|------------------|
| `tonejs:piano` | Sampler: Piano | `piano/` |
| `tonejs:strings` | Sampler: Strings | `strings/` |
| `tonejs:bass` | Sampler: Bass | `bass/` |
| `tonejs:guitar-acoustic` | Sampler: Guitar Acoustic | `guitar-acoustic/` |
| `tonejs:guitar-electric` | Sampler: Guitar Electric | `guitar-electric/` |

Each pack uses `baseUrlDefault` (or user baseUrl + subdir) and a minimal `urls` set (A1…A6, .mp3). `Tone.Sampler` repitches these samples across the MIDI range.

---

## Configurable baseUrl (PR-INS2c)

You can set a custom root path so samples are loaded from anywhere (local folder, CDN, etc.):

1. Open **Inspector** → expand **Instrument Library**.
2. Enter the base URL (e.g. `https://cdn.example.com/samples` or `/my-samples`) in **Sampler baseUrl**.
3. Click **Save**. The app appends the instrument subdirectory (e.g. `piano/`) to your URL.
4. Use **Test Load** to verify the piano pack is reachable.

**Storage:** One `localStorage` key: `hum2song_studio_sampler_baseurl`. Leave the field blank and Save to clear (revert to default path).

---

## Upload local samples (PR-INS2e)

You can upload sample files (A1..A6) directly in the UI. They are stored in IndexedDB and override baseUrl for playback and Export WAV.

1. Open **Inspector** → expand **Instrument Library**.
2. Select a pack from the "Upload local samples" dropdown (e.g. Piano).
3. Click **Upload samples** and choose files named `A1.mp3`, `A2.wav`, etc. (case-insensitive; only A1–A6 accepted).
4. Status shows recognized keys and any missing keys.
5. Use **Clear local samples** to remove uploaded samples for the selected pack and revert to baseUrl/default.

**Fallback chain:** local IndexedDB → user baseUrl → default baseUrl → default synth.

---

## Troubleshooting

**Symptom:** You select "Sampler: Piano" but hear the default synth instead.

**Cause:** Samples are missing (404) or load timeout (~4 seconds).

**Behavior:**

1. The app first checks IndexedDB for uploaded samples; then baseUrl (or default path).
2. If fetch fails or takes too long:
   - A message appears: *"Sampler pack missing. See docs to install samples. Using default synth."*
   - Playback and Export WAV fall back to the default synth.
3. No infinite hang: a timeout ensures export and playback proceed.

**Fixes:**

- Ensure the instrument folder exists (e.g. `samples/piano/`, `samples/strings/`) under `static/pianoroll/vendor/tonejs-instruments/`.
- Ensure the required `.mp3` files (A1–A6) are present for that pack.
- Check the browser Network tab for 404 responses to sample URLs.
- Verify the dev server is serving files from the `static/` directory.

---

## License

- **tonejs-instruments code:** MIT License  
- **tonejs-instruments samples:** CC BY 3.0  
  (Attribution required when distributing or using the samples.)

See the [tonejs-instruments](https://github.com/nbrosz/tonejs-instruments) repository for details.
