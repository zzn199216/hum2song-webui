# core/stem_separation.py
"""
Experimental 2-stem separation seam for the transcription pipeline.

When no real separator is wired, the stub writes predictable artifacts for
inspection and routes transcription through a dedicated vocal WAV path.

Real DSP (e.g. Demucs) can replace the implementation behind the same entry point.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


def separate_two_stems_for_transcription(
    clean_wav_path: Path,
    task_id: str,
    output_dir: Path,
) -> tuple[Path, Path]:
    """
    Produce vocal + accompaniment WAV paths under ``output_dir``.

    Current behavior (**stub**): integration seam only — not real source separation.
    - **Vocal**: byte copy of ``clean_wav_path`` (transcription input matches the
      clean mix; used to validate plumbing and file layout).
    - **Accompaniment**: silence, same sample rate / channels / length as the
      vocal file (placeholder stem file for debugging).

    Returns:
        (vocal_wav_path, accompaniment_wav_path)

    Predictable names:
        ``{output_dir}/{task_id}.stem.vocal.wav``
        ``{output_dir}/{task_id}.stem.accompaniment.wav``
    """
    clean_wav_path = Path(clean_wav_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    vocal_out = (output_dir / f"{task_id}.stem.vocal.wav").resolve()
    acc_out = (output_dir / f"{task_id}.stem.accompaniment.wav").resolve()

    logger.warning(
        "H2S [stem] STUB separation (task=%s): vocal is a copy of clean wav; "
        "accompaniment is silent placeholder — not real DSP.",
        task_id,
    )

    shutil.copy2(clean_wav_path, vocal_out)

    info = sf.info(str(vocal_out))
    n = int(info.frames)
    ch = int(info.channels)
    sr = int(info.samplerate)
    if ch <= 1:
        silence = np.zeros(n, dtype=np.float32)
    else:
        silence = np.zeros((n, ch), dtype=np.float32)
    sf.write(str(acc_out), silence, sr)

    logger.info(
        "H2S [stem] wrote vocal=%s accompaniment=%s (transcription should use vocal only)",
        vocal_out.name,
        acc_out.name,
    )
    return vocal_out, acc_out
