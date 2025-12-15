import pytest
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

# 引入 Models
from core.models import TaskStatus, Stage, FileType, OutputFormat

# ⚠️ 注意这里：从 core.task_manager 导入，而不是 core.utils
from core.task_manager import TaskManager, _infer_output_format_from_path

# ==========================================
# 0. Helper Tests (工具函数测试)
# ==========================================

def test_infer_format():
    """测试文件后缀推断逻辑"""
    assert _infer_output_format_from_path(Path("test.mp3")) == OutputFormat.mp3
    assert _infer_output_format_from_path(Path("song.wav")) == OutputFormat.wav
    assert _infer_output_format_from_path(Path("music.mid")) == OutputFormat.mid
    assert _infer_output_format_from_path(Path("music.midi")) == OutputFormat.mid
    # 默认回落
    assert _infer_output_format_from_path(Path("unknown.xyz")) == OutputFormat.mp3

# ==========================================
# 1. Lifecycle Tests (全生命周期测试)
# ==========================================

def test_full_lifecycle_success(tmp_path):
    """测试从 创建 -> 进行中 -> 完成 的完整流程"""
    manager = TaskManager()
    
    # 1. Create
    tid = manager.create_task()
    assert manager.exists(tid)
    info = manager.get_task_info(tid)
    assert info.status == TaskStatus.queued
    assert info.progress == 0.0

    # 2. Running
    manager.update_progress(tid, progress=0.5, stage=Stage.synthesizing)
    info = manager.get_task_info(tid)
    assert info.status == TaskStatus.running
    assert info.progress == 0.5
    assert info.stage == Stage.synthesizing

    # 3. Complete
    # 必须创建一个真实文件，因为 task_manager.py 里有 p.exists() 检查
    dummy_file = tmp_path / "output.mp3"
    dummy_file.touch()

    manager.mark_completed(
        tid, 
        artifact_path=dummy_file, 
        file_type=FileType.audio
    )

    info = manager.get_task_info(tid)
    assert info.status == TaskStatus.completed
    assert info.progress == 1.0
    assert info.result is not None
    assert info.result.filename == "output.mp3"
    
    # 4. 验证内部路径获取
    path = manager.get_artifact_path(tid, FileType.audio)
    assert path == dummy_file

def test_lifecycle_failure():
    """测试从 创建 -> 失败 的流程"""
    manager = TaskManager()
    tid = manager.create_task()

    manager.mark_failed(tid, message="Something went wrong", trace_id="abc-123")
    
    info = manager.get_task_info(tid)
    assert info.status == TaskStatus.failed
    assert info.error is not None
    assert info.error.message == "Something went wrong"
    assert info.result is None

# ==========================================
# 2. Defense & Security Tests (防御性测试)
# ==========================================

def test_zombie_protection_completed(tmp_path):
    """测试：任务完成后，禁止再更新进度 (僵尸复活防御)"""
    manager = TaskManager()
    tid = manager.create_task()
    
    # 完成任务
    f = tmp_path / "test.wav"
    f.touch()
    manager.mark_completed(tid, artifact_path=f)

    # 尝试非法操作
    with pytest.raises(RuntimeError, match="task already finalized"):
        manager.update_progress(tid, progress=0.5)

    with pytest.raises(RuntimeError, match="task already finalized"):
        manager.mark_failed(tid, message="Fail it")

def test_zombie_protection_failed():
    """测试：任务失败后，禁止复活"""
    manager = TaskManager()
    tid = manager.create_task()
    manager.mark_failed(tid, message="Original error")

    # 尝试再次失败或更新
    with pytest.raises(RuntimeError):
        manager.mark_running(tid)
        
    info = manager.get_task_info(tid)
    assert info.status == TaskStatus.failed
    assert info.error.message == "Original error"

def test_file_not_found_on_disk(tmp_path):
    """测试：如果物理文件不存在，mark_completed 应该直接报错"""
    manager = TaskManager()
    tid = manager.create_task()
    
    fake_path = tmp_path / "ghost.mp3"
    # 不创建文件

    with pytest.raises(FileNotFoundError):
        manager.mark_completed(tid, artifact_path=fake_path)

def test_progress_bounds():
    """测试：进度条不能超出 0.0 - 1.0"""
    manager = TaskManager()
    tid = manager.create_task()

    with pytest.raises(ValueError):
        manager.update_progress(tid, progress=1.5)
    
    with pytest.raises(ValueError):
        manager.update_progress(tid, progress=-0.1)

# ==========================================
# 3. Artifact Access Tests (文件获取测试)
# ==========================================

def test_get_artifact_premature(tmp_path):
    """测试：任务没完成时，不能获取文件路径"""
    manager = TaskManager()
    tid = manager.create_task()
    
    # 还是 queued/running 状态
    with pytest.raises(RuntimeError, match="Task not completed"):
        manager.get_artifact_path(tid, FileType.audio)

def test_get_artifact_missing_type(tmp_path):
    """测试：任务完成了 Audio，但你非要取 MIDI"""
    manager = TaskManager()
    tid = manager.create_task()
    
    f = tmp_path / "t.mp3"
    f.touch()
    manager.mark_completed(tid, artifact_path=f, file_type=FileType.audio)

    # 成功获取 Audio
    assert manager.get_artifact_path(tid, FileType.audio) == f

    # 失败获取 MIDI
    with pytest.raises(KeyError, match="Artifact not available"):
        manager.get_artifact_path(tid, FileType.midi)

# ==========================================
# 4. Maintenance Tests (清理逻辑)
# ==========================================

def test_prune_logic():
    """测试：过期的任务被清理，没过期的保留"""
    manager = TaskManager()
    
    # 任务 A: 刚创建 (新)
    tid_new = manager.create_task()
    
    # 任务 B: 很久以前 (旧)
    tid_old = manager.create_task()
    
    # 手动篡改内部时间 (模拟时间流逝)
    # 注意: _tasks 是内部变量，仅用于测试 Hack
    old_time = datetime.now(timezone.utc) - timedelta(hours=2)
    manager._tasks[tid_old].updated_at = old_time
    
    # 执行清理 (阈值 1小时)
    removed_count = manager.prune(max_age_seconds=3600)
    
    assert removed_count == 1
    assert manager.exists(tid_new) is True
    assert manager.exists(tid_old) is False