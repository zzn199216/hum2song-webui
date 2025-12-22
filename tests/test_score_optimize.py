from __future__ import annotations

import math

from core.score_models import NoteEvent, ScoreDoc, Track
from core.score_optimize import OptimizeConfig, optimize_score


def _is_multiple(x: float, step: float, tol: float = 1e-6) -> bool:
    if step <= 0:
        return True
    k = round(x / step)
    return abs(x - k * step) <= tol


def test_optimize_score_quantize_clip_merge_velocity():
    score = ScoreDoc(
        tempo_bpm=120.0,  # spq=0.5s, grid_div=4 => step=0.125s
        time_signature="4/4",
        tracks=[
            Track(
                name="T1",
                program=0,
                channel=0,
                notes=[
                    # pitch below min -> clipped
                    NoteEvent(pitch=20, start=0.03, duration=0.20, velocity=10),
                    # overlapping same pitch -> merged into one
                    NoteEvent(pitch=60, start=0.03, duration=0.50, velocity=30),
                    NoteEvent(pitch=60, start=0.40, duration=0.50, velocity=90),
                ],
            )
        ],
    )

    cfg = OptimizeConfig(
        grid_div=4,
        min_pitch=48,
        max_pitch=84,
        velocity_target=80,
        merge_same_pitch_overlaps=True,
    )
    out = optimize_score(score, cfg)

    assert len(out.tracks) == 1
    notes = out.tracks[0].notes
    assert len(notes) >= 2

    # all clipped + velocity forced
    for ne in notes:
        assert 48 <= ne.pitch <= 84
        assert ne.velocity == 80

    step = 0.5 / 4.0  # 0.125
    for ne in notes:
        assert _is_multiple(ne.start, step)
        assert _is_multiple(ne.duration, step)

    # same pitch overlap merged => only one pitch=60 note remains
    n60 = [n for n in notes if n.pitch == 60]
    assert len(n60) == 1

    # deterministic sort: (start, pitch)
    assert notes == sorted(notes, key=lambda x: (x.start, x.pitch))

def test_optimize_safe_preserves_timing_order_no_quantize():
    # 这些 start 刻意设置成“接近但不同”，如果被量化到 1/16 就会粘在一起
    score = ScoreDoc(
        tempo_bpm=120.0,  # spq=0.5
        time_signature="4/4",
        tracks=[
            Track(
                name="T1",
                program=0,
                channel=0,
                notes=[
                    NoteEvent(pitch=60, start=0.8333333, duration=0.10, velocity=60),
                    NoteEvent(pitch=62, start=0.8750000, duration=0.10, velocity=60),
                    NoteEvent(pitch=64, start=0.9166667, duration=0.10, velocity=60),
                    NoteEvent(pitch=65, start=0.9583333, duration=0.10, velocity=60),
                ],
            )
        ],
    )

    out = optimize_score(score, OptimizeConfig())  # default safe
    notes = out.tracks[0].notes

    # 1) start 应非降序（稳定排序）
    starts = [n.start for n in notes]
    assert starts == sorted(starts)

    # 2) 默认 safe 不应量化：start 的唯一值数量不应减少（至少不应把不同 start 吸到同一格）
    # 允许极小浮点误差：四舍五入到 1e-6 后比对
    in_unique = len({round(n.start, 6) for n in score.tracks[0].notes})
    out_unique = len({round(n.start, 6) for n in notes})
    assert out_unique >= in_unique

    # 3) 不应把所有音挤到同一 start（最小间隔应仍 > 0）
    # 这里检查输出最小相邻间隔仍然是正数
    diffs = [starts[i+1] - starts[i] for i in range(len(starts)-1)]
    assert min(diffs) > 0

def test_optimize_strong_quantizes_and_may_reduce_notes():
    score = ScoreDoc(
        tempo_bpm=120.0,  # step=0.125 if grid_div=4
        time_signature="4/4",
        tracks=[Track(name="T1", program=0, channel=0, notes=[
            NoteEvent(pitch=45, start=0.03, duration=0.20, velocity=10),  # will be clamped
            NoteEvent(pitch=60, start=0.03, duration=0.50, velocity=30),
            NoteEvent(pitch=60, start=0.40, duration=0.50, velocity=90),  # overlaps -> merge
        ])],
    )

    cfg = OptimizeConfig(
        grid_div=4,
        min_pitch=48,
        max_pitch=84,
        velocity_target=80,
        merge_same_pitch_overlaps=True,
        make_monophonic=True,
    )
    out = optimize_score(score, cfg)
    notes = out.tracks[0].notes

    # 强模式：start/duration 应该是 step 的倍数
    step = 0.5 / 4.0
    for n in notes:
        assert abs((n.start / step) - round(n.start / step)) < 1e-6
        assert abs((n.duration / step) - round(n.duration / step)) < 1e-6

    # 强模式：可能减少音符数量（合并/单音化）
    assert len(notes) <= len(score.tracks[0].notes)
