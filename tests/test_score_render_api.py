from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from music21 import note, stream  # type: ignore

import routers.score as score_router
from app import create_app
from core.models import FileType
from core.task_manager import task_manager


def _make_tiny_midi(p: Path) -> Path:
    s = stream.Stream()
    s.append(note.Note("C4", quarterLength=1.0))
    s.append(note.Note("E4", quarterLength=1.0))
    s.append(note.Note("G4", quarterLength=1.0))
    s.write("midi", fp=str(p))
    assert p.exists()
    return p


def test_score_render_overwrites_audio(tmp_path: Path, monkeypatch):
    # make router write into tmp_path
    monkeypatch.setattr(score_router, "get_settings", lambda: SimpleNamespace(output_dir=tmp_path))

    # patch synth to avoid requiring ffmpeg/fluidsynth in tests
    def _fake_midi_to_audio(midi_path: str | Path, output_dir=None, output_format="mp3", **kwargs):
        midi_path = Path(midi_path)
        out_dir = Path(output_dir) if output_dir is not None else tmp_path
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{midi_path.stem}.{output_format}"
        out.write_bytes(b"new-audio")
        return out.resolve()

    monkeypatch.setattr(score_router, "midi_to_audio", _fake_midi_to_audio)

    app = create_app()
    with TestClient(app) as client:
        tid = task_manager.create_task()

        # mark completed with initial audio
        old_audio = tmp_path / f"{tid}.mp3"
        old_audio.write_bytes(b"old-audio")
        task_manager.mark_completed(tid, artifact_path=old_audio, file_type=FileType.audio)

        # attach midi
        midi = _make_tiny_midi(tmp_path / f"{tid}.mid")
        task_manager.attach_artifact(tid, artifact_path=midi, file_type=FileType.midi)

        # render new audio
        r = client.post(f"/tasks/{tid}/render?output_format=mp3")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert "audio_download_url" in data

        # download audio should be the new bytes
        r2 = client.get(f"/tasks/{tid}/download?file_type=audio")
        assert r2.status_code == 200, r2.text
        assert r2.content == b"new-audio"
