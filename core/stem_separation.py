# core/stem_separation.py
"""
Experimental 2-stem separation seam for the transcription pipeline.

Backends (``H2S_STEM_SEPARATION_BACKEND`` when experimental flag is on):

- **stub**: copy clean wav → vocal; silent placeholder → accompaniment (no real DSP).
- **demucs**: real 2-stem separation via ``python -m demucs.separate --two-stems vocals``.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

# Demucs can be slow on CPU for long clips.
_DEMUCS_TIMEOUT_SEC = 900


def _wav_rms_peak(path: Path) -> tuple[float, float]:
    """RMS and max absolute sample over all channels/samples (float WAV)."""
    path = Path(path)
    data, _sr = sf.read(str(path), always_2d=True)
    if data.size == 0:
        return 0.0, 0.0
    x = np.asarray(data, dtype=np.float64).reshape(-1)
    rms = float(np.sqrt(np.mean(np.square(x))))
    peak = float(np.max(np.abs(x)))
    return rms, peak


def _log_stem_energy(task_id: str, role: str, path: Path) -> None:
    rms, peak = _wav_rms_peak(path)
    logger.info(
        "H2S [stem] energy task=%s role=%s rms=%.6f peak=%.6f file=%s",
        task_id,
        role,
        rms,
        peak,
        path.name,
    )


def _stem_output_paths(output_dir: Path, task_id: str) -> tuple[Path, Path]:
    output_dir = Path(output_dir)
    vocal_out = (output_dir / f"{task_id}.stem.vocal.wav").resolve()
    acc_out = (output_dir / f"{task_id}.stem.accompaniment.wav").resolve()
    return vocal_out, acc_out


def _separate_two_stems_stub(
    clean_wav_path: Path,
    task_id: str,
    output_dir: Path,
) -> tuple[Path, Path]:
    clean_wav_path = Path(clean_wav_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    vocal_out, acc_out = _stem_output_paths(output_dir, task_id)

    logger.warning(
        "H2S [stem] backend=stub (task=%s): vocal is a copy of clean wav; "
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
        "H2S [stem] stub wrote vocal=%s accompaniment=%s",
        vocal_out.name,
        acc_out.name,
    )
    _log_stem_energy(task_id, "input", clean_wav_path)
    _log_stem_energy(task_id, "vocal", vocal_out)
    _log_stem_energy(task_id, "acc", acc_out)
    return vocal_out, acc_out


def _find_demucs_stem_file(demucs_root: Path, filename: str) -> Path:
    hits = sorted(demucs_root.rglob(filename))
    if not hits:
        raise RuntimeError(
            f"Demucs finished but {filename!r} not found under {demucs_root}. "
            "Check Demucs logs / model output layout."
        )
    if len(hits) > 1:
        logger.warning(
            "H2S [stem] multiple %s files under %s; using %s",
            filename,
            demucs_root,
            hits[0],
        )
    return hits[0]


def _separate_two_stems_demucs(
    clean_wav_path: Path,
    task_id: str,
    output_dir: Path,
    model_name: str,
) -> tuple[Path, Path]:
    try:
        import demucs  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "Demucs separation requested (H2S_STEM_SEPARATION_BACKEND=demucs) but the "
            "'demucs' package is not installed. Install demucs (and PyTorch) or use backend=stub."
        ) from e

    clean_wav_path = Path(clean_wav_path).resolve()
    if not clean_wav_path.is_file():
        raise FileNotFoundError(f"Clean wav missing for Demucs: {clean_wav_path}")

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    vocal_out, acc_out = _stem_output_paths(output_dir, task_id)

    work = Path(tempfile.mkdtemp(prefix="h2s_demucs_"))
    try:
        in_wav = work / "h2s_in.wav"
        shutil.copy2(clean_wav_path, in_wav)
        demucs_out = work / "demucs_out"

        cmd = [
            sys.executable,
            "-m",
            "demucs.separate",
            "-n",
            model_name,
            "--two-stems=vocals",
            "-o",
            str(demucs_out),
            str(in_wav),
        ]
        logger.info(
            "H2S [stem] backend=demucs (task=%s model=%s): input_wav=%s subprocess=%s",
            task_id,
            model_name,
            str(clean_wav_path.resolve()),
            " ".join(cmd),
        )

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=_DEMUCS_TIMEOUT_SEC,
        )
        if proc.returncode != 0:
            tail = ""
            if proc.stderr:
                tail = proc.stderr.strip()[-6000:]
            elif proc.stdout:
                tail = proc.stdout.strip()[-6000:]
            raise RuntimeError(
                f"Demucs separation failed (exit={proc.returncode}) task={task_id}. "
                f"Last output:\n{tail}"
            )

        v_src = _find_demucs_stem_file(demucs_out, "vocals.wav")
        nv_src = _find_demucs_stem_file(demucs_out, "no_vocals.wav")

        shutil.copy2(v_src, vocal_out)
        shutil.copy2(nv_src, acc_out)

        logger.info(
            "H2S [stem] demucs OK (task=%s): vocal=%s accompaniment=%s (transcription uses vocal only)",
            task_id,
            vocal_out.name,
            acc_out.name,
        )
        _log_stem_energy(task_id, "input", clean_wav_path)
        _log_stem_energy(task_id, "vocal", vocal_out)
        _log_stem_energy(task_id, "acc", acc_out)
        return vocal_out, acc_out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def separate_two_stems_for_transcription(
    clean_wav_path: Path,
    task_id: str,
    output_dir: Path,
    *,
    backend: Optional[str] = None,
) -> tuple[Path, Path]:
    """
    Produce vocal + accompaniment WAV paths under ``output_dir``.

    ``clean_wav_path`` is the WAV passed to the separator (stub: transcription ``*_clean.wav``;
    Demucs: separation-prepared ``*_separation.wav`` from ``prepare_separation_input_audio``).

    ``backend`` overrides ``Settings.stem_separation_backend`` when set (tests).

    Predictable names:
        ``{output_dir}/{task_id}.stem.vocal.wav``
        ``{output_dir}/{task_id}.stem.accompaniment.wav``
    """
    from core.config import get_settings

    settings = get_settings()
    b = (backend if backend is not None else settings.stem_separation_backend).strip().lower()
    if b == "stub":
        return _separate_two_stems_stub(clean_wav_path, task_id, output_dir)
    if b == "demucs":
        return _separate_two_stems_demucs(
            clean_wav_path,
            task_id,
            output_dir,
            settings.demucs_model,
        )
    raise ValueError(
        f"Invalid stem separation backend {b!r}; expected 'stub' or 'demucs' "
        "(H2S_STEM_SEPARATION_BACKEND)."
    )
