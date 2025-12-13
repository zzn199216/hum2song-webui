"""
生成业务路由 (Step 07)

功能：
1) POST /generate: 流式接收录音 -> 落盘 -> 立即返回 task_id -> 后台启动流水线
2) GET  /tasks/{id}: 轮询任务状态
3) GET  /tasks/{id}/download: 下载 audio 或 midi
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

import aiofiles
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from core.config import get_settings
from core.utils import TaskManager, build_paths, safe_unlink

from core.audio_preprocess import preprocess_audio
from core.ai_converter import audio_to_midi
from core.synthesizer import midi_to_audio

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

router = APIRouter(prefix="/api/v1", tags=["Generation"])

AudioFormat = Literal["mp3", "wav"]
DownloadKind = Literal["audio", "midi"]


async def _save_upload_file(upload_file: UploadFile, dst_path: Path, max_mb: int) -> int:
    """chunk 写入 + 大小限制（不把整文件读进内存）"""
    dst_path.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    limit = max_mb * 1024 * 1024
    chunk_size = 1024 * 1024  # 1MB

    try:
        async with aiofiles.open(dst_path, "wb") as f:
            while True:
                chunk = await upload_file.read(chunk_size)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise HTTPException(
                        status_code=413,
                        detail=f"文件过大: {total/1024/1024:.2f}MB > {max_mb}MB",
                    )
                await f.write(chunk)
    except Exception:
        safe_unlink(dst_path)
        raise
    finally:
        await upload_file.close()

    return total


def _run_pipeline_sync(task_id: str, input_filename: str, output_format: AudioFormat, gain: float) -> None:
    """
    后台流水线（同步函数！供 BackgroundTasks 调用）
    """
    settings = get_settings()

    paths = build_paths(task_id, input_filename)
    raw_path: Path = paths["raw_audio"]
    clean_wav_path: Path = paths["clean_wav"]
    midi_path: Path = paths["midi"]

    try:
        TaskManager.update_task(task_id, status="processing", progress=10, message="正在清洗音频...")

        # Step02: raw -> clean.wav  (preprocess_audio 返回 Path)
        out_clean = preprocess_audio(raw_path, output_dir=raw_path.parent)
        if out_clean.resolve() != clean_wav_path.resolve():
            clean_wav_path = out_clean

        TaskManager.update_task(task_id, status="processing", progress=45, message="AI正在听音记谱...")

        # Step03: clean.wav -> .mid  (audio_to_midi 返回 Path)
        out_midi = audio_to_midi(clean_wav_path, output_dir=settings.output_dir)
        if out_midi.resolve() != midi_path.resolve():
            midi_path = out_midi

        TaskManager.update_task(task_id, status="processing", progress=80, message="正在合成乐器音频...")

        # Step05: .mid -> mp3/wav  (midi_to_audio 返回 Path)
        out_audio = midi_to_audio(
            midi_path,
            output_dir=settings.output_dir,
            output_format=output_format,
            keep_wav=False,
            gain=gain,
        )

        TaskManager.done_task(
            task_id,
            result={
                "audio": str(out_audio),
                "midi": str(midi_path),
                "output_format": output_format,
                "download_audio_url": f"/api/v1/tasks/{task_id}/download?kind=audio",
                "download_midi_url": f"/api/v1/tasks/{task_id}/download?kind=midi",
            },
        )
        logger.info("✅ Task[%s] done", task_id)

    except Exception as e:
        logger.exception("❌ Task[%s] failed", task_id)
        TaskManager.fail_task(task_id, str(e))

    finally:
        # MVP：至少清理 uploads 中的中间物
        safe_unlink(raw_path)
        safe_unlink(clean_wav_path)


@router.post("/generate")
async def start_generation(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    output_format: AudioFormat = Query("mp3"),
    gain: float = Query(0.8, ge=0.0, le=5.0),
):
    settings = get_settings()

    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    task_id = TaskManager.create_task(file.filename)
    paths = build_paths(task_id, file.filename)
    raw_path: Path = paths["raw_audio"]

    TaskManager.update_task(task_id, status="processing", progress=2, message="开始上传...")

    try:
        written = await _save_upload_file(file, raw_path, settings.max_upload_size_mb)
        logger.info("Task[%s] uploaded %s (%d bytes)", task_id, file.filename, written)

        # 关键：add_task 放同步函数
        background_tasks.add_task(_run_pipeline_sync, task_id, file.filename, output_format, gain)

        return {
            "task_id": task_id,
            "status": "pending",
            "message": "任务已接收，后台处理中",
            "poll_url": f"/api/v1/tasks/{task_id}",
        }

    except HTTPException as e:
        TaskManager.fail_task(task_id, str(e.detail))
        safe_unlink(raw_path)
        raise
    except Exception as e:
        TaskManager.fail_task(task_id, f"Upload error: {e}")
        safe_unlink(raw_path)
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")


@router.get("/tasks/{task_id}")
def get_task_status(task_id: str):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return task


@router.get("/tasks/{task_id}/download")
def download_result(
    task_id: str,
    kind: DownloadKind = Query("audio"),
):
    settings = get_settings()

    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    if task.get("status") != "done":
        raise HTTPException(status_code=409, detail=f"任务尚未完成，当前状态: {task.get('status')}")

    result = task.get("result") or {}
    path_str = result.get("audio") if kind == "audio" else result.get("midi")
    if not path_str:
        raise HTTPException(status_code=404, detail="文件记录丢失")

    file_path = Path(path_str)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件已过期或物理丢失")

    if kind == "midi":
        media_type = "audio/midi"
    else:
        media_type = "audio/mpeg" if file_path.suffix.lower() == ".mp3" else "audio/wav"

    return FileResponse(str(file_path), media_type=media_type, filename=file_path.name)
