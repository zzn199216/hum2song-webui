from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class NoteEvent(BaseModel):
    """
    Internal canonical note representation for App/LLM editing.
    Times are in seconds (float) relative to score start.
    """
    pitch: int = Field(..., ge=0, le=127, description="MIDI pitch 0-127")
    start: float = Field(..., ge=0.0, description="Start time in seconds")
    duration: float = Field(..., gt=0.0, description="Duration in seconds")
    velocity: int = Field(64, ge=1, le=127, description="MIDI velocity 1-127")


class Track(BaseModel):
    name: str = Field("Track", description="Track name")
    program: Optional[int] = Field(None, ge=0, le=127, description="MIDI program/instrument 0-127")
    channel: Optional[int] = Field(None, ge=0, le=15, description="MIDI channel 0-15")
    notes: List[NoteEvent] = Field(default_factory=list)


class ScoreDoc(BaseModel):
    """
    Canonical score for Hum2Song.
    This is what the App will edit in the future.
    """
    version: int = Field(1, description="Schema version")
    tempo_bpm: float = Field(120.0, gt=0.0, description="Tempo in BPM")
    time_signature: str = Field("4/4", description="Time signature, e.g., 4/4")
    tracks: List[Track] = Field(default_factory=list)
