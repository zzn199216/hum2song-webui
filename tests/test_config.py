import os
import pytest
from core.config import Settings, BASE_DIR

@pytest.fixture
def clean_env():
    """清理环境变量，保证测试纯净"""
    old_env = os.environ.copy()
    yield
    os.environ.clear()
    os.environ.update(old_env)

def test_alias_choices(clean_env):
    """测试 AliasChoices"""
    # 修复关键点：通过 _env_file=None 强制忽略项目根目录的 .env 文件干扰
    # 这样 Pydantic 才会乖乖去读我们设置的 os.environ
    
    # 情况 A: 使用 SF2_PATH
    os.environ["SF2_PATH"] = "assets/test_alias.sf2"
    s1 = Settings(_env_file=None) 
    assert s1.sound_font_path.name == "test_alias.sf2"
    
    del os.environ["SF2_PATH"]
    
    # 情况 B: 使用 SOUND_FONT_PATH
    os.environ["SOUND_FONT_PATH"] = "assets/test_full.sf2"
    s2 = Settings(_env_file=None)
    assert s2.sound_font_path.name == "test_full.sf2"

def test_sample_rate_correction():
    """测试采样率修正"""
    # 设置一个极低的值 4000
    # 逻辑应修正为 22050 (Basic Pitch 标准)
    s = Settings(TARGET_SAMPLE_RATE=4000, _env_file=None)
    assert s.target_sample_rate == 22050

def test_sanity_clamps():
    """测试防御性逻辑"""
    # 超过 60s -> 60s
    s = Settings(MAX_AUDIO_SECONDS=1000, _env_file=None)
    assert s.max_audio_seconds == 60
    
    # 阈值 > 0.95 -> 0.95
    s = Settings(ONSET_THRESHOLD=5.0, _env_file=None)
    assert s.onset_threshold == 0.95

def test_path_normalization():
    """测试相对路径转绝对路径"""
    s = Settings(UPLOAD_DIR="my_uploads", _env_file=None)
    assert s.upload_dir.is_absolute()
    assert s.upload_dir == (BASE_DIR / "my_uploads").resolve()