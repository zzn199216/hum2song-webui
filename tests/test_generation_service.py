from pathlib import Path
from uuid import UUID

from core.generation_service import GenerationService
from core.models import FileType, TaskStatus
from core.task_manager import TaskManager


def test_generation_service_success_moves_artifact_and_marks_completed(tmp_path: Path):
    tm = TaskManager()

    # Create task + input file
    task_id = tm.create_task()
    input_path = tmp_path / "input.wav"
    input_path.write_bytes(b"fake-input")

    # Stub runner: generate output somewhere else and return it
    produced = tmp_path / "produced.mp3"
    produced.write_bytes(b"fake-audio")

    def runner(_input: Path, _fmt: str) -> Path:
        assert _input.exists()
        assert _fmt == "mp3"
        return produced

    svc = GenerationService(task_manager=tm, base_dir=tmp_path, runner=runner)

    svc.process_task(UUID(str(task_id)), input_path, output_format="mp3")

    info = tm.get_task_info(task_id)
    assert info.status == TaskStatus.completed
    assert info.progress == 1.0
    assert info.result is not None
    assert info.result.file_type == FileType.audio
    assert info.result.download_url.endswith("file_type=audio")

    # Artifact should be moved to artifacts/{task_id}.mp3
    final_path = tmp_path / "artifacts" / f"{task_id}.mp3"
    assert final_path.exists()
    assert final_path.read_bytes() == b"fake-audio"

    # Input must be cleaned up
    assert not input_path.exists()


def test_generation_service_runner_exception_marks_failed_and_cleans_input(tmp_path: Path):
    tm = TaskManager()
    task_id = tm.create_task()
    input_path = tmp_path / "input.wav"
    input_path.write_bytes(b"fake-input")

    def runner(_input: Path, _fmt: str) -> Path:
        raise RuntimeError("runner boom")

    svc = GenerationService(task_manager=tm, base_dir=tmp_path, runner=runner)

    svc.process_task(UUID(str(task_id)), input_path, output_format="mp3")

    info = tm.get_task_info(task_id)
    assert info.status == TaskStatus.failed
    assert info.result is None
    assert info.error is not None
    assert "runner boom" in info.error.message

    # Input must be cleaned up even on failure
    assert not input_path.exists()


def test_generation_service_output_missing_marks_failed(tmp_path: Path):
    tm = TaskManager()
    task_id = tm.create_task()
    input_path = tmp_path / "input.wav"
    input_path.write_bytes(b"fake-input")

    missing = tmp_path / "missing.mp3"
    if missing.exists():
        missing.unlink()

    def runner(_input: Path, _fmt: str) -> Path:
        # Return a path that doesn't exist
        return missing

    svc = GenerationService(task_manager=tm, base_dir=tmp_path, runner=runner)

    svc.process_task(UUID(str(task_id)), input_path, output_format="mp3")

    info = tm.get_task_info(task_id)
    assert info.status == TaskStatus.failed
    assert info.result is None
    assert info.error is not None
    assert "output file missing" in info.error.message

    # Input must be cleaned
    assert not input_path.exists()
