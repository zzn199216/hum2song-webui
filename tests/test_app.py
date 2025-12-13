import os
import pytest
from fastapi.testclient import TestClient
from app import create_app
from core.config import get_settings

# 使用 fixture 来封装 client，避免重复代码
@pytest.fixture
def client(monkeypatch, tmp_path):
    """
    创建一个指向临时目录的 TestClient。
    这样 lifespan 启动时创建的文件夹会在临时目录里，
    不会污染你的项目根目录。
    """
    # 1. 准备临时路径
    temp_upload = tmp_path / "uploads"
    temp_output = tmp_path / "outputs"
    
    # 2. 修改环境变量 (这会影响 get_settings 的结果)
    monkeypatch.setenv("UPLOAD_DIR", str(temp_upload))
    monkeypatch.setenv("OUTPUT_DIR", str(temp_output))
    
    # 3. 清除 lru_cache，确保 get_settings 重新读取环境变量
    # (Pydantic Settings通常被缓存，这一步很重要)
    get_settings.cache_clear()
    
    # 4. 创建 App 和 Client
    app = create_app()
    with TestClient(app) as c:
        yield c
    
    # 5. 测试结束后再次清除缓存，防止影响其他测试
    get_settings.cache_clear()

def test_app_root(client):
    """测试根路径"""
    response = client.get("/")
    assert response.status_code == 200
    # 验证返回结构 (根据 app.py 逻辑，可能是 file 或 json)
    if response.headers["content-type"] == "application/json":
        assert response.json()["status"] == "ok"

def test_docs_exist(client):
    """测试 Swagger UI 是否存在"""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]

def test_health_endpoint(client):
    """测试健康检查"""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    # 确保测试环境里的路径确实被修改了 (可选验证)
    # assert "pytest" in data["paths"]["upload_dir"]