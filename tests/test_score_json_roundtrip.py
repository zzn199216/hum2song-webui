from __future__ import annotations

from pathlib import Path

from music21 import converter, note, stream  # type: ignore


from core.score_convert import midi_to_score, score_to_midi
from core.score_models import ScoreDoc


def _count_notes_in_m21_midi(midi_path: Path) -> int:
    s = converter.parse(str(midi_path))
    return len(list(s.recurse().notes))


def test_midi_score_json_roundtrip(tmp_path: Path):
    # build a tiny MIDI
    s = stream.Stream()
    s.append(note.Note("C4", quarterLength=1.0))
    s.append(note.Note("E4", quarterLength=1.0))
    s.append(note.Note("G4", quarterLength=1.0))

    midi_in = tmp_path / "tiny.mid"
    s.write("midi", fp=str(midi_in))
    assert midi_in.exists()
    assert _count_notes_in_m21_midi(midi_in) > 0

    # MIDI -> ScoreDoc
    score = midi_to_score(midi_in)
    assert isinstance(score, ScoreDoc)
    assert len(score.tracks) >= 1
    assert sum(len(t.notes) for t in score.tracks) > 0

    # ScoreDoc -> MIDI
    midi_out = tmp_path / "tiny_from_json.mid"
    out = score_to_midi(score, midi_out)
    assert out.exists()

    # parse again, should still have notes
    assert _count_notes_in_m21_midi(out) > 0
