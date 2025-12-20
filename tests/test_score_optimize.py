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
