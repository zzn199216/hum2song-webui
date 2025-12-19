from __future__ import annotations

from pathlib import Path

from music21 import note, stream  # type: ignore

from hum2song.score import midi_to_musicxml


def test_midi_to_musicxml_creates_file(tmp_path: Path):
    # build a tiny MIDI using music21 (no BasicPitch, fast)
    s = stream.Stream()
    s.append(note.Note("C4", quarterLength=1.0))
    s.append(note.Note("E4", quarterLength=1.0))
    s.append(note.Note("G4", quarterLength=1.0))

    midi_path = tmp_path / "tiny.mid"
    s.write("midi", fp=str(midi_path))
    assert midi_path.exists()

    out_dir = tmp_path / "scores"
    xml_path = midi_to_musicxml(midi_path, out_dir=out_dir)

    assert xml_path.exists()
    assert xml_path.suffix.lower() in (".musicxml", ".xml")
    data = xml_path.read_text(encoding="utf-8", errors="ignore")
    assert "<score-partwise" in data or "<score-timewise" in data
