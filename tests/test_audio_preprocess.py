import os
import shutil
import numpy as np
import soundfile as sf
import librosa
import pytest
from pathlib import Path
from core.audio_preprocess import preprocess_audio
from core.config import get_settings

# 临时目录 fixture：测试完自动清理垃圾
@pytest.fixture
def temp_workspace(tmp_path):
    # 创建模拟的 upload 和 output 目录
    upload_dir = tmp_path / "uploads"
    output_dir = tmp_path / "outputs"
    upload_dir.mkdir()
    output_dir.mkdir()
    return upload_dir, output_dir

def generate_dummy_audio(path: Path, duration_sec: int = 5, sr: int = 44100):
    """辅助函数：生成一个测试用的 WAV 文件 (白噪声)"""
    # 生成随机噪音数据
    data = np.random.uniform(-0.5, 0.5, size=duration_sec * sr)
    sf.write(str(path), data, sr)
    return path

def test_preprocess_happy_path(temp_workspace):
    """测试：正常流程（WAV -> Clean WAV）"""
    upload_dir, _ = temp_workspace
    
    # 1. 造一个 44100Hz 的假文件
    dummy_file = upload_dir / "test_raw.wav"
    generate_dummy_audio(dummy_file, duration_sec=2, sr=44100)
    
    # 2. 运行预处理
    output_path = preprocess_audio(dummy_file)
    
    # 3. 验证文件存在
    assert output_path.exists()
    assert output_path.name == "test_raw_clean.wav"
    
    # 4. 验证音频属性 (必须是 22050Hz, 单声道)
    y, sr = librosa.load(str(output_path), sr=None) # sr=None 表示读取原始采样率
    
    assert sr == 22050  # 核心指标
    assert y.ndim == 1  # 必须是单声道 (1D array)
    
    # 验证时长 (应该约为 2秒)
    duration = len(y) / sr
    assert 1.9 <= duration <= 2.1

def test_file_not_found():
    """测试：输入不存在的文件"""
    with pytest.raises(FileNotFoundError):
        preprocess_audio("non_existent_ghost_file.wav")

def test_custom_output_dir(temp_workspace):
    """测试：指定输出目录"""
    upload_dir, output_dir = temp_workspace
    
    dummy_file = upload_dir / "test_custom.wav"
    generate_dummy_audio(dummy_file)
    
    # 指定输出到 outputs 文件夹
    result = preprocess_audio(dummy_file, output_dir=output_dir)
    
    assert result.parent == output_dir
    assert result.exists()

def test_normalization(temp_workspace):
    """测试：音量归一化"""
    upload_dir, _ = temp_workspace
    
    # 1. 造一个极其小声的文件 (振幅 0.01)
    quiet_file = upload_dir / "quiet.wav"
    data = np.random.uniform(-0.01, 0.01, size=22050)
    sf.write(str(quiet_file), data, 22050)
    
    # 2. 处理
    output_path = preprocess_audio(quiet_file)
    
    # 3. 检查处理后的最大音量
    y, _ = librosa.load(str(output_path), sr=None)
    max_vol = np.max(np.abs(y))
    
    # 应该被拉大到接近 0.99
    assert max_vol > 0.9