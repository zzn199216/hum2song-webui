# core/pipeline.py
from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from core.config import get_settings
from core.utils import TaskManager, build_paths, safe_unlink

logger = logging.getLogger(__name__)

AudioFormat = Literal["mp3", "wav"]


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

    try:
        TaskManager.update_task(task_id, status="processing", progress=10, message="正在清洗音频...")

        # lazy import
        from core.audio_preprocess import preprocess_audio

        out_clean = preprocess_audio(raw_path, output_dir=settings.upload_dir)
        clean_wav_path = Path(out_clean)

        TaskManager.update_task(task_id, status="processing", progress=45, message="AI 正在听音记谱...")

        from core.ai_converter import audio_to_midi

        midi_path = audio_to_midi(clean_wav_path, output_dir=settings.output_dir)

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


# --- Adapter for GenerationService (expects Path-returning runner) ---
from pathlib import Path
from typing import Union

from core.config import get_settings

def run_pipeline(input_path: Union[str, Path], output_format: str = "mp3", gain: float = 0.8, keep_wav: bool = False) -> Path:
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
        output_format=output_format,
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
