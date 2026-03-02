"""
Unit tests for flattened_to_score_doc (core/score_convert.py).
No FastAPI dependency.
"""
from __future__ import annotations

import pytest

from core.score_convert import flattened_to_score_doc
from core.score_models import ScoreDoc


def test_flattened_to_score_doc_minimal():
    """Minimal valid flattened payload produces ScoreDoc."""
    flat = {
        "bpm": 120,
        "tracks": [
            {
                "trackId": "tr1",
                "notes": [
                    {"pitch": 60, "startSec": 0.0, "durationSec": 0.5, "velocity": 80},
                    {"pitch": 64, "startSec": 0.5, "durationSec": 0.5},
                ],
            },
        ],
    }
    doc = flattened_to_score_doc(flat)
    assert isinstance(doc, ScoreDoc)
    assert doc.tempo_bpm == 120
    assert doc.time_signature == "4/4"
    assert len(doc.tracks) == 1
    assert doc.tracks[0].name == "tr1"
    assert len(doc.tracks[0].notes) == 2
    n0, n1 = doc.tracks[0].notes
    assert n0.pitch == 60 and n0.start == 0.0 and n0.duration == 0.5 and n0.velocity == 80
    assert n1.pitch == 64 and n1.velocity == 64  # default velocity


def test_flattened_to_score_doc_empty_tracks():
    """Empty tracks is valid."""
    doc = flattened_to_score_doc({"bpm": 100, "tracks": []})
    assert doc.tempo_bpm == 100
    assert len(doc.tracks) == 0


def test_flattened_to_score_doc_missing_bpm():
    with pytest.raises(ValueError, match="bpm"):
        flattened_to_score_doc({"tracks": []})


def test_flattened_to_score_doc_invalid_bpm():
    with pytest.raises(ValueError, match="bpm"):
        flattened_to_score_doc({"bpm": 0, "tracks": []})


def test_flattened_to_score_doc_missing_note_field():
    with pytest.raises(ValueError, match="startSec|durationSec|pitch"):
        flattened_to_score_doc({
            "bpm": 120,
            "tracks": [{"notes": [{"pitch": 60}]}],
        })
