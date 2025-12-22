"""
core.score_optimize

ScoreDoc 的“轻量优化器”，用于把从 MIDI/哼唱解析出来的音符做一些
**可控、可回退** 的清洗，方便 MVP 阶段用 MuseScore/后端渲染快速验证。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal, Optional
import math

from core.score_models import NoteEvent, ScoreDoc, Track

QuantizeMode = Literal["nearest", "ceil", "floor"]


@dataclass(frozen=True)
class OptimizeConfig:
    """
    优化配置
    【默认：safe】不做量化/裁剪/合并/单音化/过滤，只保证输出排序稳定。
    如需“强清洗”，请在 CLI 里选择 preset=strong（或显式打开相关开关）。
    """

    # --- 1. 网格量化 (默认关闭，以免破坏节奏) ---
    grid_div: Optional[int] = None  # None/0 => no quantize
    quantize_mode: QuantizeMode = "nearest"

    # --- 2. 杂音过滤 (默认关闭) ---
    # 小于该阈值的音符会被视为噪声并删除；默认 0 表示关闭
    noise_min_duration: float = 0.0
    # 低于该力度的音符会被视为噪声并删除；默认 0 表示关闭
    noise_min_velocity: int = 0

    # --- 3. 音高限制 (默认关闭) ---
    min_pitch: Optional[int] = None
    max_pitch: Optional[int] = None

    # --- 4. 力度统一 (默认不改) ---
    velocity_target: Optional[int] = None

    # --- 5. 合并同音 (默认关闭；会改变音符边界) ---
    merge_same_pitch_overlaps: bool = False
    merge_gap_tolerance: float = 0.05  # seconds

    # --- 6. 单音化 (默认关闭；会删/改重叠音) ---
    make_monophonic: bool = False


def _clamp_int(x: int, lo: int, hi: int) -> int:
    return max(lo, min(x, hi))


def _quantize_time(
    t: float, step: float, mode: QuantizeMode = "nearest"
) -> float:
    if step <= 1e-9:
        return t
    if mode == "nearest":
        return round(t / step) * step
    elif mode == "floor":
        return math.floor(t / step) * step
    elif mode == "ceil":
        return math.ceil(t / step) * step
    return t


def _merge_same_pitch_overlaps(
    notes: List[NoteEvent], gap_tol: float = 0.0
) -> List[NoteEvent]:
    """
    Merge overlapping or nearly adjacent (within gap_tol) same-pitch notes.
    Assumes notes are sorted by (start, pitch).
    """
    if not notes:
        return notes
    merged: List[NoteEvent] = []
    cur = notes[0]
    for n in notes[1:]:
        if n.pitch != cur.pitch:
            merged.append(cur)
            cur = n
            continue

        cur_end = cur.start + cur.duration
        n_start = n.start
        n_end = n.start + n.duration

        # overlap or small gap
        if n_start <= cur_end + gap_tol:
            new_end = max(cur_end, n_end)
            cur = NoteEvent(
                pitch=cur.pitch,
                start=cur.start,
                duration=max(1e-6, new_end - cur.start),
                velocity=max(cur.velocity, n.velocity),
            )
        else:
            merged.append(cur)
            cur = n

    merged.append(cur)
    return merged


def _make_monophonic(notes: List[NoteEvent]) -> List[NoteEvent]:
    """
    Make a track monophonic by trimming/removing overlaps.
    Strategy:
      - sort by start asc, then velocity desc
      - keep earliest; if overlap, trim later note's start
      - discard fully overlapped notes
    """
    if not notes:
        return notes

    sorted_notes = sorted(notes, key=lambda n: (n.start, -(n.velocity or 0)))
    mono: List[NoteEvent] = []
    last_end = 0.0

    for n in sorted_notes:
        start = float(n.start)
        end = float(n.start + n.duration)

        if end <= last_end + 1e-9:
            continue

        real_start = start
        if start < last_end:
            real_start = last_end

        real_dur = end - real_start
        if real_dur <= 1e-6:
            continue

        mono.append(
            NoteEvent(
                pitch=n.pitch,
                start=real_start,
                duration=real_dur,
                velocity=n.velocity,
            )
        )
        last_end = real_start + real_dur

    return mono


def optimize_score(doc: ScoreDoc, cfg: OptimizeConfig | None = None) -> ScoreDoc:
    """
    Optimize ScoreDoc without changing musical meaning by default.

    Safe default:
      - no quantize
      - no pitch clamp
      - no merge / monophonic
      - no noise filtering
      - only stable sort of notes
    """
    cfg = cfg or OptimizeConfig()

    bpm = float(doc.tempo_bpm) if doc.tempo_bpm > 0 else 120.0
    spq = 60.0 / bpm  # seconds per quarter note

    step_sec: Optional[float] = None
    if cfg.grid_div and cfg.grid_div > 0:
        step_sec = spq / float(cfg.grid_div)

    new_tracks: list[Track] = []

    for track in doc.tracks:
        temp_notes: list[NoteEvent] = []

        for ne in track.notes:
            start = float(ne.start)
            dur = float(ne.duration)
            vel = int(ne.velocity)

            if start < 0:
                continue
            if dur <= 0:
                continue

            # Noise filter (optional)
            if cfg.noise_min_duration and dur < float(cfg.noise_min_duration):
                continue
            if cfg.noise_min_velocity and vel < int(cfg.noise_min_velocity):
                continue

            # Quantize (optional)
            if step_sec is not None:
                start = _quantize_time(start, step_sec, cfg.quantize_mode)
                dur = _quantize_time(dur, step_sec, cfg.quantize_mode)
                if dur <= 0:
                    dur = step_sec

            # Pitch clamp (optional)
            pitch = int(ne.pitch)
            if cfg.min_pitch is not None:
                pitch = max(int(cfg.min_pitch), pitch)
            if cfg.max_pitch is not None:
                pitch = min(int(cfg.max_pitch), pitch)
            pitch = _clamp_int(pitch, 0, 127)

            # Velocity leveling (optional)
            if cfg.velocity_target is not None:
                vel = int(cfg.velocity_target)
            vel = _clamp_int(vel, 1, 127)

            temp_notes.append(
                NoteEvent(pitch=pitch, start=start, duration=dur, velocity=vel)
            )

        # stable sort for deterministic output (good for UI editing / diff)
        temp_notes.sort(key=lambda n: (n.start, n.pitch))

        # Merge / monophonic (optional)
        if cfg.merge_same_pitch_overlaps:
            temp_notes = _merge_same_pitch_overlaps(temp_notes, cfg.merge_gap_tolerance)

        if cfg.make_monophonic:
            temp_notes = _make_monophonic(temp_notes)
            temp_notes.sort(key=lambda n: (n.start, n.pitch))

        new_tracks.append(
            Track(
                name=track.name,
                program=track.program,
                channel=track.channel,
                notes=temp_notes,
            )
        )

    return ScoreDoc(
        version=doc.version,
        tempo_bpm=doc.tempo_bpm,
        time_signature=doc.time_signature,
        tracks=new_tracks,
    )
