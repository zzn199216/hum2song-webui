from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from hum2song.api_client import Hum2SongClient, ContractError


def test_submit_task_multipart_and_query(tmp_path: Path):
    wav = tmp_path / "a.wav"
    wav.write_bytes(b"RIFF....FAKE")

    captured = {"seen": False}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/generate"
        assert request.url.params.get("output_format") == "mp3"

        ct = request.headers.get("content-type", "")
        assert ct.startswith("multipart/form-data")

        body = request.read()
        assert b'name="file"' in body
        assert b"a.wav" in body

        captured["seen"] = True
        return httpx.Response(
            202,
            json={
                "task_id": "550e8400-e29b-41d4-a716-446655440000",
                "status": "queued",
                "poll_url": "/tasks/550e8400-e29b-41d4-a716-446655440000",
                "created_at": "2025-12-15T10:00:00Z",
            },
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport, base_url="http://test") as http:
        c = Hum2SongClient(base_url="http://test", http=http)
        resp = c.submit_task(wav, output_format="mp3")
        assert str(resp.task_id) == "550e8400-e29b-41d4-a716-446655440000"
        assert captured["seen"]


def test_get_status_contract_validation_error():
    def handler(request: httpx.Request) -> httpx.Response:
        # progress out of range -> should fail contract
        return httpx.Response(
            200,
            json={
                "task_id": "550e8400-e29b-41d4-a716-446655440000",
                "status": "running",
                "progress": 1.5,
                "stage": "converting",
                "created_at": "2025-12-15T10:00:00Z",
                "updated_at": "2025-12-15T10:00:01Z",
                "result": None,
                "error": None,
            },
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport, base_url="http://test") as http:
        c = Hum2SongClient(base_url="http://test", http=http)
        with pytest.raises(ContractError):
            c.get_status("550e8400-e29b-41d4-a716-446655440000")


def test_download_file_writes_bytes(tmp_path: Path):
    dest = tmp_path / "out.mp3"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path.endswith("/download")
        assert request.url.params.get("file_type") == "audio"
        return httpx.Response(200, content=b"FAKE_AUDIO_BYTES")

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport, base_url="http://test") as http:
        c = Hum2SongClient(base_url="http://test", http=http)
        dl = c.download_file(
            "550e8400-e29b-41d4-a716-446655440000",
            file_type=__import__("core.models", fromlist=["FileType"]).FileType.audio,
            dest_path=dest,
            overwrite=True,
        )
        assert dl.bytes_written == len(b"FAKE_AUDIO_BYTES")
        assert dest.read_bytes() == b"FAKE_AUDIO_BYTES"


def test_download_task_file_wrapper(tmp_path: Path):
    dest = tmp_path / "out.mid"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path.endswith("/download")
        assert request.url.params.get("file_type") == "midi"
        return httpx.Response(200, content=b"MThd....FAKE_MIDI")

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport, base_url="http://test") as http:
        c = Hum2SongClient(base_url="http://test", http=http)
        dl = c.download_task_file(
            "550e8400-e29b-41d4-a716-446655440000",
            file_type=__import__("core.models", fromlist=["FileType"]).FileType.midi,
            dest_path=dest,
            overwrite=True,
        )
        assert dl.bytes_written == len(b"MThd....FAKE_MIDI")
        assert dest.read_bytes() == b"MThd....FAKE_MIDI"
