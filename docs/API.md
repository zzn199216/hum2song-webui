# HTTP API reference

Hum2Song exposes **two** API styles:

| Style | Status | Base paths |
|-------|--------|------------|
| **Contract API (frozen)** | **Recommended** | `/generate`, `/tasks/{id}`, `/tasks/{id}/download?file_type=...` |
| **Legacy** | Compatibility only | `/api/v1/...` — may be removed later |

Interactive docs when the server is running: **http://127.0.0.1:8000/docs**

---

## Contract API

### Task lifecycle

`queued` → `running` → `completed` | `failed`

### Timestamps

All time fields must be **UTC ISO-8601** with a `Z` suffix, e.g. `2025-12-15T10:00:00Z`.

### Create a task

`POST /generate`  
`Content-Type: multipart/form-data`

**Query**

- `output_format`: `mp3` | `wav` (default: `mp3`)

**Form**

- `file`: audio upload (e.g. WAV, MP3, M4A, OGG, FLAC)

**Example**

```bash
curl -X POST "http://127.0.0.1:8000/generate?output_format=mp3" \
  -F "file=@./sample.wav"
```

**Response** `202 Accepted`

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "poll_url": "/tasks/550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-12-15T10:00:00Z"
}
```

### Poll task status

`GET /tasks/{task_id}`

```bash
curl "http://127.0.0.1:8000/tasks/550e8400-e29b-41d4-a716-446655440000"
```

**Example (running)**

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "progress": 0.4,
  "stage": "converting",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:02Z",
  "result": null,
  "error": null
}
```

**Example (completed)**

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 1.0,
  "stage": "finalizing",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:10Z",
  "result": {
    "file_type": "audio",
    "output_format": "mp3",
    "filename": "550e8400-e29b-41d4-a716-446655440000.mp3",
    "download_url": "/tasks/550e8400-e29b-41d4-a716-446655440000/download?file_type=audio"
  },
  "error": null
}
```

### Download artifacts

`GET /tasks/{task_id}/download?file_type=audio|midi`

```bash
curl -L \
  "http://127.0.0.1:8000/tasks/550e8400-e29b-41d4-a716-446655440000/download?file_type=audio" \
  -o out.mp3
```

### Contract API errors

| HTTP | Meaning |
|------|---------|
| `400` | Invalid `file_type` |
| `404` | Unknown task or file missing on disk |
| `409` | Task not finished or requested `file_type` not available yet |
| `413` | Upload too large |

---

## Legacy API

> For old clients/tests only; may be removed.

- `POST /api/v1/generate`
- `GET /api/v1/tasks/{id}`
- `GET /api/v1/tasks/{id}/download?kind=audio|midi`
