from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import routers.generation as gen
from app import app
from core.generation_service import GenerationService
from core.models import FileType
from core.task_manager import TaskManager


@pytest.fixture()
def client(tmp_path, monkeypatch):
    tm = TaskManager()

    def runner(_input: Path, _fmt: str) -> Path:
        out = tmp_path / f"produced.{_fmt}"
        out.write_bytes(b"fake-audio")
        return out

    svc = GenerationService(task_manager=tm, base_dir=tmp_path, runner=runner)

    monkeypatch.setattr(gen, "task_manager", tm)
    monkeypatch.setattr(gen, "generation_service", svc)

    return TestClient(app)


def test_generate_contract_shape(client):
    resp = client.post(
        "/generate?output_format=mp3",
        files={"file": ("a.wav", b"fake", "audio/wav")},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert set(body.keys()) == {"task_id", "status", "poll_url", "created_at"}
    assert body["status"] == "queued"
    assert body["poll_url"].startswith("/tasks/")
    assert body["created_at"].endswith("Z")


def test_tasks_contract_shape(client):
    r = client.post(
        "/generate?output_format=mp3",
        files={"file": ("a.wav", b"fake", "audio/wav")},
    )
    task_id = r.json()["task_id"]

    resp = client.get(f"/tasks/{task_id}")
    assert resp.status_code == 200
    body = resp.json()
    for k in ("task_id", "status", "progress", "stage", "created_at", "updated_at", "result", "error"):
        assert k in body
    assert body["created_at"].endswith("Z")
    assert body["updated_at"].endswith("Z")


def test_download_semantics(client, tmp_path):
    tm = gen.task_manager
    tid = tm.create_task()

    # missing file_type -> 400
    assert client.get(f"/tasks/{tid}/download").status_code == 422  # FastAPI missing required query param
    # invalid file_type -> 400
    assert client.get(f"/tasks/{tid}/download?file_type=xxx").status_code == 400

    # not completed -> 409
    assert client.get(f"/tasks/{tid}/download?file_type=audio").status_code == 409

    out = (tmp_path / "ok.mp3").resolve()
    out.write_bytes(b"fake-audio")
    tm.mark_completed(tid, artifact_path=out, file_type=FileType.audio)

    # download ok -> 200
    r = client.get(f"/tasks/{tid}/download?file_type=audio")
    assert r.status_code == 200
    assert r.content == b"fake-audio"

    # midi not available -> 409
    assert client.get(f"/tasks/{tid}/download?file_type=midi").status_code == 409


def test_task_not_found_is_404(client):
    assert client.get("/tasks/00000000-0000-0000-0000-000000000000").status_code == 404
    assert (
        client.get("/tasks/00000000-0000-0000-0000-000000000000/download?file_type=audio").status_code == 404
    )
