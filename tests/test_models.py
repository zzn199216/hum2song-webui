from datetime import datetime, timezone
from uuid import UUID

import pytest

from core.models import (
    FileType,
    OutputFormat,
    Stage,
    TaskCreateResponse,
    TaskError,
    TaskInfoResponse,
    TaskResult,
    TaskStatus,
)


def _dt_utc() -> datetime:
    return datetime(2025, 12, 15, 10, 0, 0, tzinfo=timezone.utc)


def test_taskcreate_serializes_created_at_to_utc_z():
    dt = _dt_utc()
    tid = UUID("550e8400-e29b-41d4-a716-446655440000")

    resp = TaskCreateResponse(
        task_id=tid,
        status=TaskStatus.queued,
        poll_url=f"/tasks/{tid}",
        created_at=dt,
    )
    dumped = resp.model_dump(mode="json")

    assert dumped["task_id"] == str(tid)
    assert dumped["created_at"] == "2025-12-15T10:00:00Z"
    assert dumped["status"] == "queued"
    assert dumped["poll_url"] == f"/tasks/{tid}"


def test_taskinfo_serializes_datetimes_to_utc_z():
    dt = _dt_utc()
    tid = UUID("550e8400-e29b-41d4-a716-446655440000")

    resp = TaskInfoResponse(
        task_id=tid,
        status=TaskStatus.running,
        progress=0.4,
        stage=Stage.converting,
        created_at=dt,
        updated_at=dt,
        result=None,
        error=None,
    )
    dumped = resp.model_dump(mode="json")

    assert dumped["task_id"] == str(tid)
    assert dumped["created_at"].endswith("Z")
    assert dumped["updated_at"].endswith("Z")


def test_completed_requires_result_and_progress_1_and_no_error():
    dt = _dt_utc()
    tid = UUID("550e8400-e29b-41d4-a716-446655440000")

    ok = TaskInfoResponse(
        task_id=tid,
        status=TaskStatus.completed,
        progress=1.0,
        stage=Stage.finalizing,
        created_at=dt,
        updated_at=dt,
        result=TaskResult(
            file_type=FileType.audio,
            output_format=OutputFormat.mp3,
            filename="x.mp3",
            download_url=f"/tasks/{tid}/download?file_type=audio",
        ),
        error=None,
    )
    dumped = ok.model_dump(mode="json")
    assert dumped["status"] == "completed"
    assert dumped["progress"] == 1.0
    assert dumped["result"]["download_url"].endswith("file_type=audio")
    assert dumped["error"] is None

    # Missing result
    with pytest.raises(ValueError):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.completed,
            progress=1.0,
            stage=Stage.finalizing,
            created_at=dt,
            updated_at=dt,
            result=None,
            error=None,
        )

    # Wrong progress
    with pytest.raises(ValueError):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.completed,
            progress=0.99,
            stage=Stage.finalizing,
            created_at=dt,
            updated_at=dt,
            result=TaskResult(
                file_type=FileType.audio,
                output_format=OutputFormat.mp3,
                filename="x.mp3",
                download_url=f"/tasks/{tid}/download?file_type=audio",
            ),
            error=None,
        )

    # Error not allowed for completed
    with pytest.raises(ValueError):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.completed,
            progress=1.0,
            stage=Stage.finalizing,
            created_at=dt,
            updated_at=dt,
            result=TaskResult(
                file_type=FileType.audio,
                output_format=OutputFormat.mp3,
                filename="x.mp3",
                download_url=f"/tasks/{tid}/download?file_type=audio",
            ),
            error=TaskError(message="should not be here"),
        )


def test_failed_requires_error_and_no_result():
    dt = _dt_utc()
    tid = UUID("550e8400-e29b-41d4-a716-446655440000")

    ok = TaskInfoResponse(
        task_id=tid,
        status=TaskStatus.failed,
        progress=0.2,
        stage=Stage.converting,
        created_at=dt,
        updated_at=dt,
        result=None,
        error=TaskError(message="boom", trace_id="abc123"),
    )
    dumped = ok.model_dump(mode="json")
    assert dumped["status"] == "failed"
    assert dumped["result"] is None
    assert dumped["error"]["message"] == "boom"
    assert dumped["error"]["trace_id"] == "abc123"

    # Result not allowed on failed
    with pytest.raises(ValueError):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.failed,
            progress=0.2,
            stage=Stage.converting,
            created_at=dt,
            updated_at=dt,
            result=TaskResult(
                file_type=FileType.audio,
                output_format=OutputFormat.mp3,
                filename="x.mp3",
                download_url=f"/tasks/{tid}/download?file_type=audio",
            ),
            error=TaskError(message="boom"),
        )

    # Error required on failed
    with pytest.raises(ValueError):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.failed,
            progress=0.2,
            stage=Stage.converting,
            created_at=dt,
            updated_at=dt,
            result=None,
            error=None,
        )


def test_queued_running_must_have_no_result_no_error():
    dt = _dt_utc()
    tid = UUID("550e8400-e29b-41d4-a716-446655440000")

    ok = TaskInfoResponse(
        task_id=tid,
        status=TaskStatus.queued,
        progress=0.0,
        stage=Stage.preprocessing,
        created_at=dt,
        updated_at=dt,
        result=None,
        error=None,
    )
    assert ok.status == TaskStatus.queued

    with pytest.raises(ValueError):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.running,
            progress=0.1,
            stage=Stage.converting,
            created_at=dt,
            updated_at=dt,
            result=TaskResult(
                file_type=FileType.audio,
                output_format=OutputFormat.mp3,
                filename="x.mp3",
                download_url=f"/tasks/{tid}/download?file_type=audio",
            ),
            error=None,
        )

    with pytest.raises(ValueError):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.running,
            progress=0.1,
            stage=Stage.converting,
            created_at=dt,
            updated_at=dt,
            result=None,
            error=TaskError(message="not allowed"),
        )


def test_progress_bounds():
    dt = _dt_utc()
    tid = UUID("550e8400-e29b-41d4-a716-446655440000")

    with pytest.raises(Exception):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.running,
            progress=1.1,
            stage=Stage.converting,
            created_at=dt,
            updated_at=dt,
            result=None,
            error=None,
        )

    with pytest.raises(Exception):
        TaskInfoResponse(
            task_id=tid,
            status=TaskStatus.running,
            progress=-0.1,
            stage=Stage.converting,
            created_at=dt,
            updated_at=dt,
            result=None,
            error=None,
        )


def test_taskresult_consistency_rules():
    # midi must be mid
    with pytest.raises(ValueError):
        TaskResult(
            file_type=FileType.midi,
            output_format=OutputFormat.mp3,
            filename="x.mid",
            download_url="/tasks/x/download?file_type=midi",
        )

    # audio must not be mid
    with pytest.raises(ValueError):
        TaskResult(
            file_type=FileType.audio,
            output_format=OutputFormat.mid,
            filename="x.mp3",
            download_url="/tasks/x/download?file_type=audio",
        )


def test_extra_fields_forbidden():
    dt = _dt_utc()
    tid = UUID("550e8400-e29b-41d4-a716-446655440000")

    # Extra field should raise validation error due to extra="forbid"
    with pytest.raises(Exception):
        TaskCreateResponse(
            task_id=tid,
            status=TaskStatus.queued,
            poll_url=f"/tasks/{tid}",
            created_at=dt,
            extra_field="nope",  # type: ignore
        )
