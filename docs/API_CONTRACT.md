# Hum2Song API Contract (MVP v1)

> **Version**: 1.0.0
> **Status**: **Frozen** (Breaking Change)
> **Base URL**: `/` (relative)
> **Source of Truth**: This document is the single canonical contract for Backend (FastAPI), CLI, and any UI.

本契约一旦冻结：
- 服务端必须严格返回本文档定义的字段与枚举值
- 客户端（CLI/UI）必须严格依赖本文档，不得“猜字段”
- **Breaking Change**：旧字段/旧接口直接废弃，不做兼容层

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
- `completed`：**成功**完成，并且产物可下载（至少 audio）
- `failed`：失败结束，不可下载

### 0.4 Progress + Stage
必须同时提供：
- `progress`: float，范围 **[0.0, 1.0]**
- `stage`: string，固定为以下集合：
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
  - `midi`: MIDI 文件
> MVP v1 最低要求：必须支持 `file_type=audio`。

---

## 1. Data Schemas (Frozen)

### 1.1 Enums Definitions
- **TaskStatus**: `queued`, `running`, `completed`, `failed`
- **Stage**: `preprocessing`, `converting`, `synthesizing`, `finalizing`
- **FileType**: `audio`, `midi`
- **OutputFormat**: `mp3`, `wav`, `mid`

### 1.2 Shared Objects

#### TaskResult (Only present when completed)
```json
{
  "audio_format": "mp3",
  "metadata": { "duration": 45.5 },
  "download_urls": {
    "audio": "/tasks/{id}/download?file_type=audio",
    "midi": "/tasks/{id}/download?file_type=midi"
  }
}
TaskError (Only present when failed)
JSON

{
  "message": "human readable error message",
  "trace_id": "optional-uuid-for-logs"
}
2. API Endpoints (Implementation Specs)
2.1 POST /generate
创建任务。

Input: multipart/form-data with file

Response (202 Accepted):

JSON

{
  "task_id": "uuid-string",
  "status": "queued",
  "message": "Task accepted",
  "created_at": "2025-12-15T10:00:00Z"
}
2.2 GET /tasks/{task_id}
查询状态。

Scenario: Running
JSON

{
  "task_id": "uuid-string",
  "status": "running",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:05Z",
  "progress": 0.45,
  "stage": "converting",
  "result": null,
  "error": null
}
Scenario: Completed
JSON

{
  "task_id": "uuid-string",
  "status": "completed",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:30Z",
  "progress": 1.0,
  "stage": "finalizing",
  "result": {
    "audio_format": "mp3",
    "metadata": { "duration": 45.5 },
    "download_urls": {
      "audio": "/tasks/uuid-string/download?file_type=audio",
      "midi": "/tasks/uuid-string/download?file_type=midi"
    }
  },
  "error": null
}
Scenario: Failed
JSON

{
  "task_id": "uuid-string",
  "status": "failed",
  "created_at": "2025-12-15T10:00:00Z",
  "updated_at": "2025-12-15T10:00:05Z",
  "progress": 0.1,
  "stage": "preprocessing",
  "result": null,
  "error": {
    "message": "File format not supported",
    "trace_id": "abc-123"
  }
}
2.3 GET /tasks/{task_id}/download
下载文件。

Query: ?file_type=audio (Required)

Response (200 OK): Binary stream.

Response (404): Task not found or file not ready.

Response (400): Invalid file_type.