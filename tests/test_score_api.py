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


def test_score_get_put_and_download(tmp_path: Path, monkeypatch):
    # route writes should go into tmp_path, not repo outputs
    monkeypatch.setattr(score_router, "get_settings", lambda: SimpleNamespace(output_dir=tmp_path))

    app = create_app()
    with TestClient(app) as client:
        # create a completed task with dummy audio so status=completed
        tid = task_manager.create_task()
        audio = tmp_path / f"{tid}.mp3"
        audio.write_bytes(b"fake-audio")
        task_manager.mark_completed(tid, artifact_path=audio, file_type=FileType.audio)

        # attach a real midi so GET /score can derive from midi
        midi = _make_tiny_midi(tmp_path / f"{tid}.mid")
        task_manager.attach_artifact(tid, artifact_path=midi, file_type=FileType.midi)

        # GET score
        r = client.get(f"/tasks/{tid}/score")
        assert r.status_code == 200
        data = r.json()
        assert "tracks" in data
        assert len(data["tracks"]) >= 1

        # PUT score (overwrite with the same payload)
        r2 = client.put(f"/tasks/{tid}/score", json=data)
        assert r2.status_code == 200

        # after PUT, midi should be downloadable
        r3 = client.get(f"/tasks/{tid}/download?file_type=midi")
        assert r3.status_code == 200, r3.text
        assert len(r3.content) > 10
