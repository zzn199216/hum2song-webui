from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

# 【修改点1】引入 midi 模块，用于底层控制
from music21 import chord, converter, instrument, note, stream, tempo, meter, midi  # type: ignore

from core.score_models import NoteEvent, ScoreDoc, Track


def _pick_tempo_and_ts(s: stream.Stream) -> Tuple[float, str]:
    """从 Stream 中提取 BPM 和拍号"""
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
    """
    读取 MIDI 并转换为 ScoreDoc。
    【核心修复】强制关闭 music21 的自动量化 (quantizePost=False)，
    从而保留毫秒级的原始节奏（如 0.833s vs 0.875s），避免音符粘连。
    """
    midi_path = Path(midi_path)
    if not midi_path.exists() or not midi_path.is_file():
        raise FileNotFoundError(f"midi_path not found: {midi_path}")

    # --- 【修改点2】使用底层读取方式，禁用量化 ---
    try:
        mf = midi.MidiFile()
        mf.open(str(midi_path))
        mf.read()
        mf.close()
        
        # quantizePost=False 是关键，它告诉 music21 不要把音符吸附到网格上
        s = midi.translate.midiFileToStream(mf, quantizePost=False)
    except Exception as e:
        # 如果底层读取失败，尝试回退到标准读取（虽然可能有量化问题，但总比崩溃好）
        print(f"Warning: Low-level MIDI read failed, falling back to converter.parse: {e}")
        s = converter.parse(str(midi_path))
    # -------------------------------------------

    bpm, ts = _pick_tempo_and_ts(s)
    spq = 60.0 / bpm if bpm > 0 else 0.5  # seconds per quarter length

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
        # 使用 flat 获取扁平化流，确保获取所有音符
        for el in p.flat.notes:
            # start/duration in quarterLength units -> seconds
            try:
                # offset 在 quantizePost=False 模式下会是精确的浮点数
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


def score_to_midi(score: ScoreDoc, out_path: Path | str) -> Path:
    """
    将 ScoreDoc 导出为 MIDI 文件
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    bpm = float(score.tempo_bpm or 120.0)
    spq = 60.0 / bpm if bpm > 0 else 0.5

    sc = stream.Score()

    # Global markers (tempo/ts)
    # Note: adding them to the first part or global stream
    
    for tr in score.tracks:
        part = stream.Part()
        part.partName = tr.name

        # Add Tempo & TimeSignature to each part to be safe
        try:
            part.append(tempo.MetronomeMark(number=bpm))
        except Exception:
            pass
        try:
            if score.time_signature:
                part.append(meter.TimeSignature(score.time_signature))
        except Exception:
            pass

        # instrument
        if tr.program is not None:
            try:
                part.insert(0, instrument.instrumentFromMidiProgram(int(tr.program)))
            except Exception:
                pass

        # Insert notes
        for ne in tr.notes:
            # seconds -> quarterLength
            ql_offset = float(ne.start) / spq
            ql_dur = max(1e-6, float(ne.duration) / spq)

            n = note.Note(ne.pitch)
            n.quarterLength = ql_dur
            
            # 恢复 velocity
            if ne.velocity is not None:
                n.volume.velocity = int(ne.velocity)

            # 插入到指定位置
            part.insert(ql_offset, n)

        sc.append(part)

    try:
        sc.write("midi", fp=str(out_path))
    except Exception as e:
        raise IOError(f"Failed to write MIDI file to {out_path}: {e}")

    return out_path