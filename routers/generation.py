from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import UUID

import aiofiles
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from core.generation_service import generation_service
from core.models import FileType, Stage, TaskCreateResponse, TaskInfoResponse, TaskStatus
from core.task_manager import task_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Generation"])


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

    # Keep original extension for ffmpeg friendliness; fallback to ".wav"
    original_ext = (Path(file.filename).suffix or ".wav").lower()

    # Create task (queued)
    task_id = task_manager.create_task(stage=Stage.preprocessing)

    upload_dir = _resolve_upload_dir()
    input_path = (upload_dir / f"{task_id}{original_ext}").resolve()

    # Best-effort: settings.max_upload_size_mb else default 50MB
    max_mb = 50
    try:
        from core.config import get_settings  # type: ignore

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

        # Background processing (service owns state transitions)
        background_tasks.add_task(
            generation_service.process_task,
            UUID(str(task_id)),
            input_path,
            output_format,
        )

    except HTTPException:
        # Keep task consistent; input_path already cleaned by _save_upload_file on write failure
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
