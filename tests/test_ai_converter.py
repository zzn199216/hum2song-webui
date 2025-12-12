import os
import shutil
from pathlib import Path
import pytest
from core.ai_converter import audio_to_midi
from core.config import get_settings

@pytest.fixture
def clean_env():
    """清理环境变量"""
    old_env = os.environ.copy()
    yield
    os.environ.clear()
    os.environ.update(old_env)

@pytest.fixture
def workspace(tmp_path):
    """准备测试用的输入输出目录"""
    # 1. 创建假的 clean.wav
    in_dir = tmp_path / "uploads"
    out_dir = tmp_path / "outputs"
    in_dir.mkdir()
    out_dir.mkdir()
    
    wav_path = in_dir / "test_song_clean.wav"
    # 写入 1KB 的垃圾数据冒充 wav (Stub模式不在乎内容)
    with open(wav_path, "wb") as f:
        f.write(b"\x00" * 1024)
        
    return wav_path, out_dir

def test_stub_mode_generation(clean_env, workspace):
    """测试 Stub 模式：必须生成合法的 MIDI 文件"""
    wav_path, out_dir = workspace
    
    # 1. 强制开启 Stub 模式
    # 注意：因为 Settings 是 LRU Cache 的，我们直接修改实例属性最稳妥
    settings = get_settings()
    original_state = settings.use_stub_converter
    settings.use_stub_converter = True
    
    try:
        # 2. 执行转换
        midi_path = audio_to_midi(wav_path, output_dir=out_dir)
        
        # 3. 验证
        assert midi_path.exists()
        assert midi_path.name == "test_song.mid" # 检查重命名逻辑 (_clean 去除)
        assert midi_path.stat().st_size > 0
        
        # 4. 验证二进制头 (MThd)
        with open(midi_path, "rb") as f:
            header = f.read(4)
            assert header == b"MThd"
            
    finally:
        # 还原状态
        settings.use_stub_converter = original_state

def test_input_not_found():
    """测试文件不存在的情况"""
    with pytest.raises(FileNotFoundError):
        audio_to_midi("ghost_file.wav")

# 注意：Real 模式通常不放入自动化单元测试，
# 因为它涉及下载大模型(100MB+)和 TensorFlow 初始化，耗时太长。
# Real 模式我们通过 CLI 手动验证。