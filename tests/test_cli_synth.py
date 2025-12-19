from __future__ import annotations

from pathlib import Path

import core.synthesizer as synth
from hum2song.cli import main, EXIT_BAD_ARGS, EXIT_OK


def test_cli_synth_happy_path(tmp_path: Path, monkeypatch):
    # 只要文件存在即可（这里不做 MIDI 解析），避免依赖外部工具
    midi = tmp_path / "edited.mid"
    midi.write_bytes(b"FAKE_MIDI")

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    def fake_midi_to_audio(midi_path: Path, *, output_dir: Path, output_format: str, gain: float, keep_wav: bool):
        out = output_dir / f"{midi_path.stem}.{output_format}"
        out.write_bytes(b"FAKE_AUDIO")
        return out

    monkeypatch.setattr(synth, "midi_to_audio", fake_midi_to_audio)

    code = main(["synth", str(midi), "--format", "mp3", "--out-dir", str(out_dir)])
    assert code == EXIT_OK
    assert (out_dir / "edited.mp3").exists()


def test_cli_synth_missing_file(tmp_path: Path):
    missing = tmp_path / "no.mid"
    code = main(["synth", str(missing), "--format", "mp3", "--out-dir", str(tmp_path)])
    assert code == EXIT_BAD_ARGS
