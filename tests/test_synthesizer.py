import pytest
import shutil
from pathlib import Path

from core.synthesizer import midi_to_audio
from core.config import get_settings


def _which(name: str) -> bool:
    return bool(shutil.which(name) or shutil.which(name + ".exe"))


@pytest.fixture
def dummy_midi(tmp_path: Path) -> Path:
    """写一个最小合法 MIDI (Format 0, 1 track, 480 TPQ)"""
    midi_path = tmp_path / "test.mid"

    # Track events (13 bytes):
    # 00 90 3C 40        Note On (C4, velocity 64)
    # 83 60 80 3C 00     Note Off after 480 ticks
    # 00 FF 2F 00        End of Track
    events = (
        b"\x00\x90\x3C\x40"
        b"\x83\x60\x80\x3C\x00"
        b"\x00\xFF\x2F\x00"
    )

    header = b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0"
    track = b"MTrk" + len(events).to_bytes(4, "big") + events

    midi_path.write_bytes(header + track)
    return midi_path


def test_synthesizer_missing_fluidsynth(monkeypatch, dummy_midi, tmp_path):
    """测试：缺 fluidsynth 时应报错（且用真实存在的 midi 触发到该分支）"""
    import core.synthesizer as synth

    # 模拟找不到 fluidsynth（不依赖本机环境）
    monkeypatch.setattr(synth, "_find_executable", lambda name: None)

    # 同时如果你机器有 FLUIDSYNTH_PATH 配置，也要绕开它：
    monkeypatch.setattr(synth, "_get_fluidsynth_cmd", lambda: (_ for _ in ()).throw(FileNotFoundError("no fluidsynth")))

    with pytest.raises(FileNotFoundError):
        midi_to_audio(dummy_midi, output_dir=tmp_path, output_format="wav")


def test_synthesizer_wav_mode(dummy_midi, tmp_path):
    """测试：WAV 模式（需要 fluidsynth + soundfont）"""
    settings = get_settings()
    if not _which("fluidsynth") or not Path(settings.sound_font_path).exists():
        pytest.skip("Skipping: fluidsynth or SoundFont not found.")

    out_dir = tmp_path / "out_wav"
    result = midi_to_audio(dummy_midi, output_dir=out_dir, output_format="wav")

    assert result.exists()
    assert result.suffix == ".wav"
    assert result.stat().st_size > 0


def test_synthesizer_mp3_mode(dummy_midi, tmp_path):
    """测试：MP3 模式（需要 fluidsynth + ffmpeg + soundfont）"""
    settings = get_settings()
    if not _which("ffmpeg"):
        pytest.skip("Skipping: ffmpeg not found.")
    if not _which("fluidsynth") or not Path(settings.sound_font_path).exists():
        pytest.skip("Skipping: fluidsynth or SoundFont not found.")

    out_dir = tmp_path / "out_mp3"
    result = midi_to_audio(dummy_midi, output_dir=out_dir, output_format="mp3", keep_wav=False)

    assert result.exists()
    assert result.suffix == ".mp3"
    assert result.stat().st_size > 0
    assert not (out_dir / "test.wav").exists()
