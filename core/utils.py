"""
通用工具库
功能：生成唯一ID，清理临时文件等
"""
# core/utils.py
from __future__ import annotations

import logging
import time
import uuid
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Union

from core.config import get_settings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

PathLike = Union[str, Path]


# ---------------------------
# IDs / paths / file helpers
# ---------------------------
def new_job_id(prefix: str = "") -> str:
    """
    生成短 job_id（默认 12 位 hex），用于所有产物命名，避免并发覆盖。
    """
    jid = uuid.uuid4().hex[:12]
    return f"{prefix}{jid}" if prefix else jid


def ensure_dir(p: PathLike) -> Path:
    d = Path(p)
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_unlink(p: Optional[PathLike]) -> bool:
    """
    安全删除：成功 True；不存在/失败 False（不抛异常）。
    """
    if not p:
        return False
    try:
        Path(p).unlink(missing_ok=True)
        return True
    except Exception as e:
        logger.warning("safe_unlink failed for %s: %s", p, e)
        return False


def guess_extension(filename: Optional[str]) -> str:
    """
    从文件名猜扩展名（带点），如 '.m4a' '.wav'。None/无扩展名返回 ''。
    """
    if not filename:
        return ""
    return Path(filename).suffix.lower()


def build_paths(job_id: str, input_filename: Optional[str] = None) -> Dict[str, Path]:
    """
    统一命名规范（强烈建议全项目都用它）：

    uploads/{job_id}{ext}          原始上传（ext 来自 input_filename）
    uploads/{job_id}_clean.wav     清洗 wav
    outputs/{job_id}.mid           midi
    outputs/{job_id}.wav/.mp3      最终音频（根据 format 选择）

    返回常用路径 dict。
    """
    s = get_settings()
    upload_dir = ensure_dir(s.upload_dir)
    output_dir = ensure_dir(s.output_dir)

    ext = guess_extension(input_filename)
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


def cleanup_old_files(dir_path: PathLike, older_than_seconds: int = 3600) -> int:
    """
    清理目录中超过 older_than_seconds 的文件（跳过 .gitkeep）。
    返回删除数量。
    """
    d = Path(dir_path)
    if not d.exists():
        return 0

    now = time.time()
    threshold = now - older_than_seconds
    deleted = 0

    for p in d.glob("*"):
        if not p.is_file():
            continue
        if p.name == ".gitkeep":
            continue
        try:
            if p.stat().st_mtime < threshold:
                p.unlink()
                deleted += 1
        except Exception as e:
            logger.warning("cleanup failed for %s: %s", p, e)

    return deleted


def cleanup_runtime(older_than_seconds: int = 3600) -> Dict[str, int]:
    """清理 uploads/ outputs/ 旧文件（默认 1 小时）"""
    s = get_settings()
    return {
        "uploads": cleanup_old_files(s.upload_dir, older_than_seconds),
        "outputs": cleanup_old_files(s.output_dir, older_than_seconds),
    }


# ---------------------------
# In-memory Task Manager (MVP)
# ---------------------------
# 注意：仅适用于单进程（uvicorn --workers 1）
_TASK_STORE: Dict[str, Dict[str, Any]] = {}
_TASK_LOCK = threading.Lock()

# “机会式 prune”节流：至少间隔多少秒才做一次 prune 扫描
_PRUNE_MIN_INTERVAL_SECONDS = 60
_LAST_PRUNE_AT = 0.0


def _maybe_prune_locked(now: float, older_than_seconds: int) -> int:
    """
    在持锁状态下做 prune（内部函数）。
    """
    global _LAST_PRUNE_AT

    if now - _LAST_PRUNE_AT < _PRUNE_MIN_INTERVAL_SECONDS:
        return 0

    threshold = now - older_than_seconds
    to_delete = [tid for tid, t in _TASK_STORE.items() if float(t.get("updated_at", 0)) < threshold]

    for tid in to_delete:
        _TASK_STORE.pop(tid, None)

    _LAST_PRUNE_AT = now
    return len(to_delete)


class TaskManager:
    """
    MVP 版任务状态管理器（内存实现，替代 Redis）。

    task 结构示例：
    {
      "task_id": "...",
      "status": "pending|processing|done|failed",
      "message": "...",
      "progress": 0~100,
      "created_at": epoch_seconds,
      "updated_at": epoch_seconds,
      "paths": {...},   # build_paths(...) 的结果（string化）
      "result": {...},  # 可选：返回给前端的结构化结果
      "error": "...",   # 失败时
    }
    """

    @staticmethod
    def create_task(
        input_filename: Optional[str] = None,
        *,
        auto_prune: bool = True,
        prune_older_than_seconds: int = 3600,
    ) -> str:
        """
        创建任务，并可选进行“机会式 prune”。

        - auto_prune=True: 默认开启，避免 _TASK_STORE 无限增长
        - prune_older_than_seconds: 清理多久未更新的任务（默认 1 小时）
        """
        task_id = new_job_id()
        paths = build_paths(task_id, input_filename=input_filename)
        now = time.time()

        task = {
            "task_id": task_id,
            "status": "pending",
            "message": "Task created",
            "progress": 0,
            "created_at": now,
            "updated_at": now,
            "paths": {k: str(v) for k, v in paths.items()},
            "result": None,
            "error": None,
        }

        with _TASK_LOCK:
            if auto_prune:
                removed = _maybe_prune_locked(now, prune_older_than_seconds)
                if removed:
                    logger.info("🧹 pruned %d stale tasks from in-memory store", removed)

            _TASK_STORE[task_id] = task

        return task_id

    @staticmethod
    def get_task(task_id: str) -> Optional[Dict[str, Any]]:
        with _TASK_LOCK:
            t = _TASK_STORE.get(task_id)
            return dict(t) if t else None  # 返回副本，避免外部修改内部状态

    @staticmethod
    def update_task(task_id: str, status: Optional[str] = None, **kwargs: Any) -> None:
        with _TASK_LOCK:
            if task_id not in _TASK_STORE:
                return
            t = _TASK_STORE[task_id]

            if status is not None:
                t["status"] = status

            # progress clamp
            if "progress" in kwargs:
                try:
                    p = int(kwargs["progress"])
                    kwargs["progress"] = max(0, min(100, p))
                except Exception:
                    kwargs["progress"] = t.get("progress", 0)

            t.update(kwargs)
            t["updated_at"] = time.time()

    @staticmethod
    def fail_task(task_id: str, error_msg: str) -> None:
        TaskManager.update_task(
            task_id,
            status="failed",
            error=error_msg,
            message="Task failed",
            progress=0,
        )
        logger.error("❌ Task[%s] failed: %s", task_id, error_msg)

    @staticmethod
    def done_task(task_id: str, result: Optional[Dict[str, Any]] = None) -> None:
        TaskManager.update_task(
            task_id,
            status="done",
            result=result,
            message="Task done",
            progress=100,
        )

    @staticmethod
    def delete_task(task_id: str) -> bool:
        with _TASK_LOCK:
            return _TASK_STORE.pop(task_id, None) is not None

    @staticmethod
    def prune(
        older_than_seconds: int = 3600,
        *,
        force: bool = False,
    ) -> int:
        """
        主动 prune：清理太久未更新的任务记录（只清理内存 store，不动文件）。

        - force=True: 无视节流，立刻扫描并清理
        返回：清理数量
        """
        global _LAST_PRUNE_AT

        now = time.time()
        with _TASK_LOCK:
            if force:
                # force 时直接扫描
                threshold = now - older_than_seconds
                to_delete = [tid for tid, t in _TASK_STORE.items() if float(t.get("updated_at", 0)) < threshold]
                for tid in to_delete:
                    _TASK_STORE.pop(tid, None)
                _LAST_PRUNE_AT = now
                return len(to_delete)

            removed = _maybe_prune_locked(now, older_than_seconds)
            return removed


if __name__ == "__main__":
    # quick smoke
    tid = TaskManager.create_task("demo.m4a")
    print("task_id:", tid)
    print("task:", TaskManager.get_task(tid))
