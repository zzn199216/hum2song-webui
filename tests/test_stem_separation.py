"""Unit tests for experimental 2-stem separation seam (stub)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from core.stem_separation import separate_two_stems_for_transcription


def _write_mono_wav(path: Path, samples: int, sr: int = 22050) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    y = (np.random.randn(samples) * 0.01).astype(np.float32)
    sf.write(str(path), y, sr)


def test_separate_two_stems_writes_vocal_and_accompaniment(tmp_path: Path) -> None:
    clean = tmp_path / "task_clean.wav"
    _write_mono_wav(clean, 800)
    out_dir = tmp_path / "outputs"
    tid = "abc123"

    vocal, acc = separate_two_stems_for_transcription(clean, tid, out_dir)

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
