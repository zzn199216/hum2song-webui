import io
import time
import wave
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.config as config_module
import core.utils as utils_module
import routers.generation as gen_module


@pytest.fixture(autouse=True)
def reset_state(tmp_path, monkeypatch):
    # redirect runtime dirs to tmp
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv("USE_STUB_CONVERTER", "true")

    # clear cached settings
    config_module.get_settings.cache_clear()

    # clear in-memory store
    utils_module._TASK_STORE.clear()
    if hasattr(utils_module, "_LAST_PRUNE_AT"):
        utils_module._LAST_PRUNE_AT = 0.0

    yield

    utils_module._TASK_STORE.clear()


@pytest.fixture
def client(monkeypatch):
    # fake preprocess_audio: raw -> clean.wav
    def fake_preprocess_audio(raw_path, output_dir=None):
        raw_path = Path(raw_path)
        out_dir = Path(output_dir) if output_dir else raw_path.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{raw_path.stem}_clean.wav"
        out.write_bytes(raw_path.read_bytes())
        return out

    # fake audio_to_midi: clean.wav -> midi
    def fake_audio_to_midi(clean_wav_path, output_dir=None):
        clean_wav_path = Path(clean_wav_path)
        out_dir = Path(output_dir) if output_dir else clean_wav_path.parent
        out_dir.mkdir(parents=True, exist_ok=True)

        base = clean_wav_path.stem.replace("_clean", "")
        out = out_dir / f"{base}.mid"

        data = (
            b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0"
            b"MTrk\x00\x00\x00\x0c\x00\x90\x3C\x40\x83\x60\x80\x3C\x00\x00\xFF\x2F\x00"
        )
        out.write_bytes(data)
        return out

    # fake midi_to_audio: midi -> mp3/wav
    def fake_midi_to_audio(midi_path, output_dir=None, output_format="mp3", keep_wav=False, gain=0.8):
        midi_path = Path(midi_path)
        out_dir = Path(output_dir) if output_dir else midi_path.parent
        out_dir.mkdir(parents=True, exist_ok=True)

        ext = ".mp3" if output_format == "mp3" else ".wav"
        out = out_dir / f"{midi_path.stem}{ext}"

        if ext == ".mp3":
            out.write_bytes(b"ID3FAKE_MP3")
        else:
            with wave.open(str(out), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(22050)
                wf.writeframes(b"\x00\x00" * 22050)  # 1s silence
        return out

    monkeypatch.setattr(gen_module, "preprocess_audio", fake_preprocess_audio)
    monkeypatch.setattr(gen_module, "audio_to_midi", fake_audio_to_midi)
    monkeypatch.setattr(gen_module, "midi_to_audio", fake_midi_to_audio)

    app = FastAPI()
    app.include_router(gen_module.router)
    return TestClient(app)


def make_wav_bytes(seconds=0.2, sr=22050):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(b"\x00\x00" * int(sr * seconds))
    return buf.getvalue()


def test_generate_returns_task_id_and_finishes(client):
    wav_bytes = make_wav_bytes()

    r = client.post(
        "/api/v1/generate?output_format=mp3",
        files={"file": ("demo.wav", wav_bytes, "audio/wav")},
    )
    assert r.status_code == 200
    body = r.json()
    assert "task_id" in body
    task_id = body["task_id"]

    # poll until done (background tasks should finish quickly)
    task = None
    for _ in range(60):
        s = client.get(f"/api/v1/tasks/{task_id}")
        assert s.status_code == 200
        task = s.json()
        if task.get("status") == "done":
            break
        time.sleep(0.02)

    assert task is not None
    assert task.get("status") == "done"

    result = task.get("result") or {}
    assert "download_audio_url" in result
    assert "download_midi_url" in result

    d = client.get(result["download_audio_url"])
    assert d.status_code == 200
    assert d.headers["content-type"].startswith("audio/")

    m = client.get(result["download_midi_url"])
    assert m.status_code == 200


def test_download_before_done_returns_conflict(client):
    tid = utils_module.TaskManager.create_task("x.wav")
    r = client.get(f"/api/v1/tasks/{tid}/download?kind=audio")
    assert r.status_code in (409, 400)
