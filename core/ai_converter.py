# core/ai_converter.py
"""
AI 转换模块 (Step 03)

功能：
- 接收清洗后的 WAV 文件（通常是 *_clean.wav）
- 根据配置/环境决定使用 Basic Pitch 模型还是 Stub (桩) 模式
- 输出 MIDI 文件 (.mid)，默认放在 settings.output_dir 中

核心对外函数：
    audio_to_midi(audio_path, output_dir=None) -> Path

模式规则（兼容增强）：
- 若环境变量 H2S_AI_MODE=stub|real|auto，则优先按它执行
- 否则按 settings.use_stub_converter：
    - True  -> stub
    - False -> auto（优先 real，失败自动回退 stub，保证 demo 更稳）
"""
from __future__ import annotations

import inspect
import logging
import os
from pathlib import Path
from typing import Optional, Union, Literal

from core.config import get_settings

logger = logging.getLogger(__name__)

AIMode = Literal["auto", "real", "stub"]


def _resolve_ai_mode() -> AIMode:
    """
    Determine AI mode with highest priority:
    1) env var H2S_AI_MODE in {auto, real, stub}
    2) settings.use_stub_converter -> stub else auto
    """
    v = (os.getenv("H2S_AI_MODE") or "").strip().lower()
    if v in ("auto", "real", "stub"):
        return v  # type: ignore[return-value]

    settings = get_settings()
    return "stub" if getattr(settings, "use_stub_converter", False) else "auto"


def audio_to_midi(
    audio_path: Union[str, Path],
    output_dir: Optional[Union[str, Path]] = None,
) -> Path:
    """
    核心转换函数。
    输入：WAV 文件路径（建议传 *_clean.wav）
    输出：MIDI 文件路径（默认 outputs/<base_name>.mid）

    兼容行为：
    - 仍然使用 base_name = stem.replace('_clean','') 生成目标 <base_name>.mid
    - 仍然支持 settings.use_stub_converter
    - 增强：默认 auto（优先 real，失败回退 stub）
    """
    settings = get_settings()
    in_path = Path(audio_path)

    if not in_path.exists():
        raise FileNotFoundError(f"输入文件不存在: {in_path}")

    out_dir = Path(output_dir) if output_dir else Path(settings.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    base_name = in_path.stem.replace("_clean", "")
    target_midi_path = out_dir / f"{base_name}.mid"

    mode = _resolve_ai_mode()
    logger.info("🎹 [AI Converter] 准备转换: %s (mode=%s)", in_path.name, mode)

    if mode == "stub":
        logger.warning("⚠️ 使用 Stub 模式 (生成伪造 MIDI)，不会进行真实 AI 推理。")
        _create_dummy_midi(target_midi_path)
        logger.info("✅ [Stub] MIDI 生成完毕: %s", target_midi_path.name)
        return target_midi_path

    # real / auto: try basic_pitch
    try:
        midi_path = _audio_to_midi_basic_pitch(in_path, target_midi_path, out_dir)
        logger.info("✅ [AI Converter] 转换成功: %s", midi_path.name)
        return midi_path
    except Exception as e:
        if mode == "real":
            raise
        logger.warning("⚠️ Real 推理失败，自动回退 Stub: %s", e)
        _create_dummy_midi(target_midi_path)
        logger.info("✅ [Stub Fallback] MIDI 生成完毕: %s", target_midi_path.name)
        return target_midi_path


def _create_dummy_midi(path: Path) -> None:
    """
    生成一个最小合法的 MIDI 文件（短琶音：C-E-G-C），用于测试流程。
    直接写入二进制数据，避免依赖 mido 等第三方库。
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    def vlq(n: int) -> bytes:
        if n == 0:
            return b"\x00"
        out = bytearray()
        while n > 0:
            out.append(n & 0x7F)
            n >>= 7
        out.reverse()
        for i in range(len(out) - 1):
            out[i] |= 0x80
        return bytes(out)

    header = (
        b"MThd"
        + (6).to_bytes(4, "big")
        + (0).to_bytes(2, "big")
        + (1).to_bytes(2, "big")
        + (480).to_bytes(2, "big")
    )

    events = bytearray()
    events += vlq(0) + bytes([0xC0, 0x00])  # program change: piano

    notes = [60, 64, 67, 72]  # C4 E4 G4 C5
    velocity = 80
    dur = 480  # ticks

    for n in notes:
        events += vlq(0) + bytes([0x90, n, velocity])
        events += vlq(dur) + bytes([0x80, n, 0x00])

    events += vlq(0) + b"\xFF\x2F\x00"  # end of track

    track = b"MTrk" + len(events).to_bytes(4, "big") + bytes(events)

    with open(path, "wb") as f:
        f.write(header + track)


def _audio_to_midi_basic_pitch(
    in_path: Path,
    target_midi_path: Path,
    out_dir: Path,
) -> Path:
    """
    使用 Basic Pitch 模型将音频转换为 MIDI。

    关键点：
    - 你当前安装的 basic_pitch 的 predict_and_save() 需要显式传：
      save_midi / sonify_midi / save_model_outputs / save_notes / model_or_model_path
    - 这里通过 inspect.signature 做“按签名过滤参数”，避免版本差异导致崩。
    - 输出文件名可能是：
        <stem>.mid
        <stem>_basic_pitch.mid
      最终统一重命名为 target_midi_path（去掉 _clean 的 <base_name>.mid）
    """
    settings = get_settings()

    logger.info("🧠 加载 Basic Pitch 推理器... (可能会较慢)")
    try:
        from basic_pitch.inference import predict_and_save  # type: ignore
        from basic_pitch import ICASSP_2022_MODEL_PATH  # type: ignore
    except Exception as e:
        raise RuntimeError(f"basic_pitch 导入失败：{e}")

    sig = inspect.signature(predict_and_save)
    params = sig.parameters

    onset = getattr(settings, "onset_threshold", None)
    frame = getattr(settings, "frame_threshold", None)

    # 候选参数（会按签名过滤，只传 predict_and_save 真正支持的）
    candidates = {
        # 常见主参数
        "audio_path_list": [str(in_path)],
        "output_directory": str(out_dir),

        # 你当前版本里是必填
        "save_midi": True,
        "sonify_midi": False,
        "save_model_outputs": False,
        "save_notes": False,
        "model_or_model_path": ICASSP_2022_MODEL_PATH,

        # 可选阈值/时长（有就传）
        "onset_threshold": onset,
        "frame_threshold": frame,
        "minimum_note_length": 50.0,  # ms（有的版本会是默认 127.7）
    }

    call_kwargs = {}
    for k, v in candidates.items():
        if v is None:
            continue
        if k in params:
            call_kwargs[k] = v

    # 兜底：如果你的版本不是 audio_path_list，而是别的命名（极少见）
    if "audio_path_list" not in call_kwargs:
        for alt in ("audio_paths", "audio_path", "audio_files"):
            if alt in params:
                call_kwargs[alt] = [str(in_path)]
                break

    # 最低必填检查：如果签名里这些参数没有默认值但我们没提供，就直接报清晰错误
    missing_required = []
    for name, p in params.items():
        if p.default is inspect._empty and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY):
            if name not in call_kwargs:
                missing_required.append(name)
    if missing_required:
        raise TypeError(f"predict_and_save 缺少必填参数：{missing_required}；当前已准备参数：{sorted(call_kwargs.keys())}")

    logger.info("🔥 开始 AI 推理 (可能需要几秒)...")
    predict_and_save(**call_kwargs)

    stem = in_path.stem
    base_name = stem.replace("_clean", "")

    candidates_out = [
        out_dir / f"{stem}.mid",
        out_dir / f"{stem}_basic_pitch.mid",
        out_dir / f"{base_name}.mid",
        out_dir / f"{base_name}_basic_pitch.mid",
    ]

    generated = next((p for p in candidates_out if p.exists()), None)

    if generated is None:
        mids = sorted(out_dir.glob("*.mid"), key=lambda p: p.stat().st_mtime, reverse=True)
        generated = mids[0] if mids else None

    if generated is None or not generated.exists():
        raise FileNotFoundError("AI 执行完毕，但未找到任何 .mid 输出文件。")

    if target_midi_path.exists():
        target_midi_path.unlink()

    if generated.resolve() != target_midi_path.resolve():
        generated.rename(target_midi_path)

    return target_midi_path


if __name__ == "__main__":
    import sys

    s = get_settings()
    print("\n🧪 --- Step 03: AI 转换器节点测试 ---")
    if len(sys.argv) < 2:
        print("用法: python -m core.ai_converter <path/to/*_clean.wav>")
        raise SystemExit(1)

    p = Path(sys.argv[1])
    print("input =", p)
    print("H2S_AI_MODE =", os.getenv("H2S_AI_MODE"))
    print("use_stub_converter =", getattr(s, "use_stub_converter", None))
    out = audio_to_midi(p)
    print("midi =", out, "size =", out.stat().st_size)
