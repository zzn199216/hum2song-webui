import os
import shutil
import numpy as np
import soundfile as sf
import librosa
import pytest
from pathlib import Path
from core.audio_preprocess import preprocess_audio, prepare_separation_input_audio
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


def test_prepare_separation_input_stereo_44100(temp_workspace):
    """Separation WAV: stereo preserved, 44.1 kHz, task-named output."""
    upload_dir, _ = temp_workspace
    path = upload_dir / "raw_stereo.wav"
    sr = 44100
    t = np.linspace(0, 1.0, sr, endpoint=False)
    L = np.sin(2 * np.pi * 440 * t) * 0.3
    R = np.sin(2 * np.pi * 440 * t) * 0.2
    stereo = np.column_stack([L, R]).astype(np.float32)
    sf.write(str(path), stereo, sr)

    tid = "sep_job_1"
    out = prepare_separation_input_audio(path, upload_dir, tid)

    assert out.name == f"{tid}_separation.wav"
    assert out.parent == upload_dir
    d, sr_out = sf.read(str(out))
    assert sr_out == 44100
    assert d.ndim == 2 and d.shape[1] == 2


def test_prepare_separation_input_mono_duplicated_to_stereo(temp_workspace):
    """Mono source becomes 2-channel separation input for Demucs."""
    upload_dir, _ = temp_workspace
    path = upload_dir / "raw_mono.wav"
    sr = 48000
    t = np.linspace(0, 0.5, int(sr * 0.5), endpoint=False)
    mono = (np.sin(2 * np.pi * 330 * t) * 0.2).astype(np.float32)
    sf.write(str(path), mono, sr)

    out = prepare_separation_input_audio(path, upload_dir, "m1")
    d, sr_out = sf.read(str(out))
    assert sr_out == 44100
    assert d.ndim == 2 and d.shape[1] == 2