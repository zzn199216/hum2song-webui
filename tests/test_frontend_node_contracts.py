import os
import sys
import shutil
import subprocess

import pytest


def test_frontend_node_contracts():
    """Run frontend Node contract tests as part of pytest.

    Purpose: keep frontend regressions from slipping in even when only
    running the backend test suite.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed; skipping frontend tests")

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    script = os.path.join(repo_root, "scripts", "run_frontend_all_tests.js")

    if not os.path.exists(script):
        pytest.skip("frontend test runner not found: scripts/run_frontend_all_tests.js")

    res = subprocess.run(
        [node, script],
        cwd=repo_root,
        capture_output=True,
        text=True,
        shell=False,
    )

    if res.returncode != 0:
        # Print logs for debugging in CI / local runs
        sys.stdout.write(res.stdout or "")
        sys.stderr.write(res.stderr or "")

    assert res.returncode == 0
