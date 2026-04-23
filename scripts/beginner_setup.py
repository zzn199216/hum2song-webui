#!/usr/bin/env python3
"""
Beginner-friendly local Python setup: create ./venv (if needed) and pip install -r requirements.txt.

Does not install FFmpeg, FluidSynth, or SoundFont (see scripts/beginner_preflight.py).

From repository root:
  python scripts/beginner_setup.py
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
_ROOT = _SCRIPTS.parent
_REQUIREMENTS = _ROOT / "requirements.txt"
_VENV_DIR = _ROOT / "venv"


def _venv_python(root: Path) -> Path:
    if os.name == "nt":
        return (root / "venv" / "Scripts" / "python.exe").resolve()
    return (root / "venv" / "bin" / "python").resolve()


def _venv_usable(py: Path, cwd: Path) -> bool:
    if not py.is_file():
        return False
    r = subprocess.run(
        [str(py), "-c", "import uvicorn, fastapi"],
        cwd=str(cwd),
        capture_output=True,
        timeout=120,
    )
    return r.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Create ./venv (if needed) and pip install -r requirements.txt for Hum2Song."
    )
    ap.parse_args()

    os.chdir(_ROOT)

    if str(_SCRIPTS) not in sys.path:
        sys.path.insert(0, str(_SCRIPTS))
    import beginner_preflight as bp

    bp._load_env_file(_ROOT / ".env")

    print("Hum2Song beginner setup (Python venv + pip)")
    print("-" * 40)
    print(f"Project root: {_ROOT}")

    if not _REQUIREMENTS.is_file():
        print(f"[MISSING] No requirements file: {_REQUIREMENTS}")
        return 1

    py = _venv_python(_ROOT)

    if _venv_usable(py, _ROOT):
        print("[OK]      Virtual environment already looks ready:")
        print(f"          {py}")
        print("          (uvicorn and fastapi import successfully; skipping pip install.)")
        print("-" * 40)
        print("Next: python scripts/beginner_preflight.py   (optional system check)")
        print("      python scripts/beginner_launch.py    (start the server)")
        return 0

    if _VENV_DIR.exists() and not py.is_file():
        print("[WARN]    ./venv exists but the interpreter is missing (folder may be incomplete).")
        print(f"          Removing {_VENV_DIR} so a fresh venv can be created...")
        try:
            shutil.rmtree(_VENV_DIR)
        except OSError as e:
            print(f"[MISSING] Could not remove {_VENV_DIR}: {e}")
            print("          Close programs using this folder, then delete ./venv manually and re-run.")
            return 1

    if not _VENV_DIR.exists():
        print("[INFO]    Creating virtual environment: ./venv ...")
        try:
            r = subprocess.run(
                [sys.executable, "-m", "venv", str(_VENV_DIR)],
                cwd=str(_ROOT),
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            print("[MISSING] Timed out while creating ./venv.")
            return 1
        if r.returncode != 0:
            print("[MISSING] Could not create ./venv. Command was:")
            print(f"          {sys.executable} -m venv {_VENV_DIR}")
            print("          Use Python 3.10+ with the standard library 'venv' module available.")
            return 1
        print("[OK]      Created ./venv")
    else:
        print("[INFO]    ./venv exists but dependencies look incomplete; running pip install ...")

    py = _venv_python(_ROOT)
    if not py.is_file():
        print(f"[MISSING] Expected interpreter not found: {py}")
        return 1

    print("[INFO]    pip install -r requirements.txt (first run can take several minutes) ...")
    pip_cmd = [str(py), "-m", "pip", "install", "-r", str(_REQUIREMENTS)]
    pr = subprocess.run(pip_cmd, cwd=str(_ROOT))
    if pr.returncode != 0:
        print()
        print("[MISSING] pip install failed. Review the output above (network, disk, or compiler errors).")
        print("          You can retry with:")
        print("         ", " ".join(pip_cmd))
        return 1

    if not _venv_usable(py, _ROOT):
        print("[MISSING] After pip install, uvicorn/fastapi still do not import.")
        print("          Remove ./venv and run: python scripts/beginner_setup.py")
        return 1

    print("[OK]      Python environment is ready.")
    print("-" * 40)
    print("Next: python scripts/beginner_preflight.py   (optional system check)")
    print("      python scripts/beginner_launch.py    (start the server)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
