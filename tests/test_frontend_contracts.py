import subprocess
import sys
from pathlib import Path


def test_frontend_contracts_node():
    repo_root = Path(__file__).resolve().parents[1]
    script = repo_root / 'scripts' / 'run_frontend_contract_tests.js'
    assert script.exists(), f"Missing {script}"

    # On Windows, 'node' should be available on PATH.
    proc = subprocess.run(
        ['node', str(script)],
        cwd=str(repo_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        # Print node output for debugging
        sys.stdout.write(proc.stdout)
    assert proc.returncode == 0
