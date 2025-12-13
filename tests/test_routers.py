# tests/test_routers.py
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

# 导入我们需要测试的路由
from routers import generation, health
from core.utils import TaskManager, _TASK_STORE

# --- Setup ---
app = FastAPI()
# 挂载路由
app.include_router(health.router)
app.include_router(generation.router)

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_teardown():
    """每个测试前清空任务列表，防止状态干扰"""
    _TASK_STORE.clear()
    yield
    _TASK_STORE.clear()

# --- Tests ---

def test_health_check():
    """
    测试健康检查接口
    注意：路由前缀是 /api/v1
    """
    # 修正：加上 /api/v1 前缀
    response = client.get("/api/v1/health")
    
    assert response.status_code == 200
    data = response.json()
    
    # 验证你 health.py 返回的具体结构
    assert data["ok"] is True
    assert "env" in data
    assert "checks" in data
    # 甚至可以检查一下路径配置是否读到了
    assert "upload_dir" in data["paths"]

@patch("routers.generation._run_pipeline_sync") 
def test_generate_endpoint_success(mock_pipeline, tmp_path):
    """
    测试 /generate 接口 Happy Path
    """
    file_content = b"fake audio content"
    files = {"file": ("test_song.mp3", file_content, "audio/mpeg")}
    
    response = client.post("/api/v1/generate", files=files)
    
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data
    assert data["status"] in ["pending", "processing"]
    
    task_id = data["task_id"]
    
    # 验证确实调用了后台
    assert mock_pipeline.called is True
    call_args = mock_pipeline.call_args[0]
    assert call_args[0] == task_id

def test_generate_no_filename():
    """测试上传非法文件"""
    files = {"file": ("", b"content", "audio/mpeg")}
    response = client.post("/api/v1/generate", files=files)
    assert response.status_code in [400, 422]

def test_download_flow(tmp_path, monkeypatch):
    """
    测试下载流程
    """
    # Mock settings 指向临时目录
    from core.config import Settings
    def mock_settings():
        return Settings(upload_dir=tmp_path, output_dir=tmp_path)
    monkeypatch.setattr("routers.generation.get_settings", mock_settings)
    
    # 1. 准备物理文件
    fake_mp3 = tmp_path / "final.mp3"
    fake_mp3.write_bytes(b"music data")
    
    # 2. 创建一个“完成”的任务
    tid = TaskManager.create_task("input.wav")
    TaskManager.done_task(tid, result={
        "audio": str(fake_mp3), 
        "midi": str(fake_mp3.with_suffix(".mid")),
        "output_format": "mp3"
    })
    
    # 3. 请求下载 Audio (注意参数是 kind=audio)
    response = client.get(f"/api/v1/tasks/{tid}/download?kind=audio")
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"music data"

def test_download_not_ready():
    """测试任务没完成时去下载"""
    tid = TaskManager.create_task("input.wav") 
    response = client.get(f"/api/v1/tasks/{tid}/download")
    assert response.status_code == 409