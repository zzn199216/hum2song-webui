"""Tests for merging vocal + accompaniment ScoreDocs."""

from __future__ import annotations

from core.score_models import NoteEvent, ScoreDoc, Track
from core.stem_score_merge import merge_vocal_and_music_scores


def test_merge_flattens_to_vocal_and_music_tracks():
    v = ScoreDoc(
        version=1,
        tempo_bpm=120.0,
        time_signature="4/4",
        tracks=[
            Track(
                name="ch0",
                notes=[NoteEvent(pitch=60, start=0.0, duration=0.5, velocity=80)],
            )
        ],
    )
    m = ScoreDoc(
        version=1,
        tempo_bpm=120.0,
        time_signature="4/4",
        tracks=[
            Track(
                name="ch0",
                notes=[NoteEvent(pitch=64, start=0.1, duration=0.5, velocity=70)],
            )
        ],
    )
    out = merge_vocal_and_music_scores(v, m)
    assert len(out.tracks) == 2
    assert out.tracks[0].name == "Vocal"
    assert out.tracks[1].name == "Music"
    assert len(out.tracks[0].notes) == 1
    assert len(out.tracks[1].notes) == 1
