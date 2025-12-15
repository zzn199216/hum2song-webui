from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional
from uuid import UUID

import aiofiles
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

# --- New contract stack ---
from core.generation_service import generation_service
from core.models import FileType, Stage, TaskCreateResponse, TaskInfoResponse, TaskStatus
from core.task_manager import task_manager

logger = logging.getLogger(__name__)

# -------------------------------------------------------------------
# Export get_settings at module level (legacy tests monkeypatch this)
# -------------------------------------------------------------------
try:
    from core.config import get_settings as get_settings  # type: ignore
except Exception:  # pragma: no cover
    def get_settings():  # type: ignore
        raise RuntimeError("core.config.get_settings is not available")

# -------------------------------------------------------------------
# Legacy stack (only used by /api/v1 compatibility routes & old tests)
# -------------------------------------------------------------------
try:
    from core.utils import TaskManager as LegacyTaskManager, build_paths, safe_unlink  # type: ignore
except Exception:  # pragma: no cover
    LegacyTaskManager = None  # type: ignore
    build_paths = None  # type: ignore
    safe_unlink = None  # type: ignore

try:
    from core.pipeline import run_pipeline_for_task as _legacy_run_pipeline_for_task  # type: ignore
except Exception:  # pragma: no cover
    _legacy_run_pipeline_for_task = None  # type: ignore

AudioFormat = Literal["mp3", "wav"]
DownloadKind = Literal["audio", "midi"]

# Main router: NEW contract endpoints (no prefix)
router = APIRouter(tags=["Generation"])

# Legacy router: OLD endpoints (prefix=/api/v1) for backward compatibility tests
legacy_router = APIRouter(prefix="/api/v1", tags=["GenerationLegacy"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _resolve_upload_dir() -> Path:
    upload_dir = generation_service.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def _safe_unlink(p: Path) -> None:
    try:
        if p.exists():
            p.unlink()
    except Exception:
        pass


def _guess_media_type(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".mp3":
        return "audio/mpeg"
    if suf == ".wav":
        return "audio/wav"
    if suf in (".mid", ".midi"):
        return "audio/midi"
    return "application/octet-stream"


async def _save_upload_file(upload_file: UploadFile, dst_path: Path, *, max_mb: int) -> int:
    """
    Async chunk write + size limit (no full file read into memory).
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
                        detail=f"File too large: {total/1024/1024:.2f}MB > {max_mb}MB",
                    )
                await f.write(chunk)
    except Exception:
        _safe_unlink(dst_path)
        raise
    finally:
        try:
            await upload_file.close()
        except Exception:
            pass

    return total


# ===================================================================
# NEW Contract Endpoints
# ===================================================================

@router.post(
    "/generate",
    response_model=TaskCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a generation task",
)
async def generate_music(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    output_format: str = Query("mp3", pattern="^(mp3|wav)$"),
) -> TaskCreateResponse:
    """
    Contract: 202 Accepted -> TaskCreateResponse
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")

    original_ext = (Path(file.filename).suffix or ".wav").lower()

    task_id = task_manager.create_task(stage=Stage.preprocessing)

    upload_dir = _resolve_upload_dir()
    input_path = (upload_dir / f"{task_id}{original_ext}").resolve()

    max_mb = 50
    try:
        s = get_settings()
        max_mb = int(getattr(s, "max_upload_size_mb", max_mb))
    except Exception:
        pass

    try:
        written = await _save_upload_file(file, input_path, max_mb=max_mb)
        if written <= 0:
            task_manager.mark_failed(task_id, message="Empty file", stage=Stage.preprocessing)
            _safe_unlink(input_path)
            raise HTTPException(status_code=400, detail="File is empty")

        logger.info("Task[%s] uploaded (%d bytes) -> %s", task_id, written, input_path.name)

        background_tasks.add_task(
            generation_service.process_task,
            UUID(str(task_id)),
            input_path,
            output_format,
        )

    except HTTPException:
        try:
            task_manager.mark_failed(task_id, message="Upload rejected", stage=Stage.preprocessing)
        except Exception:
            pass
        raise
    except Exception as e:
        _safe_unlink(input_path)
        try:
            task_manager.mark_failed(task_id, message=f"Upload failed: {e}", stage=Stage.preprocessing)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Internal Server Error during upload")

    return TaskCreateResponse(
        task_id=task_id,
        status=TaskStatus.queued,
        poll_url=f"/tasks/{task_id}",
        created_at=_utcnow(),
    )


@router.get(
    "/tasks/{task_id}",
    response_model=TaskInfoResponse,
    summary="Poll task status",
)
def get_task_status(task_id: str) -> TaskInfoResponse:
    """
    Contract: 200 OK / 404 Not Found
    """
    try:
        return task_manager.get_task_info(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Task not found")


@router.get(
    "/tasks/{task_id}/download",
    summary="Download artifact",
)
def download_artifact(
    task_id: str,
    file_type: str = Query(..., description="file_type (audio, midi)"),
):
    """
    Contract:
    - 200: file stream
    - 400: invalid file_type
    - 404: task not found OR artifact missing on disk
    - 409: task not completed OR requested file_type unavailable
    """
    try:
        ft = FileType(file_type)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file_type")

    try:
        path = task_manager.get_artifact_path(task_id, ft)
        return FileResponse(
            path=str(path),
            filename=path.name,
            media_type=_guess_media_type(path),
        )
    except RuntimeError:
        raise HTTPException(status_code=409, detail="Task not completed or file_type unavailable")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Artifact missing")
    except KeyError as e:
        msg = str(e)
        if "Task not found" in msg or "Invalid UUID format" in msg:
            raise HTTPException(status_code=404, detail="Task not found")
        raise HTTPException(status_code=409, detail="Task not completed or file_type unavailable")


# ===================================================================
# LEGACY Compatibility Endpoints (/api/v1) for old tests
# ===================================================================

def _run_pipeline_sync(
    task_id: str,
    input_filename: str,
    output_format: AudioFormat = "mp3",
    gain: float = 0.8,
    keep_wav: bool = False,
    cleanup_uploads: bool = True,
    base_api_prefix: str = "/api/v1",
) -> None:
    """
    Legacy patch point: old tests patch routers.generation._run_pipeline_sync.
    If not patched, we best-effort call legacy pipeline entry.
    """
    if _legacy_run_pipeline_for_task is None:
        raise RuntimeError("Legacy pipeline entry (run_pipeline_for_task) is not available")
    _legacy_run_pipeline_for_task(
        task_id=task_id,
        input_filename=input_filename,
        output_format=output_format,
        gain=gain,
        keep_wav=keep_wav,
        cleanup_uploads=cleanup_uploads,
        base_api_prefix=base_api_prefix,
    )


@legacy_router.post("/generate")
async def legacy_start_generation(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    output_format: AudioFormat = Query("mp3"),
    gain: float = Query(0.8, ge=0.0, le=5.0),
    keep_clean_wav: bool = Query(False),
    cleanup_uploads: bool = Query(True),
):
    """
    Legacy response shape for old tests.
    """
    if LegacyTaskManager is None or build_paths is None:
        raise HTTPException(status_code=500, detail="Legacy TaskManager/build_paths not available")

    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    settings = get_settings()
    task_id = LegacyTaskManager.create_task(file.filename)

    paths = build_paths(task_id, file.filename)
    raw_path: Path = paths["raw_audio"]

    try:
        await _save_upload_file(file, raw_path, max_mb=int(settings.max_upload_size_mb))
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
        LegacyTaskManager.fail_task(task_id, str(e.detail))
        if safe_unlink:
            safe_unlink(raw_path)
        raise
    except Exception as e:
        LegacyTaskManager.fail_task(task_id, f"Upload error: {e}")
        if safe_unlink:
            safe_unlink(raw_path)
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")


@legacy_router.get("/tasks/{task_id}")
def legacy_get_task(task_id: str):
    if LegacyTaskManager is None:
        raise HTTPException(status_code=500, detail="Legacy TaskManager not available")
    task = LegacyTaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return task


@legacy_router.get("/tasks/{task_id}/download")
def legacy_download(task_id: str, kind: DownloadKind = Query("audio")):
    if LegacyTaskManager is None:
        raise HTTPException(status_code=500, detail="Legacy TaskManager not available")

    task = LegacyTaskManager.get_task(task_id)
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

    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=_guess_media_type(file_path),
    )


# Mount legacy routes under main router
router.include_router(legacy_router)
