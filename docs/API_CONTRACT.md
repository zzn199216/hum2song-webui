# Hum2Song API Contract (MVP v1)

> **Version**: 1.0.0  
> **Status**: **Frozen** (Contract API)  
> **Base URL**: `/` (relative)  
> **Source of Truth**: This document is the single canonical contract for Backend (FastAPI), CLI, and any UI.

本契约一旦冻结：
- 服务端（**Contract API**）必须严格返回本文档定义的字段与枚举值
- 客户端（CLI/UI）必须严格依赖本文档，不得“猜字段”
- **Breaking Change（针对 Contract API）**：字段/枚举/路径发生变更时，以本文档为准；旧版本不保证兼容

> 说明：仓库中可能存在旧版 `/api/v1/*` 兼容接口用于历史测试或过渡使用。  
> 该兼容接口 **不属于本契约范围**，且可在未来移除。本文档仅约束 **Contract API**（无 `/api/v1` 前缀）。

---

## 0. Global Rules (Frozen)

### 0.1 Naming
- JSON 字段全部使用 **snake_case**
- 枚举值全部使用 **lowercase**（如 `running`）

### 0.2 Time Format (UTC only)
所有时间字段必须为 **UTC ISO8601 且以 `Z` 结尾**：

- Example: `2025-12-15T10:00:00Z`
- 禁止输出本地时区时间（如 Asia/Taipei）；前端/客户端自行转换时区展示

### 0.3 Task Lifecycle (Status Machine)
任务状态枚举固定为：

`queued → running → completed | failed`

语义：
- `completed`：**成功**完成，并且产物可下载（至少 `audio`）
- `failed`：失败结束，不可下载

允许的转移：
- `queued → running`
- `running → completed`
- `running → failed`
- `queued → failed`（允许：入队后校验失败/立刻失败）

禁止的转移：
- `completed → *`
- `failed → *`

### 0.4 Progress + Stage
必须同时提供：
- `progress`: float，范围 **[0.0, 1.0]**
- `stage`: string，固定集合（Frozen）：

`preprocessing | converting | synthesizing | finalizing`

规则：
- `queued` MUST: `progress = 0.0`
- `completed` MUST: `progress = 1.0`
- `failed` MAY: 保留失败时的进度值

### 0.5 Download (RESTful)
下载接口固定为：

`GET /tasks/{id}/download?file_type=audio`

- `file_type` 是必填枚举（Frozen）：
  - `audio`: 最终音频（mp3 或 wav）
  - `midi`: MIDI 文件（若实现则必须遵循契约）

> MVP v1 最低要求：必须支持 `file_type=audio`。  
> 若暂未支持 `midi`，必须返回明确的 409（见 2.3）。

### 0.6 Breaking Change Policy (Contract API)
- 本文档未定义的字段：**Contract API** 服务端 **不得** 返回（避免“垃圾字段污染契约”）
- 任何变更必须先改本文档，再改模型/代码/测试

---

## 1. Data Schemas (Frozen)

### 1.1 Enums

#### TaskStatus
- `queued`
- `running`
- `completed`
- `failed`

#### Stage
- `preprocessing`
- `converting`
- `synthesizing`
- `finalizing`

#### FileType
- `audio`
- `midi`

#### OutputFormat
- `mp3`
- `wav`
- `mid` (only for `file_type=midi`)

---

### 1.2 Error Object
`error` 仅在 `status=failed` 时出现（否则为 `null`）

```json
{
  "message": "human readable error message",
  "trace_id": "optional id for log correlation"
}
```

规则：
- `message` MUST：可读、可展示给用户
- `trace_id` SHOULD：建议服务端生成短 uuid/hex，用于定位日志（可选）

---

### 1.3 Result Object
`result` 仅在 `status=completed` 时出现（否则为 `null`）

```json
{
  "file_type": "audio",
  "output_format": "mp3",
  "filename": "550e8400-e29b-41d4-a716-446655440000.mp3",
  "download_url": "/tasks/{id}/download?file_type=audio"
}
```

规则：
- `download_url` MUST：立即可用
- `filename` MUST：可用于 `Content-Disposition`

---

### 1.4 TaskInfo Response (Canonical)
这是 `GET /tasks/{id}` 的标准响应结构：

```json
{
  "task_id": "uuid",
  "status": "queued",
  "progress": 0.0,
  "stage": "preprocessing",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:00Z",
  "result": null,
  "error": null
}
```

不变式（Frozen）：
- `created_at` MUST：UTC Z
- `updated_at` MUST：UTC Z
- `status=completed` → `result` MUST NOT be null AND `error` MUST be null
- `status=failed` → `error` MUST NOT be null AND `result` MUST be null

---

## 2. Endpoints (Contract API)

### 2.1 POST /generate
提交音频文件，创建异步任务。

#### Request
- **Content-Type**: `multipart/form-data`

Form fields:
- `file` (required): audio file (`mp3`, `wav`, `m4a`, `ogg`, `flac`, etc.)

Query params:
- `output_format` (optional): `mp3|wav` (default: `mp3`)

Reserved (may be ignored by MVP, but name reserved):
- `keep_intermediates` (optional): `0|1` (default: `0`)  
  > 仅用于调试；不影响对外契约字段

#### Success Response
- **HTTP 202 Accepted**

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "poll_url": "/tasks/550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-12-15T10:00:00Z"
}
```

规则：
- `poll_url` MUST：指向该任务的查询接口

#### Error Responses
- `422 Unprocessable Entity`: missing `file` / invalid form (FastAPI validation)
- `413 Payload Too Large`: file too large (optional enforcement)
- `415 Unsupported Media Type`: unsupported audio type (optional enforcement)

---

### 2.2 GET /tasks/{id}
查询任务状态与结果。

#### Success Response (Queued/Running)
- **HTTP 200 OK**

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "progress": 0.4,
  "stage": "converting",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:40Z",
  "result": null,
  "error": null
}
```

#### Success Response (Completed)
- **HTTP 200 OK**

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 1.0,
  "stage": "finalizing",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:01:23Z",
  "result": {
    "file_type": "audio",
    "output_format": "mp3",
    "filename": "550e8400-e29b-41d4-a716-446655440000.mp3",
    "download_url": "/tasks/550e8400-e29b-41d4-a716-446655440000/download?file_type=audio"
  },
  "error": null
}
```

#### Success Response (Failed)
- **HTTP 200 OK**

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "progress": 0.2,
  "stage": "converting",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:18Z",
  "result": null,
  "error": {
    "message": "BasicPitch model load failed",
    "trace_id": "b7c2f2f2d7c7440c"
  }
}
```

#### Error Responses
- `404 Not Found`: task id does not exist / invalid id format

---

### 2.3 GET /tasks/{id}/download?file_type=audio
下载任务产物。

#### Query Params
- `file_type` (required): `audio|midi`

#### Success
- **HTTP 200 OK**
- Response body: file stream

Recommended headers:
- `Content-Disposition: attachment; filename="..."`
- `Content-Type`:
  - `audio` + `mp3` → `audio/mpeg`
  - `audio` + `wav` → `audio/wav`
  - `midi` → `audio/midi` or `application/octet-stream`

#### Error Responses (Frozen)
- `422 Unprocessable Entity`: missing `file_type` (FastAPI validation)
- `400 Bad Request`: invalid `file_type`
- `404 Not Found`: task not found OR artifact missing on disk
- `409 Conflict`:
  - task status is not `completed` (queued/running/failed)
  - requested `file_type` is not available for this task (e.g., midi not generated)

Example 409 body (optional, but recommended):
```json
{
  "detail": "Task not completed or file_type unavailable"
}
```

---

## 3. OpenAPI / Swagger Requirements (DoD Gate)
- 所有响应必须由 Pydantic 模型定义并生成 OpenAPI Schema
- 禁止使用裸 `dict` / `Any` 作为 Contract API 对外响应结构
- `/docs` 中应清晰显示：
  - TaskStatus/Stage/FileType 等枚举
  - TaskInfoResponse、TaskResult、TaskError 等 schema

---

## 4. Testing Requirements (DoD Gate)
必须新增/维护 `tests/test_api_contract.py` 来确保：
- `/generate` 返回字段齐全（202 + task_id/status/poll_url/created_at）
- `/tasks/{id}` 四态结构符合不变式
- `completed` 必有 `result.download_url`
- `failed` 必有 `error.message`
- 时间字段均为 UTC `...Z` 格式
- `/tasks/{id}/download` 对未完成/不可用返回 409

---

## 5. Notes
- 本契约是 MVP v1 的冻结版本（Contract API）。
- 任何未来扩展（例如新增 file_type、新增 stage）都必须：
  1) 先更新本文件
  2) 再更新 `core/models.py`
  3) 再更新 routers 和 tests
