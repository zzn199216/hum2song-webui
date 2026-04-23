# core/stem_score_merge.py
"""Merge separate vocal / accompaniment transcription scores into one dual-track ScoreDoc."""
from __future__ import annotations

from core.score_models import NoteEvent, ScoreDoc, Track, normalize_score


def _flatten_to_named_track(name: str, doc: ScoreDoc) -> Track:
    notes: list[NoteEvent] = []
    for tr in doc.tracks or []:
        for n in tr.notes or []:
            notes.append(n)
    notes.sort(key=lambda x: (float(x.start), int(x.pitch)))
    return Track(name=name, notes=notes)


def merge_vocal_and_music_scores(vocal_doc: ScoreDoc, music_doc: ScoreDoc) -> ScoreDoc:
    """
    Build one ScoreDoc with exactly two tracks: **Vocal**, **Music**.

    Each input may have multiple MIDI channels / tracks; notes are flattened in time order.
    Tempo / meter taken from ``vocal_doc`` when possible.
    """
    v = _flatten_to_named_track("Vocal", vocal_doc)
    m = _flatten_to_named_track("Music", music_doc)
    tempo = float(vocal_doc.tempo_bpm or music_doc.tempo_bpm or 120.0)
    ts = str(vocal_doc.time_signature or music_doc.time_signature or "4/4")
    out = ScoreDoc(version=1, tempo_bpm=tempo, time_signature=ts, tracks=[v, m])
    return normalize_score(out)
