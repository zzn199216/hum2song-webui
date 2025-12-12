# core/config.py
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict


# Project root: .../hum2song-mvp
BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """
    Hum2Song MVP settings.

    Reads from:
    - environment variables
    - .env in project root

    Goals:
    - sensible defaults for MVP
    - normalize paths
    - auto-create runtime dirs
    - safe limits for uploads & audio
    - keep config truly configurable (no silent hard-lock)
    """

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Environment / server ----
    app_env: str = Field(default="development", validation_alias="APP_ENV")
    host: str = Field(default="0.0.0.0", validation_alias="HOST")
    port: int = Field(default=8000, validation_alias="PORT")

    # ---- Paths ----
    upload_dir: Path = Field(default=Path("uploads"), validation_alias="UPLOAD_DIR")
    output_dir: Path = Field(default=Path("outputs"), validation_alias="OUTPUT_DIR")

    # SoundFont path (support alias SF2_PATH)
    sound_font_path: Path = Field(
        default=Path("assets/piano.sf2"),
        validation_alias=AliasChoices("SOUND_FONT_PATH", "SF2_PATH"),
    )

    # Optional explicit fluidsynth executable path (Windows fallback)
    fluidsynth_path: Optional[Path] = Field(
        default=None, validation_alias="FLUIDSYNTH_PATH"
    )

    # ---- Upload & audio safety ----
    max_upload_size_mb: int = Field(default=10, validation_alias="MAX_UPLOAD_SIZE_MB")

    # Keep MVP short for faster feedback (Default to 30s as agreed)
    max_audio_seconds: int = Field(default=30, validation_alias="MAX_AUDIO_SECONDS")

    # Basic Pitch commonly uses 22050Hz.
    target_sample_rate: int = Field(default=22050, validation_alias="TARGET_SAMPLE_RATE")

    # ---- AI model tuning (optional) ----
    onset_threshold: float = Field(default=0.5, validation_alias="ONSET_THRESHOLD")
    frame_threshold: float = Field(default=0.3, validation_alias="FRAME_THRESHOLD")

    # ---- Converter switch ----
    use_stub_converter: bool = Field(
        default=True, validation_alias="USE_STUB_CONVERTER"
    )

    def model_post_init(self, __context) -> None:
        # 1) Normalize paths to absolute, relative to BASE_DIR
        self.upload_dir = self._abs_path(self.upload_dir)
        self.output_dir = self._abs_path(self.output_dir)
        self.sound_font_path = self._abs_path(self.sound_font_path)

        if self.fluidsynth_path:
            self.fluidsynth_path = self._abs_path(self.fluidsynth_path)

        # 2) Ensure runtime directories exist
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 3) Defensive clamps (lightweight, avoid surprising overrides)
        if self.max_upload_size_mb <= 0:
            self.max_upload_size_mb = 10

        # Duration clamp: keep MVP responsive
        if self.max_audio_seconds <= 0:
            self.max_audio_seconds = 20
        elif self.max_audio_seconds > 60:
            self.max_audio_seconds = 60

        # Sample rate sanity: allow user override, but prevent nonsense
        # ⚠️ CRITICAL FIX: Ensure fallback aligns with default (22050)
        if self.target_sample_rate < 8000:
            self.target_sample_rate = 22050

        # Threshold clamps
        self.onset_threshold = float(min(max(self.onset_threshold, 0.05), 0.95))
        self.frame_threshold = float(min(max(self.frame_threshold, 0.05), 0.95))

    @staticmethod
    def _abs_path(p: Path) -> Path:
        if p.is_absolute():
            return p
        return (BASE_DIR / p).resolve()

    @property
    def assets_dir(self) -> Path:
        return (BASE_DIR / "assets").resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


if __name__ == "__main__":
    # Quick self-check
    s = get_settings()
    print("✅ Settings loaded")
    print(f"📂 BASE_DIR: {BASE_DIR}")
    print(f"📥 UPLOAD_DIR: {s.upload_dir}")
    print(f"📤 OUTPUT_DIR: {s.output_dir}")
    print(f"🎹 SoundFont: {s.sound_font_path} | exists={s.sound_font_path.exists()}")
    if s.fluidsynth_path:
        print(f"🎼 FluidSynth override: {s.fluidsynth_path} | exists={s.fluidsynth_path.exists()}")

    print(f"🎚️ target_sample_rate: {s.target_sample_rate} Hz")
    print(f"⏱️ max_audio_seconds: {s.max_audio_seconds}s")
    print(f"📦 max_upload_size_mb: {s.max_upload_size_mb}MB")
    print(f"🎛️ AI thresholds: onset={s.onset_threshold}, frame={s.frame_threshold}")
    print(f"🚀 Stub mode: {s.use_stub_converter}")