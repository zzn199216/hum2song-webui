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

Each pack uses its **natural keys** (scientific pitch note names). Supported filename patterns (PR-INS2g):

- **Legacy:** `A1.mp3`, `A2.wav`, … `A6` (piano)
- **Scientific pitch:** `C3.mp3`, `Ds4.wav` (s = sharp), `F#2.mp3`, `Bb3.mp3` (b = flat)

Example layout:

```
static/pianoroll/vendor/tonejs-instruments/samples/
├── piano/          → A1..A6
├── violin/         → C4, E4, G3, G4, A3, A4  (Strings pack)
├── bass-electric/  → E1, G1, Cs2, E2, G2, Cs3  (Bass pack)
├── guitar-acoustic/→ C3, D3, E3, G3, A3, C4
└── guitar-electric/→ C3, D3, E3, G3, A3, C4
```

Packs use upstream sample filenames (e.g. Ds4, Cs2); no renaming needed.

Samples are resolved relative to the site root. Example: with server at `http://127.0.0.1:8000`, the piano `A1` sample is fetched from:

```
http://127.0.0.1:8000/static/pianoroll/vendor/tonejs-instruments/samples/piano/A1.mp3
```

---

## Supported sampler packs (PR-INS2d/INS2g)

| packId | Dropdown label | requiredKeys (minimal) |
|--------|----------------|------------------------|
| `tonejs:piano` | Sampler: Piano | A1..A6 |
| `tonejs:strings` | Sampler: Strings | C4, E4, G3, G4, A3, A4 |
| `tonejs:bass` | Sampler: Bass | E1, G1, C#2, E2, G2, C#3 |
| `tonejs:guitar-acoustic` | Sampler: Guitar Acoustic | C3, D3, E3, G3, A3, C4 |
| `tonejs:guitar-electric` | Sampler: Guitar Electric | C3, D3, E3, G3, A3, C4 |

Each pack defines `requiredKeys` and `urls` (Tone note key → filename). Use upstream filenames (e.g. `Ds4.mp3` for D#, `Cs2.mp3` for C#).

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

**Import Folder (PR-INS2f):** Click **Import Folder** and choose a folder with instrument subfolders (`piano/`, `violin/`, `bass-electric/`, `guitar-acoustic/`, `guitar-electric/`). Use scientific pitch filenames (e.g. `piano/A1.mp3`, `guitar-acoustic/Ds4.mp3`). The app auto-detects the pack from the subfolder name and imports into IndexedDB.

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

- Ensure the instrument folder exists (e.g. `samples/piano/`, `samples/guitar-acoustic/`).
- Ensure the required sample files for that pack are present (see table above; e.g. piano needs A1..A6, guitar needs C3, D3, E3, G3, A3, C4).
- The Strings pack uses `violin/`; Bass uses `bass-electric/` (per tonejs-instruments layout).
- Check the browser Network tab for 404 responses to sample URLs.
- Verify the dev server is serving files from the `static/` directory.

---

## License

- **tonejs-instruments code:** MIT License  
- **tonejs-instruments samples:** CC BY 3.0  
  (Attribution required when distributing or using the samples.)

See the [tonejs-instruments](https://github.com/nbrosz/tonejs-instruments) repository for details.
