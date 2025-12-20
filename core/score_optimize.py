from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from core.score_models import NoteEvent, ScoreDoc, Track


@dataclass(frozen=True)
class OptimizeConfig:
    """
    Deterministic rule-based optimizer for score.json.
    Times are in seconds, relative to score start.

    grid_div:
      subdivisions per quarter note.
      4 -> 1/16, 2 -> 1/8, 1 -> 1/4, 8 -> 1/32.
    """
    grid_div: int = 4
    min_pitch: int = 48
    max_pitch: int = 84
    velocity_target: int | None = None
    merge_same_pitch_overlaps: bool = True

    # Float tolerance / safety
    eps: float = 1e-9


def _clamp_int(v: int, lo: int, hi: int) -> int:
    return lo if v < lo else hi if v > hi else v


def _quantize_time(t: float, step: float) -> float:
    if step <= 0:
        return max(0.0, float(t))
    k = int(round(float(t) / step))
    return max(0.0, k * step)


def _seconds_per_quarter(tempo_bpm: float) -> float:
    bpm = float(tempo_bpm) if tempo_bpm else 120.0
    if bpm <= 0:
        bpm = 120.0
    return 60.0 / bpm


def _merge_overlaps_same_pitch(notes: list[NoteEvent], eps: float) -> list[NoteEvent]:
    """
    Merge overlapping notes with the same pitch inside a track.
    Assumes notes are already sorted by (pitch, start).
    """
    merged: list[NoteEvent] = []
    for ne in notes:
        if not merged:
            merged.append(ne)
            continue

        last = merged[-1]
        if ne.pitch != last.pitch:
            merged.append(ne)
            continue

        last_end = last.start + last.duration
        ne_end = ne.start + ne.duration

        # overlap or touch
        if ne.start <= last_end + eps:
            new_end = max(last_end, ne_end)
            new_vel = max(last.velocity, ne.velocity)
            merged[-1] = NoteEvent(
                pitch=last.pitch,
                start=last.start,
                duration=max(eps, new_end - last.start),
                velocity=new_vel,
            )
        else:
            merged.append(ne)

    return merged


def _optimize_track(track: Track, *, step_sec: float, cfg: OptimizeConfig) -> Track:
    # 1) quantize + clamp pitch/velocity
    out: list[NoteEvent] = []
    for ne in track.notes:
        pitch = _clamp_int(int(ne.pitch), cfg.min_pitch, cfg.max_pitch)

        start = float(ne.start)
        dur = float(ne.duration)
        end = start + dur

        q_start = _quantize_time(start, step_sec)
        q_end = _quantize_time(end, step_sec)

        if q_end <= q_start + cfg.eps:
            q_end = q_start + step_sec  # ensure positive duration

        q_dur = q_end - q_start

        if cfg.velocity_target is not None:
            vel = _clamp_int(int(cfg.velocity_target), 1, 127)
        else:
            vel = _clamp_int(int(ne.velocity), 1, 127)

        out.append(NoteEvent(pitch=pitch, start=q_start, duration=q_dur, velocity=vel))

    # 2) sort deterministic
    out.sort(key=lambda x: (x.pitch, x.start, x.duration, x.velocity))

    # 3) merge same-pitch overlaps (optional)
    if cfg.merge_same_pitch_overlaps:
        out = _merge_overlaps_same_pitch(out, cfg.eps)

    # 4) final sort for downstream (start, pitch)
    out.sort(key=lambda x: (x.start, x.pitch))

    return Track(name=track.name, program=track.program, channel=track.channel, notes=out)


def optimize_score(score: ScoreDoc, cfg: OptimizeConfig | None = None) -> ScoreDoc:
    """
    Optimize score with deterministic rules.
    """
    cfg = cfg or OptimizeConfig()
    spq = _seconds_per_quarter(float(score.tempo_bpm or 120.0))
    grid_div = int(cfg.grid_div) if int(cfg.grid_div) > 0 else 4
    step_sec = spq / float(grid_div)

    tracks = [
        _optimize_track(t, step_sec=step_sec, cfg=cfg)
        for t in (score.tracks or [])
    ]

    return ScoreDoc(
        version=int(score.version or 1),
        tempo_bpm=float(score.tempo_bpm or 120.0),
        time_signature=str(score.time_signature or "4/4"),
        tracks=tracks,
    )
