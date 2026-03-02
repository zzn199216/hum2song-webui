# Export MIDI MVP — Feasibility Report

> Read-only investigation. No code was modified.

---

## A) Existing MIDI libs / utilities

| Layer | Location | What |
|-------|----------|------|
| **Backend (Python)** | `core/score_convert.py` | `midi_to_score()`, `score_to_midi()` — uses `mido` (read) and `music21` (write) |
| **Backend API** | `routers/score.py` | PUT score → `score_to_midi()` → writes `.mid`, returns download URL |
| **CLI** | `hum2song/score.py` | `midi2json`, `json2midi` |
| **Frontend** | — | None. Tone.js used for synthesis; "MIDI" only in comments (pitch 0–127, velocity 1–127) |

**JS libraries (npm):** `midi-writer-js`, `JZZ-midi-SMF`, `TinySMF` (lightweight). No MIDI writer currently in the frontend.

---

## B) ScoreBeat note schema and where to get it

### Canonical location

- **Storage:** `project.clips[clipId].score` (ScoreBeatV2)
- **Spec:** `docs/PROJECTDOC_V2_BEATS_SPEC.md` §3.2

### Schema

```js
ScoreBeatV2 = {
  version: 2,
  tempo_bpm: number|null,
  time_signature: string|null,
  tracks: [{
    id: string,
    name: string,
    notes: NoteBeat[]
  }]
}

NoteBeat = {
  id: string,
  pitch: int 0..127,
  velocity: int 1..127,
  startBeat: number >=0,
  durationBeat: number >0
}
```

### Flatten output (already seconds-based)

- **Source:** `H2SProject.flatten(projectV2)` in `static/pianoroll/project.js` (~line 934)
- **Output:**
  ```js
  { bpm, tracks: [{ trackId, notes: [{ startSec, durationSec, pitch, velocity, clipId, instanceId, noteId }] }] }
  ```
- **Order:** Tracks follow `project.tracks` order; notes sorted by `(startSec, pitch, noteId)`.

### Backend ScoreDoc (for backend path)

- **Schema:** `core/score_models.py`
- **NoteEvent:** `pitch`, `start` (sec), `duration` (sec), `velocity`
- **Track:** `id`, `name`, `program`, `channel`, `notes[]`
- **ScoreDoc:** `version`, `tempo_bpm`, `time_signature`, `tracks[]`
- **Difference:** ScoreBeatV2 uses beats; ScoreDoc uses seconds. `project.bpm` is used for beat↔sec.

---

## C) Recommended minimal implementation approach

### Option A — Frontend JS MIDI writer (recommended for MVP)

- **Library:** `midi-writer-js` or `TinySMF` (small, browser-friendly)
- **Input:** `H2SProject.flatten(p2)` — already in sec per track
- **Logic:**
  1. Convert `startSec`/`durationSec` → SMF ticks via `bpm` (e.g. 480 ppq)
  2. For each flatten track, add notes to a MIDI track
  3. Set global tempo from `project.bpm`
- **Output:** SMF bytes → `Blob` → `downloadText`-style download (e.g. `downloadBlob('project.mid', blob)`)

### Option B — Backend endpoint

- **Endpoint:** New route (e.g. `POST /api/export-midi`) accepts flattened JSON
- **Logic:** Map flatten → `ScoreDoc` (sec already present), call `score_to_midi()`, return binary or signed URL
- **Pros:** Reuses existing Python writer; fewer frontend changes
- **Cons:** Network round-trip; need flatten→ScoreDoc mapping and track names

### UI placement

- **Section:** Inspector → Actions
- **Placement:** Next to `btnExportProject` and `btnExportFlatten`

### Files to change (Option A)

| File | Change |
|------|--------|
| `static/pianoroll/index.html` | Add `<script>` for MIDI writer lib (or bundle it) |
| New: `static/pianoroll/controllers/export_midi_controller.js` | Same pattern as `export_flatten_controller.js`: inject button, wire to export function |
| Possibly `package.json` | Add dep for `midi-writer-js` or `TinySMF` if bundling |

### Files to change (Option B)

| File | Change |
|------|--------|
| `app.py` or `routers/` | New route for export-midi |
| `core/score_convert.py` | Possibly a `flatten_to_score_doc()` helper |
| `static/pianoroll/controllers/export_midi_controller.js` | Button + POST to endpoint + download response |

---

## D) Risks / edge cases

| Risk | Notes |
|------|-------|
| **Multiple project tracks** | Flatten already groups by `trackId`; each project track → one MIDI track |
| **Multiple clips / instances** | Flatten merges notes from all instances into track buckets; startSec is absolute on timeline |
| **Clip-internal multi-track** | MVP: all clip score tracks for an instance map to single `project.trackId`; no per-clip-track MIDI channels yet |
| **Schema mismatch** | ScoreBeatV2: `startBeat`/`durationBeat`. ScoreDoc: `start`/`duration` in sec. Conversion uses `project.bpm` |
| **Empty project** | Handle no clips, no instances, or empty flatten gracefully |
| **BPM source** | Always use `project.bpm` from `H2SProject.getProjectBpm(project)` — single source of truth per spec |
| **Time signature** | ScoreBeatV2 has `time_signature`; ScoreDoc has it. Default `"4/4"` if missing |

---

## Summary

- **Best minimal place:** Use `H2SProject.flatten(p2)` as input; BPM from `project.bpm`.
- **Option A (frontend):** Small JS MIDI writer + new controller patterned after `export_flatten_controller.js` — minimal, no server changes.
- **Option B (backend):** Thin endpoint + flatten→ScoreDoc mapping — reuses `score_to_midi`.
- **MVP scope:** Export full arrangement (all instances) as multi-track MIDI, one project track = one MIDI track.
