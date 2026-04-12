#!/usr/bin/env python3
"""
Beginner preflight / doctor: read-only checks for local Hum2Song prerequisites.

Does not install packages, download assets, or modify the filesystem (except
reading .env for the same keys the app uses). Safe to run before `pip install`.

Run from repository root:
  python scripts/beginner_preflight.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parent.parent
CHECKLIST = "docs/BEGINNER_FIRST_RUN_CHECKLIST.md"


def _load_env_file(path: Path) -> None:
    """Merge KEY=VALUE lines into os.environ if key not already set (like typical .env precedence)."""
    if not path.is_file():
        return
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if not key:
            continue
        val = val.strip()
        if val.startswith('"') and val.endswith('"') and len(val) >= 2:
            val = val[1:-1].replace('\\"', '"')
        elif val.startswith("'") and val.endswith("'") and len(val) >= 2:
            val = val[1:-1]
        if key not in os.environ:
            os.environ[key] = val


def _abs_path(p: Path) -> Path:
    if p.is_absolute():
        return p.resolve()
    return (ROOT / p).resolve()


def _which_fluidsynth() -> Optional[str]:
    cmd = shutil.which("fluidsynth")
    if cmd:
        return cmd
    if os.name == "nt":
        return shutil.which("fluidsynth.exe")
    return None


def _try_health(port: int) -> Optional[Dict[str, Any]]:
    url = f"http://127.0.0.1:{port}/api/v1/health"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "hum2song-beginner-preflight"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError):
        return None


def main(suppress_next_step_hint: bool = False) -> int:
    _load_env_file(ROOT / ".env")

    print("Hum2Song beginner preflight")
    print("-" * 40)

    fail = False

    # --- Python ---
    v = sys.version_info
    ver_s = f"{v.major}.{v.minor}.{v.micro}"
    if v < (3, 10):
        print(f"[MISSING] Python {ver_s} (need 3.10+; README recommends 3.11+ for local dev)")
        print(f"          See: {CHECKLIST}")
        fail = True
    elif v < (3, 11):
        print(f"[WARN]    Python {ver_s} (README recommends 3.11+; OK for many setups)")
    else:
        print(f"[PASS]    Python {ver_s} (>= 3.11)")

    # --- SoundFont (same env keys as core/config.py) ---
    raw_sf2 = os.environ.get("SOUND_FONT_PATH") or os.environ.get("SF2_PATH")
    if raw_sf2:
        sf2 = _abs_path(Path(raw_sf2))
    else:
        sf2 = _abs_path(Path("assets/piano.sf2"))

    assets_dir = ROOT / "assets"
    fallback_sf2 = sorted(assets_dir.glob("*.sf2")) if assets_dir.is_dir() else []

    if sf2.exists():
        print(f"[PASS]    SoundFont at {sf2}")
    elif fallback_sf2:
        print(f"[WARN]    Default SoundFont not at {sf2}")
        print(f"          Found other .sf2 in assets/: {fallback_sf2[0].name} (app may fall back; prefer piano.sf2)")
    else:
        print(f"[MISSING] SoundFont - place a .sf2 at {sf2} (see assets/README.txt)")
        print(f"          See: {CHECKLIST}")
        fail = True

    # --- FluidSynth ---
    fs_override = os.environ.get("FLUIDSYNTH_PATH")
    if fs_override:
        fs_p = _abs_path(Path(fs_override))
        if fs_p.exists():
            print(f"[PASS]    FluidSynth via FLUIDSYNTH_PATH={fs_p}")
        else:
            print(f"[MISSING] FLUIDSYNTH_PATH points to missing file: {fs_p}")
            print(f"          See: {CHECKLIST}")
            fail = True
    else:
        w = _which_fluidsynth()
        if w:
            print(f"[PASS]    FluidSynth on PATH ({w})")
        else:
            print("[MISSING] FluidSynth not found (install and add to PATH, or set FLUIDSYNTH_PATH in .env)")
            print(f"          See: {CHECKLIST}")
            fail = True

    # --- FFmpeg ---
    ff = shutil.which("ffmpeg") or (shutil.which("ffmpeg.exe") if os.name == "nt" else None)
    if ff:
        print(f"[PASS]    FFmpeg on PATH ({ff})")
    else:
        print("[WARN]    FFmpeg not on PATH - MP3 and some conversions may fail (WAV may still work)")
        print(f"          See: {CHECKLIST}")

    # --- Optional: live health if server is up ---
    try:
        port = int(os.environ.get("PORT", "8000"))
    except ValueError:
        port = 8000
    health = _try_health(port)
    if health is None:
        print(f"[SKIP]    Live health check - server not responding on port {port} (optional)")
        print("          After `uvicorn app:app`, open: http://127.0.0.1:8000/api/v1/health")
    else:
        chk = health.get("checks") or {}
        print(f"[PASS]    Live health OK (http://127.0.0.1:{port}/api/v1/health)")
        print(
            f"          Server reports: soundfont_exists={chk.get('soundfont_exists')} "
            f"fluidsynth={chk.get('fluidsynth')} ffmpeg={chk.get('ffmpeg')}"
        )

    print("-" * 40)
    if fail:
        print("Result: some required items are missing. Fix the [MISSING] lines above.")
        print(f"Help: {CHECKLIST}")
        return 1
    print("Result: OK for core audio prerequisites (see any [WARN] lines).")
    if not suppress_next_step_hint:
        print(f"Next: python scripts/beginner_setup.py  (venv + pip) - see {CHECKLIST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
