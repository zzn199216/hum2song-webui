from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Dict, Optional, Union
from uuid import UUID, uuid4

from core.models import (
    FileType,
    OutputFormat,
    Stage,
    TaskError,
    TaskInfoResponse,
    TaskResult,
    TaskStatus,
)


def _utcnow() -> datetime:
    """Helper for strictly UTC aware datetime."""
    return datetime.now(timezone.utc)


def _ensure_uuid(task_id: Union[str, UUID]) -> UUID:
    """Helper to handle both str and UUID input."""
    if isinstance(task_id, UUID):
        return task_id
    try:
        return UUID(str(task_id))
    except ValueError as e:
        # input invalid; let router map this to 404 or 422 depending on how you type it there
        raise KeyError(f"Invalid UUID format: {task_id}") from e


def _infer_output_format_from_path(p: Path) -> OutputFormat:
    """Helper to guess format from extension."""
    suf = p.suffix.lower()
    if suf == ".mp3":
        return OutputFormat.mp3
    if suf == ".wav":
        return OutputFormat.wav
    if suf in (".mid", ".midi"):
        return OutputFormat.mid
    # Default fallback (audio)
    return OutputFormat.mp3


@dataclass
class _TaskRecord:
    """
    内部存储结构 (Internal State)。
    包含 API 契约字段 + 服务器内部字段（如文件绝对路径）。
    """
    task_id: UUID
    status: TaskStatus
    progress: float
    stage: Stage
    created_at: datetime
    updated_at: datetime
    result: Optional[TaskResult] = None
    error: Optional[TaskError] = None

    # Internal only: mapping FileType -> Local Absolute Path
    artifact_paths: Dict[FileType, str] = field(default_factory=dict)


class TaskManager:
    """
    In-memory task store with Contract enforcement.
    Acts as the 'Enforcer' between raw data and Pydantic models.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._tasks: Dict[UUID, _TaskRecord] = {}

    # ----------------------------
    # Core helpers
    # ----------------------------
    def _get_record_locked(self, tid: UUID) -> _TaskRecord:
        if tid not in self._tasks:
            raise KeyError(f"Task not found: {tid}")
        return self._tasks[tid]

    @staticmethod
    def _is_finalized(status: TaskStatus) -> bool:
        return status in (TaskStatus.completed, TaskStatus.failed)

    # ----------------------------
    # Read Methods
    # ----------------------------
    def exists(self, task_id: Union[str, UUID]) -> bool:
        try:
            tid = _ensure_uuid(task_id)
        except KeyError:
            return False
        with self._lock:
            return tid in self._tasks

    def get_task_info(self, task_id: Union[str, UUID]) -> TaskInfoResponse:
        """
        Public API: Returns the Contract Model (TaskInfoResponse).
        Hides internal details like file paths.
        """
        tid = _ensure_uuid(task_id)
        with self._lock:
            rec = self._get_record_locked(tid)

            return TaskInfoResponse(
                task_id=rec.task_id,
                status=rec.status,
                progress=rec.progress,
                stage=rec.stage,
                created_at=rec.created_at,
                updated_at=rec.updated_at,
                result=rec.result,
                error=rec.error,
            )

    def get_artifact_path(self, task_id: Union[str, UUID], file_type: FileType) -> Path:
        """
        Internal API: Used by Download Router to find physical file.

        Error semantics (recommended mapping):
        - KeyError("Task not found") -> 404
        - RuntimeError("Task not completed") -> 409
        - KeyError("Artifact not available") -> 409
        - FileNotFoundError -> 404
        """
        tid = _ensure_uuid(task_id)
        with self._lock:
            rec = self._get_record_locked(tid)

            if rec.status != TaskStatus.completed:
                raise RuntimeError(f"Task not completed: {tid} status={rec.status}")

            path_str = rec.artifact_paths.get(file_type)
            if not path_str:
                raise KeyError(f"Artifact not available: file_type={file_type.value} task_id={tid}")

        # Check disk existence outside lock
        p = Path(path_str)
        if not p.exists():
            raise FileNotFoundError(f"Artifact file missing on disk: {p}")
        return p

    # ----------------------------
    # Write Methods (Mutations)
    # ----------------------------
    def create_task(self, *, stage: Stage = Stage.preprocessing) -> UUID:
        now = _utcnow()
        tid = uuid4()

        rec = _TaskRecord(
            task_id=tid,
            status=TaskStatus.queued,
            progress=0.0,
            stage=stage,
            created_at=now,
            updated_at=now,
            result=None,
            error=None,
        )

        with self._lock:
            self._tasks[tid] = rec
        return tid

    def mark_running(self, task_id: Union[str, UUID], *, stage: Optional[Stage] = None) -> None:
        tid = _ensure_uuid(task_id)
        with self._lock:
            rec = self._get_record_locked(tid)
            if self._is_finalized(rec.status):
                raise RuntimeError(f"Cannot mark_running(): task already finalized: {tid} status={rec.status}")

            rec.status = TaskStatus.running
            if stage is not None:
                rec.stage = stage
            rec.updated_at = _utcnow()

    def update_progress(
        self,
        task_id: Union[str, UUID],
        *,
        progress: float,
        stage: Optional[Stage] = None,
    ) -> None:
        """
        Updates task progress in RUNNING state.

        Strict rules:
        - progress must be within [0.0, 1.0] else ValueError
        - finalized tasks cannot be updated
        - if task is queued, it becomes running on first update
        """
        if not (0.0 <= progress <= 1.0):
            raise ValueError("progress must be within [0.0, 1.0]")

        tid = _ensure_uuid(task_id)
        with self._lock:
            rec = self._get_record_locked(tid)
            if self._is_finalized(rec.status):
                raise RuntimeError(f"Cannot update_progress(): task already finalized: {tid} status={rec.status}")

            if rec.status == TaskStatus.queued:
                rec.status = TaskStatus.running

            rec.progress = float(progress)
            if stage is not None:
                rec.stage = stage
            rec.updated_at = _utcnow()

    def mark_completed(
        self,
        task_id: Union[str, UUID],
        *,
        artifact_path: Union[str, Path],
        file_type: FileType = FileType.audio,
        output_format: Optional[OutputFormat] = None,
        filename: Optional[str] = None,
    ) -> None:
        """
        Finalizes task as COMPLETED.
        - infers output_format (if not provided)
        - generates download_url (contract)
        - stores internal absolute path mapping
        """
        tid = _ensure_uuid(task_id)

        p = Path(artifact_path).expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(f"artifact_path does not exist: {p}")

        fmt = output_format or _infer_output_format_from_path(p)
        name = filename or p.name

        download_url = f"/tasks/{tid}/download?file_type={file_type.value}"

        # Validated by Pydantic model (consistency rules)
        result = TaskResult(
            file_type=file_type,
            output_format=fmt,
            filename=name,
            download_url=download_url,
        )

        with self._lock:
            rec = self._get_record_locked(tid)
            if self._is_finalized(rec.status):
                raise RuntimeError(f"Cannot mark_completed(): task already finalized: {tid} status={rec.status}")

            rec.status = TaskStatus.completed
            rec.progress = 1.0
            rec.stage = Stage.finalizing
            rec.result = result
            rec.error = None
            rec.artifact_paths[file_type] = str(p)
            rec.updated_at = _utcnow()

    def mark_failed(
        self,
        task_id: Union[str, UUID],
        *,
        message: str,
        trace_id: Optional[str] = None,
        stage: Optional[Stage] = None,
    ) -> None:
        """
        Finalizes task as FAILED.
        """
        tid = _ensure_uuid(task_id)
        err = TaskError(message=message, trace_id=trace_id)

        with self._lock:
            rec = self._get_record_locked(tid)
            if self._is_finalized(rec.status):
                raise RuntimeError(f"Cannot mark_failed(): task already finalized: {tid} status={rec.status}")

            rec.status = TaskStatus.failed
            if stage is not None:
                rec.stage = stage
            rec.result = None
            rec.error = err
            rec.updated_at = _utcnow()

    def prune(self, *, max_age_seconds: int = 3600) -> int:
        """
        Maintenance: Remove old tasks to prevent memory leaks.
        """
        now = _utcnow()
        removed = 0
        with self._lock:
            to_del = []
            for tid, rec in self._tasks.items():
                age = (now - rec.updated_at).total_seconds()
                if age > max_age_seconds:
                    to_del.append(tid)

            for tid in to_del:
                del self._tasks[tid]
                removed += 1
        return removed
    
    def attach_artifact(
        self,
        task_id: Union[str, UUID],
        *,
        artifact_path: Union[str, Path],
        file_type: FileType,
    ) -> None:
        """
        Attach/overwrite an artifact path for an ALREADY COMPLETED task.
        Used for:
        - adding midi after audio
        - re-rendering audio after score edits

        Error semantics:
        - task not found -> KeyError
        - task not completed -> RuntimeError (409)
        - artifact_path missing -> FileNotFoundError (404)
        """
        tid = _ensure_uuid(task_id)
        p = Path(artifact_path).expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(f"artifact_path does not exist: {p}")

        with self._lock:
            rec = self._get_record_locked(tid)
            if rec.status != TaskStatus.completed:
                raise RuntimeError(f"Task not completed: {tid} status={rec.status}")

            # ✅ 关键：download 只看这个映射
            rec.artifact_paths[file_type] = str(p)
            rec.updated_at = _utcnow()

    
# Singleton Instance
task_manager = TaskManager()
