#!/usr/bin/env python
"""Diagnostic: confirm export router is registered in the app uvicorn would load."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure project root is on path (uvicorn runs from project root)
_root = Path(__file__).resolve().parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

def main():
    import app as app_mod
    a = getattr(app_mod, "app", None)
    print("app module file:", getattr(app_mod, "__file__", None))
    print("has app attr:", hasattr(app_mod, "app"))
    if not a:
        print("ERROR: No FastAPI app found")
        return 1
    paths = [r.path for r in a.router.routes if hasattr(r, "path")]
    export_paths = [p for p in paths if "export" in p or "midi" in p]
    print("Paths with export/midi:", export_paths)
    if "/export/midi" not in paths:
        print("ERROR: /export/midi NOT registered. Export router may be missing.")
        return 1
    print("OK: /export/midi is registered.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
