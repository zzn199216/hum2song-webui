# core/audio_preprocess.py
"""
音频预处理模块 (Step 02) - Optimized

功能：
- 接受任意 librosa 支持的音频格式（wav/mp3/m4a 等）
- 仅读取前 N 秒，防止超长音频拖垮内存/CPU
- 重采样 & 单声道 & 归一化
- 输出 <原文件名>_clean.wav
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Union
import logging
import sys

import numpy as np
import librosa
import soundfile as sf

from core.config import get_settings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def preprocess_audio(
    input_path: Union[str, Path],
    output_dir: Optional[Union[str, Path]] = None,
) -> Path:
    """
    标准化音频预处理入口。

    步骤：
        1. 只解码前 max_audio_seconds 秒
        2. 重采样到 target_sample_rate
        3. 单声道
        4. 峰值归一化到 0.99
        5. 保存为 <name>_clean.wav
    """
    settings = get_settings()
    in_path = Path(input_path)

    if not in_path.exists():
        raise FileNotFoundError(f"输入文件不存在: {in_path}")

    # 1. 决定输出路径
    if output_dir:
        out_dir = Path(output_dir)
    else:
        out_dir = in_path.parent

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{in_path.stem}_clean.wav"

    # 2. 大小预警（不阻断，仅提醒）
    try:
        size_mb = in_path.stat().st_size / (1024 * 1024)
        if size_mb > settings.max_upload_size_mb:
            logger.warning(
                "⚠️ 输入文件 %.2fMB 超过配置上限 %.2fMB，仍将尝试预处理。",
                size_mb,
                settings.max_upload_size_mb,
            )
    except OSError:
        # 某些文件系统可能 stat 失败，忽略即可
        pass

    target_sr = settings.target_sample_rate
    max_sec = settings.max_audio_seconds if settings.max_audio_seconds > 0 else 20

    logger.info(
        "🔊 [Preprocess] 加载音频: %s (sr -> %d, 只读前 %.1fs, mono=True)",
        in_path.name,
        target_sr,
        max_sec,
    )

    try:
        # 核心优化：即使用户丢一个 1 小时文件，也只解码前 max_sec 秒
        y, sr = librosa.load(
            str(in_path),
            sr=target_sr,
            mono=True,
            duration=max_sec,
        )
    except Exception as e:
        logger.error("❌ Librosa 加载失败: %s", e)
        if "NoBackendError" in str(e) or "audioread" in str(e):
            logger.error("💡 提示: 请检查系统是否安装了 FFmpeg（librosa 读取 mp3/m4a 需要它）")
        raise

    # 3. 峰值归一化到 0.99
    if y.size > 0:
        max_vol = float(np.max(np.abs(y)))
    else:
        max_vol = 0.0

    if max_vol > 0:
        y = y / max_vol * 0.99
    else:
        logger.warning("⚠️ 读取到的音频为空或全静音。")

    # 4. 写出为标准 WAV
    logger.info("💾 [Preprocess] 写入: %s", out_path.name)
    sf.write(str(out_path), y, target_sr)

    logger.info(
        "✅ [Preprocess] 完成: %s (sr=%d, duration=%.2fs)",
        out_path.name,
        target_sr,
        len(y) / target_sr if target_sr > 0 else 0.0,
    )

    return out_path


def _auto_find_test_file() -> Optional[Path]:
    """
    在 uploads 目录中自动寻找测试音频：
    - 排除 .gitkeep
    - 排除 *_clean.wav
    """
    settings = get_settings()
    if not settings.upload_dir.exists():
        settings.upload_dir.mkdir(parents=True, exist_ok=True)

    candidates = list(settings.upload_dir.glob("*"))
    test_files = [
        f
        for f in candidates
        if f.is_file()
        and f.name != ".gitkeep"
        and not f.name.endswith("_clean.wav")
    ]
    return test_files[0] if test_files else None


if __name__ == "__main__":
    print("\n🧪 --- Step 02: 预处理节点测试 (Optimized) ---")
    settings = get_settings()

    # 支持：python core/audio_preprocess.py uploads\test.m4a
    if len(sys.argv) >= 2:
        in_file = Path(sys.argv[1])
    else:
        print(f"📂 未指定文件，自动扫描 {settings.upload_dir} ...")
        in_file = _auto_find_test_file()
        if not in_file:
            print(f"❌ 错误: {settings.upload_dir} 目录下没有任何音频文件。")
            print("💡 请放入一个 .wav/.mp3/.m4a 后重试。")
            sys.exit(1)

    print(f"🎯 目标文件: {in_file}")

    try:
        out = preprocess_audio(in_file)
        if out.exists() and out.stat().st_size > 0:
            print(f"🎉 预处理测试通过！输出路径:\n   {out}")
        else:
            print("❌ 测试失败：文件未生成或为空。")
    except Exception as e:
        print(f"💥 测试崩溃: {e}")
        print("💡 请检查 ffmpeg 是否安装 / 音频文件是否损坏。")
        raise
