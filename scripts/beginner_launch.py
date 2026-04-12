#!/usr/bin/env python3
"""
Beginner-friendly local server launch: same path as the README (uvicorn app:app from repo root).

- Optionally runs preflight first (see scripts/beginner_preflight.py).
- Prefers ./venv Python when present so you can run without activating the venv.
- Waits until GET /api/v1/health responds (bounded time), then keeps the server running.
- Optional --open: open Hum2Song Studio in the default browser after readiness (or after timeout).
- Does not install packages or create a venv (use scripts/beginner_setup.py for that).

From repository root:
  python scripts/beginner_launch.py
  python scripts/beginner_launch.py --skip-preflight
  python scripts/beginner_launch.py --reload
  python scripts/beginner_launch.py --open
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
_ROOT = _SCRIPTS.parent
_CHECKLIST = "docs/BEGINNER_FIRST_RUN_CHECKLIST.md"

# Bounded wait for FastAPI to accept connections (import-heavy app may take several seconds).
_READY_TIMEOUT_SEC = 45.0
_POLL_INTERVAL_SEC = 0.4
_STILL_WAITING_EVERY_SEC = 2.0


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


def _health_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/api/v1/health"


def _wait_for_ready(port: int, proc: subprocess.Popen, timeout_sec: float) -> tuple[str, float]:
    """
    Poll health until JSON ok=true, subprocess exits, or timeout.
    Returns (status, elapsed) where status is 'ready' | 'timeout' | 'dead'.
    """
    url = _health_url(port)
    start = time.monotonic()
    last_msg = 0.0
    while True:
        code = proc.poll()
        if code is not None:
            return "dead", time.monotonic() - start

        elapsed = time.monotonic() - start
        if elapsed > timeout_sec:
            return "timeout", elapsed

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hum2song-beginner-launch"})
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("ok") is True:
                        return "ready", elapsed
        except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError):
            pass

        if elapsed - last_msg >= _STILL_WAITING_EVERY_SEC:
            print(f"  ... still waiting ({elapsed:.0f}s / {timeout_sec:.0f}s) ...")
            last_msg = elapsed

        time.sleep(_POLL_INTERVAL_SEC)


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
    ap.add_argument(
        "--open",
        action="store_true",
        help="Open Studio (/ui) in the default browser when ready (or after wait timeout).",
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
        print("          Prepare the Python environment (creates ./venv if needed, then pip install):")
        print("            python scripts/beginner_setup.py")
        print("          Or manually: activate ./venv and run pip install -r requirements.txt")
        print(f"          See: {_CHECKLIST}")
        return 1

    try:
        port = int(os.environ.get("PORT", "8000"))
    except ValueError:
        port = 8000

    host = (os.environ.get("HOST") or "127.0.0.1").strip() or "127.0.0.1"

    studio_url = f"http://127.0.0.1:{port}/ui"
    docs_url = f"http://127.0.0.1:{port}/docs"

    print("Hum2Song local launch")
    print("-" * 40)
    cmd = [str(py), "-m", "uvicorn", "app:app", "--host", host, "--port", str(port)]
    if args.reload:
        cmd.append("--reload")
    print("Command:", " ".join(cmd))
    print("Directory:", _ROOT)
    print("-" * 40)
    print("Starting server process...")
    print(f"Readiness: waiting for {_health_url(port)} (max {_READY_TIMEOUT_SEC:.0f}s).")
    print('"Ready" means the API responds with ok=true (same as a manual health check).')
    print("-" * 40)

    try:
        proc = subprocess.Popen(cmd, cwd=str(_ROOT))
    except OSError as e:
        print(f"Failed to start server: {e}")
        return 1

    time.sleep(0.15)
    if proc.poll() is not None:
        print()
        print("The server process exited immediately (port in use, import error, or bad command).")
        print("Try another PORT in .env, stop other servers on this port, or see " + _CHECKLIST)
        return proc.returncode if proc.returncode is not None else 1

    status, elapsed = _wait_for_ready(port, proc, _READY_TIMEOUT_SEC)

    if status == "dead":
        print()
        print(f"Server process exited after {elapsed:.1f}s (check the log output above).")
        print("If the port was already in use, set PORT in .env or stop the other process.")
        print("See " + _CHECKLIST)
        return proc.returncode if proc.returncode is not None else 1

    if status == "ready":
        print(f"[Ready] Health check OK after {elapsed:.1f}s.")
    else:
        print(
            f"[Notice] Could not confirm readiness within {_READY_TIMEOUT_SEC:.0f}s "
            f"(waited {elapsed:.1f}s). The server may still be starting, or something is wrong."
        )
        print("Open the URLs below manually. If the page fails to load, check the terminal output.")

    print()
    print("Local URLs:")
    print(f"  Studio:   {studio_url}")
    print(f"  Health:   {_health_url(port)}")
    print(f"  API docs: {docs_url}")
    if host not in ("127.0.0.1", "localhost", "::1"):
        print(f"(Server bound on {host}:{port}; use 127.0.0.1 URLs from this machine.)")

    if args.open:
        if status == "ready":
            print("Opening Studio in your default browser...")
        else:
            print("Opening Studio in your default browser (may load before the server is up; retry if needed)...")
        try:
            webbrowser.open(studio_url)
        except OSError as e:
            print(f"Could not open browser: {e}. Open manually: {studio_url}")

    print("-" * 40)
    print("Server is running. Press Ctrl+C to stop.")
    print()

    try:
        r = proc.wait()
        if r != 0:
            print()
            print("Server process ended with a non-zero exit code.")
            print("See " + _CHECKLIST)
        return r
    except KeyboardInterrupt:
        print("\nStopping server...")
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("Server stopped.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
