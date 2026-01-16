import subprocess, sys, os, shutil, pytest

def test_frontend_editor_contracts():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed; skipping frontend editor contract tests")
    cmd = [node, os.path.join("scripts", "run_frontend_editor_contract_tests.js")]
    p = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(p.stdout)
    sys.stderr.write(p.stderr)
    assert p.returncode == 0
