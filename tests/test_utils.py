# tests/test_utils.py
import os
import time
import pytest

import core.utils as utils_module
from core.utils import (
    TaskManager,
    build_paths,
    safe_unlink,
    cleanup_old_files,
    new_job_id,
    _TASK_STORE,
)
from core.config import get_settings


# --- Global fixtures ---

@pytest.fixture(autouse=True)
def isolate_dirs_and_reset(tmp_path, monkeypatch):
    """
    1) 把 UPLOAD_DIR / OUTPUT_DIR 指向 tmp_path，避免污染真实项目目录
    2) 清理 Task store 与 prune 计时器
    3) 清掉 settings cache，确保 env 生效
    """
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "outputs"))

    # config.get_settings 是 lru_cache，必须清理
    get_settings.cache_clear()

    _TASK_STORE.clear()
    utils_module._LAST_PRUNE_AT = 0.0

    yield

    _TASK_STORE.clear()
    get_settings.cache_clear()


# --- 1) ID 生成测试 ---

def test_new_job_id():
    jid = new_job_id()
    assert len(jid) == 12

    ids = {new_job_id() for _ in range(1000)}
    assert len(ids) == 1000


# --- 2) 路径生成测试 ---

def test_build_paths():
    s = get_settings()

    job_id = "test_job"
    paths = build_paths(job_id, "demo.m4a")

    assert paths["raw_audio"].name == "test_job.m4a"
    assert paths["clean_wav"].name == "test_job_clean.wav"
    assert paths["midi"].name == "test_job.mid"
    assert paths["audio_wav"].name == "test_job.wav"
    assert paths["audio_mp3"].name == "test_job.mp3"

    # 更稳：直接比较 parent，而不是字符串包含 "outputs"
    assert paths["raw_audio"].parent.resolve() == s.upload_dir.resolve()
    assert paths["clean_wav"].parent.resolve() == s.upload_dir.resolve()
    assert paths["midi"].parent.resolve() == s.output_dir.resolve()
    assert paths["audio_mp3"].parent.resolve() == s.output_dir.resolve()


# --- 3) safe_unlink 测试 ---

def test_safe_unlink(tmp_path):
    # 不存在文件：不应抛异常
    non_existent = tmp_path / "ghost.txt"
    res = safe_unlink(non_existent)
    assert res is True  # 你的实现是 missing_ok=True -> True

    # 存在文件：应删除
    real_file = tmp_path / "real.txt"
    real_file.touch()
    assert real_file.exists()

    res = safe_unlink(real_file)
    assert res is True
    assert not real_file.exists()


# --- 4) cleanup_old_files 测试 ---

def test_cleanup_old_files(tmp_path):
    d = tmp_path / "cleanup_test"
    d.mkdir()

    gitkeep = d / ".gitkeep"
    gitkeep.touch()

    old_file = d / "old.tmp"
    old_file.touch()

    now = time.time()
    two_hours_ago = now - 7200
    os.utime(old_file, (two_hours_ago, two_hours_ago))

    new_file = d / "new.tmp"
    new_file.touch()

    deleted_count = cleanup_old_files(d, older_than_seconds=3600)

    assert deleted_count == 1
    assert gitkeep.exists()
    assert new_file.exists()
    assert not old_file.exists()


# --- 5) TaskManager 基础测试 ---

def test_task_manager_basic():
    tid = TaskManager.create_task("song.mp3")
    task = TaskManager.get_task(tid)

    assert task is not None
    assert task["task_id"] == tid
    assert task["status"] == "pending"
    assert "progress" in task
    assert "paths" in task
    assert "clean_wav" in task["paths"]


# --- 6) prune(force=True) 测试 ---

def test_task_manager_prune_force(monkeypatch):
    start_time = 1000.0
    # 更精确：patch utils_module 内部用到的 time.time
    monkeypatch.setattr(utils_module.time, "time", lambda: start_time)

    tid_old = TaskManager.create_task("old.wav", auto_prune=False)
    _TASK_STORE[tid_old]["updated_at"] = start_time - 7200  # 2 小时前

    tid_new = TaskManager.create_task("new.wav", auto_prune=False)

    assert tid_old in _TASK_STORE
    assert tid_new in _TASK_STORE

    removed = TaskManager.prune(older_than_seconds=3600, force=True)

    assert removed == 1
    assert tid_old not in _TASK_STORE
    assert tid_new in _TASK_STORE
