# routers/generation.py
"""
Generation Router (Step 07)

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
from core.pipeline import run_pipeline_for_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["Generation"])

AudioFormat = Literal["mp3", "wav"]
DownloadKind = Literal["audio", "midi"]


async def _save_upload_file(upload_file: UploadFile, dst_path: Path, max_mb: int) -> int:
    """
    chunk 写入 + 大小限制（不把整文件读进内存）
    """
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


def _run_pipeline_sync(
    task_id: str,
    input_filename: str,
    output_format: AudioFormat,
    gain: float,
    keep_wav: bool = False,
    cleanup_uploads: bool = True,
) -> None:
    """
    ✅ 兼容旧测试的函数名：tests/test_routers.py 里会 patch 这个符号。
    内部仅转调 pipeline，路由层仍不耦合 preprocess/ai/synth 细节。
    """
    run_pipeline_for_task(
        task_id=task_id,
        input_filename=input_filename,
        output_format=output_format,
        gain=gain,
        keep_wav=keep_wav,
        cleanup_uploads=cleanup_uploads,
        base_api_prefix="/api/v1",
    )


@router.post("/generate")
async def start_generation(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    output_format: AudioFormat = Query("mp3"),
    gain: float = Query(0.8, ge=0.0, le=5.0),
    # 调试参数
    keep_clean_wav: bool = Query(False),
    cleanup_uploads: bool = Query(True),
):
    settings = get_settings()

    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 1. 创建任务
    task_id = TaskManager.create_task(file.filename)
    paths = build_paths(task_id, file.filename)
    raw_path: Path = paths["raw_audio"]

    TaskManager.update_task(task_id, status="processing", progress=2, message="开始上传...")

    try:
        # 2. 接收文件 (Web 层职责)
        written = await _save_upload_file(file, raw_path, settings.max_upload_size_mb)
        logger.info("Task[%s] uploaded (%d bytes) -> %s", task_id, written, raw_path.name)

        # 3. 丢给后台执行（通过兼容壳函数名，保持旧测试可 patch）
        background_tasks.add_task(
            _run_pipeline_sync,
            task_id,
            file.filename,
            output_format,
            gain,
            keep_clean_wav,
            cleanup_uploads,
        )

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

    filename = file_path.name
    if kind == "midi":
        media_type = "audio/midi"
    else:
        media_type = "audio/wav" if filename.lower().endswith(".wav") else "audio/mpeg"

    return FileResponse(str(file_path), media_type=media_type, filename=filename)
