# tests/test_generation_api.py
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.generation as gen_module
from core.utils import TaskManager


@pytest.fixture
def client(tmp_path, monkeypatch):
    # 让 settings 指向临时目录
    up = tmp_path / "uploads"
    out = tmp_path / "outputs"
    up.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("UPLOAD_DIR", str(up))
    monkeypatch.setenv("OUTPUT_DIR", str(out))
    monkeypatch.setenv("APP_ENV", "development")

    import core.config as config_module
    config_module.get_settings.cache_clear()

    # patch pipeline：直接产出文件并 done
    def fake_run_pipeline_for_task(
        task_id: str,
        input_filename: str,
        output_format: str = "mp3",
        gain: float = 0.8,
        keep_wav: bool = False,
        cleanup_uploads: bool = True,
        base_api_prefix: str = "/api/v1",
    ):
        # 产出两个文件
        midi_path = out / f"{task_id}.mid"
        audio_path = out / f"{task_id}.{ 'mp3' if output_format=='mp3' else 'wav' }"

        midi_path.write_bytes(
            b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0"
            b"MTrk\x00\x00\x00\x0c\x00\x90\x3C\x40\x83\x60\x80\x3C\x00\x00\xFF\x2F\x00"
        )
        audio_path.write_bytes(b"FAKE_AUDIO")

        TaskManager.done_task(task_id, result={"audio": str(audio_path), "midi": str(midi_path), "output_format": output_format})

    monkeypatch.setattr(gen_module, "run_pipeline_for_task", fake_run_pipeline_for_task)

    app = FastAPI()
    app.include_router(gen_module.router)
    return TestClient(app)


def test_generate_returns_task_id_and_finishes(client):
    resp = client.post(
        "/api/v1/generate?output_format=mp3",
        files={"file": ("demo.wav", b"dummy", "audio/wav")},
    )
    assert resp.status_code == 200
    tid = resp.json()["task_id"]

    # BackgroundTasks 在 TestClient 下会在响应后执行
    status = client.get(f"/api/v1/tasks/{tid}").json()
    assert status["status"] == "done"

    dl = client.get(f"/api/v1/tasks/{tid}/download?kind=audio")
    assert dl.status_code == 200


def test_download_before_done_returns_conflict(client):
    tid = TaskManager.create_task("x.wav")
    r = client.get(f"/api/v1/tasks/{tid}/download?kind=audio")
    assert r.status_code == 409
