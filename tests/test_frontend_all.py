import shutil
import subprocess
import sys
import pytest

def test_frontend_all_contracts_and_editor():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed; skipping frontend JS tests")
    r = subprocess.run(
        [node, "scripts/run_frontend_all_tests.js"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    sys.stdout.write(r.stdout or "")
    sys.stderr.write(r.stderr or "")
    assert r.returncode == 0
