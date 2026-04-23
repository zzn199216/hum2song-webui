"""Tests for experimental 2-stem separation (stub vs Demucs seam)."""

from __future__ import annotations

import subprocess
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf

from core.stem_separation import separate_two_stems_for_transcription


def _write_mono_wav(path: Path, samples: int, sr: int = 22050) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    y = (np.random.randn(samples) * 0.01).astype(np.float32)
    sf.write(str(path), y, sr)


def test_separate_two_stems_stub_writes_vocal_and_accompaniment(tmp_path: Path) -> None:
    clean = tmp_path / "task_clean.wav"
    _write_mono_wav(clean, 800)
    out_dir = tmp_path / "outputs"
    tid = "abc123"

    vocal, acc = separate_two_stems_for_transcription(clean, tid, out_dir, backend="stub")

    assert vocal == (out_dir / f"{tid}.stem.vocal.wav").resolve()
    assert acc == (out_dir / f"{tid}.stem.accompaniment.wav").resolve()
    assert vocal.exists()
    assert acc.exists()

    v_data, v_sr = sf.read(str(vocal))
    a_data, a_sr = sf.read(str(acc))
    assert v_sr == a_sr == 22050
    assert v_data.shape == a_data.shape
    np.testing.assert_array_equal(a_data, np.zeros_like(a_data))

    u1 = clean.read_bytes()
    u2 = vocal.read_bytes()
    assert u1 == u2


def test_separate_two_stems_invalid_backend_raises(tmp_path: Path) -> None:
    clean = tmp_path / "c.wav"
    _write_mono_wav(clean, 50)
    with pytest.raises(ValueError, match="Invalid stem separation backend"):
        separate_two_stems_for_transcription(clean, "t1", tmp_path, backend="other")


def test_separate_two_stems_demucs_invokes_cli_and_writes_canonical_names(tmp_path: Path) -> None:
    """Demucs path without installing weights: mock subprocess and inject fake demucs module."""

    clean = tmp_path / "task_clean.wav"
    _write_mono_wav(clean, 400)
    out_dir = tmp_path / "outputs"
    tid = "task99"

    def fake_run(
        cmd: list,
        capture_output: bool = True,
        text: bool = True,
        timeout: float | None = None,
    ) -> subprocess.CompletedProcess:
        assert "demucs.separate" in cmd
        oi = cmd.index("-o")
        demucs_root = Path(cmd[oi + 1])
        ni = cmd.index("-n")
        model = cmd[ni + 1]
        assert model == "htdemucs_ft"
        track_dir = demucs_root / model / "h2s_in"
        track_dir.mkdir(parents=True, exist_ok=True)
        sf.write(str(track_dir / "vocals.wav"), np.ones(120, dtype=np.float32) * 0.1, 22050)
        sf.write(str(track_dir / "no_vocals.wav"), np.ones(120, dtype=np.float32) * 0.05, 22050)
        return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    fake_demucs = types.ModuleType("demucs")
    with patch.dict(sys.modules, {"demucs": fake_demucs}):
        with patch("core.stem_separation.subprocess.run", side_effect=fake_run):
            with patch("core.config.get_settings") as gs:
                gs.return_value = SimpleNamespace(
                    stem_separation_backend="stub",
                    demucs_model="htdemucs_ft",
                )
                vocal, acc = separate_two_stems_for_transcription(
                    clean,
                    tid,
                    out_dir,
                    backend="demucs",
                )

    assert vocal.name == f"{tid}.stem.vocal.wav"
    assert acc.name == f"{tid}.stem.accompaniment.wav"
    v_data, _ = sf.read(str(vocal))
    nv_data, _ = sf.read(str(acc))
    assert np.mean(v_data) > 0.05
    assert np.mean(nv_data) > 0.02


def test_separate_two_stems_demucs_nonzero_exit_raises(tmp_path: Path) -> None:
    clean = tmp_path / "task_clean.wav"
    _write_mono_wav(clean, 40)
    fake_demucs = types.ModuleType("demucs")

    def boom(*_a, **_k):
        return subprocess.CompletedProcess([], 1, stdout="", stderr="demucs failed xyz")

    with patch.dict(sys.modules, {"demucs": fake_demucs}):
        with patch("core.stem_separation.subprocess.run", side_effect=boom):
            with patch("core.config.get_settings") as gs:
                gs.return_value = SimpleNamespace(stem_separation_backend="stub", demucs_model="htdemucs_ft")
                with pytest.raises(RuntimeError, match="Demucs separation failed"):
                    separate_two_stems_for_transcription(
                        clean, "t2", tmp_path / "o", backend="demucs"
                    )


def test_config_stem_backend_normalized(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from core.config import Settings, get_settings

    monkeypatch.setenv("H2S_STEM_SEPARATION_BACKEND", "DEMUCS")
    get_settings.cache_clear()
    s = Settings()
    assert s.stem_separation_backend == "demucs"
    get_settings.cache_clear()
