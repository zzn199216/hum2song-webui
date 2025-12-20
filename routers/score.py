from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse

from core.models import FileType, TaskStatus
from core.score_convert import midi_to_score, score_to_midi
from core.score_models import ScoreDoc
from core.task_manager import task_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Score"])

# -------------------------------------------------------------------
# Export get_settings at module level (tests monkeypatch this)
# -------------------------------------------------------------------
try:
    from core.config import get_settings as get_settings  # type: ignore
except Exception:  # pragma: no cover
    def get_settings():  # type: ignore
        raise RuntimeError("core.config.get_settings is not available")


def _output_dir() -> Path:
    """
    Where score-related artifacts should be written.
    Tests monkeypatch get_settings().output_dir to tmp_path.
    """
    s = get_settings()
    out = Path(getattr(s, "output_dir", "outputs"))
    out.mkdir(parents=True, exist_ok=True)
    return out


def _score_json_path(task_id: str) -> Path:
    return (_output_dir() / f"{task_id}.score.json").resolve()


def _score_midi_path(task_id: str) -> Path:
    return (_output_dir() / f"{task_id}.mid").resolve()


def _score_musicxml_path(task_id: str) -> Path:
    return (_output_dir() / f"{task_id}.musicxml").resolve()


def _ensure_task_completed(task_id: str) -> None:
    try:
        info = task_manager.get_task_info(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Task not found")

    if info.status != TaskStatus.completed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Task not completed",
        )


def _ensure_midi_available(task_id: str) -> Path:
    """
    Prefer TaskManager-registered MIDI artifact; fallback to output_dir/{task_id}.mid if present.
    """
    try:
        return task_manager.get_artifact_path(task_id, FileType.midi)
    except Exception:
        # fallback: maybe already exists on disk but not registered
        p = _score_midi_path(task_id)
        if p.exists():
            try:
                task_manager.attach_artifact(task_id, artifact_path=p, file_type=FileType.midi)
                return p
            except Exception:
                return p
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="MIDI is not available for this task",
        )


def _write_musicxml_from_midi(midi_path: Path, out_xml: Path) -> Path:
    """
    Convert MIDI -> MusicXML using music21.
    """
    try:
        from music21 import converter  # lazy import
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"music21 not available: {e}")

    try:
        s = converter.parse(str(midi_path))
        out_xml.parent.mkdir(parents=True, exist_ok=True)
        s.write("musicxml", fp=str(out_xml))
        if not out_xml.exists():
            raise RuntimeError("musicxml not created")
        return out_xml
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export MusicXML: {e}")


@router.get(
    "/tasks/{task_id}/score",
    response_model=ScoreDoc,
    summary="Get score JSON derived from the task MIDI",
)
def get_score(task_id: str) -> ScoreDoc:
    _ensure_task_completed(task_id)

    midi_path = _ensure_midi_available(task_id)
    try:
        score = midi_to_score(midi_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse MIDI into score: {e}")

    return score


@router.put(
    "/tasks/{task_id}/score",
    summary="Overwrite score JSON and re-generate MIDI for this task",
)
def put_score(task_id: str, score: ScoreDoc):
    _ensure_task_completed(task_id)

    p_json = _score_json_path(task_id)
    p_mid = _score_midi_path(task_id)

    try:
        p_json.parent.mkdir(parents=True, exist_ok=True)
        p_json.write_text(score.model_dump_json(indent=2), encoding="utf-8")

        p_mid.parent.mkdir(parents=True, exist_ok=True)
        score_to_midi(score, p_mid)

        # Make sure MIDI exists and is registered so /tasks/{id}/download?file_type=midi works
        if not p_mid.exists():
            raise RuntimeError("MIDI file was not created")

        task_manager.attach_artifact(task_id, artifact_path=p_mid, file_type=FileType.midi)

        # self-check: ensure it can be resolved via TaskManager API
        _ = task_manager.get_artifact_path(task_id, FileType.midi)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save score: {e}")

    return {"ok": True, "task_id": task_id}


@router.get(
    "/tasks/{task_id}/score/download",
    summary="Download score artifact (musicxml or json)",
)
def download_score(
    task_id: str,
    format: Literal["musicxml", "json"] = Query("musicxml"),
):
    _ensure_task_completed(task_id)

    if format == "json":
        p_json = _score_json_path(task_id)
        # If JSON doesn't exist yet, derive it from MIDI and persist once.
        if not p_json.exists():
            midi_path = _ensure_midi_available(task_id)
            score = midi_to_score(midi_path)
            p_json.write_text(score.model_dump_json(indent=2), encoding="utf-8")
        return FileResponse(
            path=str(p_json),
            filename=p_json.name,
            media_type="application/json",
        )

    # musicxml
    midi_path = _ensure_midi_available(task_id)
    p_xml = _score_musicxml_path(task_id)
    if not p_xml.exists():
        _write_musicxml_from_midi(midi_path, p_xml)

    return FileResponse(
        path=str(p_xml),
        filename=p_xml.name,
        media_type="application/vnd.recordare.musicxml+xml",
    )
