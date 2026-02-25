# Export MIDI 404 — Debug Report

## Task A — Module & routes

### A1–A2: What uvicorn imports

```
app module file: W:\git\Hum2song1\hum2song-cursor-dev\app.py
has FastAPI app attr: True
Paths with export/midi: ['/export/midi']
```

- **Module loaded:** `app` resolves to root `app.py`, not an `app/` package.
- **Export router:** `/export/midi` is registered when importing `app`.

### A3: Routes on the imported app

- `/export/midi` appears with `{'POST'}`.
- `openapi.json` includes `"/export/midi"` under `paths`.

---

## Task B — Router setup

### B1: Entrypoint

- `app.py` (root) is the entrypoint.
- No `app/` package or conflicting `app` module found.

### B2: Router registration

```python
# app.py
from routers.export import router as export_router
# ...
app.include_router(export_router)
```

### B3: `routers/export.py`

```python
router = APIRouter(tags=["Export"])  # No prefix
@router.post("/export/midi")
async def export_midi(request: Request): ...
```

- Route path: `/export/midi`.
- Router has no prefix, so the final path is `/export/midi`.

---

## Task C — OpenAPI check

With TestClient: `GET /openapi.json` includes `"/export/midi"`.

---

## Summary: Why a 404 might occur

- The codebase registers `/export/midi` correctly.
- If you see 404 in your environment, likely causes are:
  1. Old uvicorn process still running (before export router was added).
  2. Running uvicorn from the wrong directory so `app` imports a different module.
  3. Reverse proxy or base path stripping `/export/midi`.

---

## Minimal fix plan

1. Stop any existing uvicorn process.
2. Start from project root: `uvicorn app:app`.
3. Run: `python scripts/check_export_routes.py` to confirm routes.
4. If using Docker: rebuild the image (`docker build ...`) and run a fresh container.

---

## Verification

```bash
# 1. Verify routes (from project root)
python scripts/check_export_routes.py

# 2. Backend tests
pytest tests/test_export_midi.py tests/test_flattened_to_score.py -v

# 3. Start server and test
uvicorn app:app --port 8000
# In another terminal:
curl -X POST http://127.0.0.1:8000/export/midi \
  -H "Content-Type: application/json" \
  -d '{"bpm":120,"tracks":[]}' \
  -o out.mid
# Check out.mid starts with MThd (SMF header)
```
