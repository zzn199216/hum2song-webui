from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

from core.score_models import NoteEvent, ScoreDoc, Track


def _default_tempo_ts() -> Tuple[float, str]:
    return 120.0, "4/4"


def midi_to_score(midi_path: Path) -> ScoreDoc:
    """
    MIDI -> ScoreDoc (seconds-based), aiming to be timing-lossless.
    Prefer mido parsing (tick-accurate). Fall back to music21 only if mido unavailable.
    """
    midi_path = Path(midi_path)
    if not midi_path.exists() or not midi_path.is_file():
        raise FileNotFoundError(f"midi_path not found: {midi_path}")

    # ---------- Preferred: mido (lossless tick timing) ----------
    try:
        import mido  # type: ignore
    except Exception:
        mido = None  # type: ignore

    if mido is not None:
        mid = mido.MidiFile(str(midi_path))
        ppq = int(getattr(mid, "ticks_per_beat", 480) or 480)

        # Collect global tempo + time signature from meta messages (with absolute tick)
        tempo_map: List[Tuple[int, int]] = [(0, 500000)]  # (abs_tick, us_per_qn)
        ts: str = "4/4"

        for tr in mid.tracks:
            abs_tick = 0
            for msg in tr:
                abs_tick += int(msg.time)
                if msg.type == "set_tempo":
                    tempo_map.append((abs_tick, int(msg.tempo)))
                elif msg.type == "time_signature" and ts == "4/4":
                    ts = f"{int(msg.numerator)}/{int(msg.denominator)}"

        tempo_map = sorted(set(tempo_map), key=lambda x: x[0])
        base_us = tempo_map[0][1] if tempo_map else 500000
        bpm = float(60_000_000.0 / float(base_us)) if base_us > 0 else 120.0

        def tick_to_seconds(tick: int) -> float:
            """Convert absolute tick -> seconds using tempo map."""
            if tick <= 0:
                return 0.0
            sec = 0.0
            last_tick = 0
            cur_tempo = tempo_map[0][1] if tempo_map else 500000
            for (t, tempo_us) in tempo_map[1:]:
                if tick < t:
                    break
                sec += mido.tick2second(t - last_tick, ppq, cur_tempo)
                last_tick = t
                cur_tempo = tempo_us
            sec += mido.tick2second(tick - last_tick, ppq, cur_tempo)
            return float(sec)

        # Parse notes per channel (track is mostly irrelevant for humming)
        programs: Dict[int, int] = {}  # channel -> program
        notes_by_channel: Dict[int, List[Tuple[float, int, float, int, int]]] = {}
        # store as (start_sec, seq, duration_sec, pitch, velocity)
        seq_counter = 0

        for tr in mid.tracks:
            abs_tick = 0
            active: Dict[Tuple[int, int], Tuple[int, int, int]] = {}  # (ch,pitch)->(start_tick, vel, seq)
            for msg in tr:
                abs_tick += int(msg.time)

                if msg.type == "program_change":
                    programs[int(msg.channel)] = int(msg.program)

                if msg.type == "note_on" and int(msg.velocity) > 0:
                    ch = int(msg.channel)
                    pitch = int(msg.note)
                    vel = int(msg.velocity)
                    active[(ch, pitch)] = (abs_tick, vel, seq_counter)
                    seq_counter += 1
                elif msg.type in ("note_off", "note_on") and (msg.type == "note_off" or int(msg.velocity) == 0):
                    ch = int(getattr(msg, "channel", 0))
                    pitch = int(getattr(msg, "note", 0))
                    key = (ch, pitch)
                    if key in active:
                        st_tick, vel, seq = active.pop(key)
                        end_tick = abs_tick
                        if end_tick <= st_tick:
                            continue
                        st_sec = tick_to_seconds(st_tick)
                        end_sec = tick_to_seconds(end_tick)
                        dur_sec = max(1e-6, float(end_sec - st_sec))
                        notes_by_channel.setdefault(ch, []).append((float(st_sec), int(seq), dur_sec, pitch, vel))

        # If no notes found, return empty score
        if not notes_by_channel:
            bpm0, ts0 = _default_tempo_ts()
            return ScoreDoc(version=1, tempo_bpm=bpm0, time_signature=ts0, tracks=[])

        # Normalize start: earliest note starts at 0
        min_start = min(n[0] for ns in notes_by_channel.values() for n in ns)
        if min_start < 0:
            min_start = 0.0

        tracks: List[Track] = []
        for ch in sorted(notes_by_channel.keys()):
            raw = notes_by_channel[ch]
            # stable sort by (start, seq) so ties keep original order
            raw.sort(key=lambda x: (x[0], x[1]))

            t = Track(
                name=f"ch{ch}",
                program=programs.get(ch),
                channel=ch,
                notes=[],
            )
            for (st_sec, _seq, dur_sec, pitch, vel) in raw:
                t.notes.append(
                    NoteEvent(
                        pitch=int(pitch),
                        start=max(0.0, float(st_sec - min_start)),
                        duration=float(dur_sec),
                        velocity=max(1, min(127, int(vel) if vel else 64)),
                    )
                )
            tracks.append(t)

        return ScoreDoc(version=1, tempo_bpm=float(bpm), time_signature=str(ts), tracks=tracks)

    # ---------- Fallback: music21 (best-effort; may quantize) ----------
    # Keep this only as a last resort when mido isn't available.
    from music21 import chord, converter, instrument, note, stream, tempo, meter  # type: ignore

    s = converter.parse(str(midi_path))
    bpm, ts = _default_tempo_ts()
    try:
        mm = s.metronomeMarkBoundaries()
        if mm and mm[0] and mm[0][2] and mm[0][2].number:
            bpm = float(mm[0][2].number)
    except Exception:
        pass
    try:
        ts_obj = s.recurse().getElementsByClass(meter.TimeSignature).first()
        if ts_obj is not None:
            ts = str(ts_obj.ratioString)
    except Exception:
        pass

    spq = 60.0 / float(bpm if bpm > 0 else 120.0)

    parts = list(getattr(s, "parts", [])) or [s]
    tracks: List[Track] = []
    for idx, p in enumerate(parts):
        prog: Optional[int] = None
        try:
            inst = p.getInstrument(returnDefault=False)
            if inst is not None and getattr(inst, "midiProgram", None) is not None:
                prog = int(inst.midiProgram)
        except Exception:
            prog = None

        name = str(getattr(p, "partName", None) or f"Track{idx+1}")
        t = Track(name=name, program=prog, channel=None, notes=[])

        for el in p.recurse().notes:
            start_sec = float(getattr(el, "offset", 0.0)) * spq
            dur_ql = float(getattr(el, "quarterLength", 1.0))
            dur_sec = max(1e-6, dur_ql * spq)

            vel = 64
            try:
                v = getattr(getattr(el, "volume", None), "velocity", None)
                if v is not None:
                    vel = int(v)
            except Exception:
                vel = 64

            if isinstance(el, note.Note):
                t.notes.append(NoteEvent(pitch=int(el.pitch.midi), start=start_sec, duration=dur_sec, velocity=vel))
            elif isinstance(el, chord.Chord):
                for pit in el.pitches:
                    t.notes.append(NoteEvent(pitch=int(pit.midi), start=start_sec, duration=dur_sec, velocity=vel))

        t.notes.sort(key=lambda x: (x.start, x.pitch))
        tracks.append(t)

    return ScoreDoc(version=1, tempo_bpm=float(bpm), time_signature=str(ts), tracks=tracks)


def score_to_midi(score: ScoreDoc, out_path: Path) -> Path:
    """
    Keep existing behavior (music21 writer).
    If later you want fully deterministic tick writing, we can switch this to mido too.
    """
    from music21 import instrument, note, stream, tempo, meter  # type: ignore

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    bpm = float(score.tempo_bpm or 120.0)
    spq = 60.0 / bpm if bpm > 0 else 0.5

    sc = stream.Score()
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

        if tr.program is not None:
            try:
                part.insert(0, instrument.instrumentFromMidiProgram(int(tr.program)))
            except Exception:
                pass

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
