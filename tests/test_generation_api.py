from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import routers.generation as gen_module
from app import app
from core.generation_service import GenerationService
from core.models import FileType, TaskStatus
from core.task_manager import TaskManager


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """
    Isolated API test client:
    - Patch router module's task_manager and generation_service to test-local instances
    - Use stub runner (no real AI, fast, deterministic)
    """
    tm = TaskManager()

    # stub runner: always produce a tiny audio file
    def runner(_input: Path, _fmt: str) -> Path:
        out = tmp_path / f"produced.{_fmt}"
        out.write_bytes(b"FAKE_AUDIO")
        return out

    svc = GenerationService(task_manager=tm, base_dir=tmp_path, runner=runner)

    monkeypatch.setattr(gen_module, "task_manager", tm)
    monkeypatch.setattr(gen_module, "generation_service", svc)

    return TestClient(app)


def test_generate_returns_task_id_and_finishes(client):
    r = client.post(
        "/generate?output_format=mp3",
        files={"file": ("a.wav", b"fake-wav", "audio/wav")},
    )
    assert r.status_code == 202
    body = r.json()

    assert "task_id" in body
    task_id = body["task_id"]
    assert body["status"] == "queued"
    assert body["poll_url"].endswith(f"/tasks/{task_id}")
    assert body["created_at"].endswith("Z")

    # Poll once (in TestClient, BackgroundTasks normally runs after response)
    s = client.get(f"/tasks/{task_id}")
    assert s.status_code == 200
    info = s.json()

    assert info["task_id"] == task_id
    assert info["status"] in ("queued", "running", "completed", "failed")

    if info["status"] == "completed":
        assert info["progress"] == 1.0
        assert info["result"] is not None
        assert info["result"]["download_url"].endswith("file_type=audio")
        assert info["error"] is None


def test_download_before_done_returns_conflict(client):
    # Create task directly (queued) so it's definitely not completed
    tm = gen_module.task_manager
    tid = tm.create_task()

    r = client.get(f"/tasks/{tid}/download?file_type=audio")
    assert r.status_code == 409


def test_download_after_done_returns_file(client, tmp_path):
    tm = gen_module.task_manager
    tid = tm.create_task()

    out = (tmp_path / "ok.mp3").resolve()
    out.write_bytes(b"FAKE_AUDIO")
    tm.mark_completed(tid, artifact_path=out, file_type=FileType.audio)

    r = client.get(f"/tasks/{tid}/download?file_type=audio")
    assert r.status_code == 200
    assert r.content == b"FAKE_AUDIO"


def test_download_invalid_file_type_is_400(client):
    tm = gen_module.task_manager
    tid = tm.create_task()

    r = client.get(f"/tasks/{tid}/download?file_type=xxx")
    assert r.status_code == 400
