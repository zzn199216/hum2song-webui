"""
core.score_optimize

ScoreDoc 的“轻量优化器”，用于把从 MIDI/哼唱解析出来的音符做一些
**可控、可回退** 的清洗，方便 MVP 阶段用 MuseScore/后端渲染快速验证。

设计目标（非常重要）：
- 默认尽量 **不改动旋律顺序/节奏**，避免“全部挤到一起”的现象
- 允许通过参数开启网格量化、同音重叠合并、单旋律抽取（monophonic）等更“激进”的操作
- 对“极短 + 极弱”的噪声音符做保守过滤（不会把长音腰斩）

注意：ScoreDoc 里的 start/duration 单位是 **秒**（不是拍子）。
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
    优化配置（默认值尽量保守：不量化、不强行单声部、不合并）
    """

    # --- 网格量化（可选） ---
    # grid_div: 每拍切成几格，例如 4 => 16分音符网格（在 tempo_bpm 下换算成秒）
    grid_div: Optional[int] = None
    quantize_mode: QuantizeMode = "nearest"

    # --- 音高裁剪（可选） ---
    min_pitch: Optional[int] = None
    max_pitch: Optional[int] = None

    # --- 音量/力度（velocity）处理 ---
    # 设为 None 表示不改；设为 [1..127] 表示把所有音符 velocity 统一拉到该值（调平）
    velocity_target: Optional[int] = 80

    # --- 降噪（保守）---
    # 仅当 “duration < noise_min_duration 且 velocity < noise_min_velocity” 时才丢弃
    drop_weak_short_notes: bool = True
    noise_min_duration: float = 0.06  # 秒（60ms 以下的短促杂音更常见）
    noise_min_velocity: int = 30      # 低力度

    # --- 同音重叠合并（可选）---
    merge_same_pitch_overlaps: bool = False

    # --- 单旋律抽取（可选）---
    # 目的：把多声部/重叠变成单声部，减少“和弦化/糊在一起”
    make_monophonic: bool = True

    # 单声部：当发生重叠时，是否倾向于“保留更强/更长的音”
    monophonic_switch_strength_ratio: float = 1.10
    monophonic_min_switch_duration: float = 0.10  # 秒（太短的音不应触发切换）
    # 允许基于位置切换：如果新音发生在旧音的后半段（>= 该比例），更可能是真正换音
    monophonic_switch_after_frac: float = 0.30
    # 弱重叠的处理：True=把新音延后到前一个音结束后（保序、不叠音）；False=直接丢弃新音
    monophonic_delay_weak_overlaps: bool = False

    eps: float = 1e-9


def _step_seconds(tempo_bpm: float, grid_div: Optional[int]) -> float:
    if not grid_div or grid_div <= 0:
        return 0.0
    spq = 60.0 / float(tempo_bpm)  # seconds per quarter
    return spq / float(grid_div)


def _is_noise(ne: NoteEvent, cfg: OptimizeConfig) -> bool:
    return (ne.duration < cfg.noise_min_duration) and (ne.velocity < cfg.noise_min_velocity)


def _quantize_value(t: float, *, step: float, mode: QuantizeMode, eps: float) -> float:
    if step <= 0:
        return float(t)
    x = float(t) / step
    if mode == "nearest":
        k = int(round(x))
    elif mode == "ceil":
        k = int(math.ceil(x - eps))
    else:  # floor
        k = int(math.floor(x + eps))

    q = k * step
    if abs(q) < eps:
        q = 0.0
    # 统一截断浮点噪声，避免“看起来是 0.1250000003”
    return round(q, 10)


def _quantize_note(ne: NoteEvent, cfg: OptimizeConfig, step: float) -> NoteEvent:
    """
    把 start 和 end 量化到网格，再回算 duration。
    确保 duration > 0。
    """
    s = _quantize_value(ne.start, step=step, mode=cfg.quantize_mode, eps=cfg.eps)
    e = _quantize_value(ne.start + ne.duration, step=step, mode=cfg.quantize_mode, eps=cfg.eps)
    if e <= s + cfg.eps:
        # 至少给一个 step；如果 step=0 则保留原 duration
        e = s + (step if step > 0 else max(float(ne.duration), 1e-3))
    d = round(e - s, 10)
    return NoteEvent(pitch=int(ne.pitch), start=float(s), duration=float(d), velocity=int(ne.velocity))


def _merge_same_pitch_overlaps(notes: List[NoteEvent], cfg: OptimizeConfig) -> List[NoteEvent]:
    if not notes:
        return []

    # 先按 pitch + start 排序，便于合并
    items = sorted(notes, key=lambda n: (n.pitch, n.start, -n.duration))

    out: List[NoteEvent] = []
    cur = items[0]
    cur_end = cur.start + cur.duration

    for ne in items[1:]:
        ne_end = ne.start + ne.duration
        if ne.pitch != cur.pitch or ne.start > cur_end + cfg.eps:
            out.append(cur)
            cur = ne
            cur_end = ne_end
            continue

        # overlap => merge
        new_start = min(cur.start, ne.start)
        new_end = max(cur_end, ne_end)
        cur = NoteEvent(
            pitch=int(cur.pitch),
            start=float(new_start),
            duration=float(round(new_end - new_start, 10)),
            velocity=int(max(cur.velocity, ne.velocity)),
        )
        cur_end = cur.start + cur.duration

    out.append(cur)

    # 再按时间排序回去
    return sorted(out, key=lambda n: (n.start, n.pitch))


def _make_monophonic(notes: List[NoteEvent], cfg: OptimizeConfig) -> List[NoteEvent]:
    """
    把一个 track 的音符变成单声部（尽量不叠音）。

    关键点：**不会让极短/极弱的噪声音符去“切断”长音**。
    """
    if not notes:
        return []

    # 时间排序：同起点时优先更强更长（有助于“主旋律”先被选中）
    items = sorted(notes, key=lambda n: (n.start, -n.velocity, -n.duration))

    out: List[NoteEvent] = []
    for ne in items:
        if cfg.drop_weak_short_notes and _is_noise(ne, cfg):
            continue

        if not out:
            out.append(ne)
            continue

        prev = out[-1]
        prev_end = prev.start + prev.duration

        if ne.start >= prev_end - cfg.eps:
            out.append(ne)
            continue

        # overlap
        # 噪声不参与切换
        if _is_noise(ne, cfg):
            continue

        prev_strength = float(prev.velocity) * float(prev.duration)
        ne_strength = float(ne.velocity) * float(ne.duration)

        prev_progress = 0.0
        if prev.duration > cfg.eps:
            prev_progress = (ne.start - prev.start) / prev.duration

        # 是否应当切换到新音（trim 前一个音到 ne.start）
        should_switch = (
            ne.duration >= cfg.monophonic_min_switch_duration
            and (
                ne_strength >= prev_strength * cfg.monophonic_switch_strength_ratio
                or prev_progress >= cfg.monophonic_switch_after_frac
            )
        )

        if should_switch:
            trimmed = max(cfg.eps, float(ne.start - prev.start))
            out[-1] = NoteEvent(
                pitch=int(prev.pitch),
                start=float(prev.start),
                duration=float(trimmed),
                velocity=int(prev.velocity),
            )
            out.append(ne)
            continue

        # 弱重叠：保序处理（延后 or 丢弃）
        if cfg.monophonic_delay_weak_overlaps:
            shifted_start = prev_end
            out.append(
                NoteEvent(
                    pitch=int(ne.pitch),
                    start=float(shifted_start),
                    duration=float(ne.duration),
                    velocity=int(ne.velocity),
                )
            )
        # else: drop

    return out


def _optimize_track(track: Track, tempo_bpm: float, cfg: OptimizeConfig) -> Track:
    step = _step_seconds(tempo_bpm, cfg.grid_div)

    optimized: List[NoteEvent] = []
    for ne in track.notes:
        # 先用“原始”信息判断是否是噪声（避免先调平 velocity 后把噪声抬高）
        if cfg.drop_weak_short_notes and _is_noise(ne, cfg):
            continue

        pitch = int(ne.pitch)
        if cfg.min_pitch is not None:
            pitch = max(pitch, int(cfg.min_pitch))
        if cfg.max_pitch is not None:
            pitch = min(pitch, int(cfg.max_pitch))

        vel = int(ne.velocity)
        if cfg.velocity_target is not None:
            vel = int(cfg.velocity_target)

        out_ne = NoteEvent(
            pitch=pitch,
            start=float(ne.start),
            duration=float(ne.duration),
            velocity=vel,
        )

        if step > 0:
            out_ne = _quantize_note(out_ne, cfg, step)

        optimized.append(out_ne)

    if cfg.merge_same_pitch_overlaps:
        optimized = _merge_same_pitch_overlaps(optimized, cfg)

    if cfg.make_monophonic:
        optimized = _make_monophonic(optimized, cfg)
        # monophonic 可能会“延后” start，必要时再量化一次保持网格
        if step > 0:
            optimized = [_quantize_note(n, cfg, step) for n in optimized]

    # 确保最终按时间排序（不依赖上游顺序）
    optimized = sorted(optimized, key=lambda n: (n.start, n.pitch))

    return Track(
        name=track.name,
        program=track.program,
        channel=track.channel,
        notes=optimized,
    )


def optimize_score(score: ScoreDoc, cfg: OptimizeConfig) -> ScoreDoc:
    tracks: List[Track] = [
        _optimize_track(t, score.tempo_bpm, cfg) for t in score.tracks
    ]
    return ScoreDoc(
        tempo_bpm=float(score.tempo_bpm),
        time_signature=str(score.time_signature),
        tracks=tracks,
    )
