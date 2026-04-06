#!/usr/bin/env python3
"""
Beginner-friendly local server launch: same path as the README (uvicorn app:app from repo root).

- Optionally runs preflight first (see scripts/beginner_preflight.py).
- Prefers ./venv Python when present so you can run without activating the venv.
- Does not install packages or create a venv.

From repository root:
  python scripts/beginner_launch.py
  python scripts/beginner_launch.py --skip-preflight
  python scripts/beginner_launch.py --reload
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
_ROOT = _SCRIPTS.parent
_CHECKLIST = "docs/BEGINNER_FIRST_RUN_CHECKLIST.md"


def _python_exe(root: Path) -> Path:
    """Prefer project venv if it exists (README standard layout); else current interpreter."""
    if os.name == "nt":
        v = root / "venv" / "Scripts" / "python.exe"
    else:
        v = root / "venv" / "bin" / "python"
    if v.is_file():
        return v.resolve()
    return Path(sys.executable).resolve()


def _have_uvicorn(py: Path, cwd: Path) -> bool:
    r = subprocess.run(
        [str(py), "-c", "import uvicorn"],
        cwd=str(cwd),
        capture_output=True,
        timeout=60,
    )
    return r.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Start Hum2Song locally (uvicorn app:app).")
    ap.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Do not run scripts/beginner_preflight.py first (not recommended).",
    )
    ap.add_argument(
        "--reload",
        action="store_true",
        help="Pass --reload to uvicorn (auto-restart on code changes).",
    )
    args = ap.parse_args()

    os.chdir(_ROOT)

    if str(_SCRIPTS) not in sys.path:
        sys.path.insert(0, str(_SCRIPTS))
    import beginner_preflight as bp

    bp._load_env_file(_ROOT / ".env")

    if not args.skip_preflight:
        print("(Running preflight first. Use --skip-preflight to skip.)\n")
        rc = bp.main(suppress_next_step_hint=True)
        if rc != 0:
            print()
            print("Launch aborted. Fix the [MISSING] items or see " + _CHECKLIST)
            return 1
        print()

    py = _python_exe(_ROOT)
    if not _have_uvicorn(py, _ROOT):
        print("[MISSING] Cannot import `uvicorn` with this interpreter:")
        print(f"          {py}")
        print("          Install dependencies: pip install -r requirements.txt (usually inside a venv).")
        print(f"          See: {_CHECKLIST}")
        return 1

    try:
        port = int(os.environ.get("PORT", "8000"))
    except ValueError:
        port = 8000

    host = (os.environ.get("HOST") or "127.0.0.1").strip() or "127.0.0.1"

    print("Hum2Song local launch")
    print("-" * 40)
    cmd = [str(py), "-m", "uvicorn", "app:app", "--host", host, "--port", str(port)]
    if args.reload:
        cmd.append("--reload")
    print("Command:", " ".join(cmd))
    print("Directory:", _ROOT)
    print("-" * 40)
    print("When the server is running, open:")
    print(f"  Studio:   http://127.0.0.1:{port}/ui")
    print(f"  Health:   http://127.0.0.1:{port}/api/v1/health")
    print(f"  API docs: http://127.0.0.1:{port}/docs")
    print("-" * 40)
    print("Press Ctrl+C to stop the server.")
    if host not in ("127.0.0.1", "localhost", "::1"):
        print(f"(Bound on {host}:{port}; use the URLs above from this machine.)")
    print()

    try:
        r = subprocess.run(cmd, cwd=str(_ROOT))
        if r.returncode != 0:
            print()
            print("If the server exited immediately: port may be in use, or imports failed.")
            print("Try another PORT in .env, stop other servers on this port, or see " + _CHECKLIST)
        return r.returncode
    except KeyboardInterrupt:
        print("\nServer stopped.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
