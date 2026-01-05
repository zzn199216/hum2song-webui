from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from core.models import FileType, TaskStatus
from core.task_manager import task_manager

# score conversion
from core.score_convert import midi_to_score, score_to_midi
from core.score_models import ScoreDoc, normalize_score

# synth
from core.synthesizer import midi_to_audio

logger = logging.getLogger(__name__)

AudioFormat = Literal["mp3", "wav"]

router = APIRouter(tags=["Score"])

# ... (Helper functions keep same: get_settings, _resolve_output_dir, _guess_media_type, _ensure_task_completed, _get_latest_midi_path) ...
# 为了节省篇幅，这里假设 Helper 函数保持你之前提供的原样，只贴核心 API 变动

# -------------------------------------------------------------------
# (Paste the helpers here if you are replacing the whole file, 
#  or just keep them if editing partially. 
#  For safety, I assume you know the helpers are unchanged.)
# -------------------------------------------------------------------
# Re-importing helpers context for completeness in your mind:
try:
    from core.config import get_settings as get_settings
except Exception:
    def get_settings(): return SimpleNamespace(output_dir=Path("outputs"))

def _resolve_output_dir() -> Path:
    s = get_settings()
    out_dir = Path(getattr(s, "output_dir", "outputs"))
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir.resolve()

def _guess_media_type(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".json": return "application/json"
    if suf in (".mid", ".midi"): return "audio/midi"
    if suf == ".mp3": return "audio/mpeg"
    if suf == ".wav": return "audio/wav"
    return "application/octet-stream"

def _ensure_task_completed(task_id: str) -> None:
    try:
        info = task_manager.get_task_info(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Task not found")
    if info.status != TaskStatus.completed:
        raise HTTPException(status_code=409, detail="Task not completed")

def _get_latest_midi_path(task_id: str) -> Path:
    try:
        return task_manager.get_artifact_path(task_id, FileType.midi)
    except Exception:
        pass
    out_dir = _resolve_output_dir()
    p = (out_dir / f"{task_id}.mid").resolve()
    if p.exists(): return p
    raise HTTPException(status_code=409, detail="MIDI not available for this task")


@router.get("/tasks/{task_id}/score", response_model=ScoreDoc)
def get_score(task_id: str) -> ScoreDoc:
    """
    Return ScoreDoc for UI editing.
    """
    _ensure_task_completed(task_id)
    out_dir = _resolve_output_dir()
    score_json_path = (out_dir / f"{task_id}.score.json").resolve()

    # 1) Prefer persisted JSON (Stable)
    if score_json_path.exists():
        try:
            raw = score_json_path.read_text(encoding="utf-8")
            score = ScoreDoc.model_validate_json(raw)
            return normalize_score(score) # Double check normalize on read
        except Exception:
            pass

    # 2) Fallback: derive from MIDI
    midi_path = _get_latest_midi_path(task_id)
    try:
        score = midi_to_score(midi_path)
        # FORCE NORMALIZE: Add IDs, Sort, Round, Fix types
        score_n = normalize_score(score)

        # Cache it immediately
        try:
            score_json_path.write_text(score_n.model_dump_json(indent=2), encoding="utf-8")
        except Exception:
            pass

        return score_n
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to build score from midi: %s", e)
        raise HTTPException(status_code=500, detail="Failed to parse MIDI into score")


@router.put("/tasks/{task_id}/score")
def put_score(task_id: str, score: ScoreDoc = Body(...)):
    """
    Accept ScoreDoc JSON, normalize (safe), write a new MIDI.
    """
    _ensure_task_completed(task_id)
    out_dir = _resolve_output_dir()

    # --- ACTION: Enforce Safe Normalization (Sort/Round/TypeFix) ---
    score_n = normalize_score(score)

    # 1) persist score json
    score_json_path = (out_dir / f"{task_id}.score.json").resolve()
    try:
        score_json_path.write_text(score_n.model_dump_json(indent=2), encoding="utf-8")
    except Exception:
        pass

    # 2) export midi
    midi_out = (out_dir / f"{task_id}.mid").resolve()
    try:
        score_to_midi(score_n, midi_out)
    except Exception as e:
        logger.exception("Failed to write MIDI: %s", e)
        raise HTTPException(status_code=500, detail="Failed to export score to MIDI")

    # 3) attach to task manager
    try:
        task_manager.attach_artifact(task_id, artifact_path=midi_out, file_type=FileType.midi)
    except TypeError:
        task_manager.attach_artifact(task_id, midi_out, FileType.midi)

    return {
        "ok": True,
        "task_id": task_id,
        "midi_path": str(midi_out),
        "midi_download_url": f"/tasks/{task_id}/download?file_type=midi",
        # Hint frontend to reload so it gets the normalized IDs
        "hint": "Please reload score to sync IDs" 
    }


@router.post("/tasks/{task_id}/render")
def render_audio(
    task_id: str,
    output_format: str = Query("mp3", pattern="^(mp3|wav)$"),
):
    _ensure_task_completed(task_id)
    midi_path = _get_latest_midi_path(task_id)
    out_dir = _resolve_output_dir()

    try:
        audio_path = midi_to_audio(
            midi_path,
            output_dir=out_dir,
            output_format=output_format,  # type: ignore
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to render audio: %s", e)
        raise HTTPException(status_code=500, detail="Failed to render audio from MIDI")

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
        
        # Derive on fly + normalize
        midi_path = _get_latest_midi_path(task_id)
        score = midi_to_score(midi_path)
        score_n = normalize_score(score)
        
        tmp = (out_dir / f"{task_id}.score.json").resolve()
        tmp.write_text(score_n.model_dump_json(indent=2), encoding="utf-8")
        return FileResponse(str(tmp), filename=tmp.name, media_type=_guess_media_type(tmp))

    raise HTTPException(status_code=400, detail="Invalid file_type (json|midi)")