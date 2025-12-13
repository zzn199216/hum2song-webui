"""
健康检查路由
功能：用于云服务监控存活状态
"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter

from core.config import get_settings

router = APIRouter(prefix="/api/v1", tags=["Health"])


@router.get("/health")
def health() -> Dict[str, Any]:
    """
    健康检查（给前端 / 部署平台 / 监控用）
    - always returns ok=True if API is alive
    - extra diagnostics: dirs, soundfont, binaries
    """
    s = get_settings()

    sf2 = Path(s.sound_font_path)
    uploads = Path(s.upload_dir)
    outputs = Path(s.output_dir)

    # 可选：检查外部工具是否在 PATH（你本机已装 ffmpeg/fluidsynth）
    fluidsynth_ok = bool(shutil.which("fluidsynth")) or (s.fluidsynth_path is not None and Path(s.fluidsynth_path).exists())
    ffmpeg_ok = bool(shutil.which("ffmpeg"))

    return {
        "ok": True,
        "env": s.app_env,
        "paths": {
            "upload_dir": str(uploads),
            "output_dir": str(outputs),
            "soundfont": str(sf2),
        },
        "checks": {
            "upload_dir_exists": uploads.exists(),
            "output_dir_exists": outputs.exists(),
            "soundfont_exists": sf2.exists(),
            "fluidsynth": fluidsynth_ok,
            "ffmpeg": ffmpeg_ok,
        },
    }
