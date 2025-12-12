# core/ai_converter.py
"""
AI 转换模块 (Step 03)

功能：
- 接收清洗后的 WAV 文件（通常是 *_clean.wav）
- 根据配置决定使用 Basic Pitch 模型还是 Stub (桩) 模式
- 输出 MIDI 文件 (.mid)，默认放在 settings.output_dir 中

核心对外函数：
    audio_to_midi(audio_path, output_dir=None) -> Path
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, Union

from core.config import get_settings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


# =============================
# 对外主入口
# =============================

def audio_to_midi(
    audio_path: Union[str, Path],
    output_dir: Optional[Union[str, Path]] = None,
) -> Path:
    """
    核心转换函数。
    输入：WAV 文件路径（建议传 *_clean.wav）
    输出：MIDI 文件路径（默认 outputs/<base_name>.mid）

    行为：
    - 如果 settings.use_stub_converter 为 True：
        使用 Stub 模式，生成一个简单的 C 音符 MIDI
    - 否则：
        使用 Basic Pitch 模型进行真实 Audio-to-MIDI 转换
    """
    settings = get_settings()
    in_path = Path(audio_path)

    if not in_path.exists():
        raise FileNotFoundError(f"输入文件不存在: {in_path}")

    # 1. 决定输出目录（默认 outputs/）
    if output_dir:
        out_dir = Path(output_dir)
    else:
        out_dir = settings.output_dir

    out_dir.mkdir(parents=True, exist_ok=True)

    # song_clean.wav -> song.mid
    base_name = in_path.stem.replace("_clean", "")
    target_midi_path = out_dir / f"{base_name}.mid"

    logger.info("🎹 [AI Converter] 准备转换: %s", in_path.name)

    # 2. 分流：Stub 模式 vs Real 模式
    if settings.use_stub_converter:
        logger.warning("⚠️ 使用 Stub 模式 (生成伪造 MIDI)，不会进行真实 AI 推理。")
        _create_dummy_midi(target_midi_path)
        logger.info("✅ [Stub] MIDI 生成完毕: %s", target_midi_path.name)
        return target_midi_path

    # 3. Real 模式: Basic Pitch
    return _audio_to_midi_basic_pitch(in_path, target_midi_path, out_dir)


# =============================
# Stub 实现：最小合法 MIDI
# =============================

def _create_dummy_midi(path: Path) -> None:
    """
    生成一个最小合法的 MIDI 文件 (C4 单音)，用于测试流程。
    直接写入二进制数据，避免依赖 mido 等第三方库。
    """
    # Header: MThd + 长度 6 + 格式 0 + 1 轨 + division=480
    header = (
        b"MThd"
        + (6).to_bytes(4, "big")    # header length
        + (0).to_bytes(2, "big")    # format 0
        + (1).to_bytes(2, "big")    # 1 track
        + (480).to_bytes(2, "big")  # 480 ticks/quarter
    )

    # Track events:
    #  delta 0, Note On, middle C(60), velocity=64
    #  delta 480, Note Off, middle C(60), velocity=0
    #  delta 0, End of Track
    events = (
        b"\x00\x90\x3C\x40"       # Note On
        b"\x83\x60\x80\x3C\x00"   # delta=480, Note Off
        b"\x00\xFF\x2F\x00"       # End of Track
    )

    track = b"MTrk" + len(events).to_bytes(4, "big") + events

    with open(path, "wb") as f:
        f.write(header + track)


# =============================
# Basic Pitch 实现
# =============================

def _audio_to_midi_basic_pitch(
    in_path: Path,
    target_midi_path: Path,
    out_dir: Path,
) -> Path:
    """
    使用 Basic Pitch 模型将音频转换为 MIDI。

    注意：
    - 需要安装 basic-pitch 库
    - 可能较为耗时（取决于机器性能）
    """
    settings = get_settings()

    try:
        logger.info("🧠 加载 Basic Pitch 模型...")
        from basic_pitch.inference import predict_and_save
        from basic_pitch import ICASSP_2022_MODEL_PATH

        logger.info("🔥 开始 AI 推理 (可能需要几秒)...")

        # Basic Pitch 会在 output_directory 下生成多个文件
        predict_and_save(
            audio_path_list=[str(in_path)],
            output_directory=str(out_dir),
            save_midi=True,
            sonify_midi=False,
            save_model_outputs=False,
            save_notes=False,
            model_or_model_path=ICASSP_2022_MODEL_PATH,
            onset_threshold=settings.onset_threshold,
            frame_threshold=settings.frame_threshold,
            minimum_note_length=50.0,  # ms
        )

        # 通常生成: <stem>_basic_pitch.mid
        expected_name = f"{in_path.stem}_basic_pitch.mid"
        generated_file = out_dir / expected_name

        if generated_file.exists():
            # 如已有旧文件，先删
            if target_midi_path.exists():
                target_midi_path.unlink()
            generated_file.rename(target_midi_path)
            logger.info("✅ [AI Converter] 转换成功: %s", target_midi_path.name)
            return target_midi_path

        # 找不到预期文件时的兜底策略：尝试匹配 stem 前缀的其他 .mid
        logger.error("❌ AI 执行完毕，但未找到预期文件: %s", generated_file)
        candidates = list(out_dir.glob(f"{in_path.stem}*.mid"))
        if candidates:
            logger.info("🔎 找到替代 MIDI 文件: %s", candidates[0].name)
            if target_midi_path.exists():
                target_midi_path.unlink()
            candidates[0].rename(target_midi_path)
            return target_midi_path

        raise FileNotFoundError(
            "AI 模型未能生成 MIDI 文件（可能是音频全静音，或者 Basic Pitch 行为变化）。"
        )

    except Exception as e:
        logger.error("❌ AI 转换失败: %s", e)
        raise


# =============================
# 命令行自测入口
# =============================

def _auto_find_clean_wav() -> Optional[Path]:
    """
    在 uploads 目录中寻找一个 *_clean.wav 用于测试。
    """
    settings = get_settings()
    uploads = settings.upload_dir

    if not uploads.exists():
        uploads.mkdir(parents=True, exist_ok=True)

    candidates = list(uploads.glob("*_clean.wav"))
    return candidates[0] if candidates else None


if __name__ == "__main__":
    import sys

    settings = get_settings()
    print("\n🧪 --- Step 03: AI 转换器节点测试 ---")

    # 1) 选择输入文件
    if len(sys.argv) >= 2:
        in_file = Path(sys.argv[1])
    else:
        print(f"📂 未指定文件，自动扫描 {settings.upload_dir} 中的 *_clean.wav ...")
        in_file = _auto_find_clean_wav()
        if not in_file:
            print("❌ 没找到 _clean.wav 文件。请先运行 Step 02 (audio_preprocess.py)。")
            sys.exit(1)

    print(f"🎯 输入音频: {in_file}")
    print(f"⚙️ 当前模式: {'Stub (假装)' if settings.use_stub_converter else 'Real (Basic Pitch)'}")

    try:
        midi_out = audio_to_midi(in_file)
        if midi_out.exists() and midi_out.stat().st_size > 0:
            print("🎉 转换测试通过！")
            print(f"📍 输出 MIDI: {midi_out}")
            if settings.use_stub_converter:
                print("💡 提示: 这是 Stub 生成的简易 MIDI，只是一个简单音符。")
            else:
                print("💡 提示: 这是 Basic Pitch 生成的真 MIDI，可以用播放器听听效果。")
        else:
            print("❌ 测试失败：MIDI 文件未生成或为空。")
    except Exception as e:
        print(f"💥 测试崩溃: {e}")
        raise
