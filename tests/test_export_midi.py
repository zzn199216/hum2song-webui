"""
Tests for POST /export/midi endpoint.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app import create_app


def test_export_midi_minimal():
    """POST /export/midi with minimal flattened payload returns MIDI bytes."""
    app = create_app()
    payload = {
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
    with TestClient(app) as client:
        r = client.post("/export/midi", json=payload)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("audio/midi")
    assert "attachment" in r.headers.get("content-disposition", "").lower()
    assert "hum2song.mid" in r.headers.get("content-disposition", "")
    # Standard MIDI file header: MThd
    assert r.content[:4] == b"MThd", "Expected SMF header"


def test_export_midi_empty_tracks():
    """Empty tracks array is valid (produces minimal MIDI)."""
    app = create_app()
    payload = {"bpm": 120, "tracks": []}
    with TestClient(app) as client:
        r = client.post("/export/midi", json=payload)
    assert r.status_code == 200, r.text
    assert r.content[:4] == b"MThd"


def test_export_midi_400_missing_bpm():
    """Missing bpm returns 400."""
    app = create_app()
    payload = {"tracks": []}
    with TestClient(app) as client:
        r = client.post("/export/midi", json=payload)
    assert r.status_code == 400, r.text


def test_export_midi_400_invalid_bpm():
    """Invalid bpm (<=0) returns 400."""
    app = create_app()
    payload = {"bpm": 0, "tracks": []}
    with TestClient(app) as client:
        r = client.post("/export/midi", json=payload)
    assert r.status_code == 400, r.text


def test_export_midi_400_missing_note_fields():
    """Note missing startSec/durationSec returns 400."""
    app = create_app()
    payload = {
        "bpm": 120,
        "tracks": [{"notes": [{"pitch": 60}]}],
    }
    with TestClient(app) as client:
        r = client.post("/export/midi", json=payload)
    assert r.status_code == 400, r.text
