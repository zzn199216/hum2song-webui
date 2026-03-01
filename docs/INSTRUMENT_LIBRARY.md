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

For the bundled Piano pack:

```
static/pianoroll/vendor/tonejs-instruments/samples/piano/
├── A1.mp3
├── A2.mp3
├── A3.mp3
├── A4.mp3
├── A5.mp3
├── A6.mp3
```

Samples are resolved relative to the site root. Example: with server at `http://127.0.0.1:8000`, the piano `A1` sample is fetched from:

```
http://127.0.0.1:8000/static/pianoroll/vendor/tonejs-instruments/samples/piano/A1.mp3
```

---

## How the app references baseUrl

The app uses a pack registry that defines `baseUrlDefault` per instrument. For the Piano pack:

| Field       | Value                                                                 |
|------------|-----------------------------------------------------------------------|
| packId     | `tonejs:piano`                                                        |
| baseUrlDefault | `/static/pianoroll/vendor/tonejs-instruments/samples/piano/`      |
| urls       | `{ A1: 'A1.mp3', A2: 'A2.mp3', ... }`                                 |

`Tone.Sampler` uses `baseUrl` + each `url` key to fetch samples. Repitching is automatic: a few sample notes cover the full MIDI range.

---

## Configurable baseUrl (PR-INS2c)

You can set a custom root path so samples are loaded from anywhere (local folder, CDN, etc.):

1. Open **Inspector** → expand **Instrument Library**.
2. Enter the base URL (e.g. `https://cdn.example.com/samples` or `/my-samples`) in **Sampler baseUrl**.
3. Click **Save**. The app appends the instrument subdirectory (e.g. `piano/`) to your URL.
4. Use **Test Load** to verify the piano pack is reachable.

**Storage:** One `localStorage` key: `hum2song_studio_sampler_baseurl`. Leave the field blank and Save to clear (revert to default path).

---

## Troubleshooting

**Symptom:** You select "Sampler: Piano" but hear the default synth instead.

**Cause:** Samples are missing (404) or load timeout (~4 seconds).

**Behavior:**

1. The app tries to fetch samples from the configured `baseUrl`.
2. If fetch fails or takes too long:
   - A message appears: *"Sampler pack missing. See docs to install samples. Using default synth."*
   - Playback and Export WAV fall back to the default synth.
3. No infinite hang: a timeout ensures export and playback proceed.

**Fixes:**

- Ensure the `samples/piano/` directory exists under `static/pianoroll/vendor/tonejs-instruments/`.
- Ensure the required `.mp3` files (A1, A2, A3, A4, A5, A6) are present.
- Check the browser Network tab for 404 responses to sample URLs.
- Verify the dev server is serving files from the `static/` directory.

---

## License

- **tonejs-instruments code:** MIT License  
- **tonejs-instruments samples:** CC BY 3.0  
  (Attribution required when distributing or using the samples.)

See the [tonejs-instruments](https://github.com/nbrosz/tonejs-instruments) repository for details.
