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

## Upload local samples (PR-INS2e/INS2e.2)

You can upload sample files to create new custom instruments or (with baseUrl) use built-in packs.

1. Open **Inspector** → expand **Instrument Library**.
2. Click **Upload samples (creates new instrument)** and choose files named `A1.mp3`, `C4.wav`, etc. (A1..A6 or C3/Ds4/F#2/Bb3).
3. A new instrument is created (name from first file). It appears in **My Instruments** in the track dropdown.
4. The dropdown shows built-in packs and My Instruments. Select one to view status. Use **Clear local samples** to clear built-in pack samples, or **delete** a custom instrument entirely.

**Import Folder (PR-INS2e.2):** Click **Import Folder** and choose any folder. Creates a **new instrument** named from the folder (e.g. `tuba/` → 自定义：tuba). All recognizable sample files (e.g. `A4.mp3`, `C4.wav`) under the folder are imported. Requires ≥2 different note keys for sampler; 1 key creates a oneshot. New instruments appear in **My Instruments** in the track dropdown.

**Upload samples (PR-INS2e.2):** Click **Upload samples** to create a **new instrument** from selected files. Name is derived from the first filename. Same rules: ≥2 keys → sampler, 1 key → oneshot.

**Fallback chain:** local IndexedDB → user baseUrl → default baseUrl → default synth.

---

## My Instruments (PR-INS2e.2)

Import Folder and Upload samples create **custom instruments** that appear in the track dropdown under **My Instruments**. Built-in packs (Piano, Strings, etc.) are no longer overwritten.

**Naming:** Custom instruments use the prefix 自定义： (Chinese: "custom") + base name. If a name exists, a suffix is added: (2), (3), etc.

**To delete:** Open Inspector → Instrument Library, select the instrument from the dropdown (under My Instruments), and click **Clear local samples**. For custom instruments this removes the instrument from the registry and deletes all its samples.

**Sampler vs oneshot:** ≥2 different note keys (e.g. A4, C4) → sampler (pitch-shifted playback). 1 key → oneshot (same sample for all pitches; overlapping notes retrigger).

---

## Partial packs (PR-INS2g.1)

Packs with incomplete sample sets are supported. For example, a violin folder with only `A4.mp3`, `A5.mp3`, and `A6.mp3` will work; the app probes which files exist and builds the sampler from available keys only.

**Behavior:**

- The app probes sample existence (HEAD requests) per key and extension (mp3, ogg, wav).
- Only keys with existing files are used; no repeated 404s for missing samples.
- If **fewer than 2 keys** are available, the pack falls back to the default synth with status: *"Sampler pack incomplete (0/1 sample(s) found)."*
- Instrument Library status shows **Available (local/remote):** keys you have, **Missing:** keys not found.

**Complete packs** (piano, bass) behave unchanged. Export WAV uses the same mapping as playback.

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
