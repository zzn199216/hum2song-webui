# tests/test_frontend_core.py
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")

@pytest.mark.skipif(NODE is None, reason="node is not installed; frontend core tests require Node.js")
def test_frontend_core_node():
    script = REPO_ROOT / "scripts" / "run_frontend_tests.js"
    assert script.exists(), f"Missing test runner: {script}"
    proc = subprocess.run([NODE, str(script)], cwd=str(REPO_ROOT), capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    assert proc.returncode == 0
