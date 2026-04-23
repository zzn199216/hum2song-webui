# core/pipeline.py
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Literal, Optional, Union

from core.config import get_settings
from core.task_manager import task_manager as contract_task_manager
from core.utils import TaskManager, build_paths, safe_unlink

logger = logging.getLogger(__name__)

AudioFormat = Literal["mp3", "wav"]


def _ensure_taskid_midi(task_id: str, midi_path: Union[str, Path], output_dir: Union[str, Path]) -> Path:
    """
    Ensure a stable, canonical MIDI artifact exists at:
        <output_dir>/<task_id>.mid

    Returns the canonical midi path.

    Behavior:
    - If midi_path is already canonical -> return it.
    - Else copy/move to canonical path (best-effort).
    - If canonical still missing -> raise FileNotFoundError.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    src = Path(midi_path)
    canonical = (out_dir / f"{task_id}.mid").resolve()

    if src.resolve() == canonical:
        if not canonical.exists():
            raise FileNotFoundError(f"Canonical MIDI path expected but missing: {canonical}")
        return canonical

    if not src.exists():
        raise FileNotFoundError(f"MIDI path returned by converter does not exist: {src}")

    canonical.parent.mkdir(parents=True, exist_ok=True)

    # Prefer move if src is inside output_dir; else copy.
    try:
        src_parent = src.resolve().parent
        if src_parent == out_dir.resolve():
            # rename/move within the same dir
            shutil.move(str(src), str(canonical))
        else:
            shutil.copy2(str(src), str(canonical))
    except Exception:
        # Last resort: bytes copy
        canonical.write_bytes(src.read_bytes())

    if not canonical.exists():
        raise FileNotFoundError(f"Failed to materialize canonical MIDI: {canonical}")

    return canonical


def run_pipeline_for_task(
    task_id: str,
    input_filename: str,
    output_format: AudioFormat = "mp3",
    gain: float = 0.8,
    keep_wav: bool = False,
    cleanup_uploads: bool = True,
    base_api_prefix: str = "/api/v1",
) -> None:
    """
    给 Router/EXE/CLI 复用的核心流水线入口（同步函数，适合 BackgroundTasks 调用）
    """
    settings = get_settings()
    paths = build_paths(task_id, input_filename)

    raw_path: Path = paths["raw_audio"]
    clean_wav_path: Path = paths["clean_wav"]
    separation_input_path: Optional[Path] = None

    try:
        TaskManager.update_task(task_id, status="processing", progress=10, message="正在清洗音频...")

        # lazy import
        from core.audio_preprocess import preprocess_audio, prepare_separation_input_audio

        out_clean = preprocess_audio(raw_path, output_dir=settings.upload_dir)
        clean_wav_path = Path(out_clean)

        stem_requested = contract_task_manager.get_request_two_stem_separation(task_id)

        if stem_requested:
            from core.ai_converter import audio_to_midi
            from core.score_convert import midi_to_score, score_to_midi
            from core.score_models import normalize_score
            from core.stem_score_merge import merge_vocal_and_music_scores
            from core.stem_separation import separate_two_stems_for_transcription

            stem_backend = getattr(settings, "stem_separation_backend", "stub")
            if stem_backend == "demucs":
                separation_input_path = prepare_separation_input_audio(
                    raw_path, settings.upload_dir, task_id
                )
                stem_input_wav = separation_input_path
                logger.info(
                    "H2S [stem] backend=demucs (task=%s): Demucs input is separation-prepared wav "
                    "(stereo 44.1kHz, not transcription *_clean.wav): %s",
                    task_id,
                    stem_input_wav.resolve(),
                )
            else:
                stem_input_wav = clean_wav_path
                logger.info(
                    "H2S [stem] backend=stub (task=%s): stem seam uses transcription clean wav: %s",
                    task_id,
                    stem_input_wav.resolve(),
                )

            logger.info(
                "H2S [stem] task requested vocal separation (task=%s): "
                "seam backend=%s; transcribing vocal + accompaniment, merging to dual-track score.",
                task_id,
                stem_backend,
            )
            vocal_path, acc_path = separate_two_stems_for_transcription(
                stem_input_wav,
                task_id,
                settings.output_dir,
            )

            TaskManager.update_task(task_id, status="processing", progress=40, message="AI 正在听音记谱 (vocal)...")
            midi_v = audio_to_midi(vocal_path, output_dir=settings.output_dir)
            TaskManager.update_task(task_id, status="processing", progress=50, message="AI 正在听音记谱 (music)...")
            midi_m = audio_to_midi(acc_path, output_dir=settings.output_dir)

            sv = normalize_score(midi_to_score(Path(midi_v)))
            sm = normalize_score(midi_to_score(Path(midi_m)))
            merged = merge_vocal_and_music_scores(sv, sm)

            out_dir = Path(settings.output_dir)
            score_json_path = (out_dir / f"{task_id}.score.json").resolve()
            try:
                score_json_path.write_text(merged.model_dump_json(indent=2), encoding="utf-8")
            except Exception as e:
                logger.warning("H2S [stem] failed to cache score json: %s", e)

            merged_midi = (out_dir / f"{task_id}.mid").resolve()
            score_to_midi(merged, merged_midi)
            midi_path = _ensure_taskid_midi(task_id, merged_midi, settings.output_dir)
            logger.info(
                "H2S [stem] dual transcription merged: tracks=%s",
                [t.name for t in merged.tracks],
            )
        else:
            logger.debug(
                "H2S [stem] no vocal separation for task=%s (transcription uses clean wav).",
                task_id,
            )

            TaskManager.update_task(task_id, status="processing", progress=45, message="AI 正在听音记谱...")

            from core.ai_converter import audio_to_midi

            midi_path = audio_to_midi(clean_wav_path, output_dir=settings.output_dir)

            # ✅ 强制 MIDI 产物命名/落盘一致性：outputs/{task_id}.mid
            midi_path = _ensure_taskid_midi(task_id, midi_path, settings.output_dir)

        TaskManager.update_task(task_id, status="processing", progress=80, message="正在合成乐器音频...")

        from core.synthesizer import midi_to_audio

        audio_path = midi_to_audio(
            midi_path,
            output_dir=settings.output_dir,
            output_format=output_format,
            keep_wav=False,   # 合成阶段的临时 wav 是否保留，交给 synthesizer 自己处理
            gain=gain,
        )

        TaskManager.done_task(
            task_id,
            result={
                "audio": str(Path(audio_path).resolve()),
                "midi": str(Path(midi_path).resolve()),
                "output_format": output_format,
                "download_audio_url": f"{base_api_prefix}/tasks/{task_id}/download?kind=audio",
                "download_midi_url": f"{base_api_prefix}/tasks/{task_id}/download?kind=midi",
            },
        )

    except Exception as e:
        logger.exception("Task[%s] pipeline failed", task_id)
        TaskManager.fail_task(task_id, str(e))

    finally:
        # ✅ 修复 keep_wav 与 cleanup_uploads 冲突：
        # raw 上传文件一般可删；clean_wav 是否删由 keep_wav 决定
        if cleanup_uploads:
            safe_unlink(raw_path)
            if not keep_wav:
                safe_unlink(clean_wav_path)
                if separation_input_path is not None:
                    safe_unlink(separation_input_path)


# --- Adapter for GenerationService (expects Path-returning runner) ---
def run_pipeline(
    input_path: Union[str, Path],
    output_format: str = "mp3",
    gain: float = 0.8,
    keep_wav: bool = False,
) -> Path:
    """
    GenerationService adapter:
    input: a local file path (usually uploads/{task_id}.wav)
    output: final audio path (mp3/wav)
    """
    p = Path(input_path)
    s = get_settings()

    # 保证文件在 upload_dir（你的旧 pipeline 大概率按 filename + upload_dir 找）
    upload_dir = Path(s.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    if p.parent.resolve() != upload_dir.resolve():
        dst = upload_dir / p.name
        dst.write_bytes(p.read_bytes())
        p = dst

    task_id = p.stem

    # 复用你现有的 task-based pipeline
    run_pipeline_for_task(
        task_id=str(task_id),
        input_filename=p.name,
        output_format=output_format,  # type: ignore[arg-type]
        gain=gain,
        keep_wav=keep_wav,
        cleanup_uploads=False,     # 交给 GenerationService 去清理
        base_api_prefix="",        # 这里不需要 URL
    )

    out_dir = Path(s.output_dir)

    # 优先按 output_format 找
    preferred = out_dir / f"{task_id}.{output_format}"
    if preferred.exists():
        return preferred

    # 兜底：找 mp3/wav
    for ext in ("mp3", "wav"):
        cand = out_dir / f"{task_id}.{ext}"
        if cand.exists():
            return cand

    raise FileNotFoundError(f"Pipeline produced no audio artifact for task {task_id} in {out_dir}")
