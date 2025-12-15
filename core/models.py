from __future__ import annotations

import math
from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import UUID

# ---------------------------------------------------------
# ⚠️ 严重警告：本文件必须运行在 Pydantic V2 环境下
# 如果报错 ImportError，请执行：pip install "pydantic>=2.0"
# ---------------------------------------------------------
from pydantic import BaseModel, Field, field_serializer, model_validator
from pydantic.config import ConfigDict


def _to_utc_z(dt: datetime) -> str:
    """
    Serialize datetime to UTC ISO8601 with trailing 'Z' (seconds precision).
    Contract requires: 2025-12-15T10:00:00Z
    """
    # 1) 强制转换为 Aware Time (带时区)
    if dt.tzinfo is None:
        # ⚠️ 如果传入 naive time (无时区)，默认当作 UTC。
        # 推荐调用方使用 datetime.now(timezone.utc)
        dt = dt.replace(tzinfo=timezone.utc)

    # 2) 转为 UTC
    dt_utc = dt.astimezone(timezone.utc)

    # 3) 格式化并替换 +00:00 为 Z
    s = dt_utc.isoformat(timespec="seconds")
    return s.replace("+00:00", "Z")


# =========================
# Enums (Frozen)
# =========================
class TaskStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class Stage(str, Enum):
    preprocessing = "preprocessing"
    converting = "converting"
    synthesizing = "synthesizing"
    finalizing = "finalizing"


class FileType(str, Enum):
    audio = "audio"
    midi = "midi"


class OutputFormat(str, Enum):
    mp3 = "mp3"
    wav = "wav"
    mid = "mid"  # Only for file_type=midi


# =========================
# Base Model Config (Frozen)
# =========================
class _ContractBaseModel(BaseModel):
    """
    Contract hardening:
    - forbid extra fields (Breaking Change)
    - keep strict-ish behavior via validation
    """
    model_config = ConfigDict(extra="forbid")


# =========================
# Schemas
# =========================
class TaskError(_ContractBaseModel):
    message: str = Field(..., min_length=1, description="Human readable error message")
    trace_id: Optional[str] = Field(default=None, description="Optional id for log correlation")


class TaskResult(_ContractBaseModel):
    file_type: FileType
    output_format: OutputFormat
    filename: str = Field(..., min_length=1)
    download_url: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _validate_result_consistency(self) -> "TaskResult":
        # Enforce minimal consistency (Frozen)
        if self.file_type == FileType.midi and self.output_format != OutputFormat.mid:
            raise ValueError("For file_type='midi', output_format must be 'mid'")
        if self.file_type == FileType.audio and self.output_format == OutputFormat.mid:
            raise ValueError("For file_type='audio', output_format must be 'mp3' or 'wav'")
        return self


class TaskCreateResponse(_ContractBaseModel):
    task_id: UUID = Field(..., description="UUID")
    status: TaskStatus = Field(default=TaskStatus.queued)
    poll_url: str = Field(..., min_length=1)
    created_at: datetime

    @field_serializer("created_at")
    def _ser_created_at(self, dt: datetime) -> str:
        return _to_utc_z(dt)


class TaskInfoResponse(_ContractBaseModel):
    task_id: UUID = Field(..., description="UUID")
    status: TaskStatus
    progress: float = Field(..., ge=0.0, le=1.0)
    stage: Stage
    created_at: datetime
    updated_at: datetime
    result: Optional[TaskResult] = None
    error: Optional[TaskError] = None

    @field_serializer("created_at", "updated_at")
    def _ser_dt(self, dt: datetime) -> str:
        return _to_utc_z(dt)

    @model_validator(mode="after")
    def _validate_invariants(self) -> "TaskInfoResponse":
        """
        Frozen contract invariants:
        - completed => result!=null and error==null, progress==1.0
        - failed    => error!=null and result==null
        - queued/running => result==null and error==null
        """
        if self.status == TaskStatus.completed:
            if self.result is None:
                raise ValueError("status='completed' requires result to be non-null")
            if self.error is not None:
                raise ValueError("status='completed' requires error to be null")
            # Strict to contract, but tolerate tiny floating errors.
            if not math.isclose(self.progress, 1.0, abs_tol=1e-9):
                raise ValueError("status='completed' requires progress=1.0")

        elif self.status == TaskStatus.failed:
            if self.error is None:
                raise ValueError("status='failed' requires error to be non-null")
            if self.result is not None:
                raise ValueError("status='failed' requires result to be null")

        else:
            # queued / running
            if self.result is not None:
                raise ValueError("status='queued'/'running' requires result to be null")
            if self.error is not None:
                raise ValueError("status='queued'/'running' requires error to be null")

        return self
