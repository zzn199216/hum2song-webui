from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.config as config_module
import routers.health as health_module


@pytest.fixture(autouse=True)
def reset_settings_cache(tmp_path, monkeypatch):
    # 把路径指向 tmp，避免污染真实 uploads/outputs
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv("SOUND_FONT_PATH", str(tmp_path / "assets" / "piano.sf2"))
    monkeypatch.setenv("APP_ENV", "test")

    config_module.get_settings.cache_clear()
    yield
    config_module.get_settings.cache_clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(health_module.router)
    return TestClient(app)


def test_health_ok(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()

    assert body["ok"] is True
    assert body["env"] == "test"
    assert "paths" in body and "checks" in body


def test_health_paths_are_strings(client):
    body = client.get("/api/v1/health").json()
    assert isinstance(body["paths"]["upload_dir"], str)
    assert isinstance(body["paths"]["output_dir"], str)
    assert isinstance(body["paths"]["soundfont"], str)


def test_health_dir_exists_flags(client):
    body = client.get("/api/v1/health").json()

    # config.py 会自动创建 uploads/outputs（如果你保留了那个逻辑）
    assert body["checks"]["upload_dir_exists"] is True
    assert body["checks"]["output_dir_exists"] is True


def test_health_soundfont_flag_changes(tmp_path, monkeypatch):
    # 这里不用 fixture client（因为要重新 build app + 清 cache）
    # case 1: soundfont 不存在 -> False
    monkeypatch.setenv("SOUND_FONT_PATH", str(tmp_path / "assets" / "piano.sf2"))
    config_module.get_settings.cache_clear()

    app = FastAPI()
    app.include_router(health_module.router)
    c = TestClient(app)

    body = c.get("/api/v1/health").json()
    assert body["checks"]["soundfont_exists"] is False

    # case 2: 创建 soundfont -> True
    sf2 = Path(tmp_path / "assets" / "piano.sf2")
    sf2.parent.mkdir(parents=True, exist_ok=True)
    sf2.write_bytes(b"FAKE_SF2")  # 这里只测试 exists，不需要真 sf2

    config_module.get_settings.cache_clear()
    body2 = c.get("/api/v1/health").json()
    assert body2["checks"]["soundfont_exists"] is True
