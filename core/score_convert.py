from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

from music21 import chord, converter, instrument, note, stream, tempo, meter  # type: ignore

from core.score_models import NoteEvent, ScoreDoc, Track


def _pick_tempo_and_ts(s: stream.Stream) -> Tuple[float, str]:
    # tempo
    bpm: float = 120.0
    try:
        mm = s.metronomeMarkBoundaries()
        if mm and mm[0] and mm[0][2]:
            maybe = mm[0][2].number
            if maybe:
                bpm = float(maybe)
    except Exception:
        pass

    # time signature
    ts = "4/4"
    try:
        ts_obj = s.recurse().getElementsByClass(meter.TimeSignature).first()
        if ts_obj is not None:
            ts = str(ts_obj.ratioString)
    except Exception:
        pass

    return bpm, ts


def midi_to_score(midi_path: Path) -> ScoreDoc:
    midi_path = Path(midi_path)
    if not midi_path.exists() or not midi_path.is_file():
        raise FileNotFoundError(f"midi_path not found: {midi_path}")

    s = converter.parse(str(midi_path))
    bpm, ts = _pick_tempo_and_ts(s)
    spq = 60.0 / bpm  # seconds per quarter length

    # If it's a Score with parts, use parts; otherwise treat as single-part.
    parts = list(getattr(s, "parts", [])) or [s]

    tracks: list[Track] = []
    for idx, p in enumerate(parts):
        # determine instrument/program if available
        prog: Optional[int] = None
        try:
            inst = p.getInstrument(returnDefault=False)
            if inst is not None and getattr(inst, "midiProgram", None) is not None:
                prog = int(inst.midiProgram)
        except Exception:
            prog = None

        name = getattr(p, "partName", None) or f"Track{idx+1}"
        t = Track(name=name, program=prog, channel=None, notes=[])

        # Collect notes
        for el in p.recurse().notes:
            # start/duration in quarterLength units -> seconds
            try:
                start_sec = float(el.offset) * spq
            except Exception:
                start_sec = 0.0
            try:
                dur_ql = float(el.quarterLength)
            except Exception:
                dur_ql = 1.0
            dur_sec = max(1e-6, dur_ql * spq)

            # velocity (music21 can have None)
            vel = 64
            try:
                v = getattr(getattr(el, "volume", None), "velocity", None)
                if v is not None:
                    vel = int(v)
            except Exception:
                vel = 64

            if isinstance(el, note.Note):
                t.notes.append(
                    NoteEvent(
                        pitch=int(el.pitch.midi),
                        start=start_sec,
                        duration=dur_sec,
                        velocity=vel,
                    )
                )
            elif isinstance(el, chord.Chord):
                # chord -> multiple NoteEvent with same timing
                for pit in el.pitches:
                    t.notes.append(
                        NoteEvent(
                            pitch=int(pit.midi),
                            start=start_sec,
                            duration=dur_sec,
                            velocity=vel,
                        )
                    )

        # Keep deterministic order: sort by (start, pitch)
        t.notes.sort(key=lambda x: (x.start, x.pitch))
        tracks.append(t)

    return ScoreDoc(version=1, tempo_bpm=bpm, time_signature=ts, tracks=tracks)


def score_to_midi(score: ScoreDoc, out_path: Path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    bpm = float(score.tempo_bpm or 120.0)
    spq = 60.0 / bpm

    sc = stream.Score()

    # Global markers (tempo/ts) at the beginning of each part is safest for MIDI writers
    ts_obj = None
    try:
        ts_obj = meter.TimeSignature(score.time_signature)
    except Exception:
        ts_obj = meter.TimeSignature("4/4")

    for tr in score.tracks:
        part = stream.Part()
        part.partName = tr.name

        try:
            part.append(tempo.MetronomeMark(number=bpm))
        except Exception:
            pass
        try:
            part.append(ts_obj)
        except Exception:
            pass

        # instrument
        if tr.program is not None:
            try:
                part.insert(0, instrument.instrumentFromMidiProgram(int(tr.program)))
            except Exception:
                pass

        # Insert notes (offset/duration in quarterLength)
        for ne in tr.notes:
            ql_offset = float(ne.start) / spq
            ql_dur = max(1e-6, float(ne.duration) / spq)

            n = note.Note(int(ne.pitch))
            n.quarterLength = ql_dur
            try:
                n.volume.velocity = int(ne.velocity)
            except Exception:
                pass
            part.insert(ql_offset, n)

        sc.insert(0, part)

    sc.write("midi", fp=str(out_path))
    return out_path.resolve()
