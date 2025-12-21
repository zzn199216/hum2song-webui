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
    【当前默认值：强力去污模式】
    针对“生肉”MIDI数据（未量化、有杂音）进行清洗
    """

    # --- 1. 网格量化 (保持关闭，以免破坏节奏) ---
    grid_div: Optional[int] = None  # 建议保持 None，除非需要机械感
    quantize_mode: QuantizeMode = "nearest"

    # --- 2. 杂音过滤 (核心修改) ---
    # 任何短于 0.12秒 (120ms) 的音符都会被当作“嘴唇杂音”删掉
    noise_min_duration: float = 0.03 
    # 任何力度小于 55 的音符都会被当作“呼吸/底噪”删掉
    noise_min_velocity: int = 25      

    # --- 3. 音高限制 ---
    min_pitch: Optional[int] = None
    max_pitch: Optional[int] = None

    # --- 4. 力度统一 ---
    # 如果不想让力度忽大忽小，可以设为 80；设为 None 则保留原始起伏
    velocity_target: Optional[int] = None 

    # --- 5. 合并同音 (防止长音被打断) ---
    merge_same_pitch_overlaps: bool = True
    merge_gap_tolerance: float = 0.05  # 50ms 内的断裂会自动连起来

    # --- 6. 单音化 (防止和弦/重叠) ---
    make_monophonic: bool = True


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


def _merge_same_pitch_overlaps(notes: List[NoteEvent], tolerance: float) -> List[NoteEvent]:
    """
    合并相同音高、且时间上相邻（或重叠）的音符。
    用于修复哼唱时因为不稳定导致的一个长音被切成多段的问题。
    """
    if not notes:
        return []

    # 必须先按 (start, pitch) 排序，但为了合并同音，我们最好主要按 pitch 聚类，或者仅处理相邻
    # 这里采用标准策略：先按 start 排序，线性扫描
    sorted_notes = sorted(notes, key=lambda x: (x.start, x.pitch))
    merged = []
    
    current = sorted_notes[0]

    for next_note in sorted_notes[1:]:
        # 判断是否同音
        if next_note.pitch == current.pitch:
            # 判断是否衔接（结束时间 + 容差 >= 下一个的开始时间）
            current_end = current.start + current.duration
            if current_end + tolerance >= next_note.start:
                # 合并：新的结束时间是两者最大的结束时间
                new_end = max(current_end, next_note.start + next_note.duration)
                new_dur = new_end - current.start
                # 力度取最大值（保留重音）
                new_vel = max(current.velocity or 0, next_note.velocity or 0)
                
                # 更新 current，暂不存入 merged
                current = NoteEvent(
                    pitch=current.pitch,
                    start=current.start,
                    duration=new_dur,
                    velocity=new_vel
                )
                continue
        
        # 无法合并，推入上一个，开始新的
        merged.append(current)
        current = next_note

    merged.append(current)
    return merged


def _make_monophonic(notes: List[NoteEvent]) -> List[NoteEvent]:
    """
    单音化处理：
    如果有时间重叠的音符，只保留“最响”或者“最长”的那个，
    或者简单地把重叠部分切除。
    这里采用“优先保留高音/响度大”的策略，并修剪时间。
    简化版策略：直接由时间轴扫描，同一时刻只允许一个音符存在。
    """
    if not notes:
        return []

    # 按开始时间排序，如果开始时间相同，力度大的排前面
    sorted_notes = sorted(notes, key=lambda x: (x.start, -1 * (x.velocity or 0)))
    
    mono = []
    last_end = 0.0

    for n in sorted_notes:
        # 如果这个音符完全在从上一个音符的阴影里，丢弃
        if n.start + n.duration <= last_end:
            continue
        
        # 如果这个音符开始得比上一个结束得早（重叠），裁剪它的开始时间
        real_start = max(n.start, last_end)
        real_dur = (n.start + n.duration) - real_start
        
        if real_dur > 0:
            new_note = NoteEvent(
                pitch=n.pitch,
                start=real_start,
                duration=real_dur,
                velocity=n.velocity
            )
            mono.append(new_note)
            last_end = real_start + real_dur

    return mono


def optimize_score(doc: ScoreDoc, config: Optional[OptimizeConfig] = None) -> ScoreDoc:
    """
    主入口：对 ScoreDoc 进行清洗
    """
    if config is None:
        config = OptimizeConfig()

    cfg = config
    step_sec = None
    if cfg.grid_div and cfg.grid_div > 0 and doc.tempo_bpm and doc.tempo_bpm > 0:
        step_sec = (60.0 / doc.tempo_bpm) / float(cfg.grid_div)

    new_tracks = []

    for track in doc.tracks:
        # 1. 初步过滤与转换
        temp_notes = []
        for ne in track.notes:
            start = float(ne.start)
            dur = float(ne.duration)
            vel = int(ne.velocity) if ne.velocity else 64

            # --- 过滤逻辑 ---
            # 过滤极短音符
            if dur < cfg.noise_min_duration:
                continue
            # 过滤极弱音符
            if vel < cfg.noise_min_velocity:
                continue

            # 量化逻辑
            if step_sec is not None:
                start = _quantize_time(start, step_sec, cfg.quantize_mode)
                dur = _quantize_time(dur, step_sec, cfg.quantize_mode)
                if dur <= 0:
                    dur = step_sec  # 保证量化后至少有一格

            start = max(0.0, start)
            dur = max(0.0, dur)

            # 音高限制
            pitch = ne.pitch
            if cfg.min_pitch is not None:
                pitch = max(pitch, int(cfg.min_pitch))
            if cfg.max_pitch is not None:
                pitch = min(pitch, int(cfg.max_pitch))

            # 力度统一
            if cfg.velocity_target is not None:
                vel = int(cfg.velocity_target)
            
            vel = _clamp_int(vel, 1, 127)

            temp_notes.append(NoteEvent(pitch=int(pitch), start=start, duration=dur, velocity=vel))

        # 2. 合并同音 (Merge Overlaps)
        #    在单音化之前做，可以把碎掉的长音连起来
        if cfg.merge_same_pitch_overlaps:
            temp_notes = _merge_same_pitch_overlaps(temp_notes, cfg.merge_gap_tolerance)

        # 3. 单音化 (Make Monophonic)
        #    解决“和弦”问题，确保它是单旋律
        if cfg.make_monophonic:
            temp_notes = _make_monophonic(temp_notes)

        # 4. 再次排序，确保输出有序
        temp_notes.sort(key=lambda n: (n.start, n.pitch))

        new_tracks.append(
            Track(
                name=track.name,
                program=track.program,
                channel=track.channel,
                notes=temp_notes
            )
        )

    return ScoreDoc(
        version=doc.version,
        tempo_bpm=doc.tempo_bpm,
        time_signature=doc.time_signature,
        tracks=new_tracks
    )