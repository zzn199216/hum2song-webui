# core/utils.py
from __future__ import annotations

import os
import re
import time
import uuid
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from core.config import get_settings

logger = logging.getLogger(__name__)

_TASK_STORE: Dict[str, Dict[str, Any]] = {}

# 为了避免 prune 每次都跑，做一个简单节流
_LAST_PRUNE_AT: float = 0.0
_PRUNE_MIN_INTERVAL_SEC: float = 5.0


def new_job_id() -> str:
    """生成短 ID（12 位 hex）"""
    return uuid.uuid4().hex[:12]


def ensure_dir(p: Path) -> Path:
    p = Path(p)
    p.mkdir(parents=True, exist_ok=True)
    return p


def safe_unlink(p: Optional[Path], missing_ok: bool = True) -> bool:
    """Windows 可能遇到文件锁，尽量安全删除"""
    if not p:
        return True
    p = Path(p)
    if not p.exists():
        return True
    try:
        p.unlink()
        return True
    except FileNotFoundError:
        return True
    except PermissionError as e:
        # Windows 文件被占用时常见
        logger.warning("safe_unlink PermissionError: %s (%s)", p, e)
        return False
    except OSError as e:
        logger.warning("safe_unlink OSError: %s (%s)", p, e)
        return False


def cleanup_old_files(dir_path: Path, older_than_seconds: int = 86400) -> int:
    """清理目录下旧文件（不会删除 .gitkeep）"""
    dir_path = Path(dir_path)
    if not dir_path.exists():
        return 0

    now = time.time()
    removed = 0
    for fp in dir_path.glob("*"):
        if not fp.is_file():
            continue
        if fp.name == ".gitkeep":
            continue
        try:
            mtime = fp.stat().st_mtime
        except OSError:
            continue
        if now - mtime >= older_than_seconds:
            if safe_unlink(fp):
                removed += 1
    return removed


_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(name: str, max_stem: int = 64) -> str:
    """
    清理用户文件名（不改变后缀），避免空格/特殊字符/emoji/超长路径坑。
    """
    name = (name or "").strip()
    # 防止带路径
    name = name.replace("\\", "/").split("/")[-1]
    if not name:
        return "audio.wav"

    p = Path(name)
    stem = p.stem or "audio"
    suffix = p.suffix or ".wav"

    stem = _FILENAME_SAFE_RE.sub("_", stem).strip("._- ")
    if not stem:
        stem = "audio"

    stem = stem[:max_stem]
    # Windows 不允许末尾空格/点
    stem = stem.rstrip(" .")
    if not stem:
        stem = "audio"

    suffix = suffix.lower()
    if len(suffix) > 10 or not suffix.startswith("."):
        suffix = ".wav"

    return f"{stem}{suffix}"


def build_paths(job_id: str, original_filename: str) -> Dict[str, Path]:
    """
    统一生成各阶段产物路径：
    - raw_audio: uploads/<job_id>.<ext>
    - clean_wav: uploads/<job_id>_clean.wav
    - midi:      outputs/<job_id>.mid
    - audio_wav: outputs/<job_id>.wav
    - audio_mp3: outputs/<job_id>.mp3
    """
    s = get_settings()
    safe_name = sanitize_filename(original_filename)
    ext = Path(safe_name).suffix or ".wav"

    upload_dir = ensure_dir(s.upload_dir)
    output_dir = ensure_dir(s.output_dir)

    raw_audio = upload_dir / f"{job_id}{ext}"
    clean_wav = upload_dir / f"{job_id}_clean.wav"
    midi = output_dir / f"{job_id}.mid"
    audio_wav = output_dir / f"{job_id}.wav"
    audio_mp3 = output_dir / f"{job_id}.mp3"

    return {
        "raw_audio": raw_audio,
        "clean_wav": clean_wav,
        "midi": midi,
        "audio_wav": audio_wav,
        "audio_mp3": audio_mp3,
    }


class TaskManager:
    @staticmethod
    def create_task(original_filename: str, auto_prune: bool = True) -> str:
        """
        创建任务（兼容测试：auto_prune 参数）
        """
        if auto_prune:
            TaskManager.prune()

        task_id = new_job_id()
        paths = build_paths(task_id, original_filename)

        now = time.time()
        _TASK_STORE[task_id] = {
            "task_id": task_id,
            "original_filename": original_filename,
            "status": "pending",
            "message": "Task created",
            "progress": 0,
            "created_at": now,
            "updated_at": now,
            "result": None,
            "error": None,
            "paths": {k: str(v) for k, v in paths.items()},
        }
        return task_id

    @staticmethod
    def get_task(task_id: str) -> Optional[Dict[str, Any]]:
        return _TASK_STORE.get(task_id)

    @staticmethod
    def update_task(task_id: str, status: str, **kwargs: Any) -> None:
        t = _TASK_STORE.get(task_id)
        if not t:
            return
        t["status"] = status
        t.update(kwargs)
        t["updated_at"] = time.time()

    @staticmethod
    def done_task(task_id: str, result: Dict[str, Any]) -> None:
        TaskManager.update_task(task_id, status="done", progress=100, message="Done", result=result)

    @staticmethod
    def fail_task(task_id: str, error_msg: str) -> None:
        TaskManager.update_task(task_id, status="failed", progress=0, message="Failed", error=error_msg)

    @staticmethod
    def prune(older_than_seconds: int = 86400, force: bool = False) -> int:
        global _LAST_PRUNE_AT
        now = time.time()
        if not force and (now - _LAST_PRUNE_AT) < _PRUNE_MIN_INTERVAL_SEC:
            return 0

        _LAST_PRUNE_AT = now
        removed = 0
        to_delete = []
        for tid, t in _TASK_STORE.items():
            updated_at = float(t.get("updated_at", 0.0))
            if now - updated_at >= older_than_seconds:
                to_delete.append(tid)

        for tid in to_delete:
            _TASK_STORE.pop(tid, None)
            removed += 1

        return removed
