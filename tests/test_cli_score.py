from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import hum2song.cli as cli
from core.models import FileType


class FakeClient:
    def __init__(self, *args, **kwargs):
        self.calls = []

    def close(self) -> None:
        self.calls.append(("close",))

    def get_score(self, task_id: str):
        self.calls.append(("get_score", task_id))
        return {"tracks": [{"name": "piano", "notes": []}]}

    def put_score(self, task_id: str, *, score_json):
        self.calls.append(("put_score", task_id, score_json))
        return {"ok": True}

    def render_audio(self, task_id: str, *, output_format: str = "mp3"):
        self.calls.append(("render_audio", task_id, output_format))
        return {"ok": True}

    def download_file(self, task_id: str, *, file_type: FileType, dest_path: Path, overwrite: bool = False):
        self.calls.append(("download_file", task_id, file_type, str(dest_path), overwrite))
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(b"x")
        return SimpleNamespace(file_type=file_type, path=dest_path, bytes_written=1)


def test_cli_parser_score_subcommands():
    p = cli.build_parser()
    args = p.parse_args(["score", "pull", "tid"])
    assert args.cmd == "score"
    assert args.score_cmd == "pull"
    args2 = p.parse_args(["score", "push", "tid", "--score", "a.json"])
    assert args2.cmd == "score"
    assert args2.score_cmd == "push"


def test_cli_score_pull_writes_json(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cli, "Hum2SongClient", FakeClient)

    out = tmp_path / "out.json"
    args = cli.build_parser().parse_args(["score", "pull", "tid", "--out", str(out)])
    rc = cli.cmd_score_pull(args)
    assert rc == cli.EXIT_OK
    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert "tracks" in data


def test_cli_score_push_render_and_download(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cli, "Hum2SongClient", FakeClient)

    score_path = tmp_path / "score.json"
    score_path.write_text(json.dumps({"tracks": []}), encoding="utf-8")

    args = cli.build_parser().parse_args(
        [
            "score",
            "push",
            "tid",
            "--score",
            str(score_path),
            "--render",
            "--format",
            "mp3",
            "--out-dir",
            str(tmp_path),
            "--download",
            "both",
        ]
    )
    rc = cli.cmd_score_push(args)
    assert rc == cli.EXIT_OK

    # audio + midi downloaded
    assert (tmp_path / "tid.mp3").exists()
    assert (tmp_path / "downloads" / "tid.mid").exists()
