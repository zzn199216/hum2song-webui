from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from core.models import FileType, TaskStatus
from core.task_manager import task_manager

# score conversion (your canonical internal format)
from core.score_convert import midi_to_score, score_to_midi
from core.score_models import ScoreDoc

# synth
from core.synthesizer import midi_to_audio  # patched in tests

logger = logging.getLogger(__name__)

AudioFormat = Literal["mp3", "wav"]

router = APIRouter(tags=["Score"])

# -------------------------------------------------------------------
# Export get_settings at module level (tests monkeypatch this)
# -------------------------------------------------------------------
try:
    from core.config import get_settings as get_settings  # type: ignore
except Exception:  # pragma: no cover
    def get_settings():  # type: ignore
        # minimal fallback to keep module importable
        return SimpleNamespace(output_dir=Path("outputs"))


def _resolve_output_dir() -> Path:
    s = get_settings()
    out_dir = Path(getattr(s, "output_dir", "outputs"))
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir.resolve()


def _guess_media_type(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".json":
        return "application/json"
    if suf in (".xml", ".musicxml"):
        return "application/vnd.recordare.musicxml+xml"
    if suf in (".mid", ".midi"):
        return "audio/midi"
    if suf == ".mp3":
        return "audio/mpeg"
    if suf == ".wav":
        return "audio/wav"
    return "application/octet-stream"


def _ensure_task_completed(task_id: str) -> None:
    try:
        info = task_manager.get_task_info(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Task not found")
    if info.status != TaskStatus.completed:
        raise HTTPException(status_code=409, detail="Task not completed")


def _get_latest_midi_path(task_id: str) -> Path:
    """
    Prefer TaskManager-registered midi (supports tmp_path tests / edited midi),
    fallback to outputs/{task_id}.mid if exists.
    """
    # 1) task manager (registered artifact)
    try:
        return task_manager.get_artifact_path(task_id, FileType.midi)
    except Exception:
        pass

    # 2) fallback to canonical outputs
    out_dir = _resolve_output_dir()
    p = (out_dir / f"{task_id}.mid").resolve()
    if p.exists():
        return p

    raise HTTPException(status_code=409, detail="MIDI not available for this task")


@router.get("/tasks/{task_id}/score", response_model=ScoreDoc)
def get_score(task_id: str) -> ScoreDoc:
    """
    Derive ScoreDoc from the latest MIDI associated with this task.
    """
    _ensure_task_completed(task_id)
    midi_path = _get_latest_midi_path(task_id)

    try:
        score = midi_to_score(midi_path)
        return score
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to build score from midi: %s", e)
        raise HTTPException(status_code=500, detail="Failed to parse MIDI into score")


@router.put("/tasks/{task_id}/score")
def put_score(task_id: str, score: ScoreDoc = Body(...)):
    """
    Accept ScoreDoc JSON, write a new MIDI, and attach it to the task.
    """
    _ensure_task_completed(task_id)

    out_dir = _resolve_output_dir()

    # 1) persist score json (debuggable artifact)
    score_json_path = (out_dir / f"{task_id}.score.json").resolve()
    try:
        score_json_path.write_text(score.model_dump_json(indent=2), encoding="utf-8")
    except Exception:
        # non-fatal
        pass

    # 2) export midi
    midi_out = (out_dir / f"{task_id}.mid").resolve()
    try:
        score_to_midi(score, midi_out)
    except Exception as e:
        logger.exception("Failed to write MIDI: %s", e)
        raise HTTPException(status_code=500, detail="Failed to export score to MIDI")

    # 3) attach to task manager
    try:
        task_manager.attach_artifact(task_id, artifact_path=midi_out, file_type=FileType.midi)
    except TypeError:
        # in case attach_artifact uses positional signature
        task_manager.attach_artifact(task_id, midi_out, FileType.midi)

    return {
        "ok": True,
        "task_id": task_id,
        "midi_path": str(midi_out),
        "midi_download_url": f"/tasks/{task_id}/download?file_type=midi",
    }


@router.post("/tasks/{task_id}/render")
def render_audio(
    task_id: str,
    output_format: str = Query("mp3", pattern="^(mp3|wav)$"),
):
    """
    Re-render audio from the latest MIDI and attach audio artifact.
    """
    _ensure_task_completed(task_id)
    midi_path = _get_latest_midi_path(task_id)

    out_dir = _resolve_output_dir()

    try:
        audio_path = midi_to_audio(
            midi_path,
            output_dir=out_dir,
            output_format=output_format,  # type: ignore[arg-type]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to render audio: %s", e)
        raise HTTPException(status_code=500, detail="Failed to render audio from MIDI")

    # register audio artifact (overwrite existing audio mapping)
    try:
        task_manager.attach_artifact(task_id, artifact_path=audio_path, file_type=FileType.audio)
    except TypeError:
        task_manager.attach_artifact(task_id, audio_path, FileType.audio)

    return {
        "ok": True,
        "task_id": task_id,
        "audio_path": str(audio_path),
        "audio_download_url": f"/tasks/{task_id}/download?file_type=audio",
    }


@router.get("/tasks/{task_id}/score/download")
def download_score(
    task_id: str,
    file_type: str = Query("json", description="json | midi"),
):
    """
    Optional helper endpoint:
    - file_type=json -> returns outputs/{task_id}.score.json if exists (else derive from midi)
    - file_type=midi -> returns latest midi
    """
    _ensure_task_completed(task_id)

    ft = (file_type or "").strip().lower()
    out_dir = _resolve_output_dir()

    if ft == "midi":
        midi_path = _get_latest_midi_path(task_id)
        return FileResponse(str(midi_path), filename=midi_path.name, media_type=_guess_media_type(midi_path))

    if ft == "json":
        p = (out_dir / f"{task_id}.score.json").resolve()
        if p.exists():
            return FileResponse(str(p), filename=p.name, media_type=_guess_media_type(p))
        # derive on the fly
        midi_path = _get_latest_midi_path(task_id)
        score = midi_to_score(midi_path)
        tmp = (out_dir / f"{task_id}.score.json").resolve()
        tmp.write_text(score.model_dump_json(indent=2), encoding="utf-8")
        return FileResponse(str(tmp), filename=tmp.name, media_type=_guess_media_type(tmp))

    raise HTTPException(status_code=400, detail="Invalid file_type (json|midi)")
