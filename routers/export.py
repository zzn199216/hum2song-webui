"""
Export routes: MIDI and other export-only endpoints (no persistence).
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from core.score_convert import flattened_to_score_doc, score_to_midi

router = APIRouter(tags=["Export"])


@router.post("/export/midi")
async def export_midi(request: Request):
    """
    Export flattened project JSON to MIDI binary.

    Body: flattened JSON from H2SProject.flatten(p2):
      { bpm, tracks: [{ trackId?, notes: [{ pitch, startSec, durationSec, velocity? }] }] }
    Response: MIDI file bytes, Content-Type: audio/midi
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be JSON object")

    try:
        score = flattened_to_score_doc(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / "hum2song.mid"
            score_to_midi(score, out_path)
            midi_bytes = out_path.read_bytes()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to build MIDI")

    return Response(
        content=midi_bytes,
        media_type="audio/midi",
        headers={
            "Content-Disposition": 'attachment; filename="hum2song.mid"',
        },
    )
