# Hum2Song MVP（中文版）

Hum2Song 是一个“哼歌成曲”的 MVP 服务：
- 上传一段短音频（wav/mp3/m4a/ogg/flac）
- 运行流水线（预处理 → wav→midi → 合成）
- 下载生成的音频 / MIDI（取决于流水线产物）

本仓库目前同时提供 **两套 API**：
- **契约 API（已冻结，推荐使用）**：`/generate`、`/tasks/{id}`、`/tasks/{id}/download?file_type=...`
- **旧版 API（临时兼容）**：`/api/v1/...`（仅用于旧测试/旧客户端，未来可能移除）

This repo includes: **Backend API** + **Hum2Song Studio** (browser UI for clip editing, piano roll, LLM Optimize).

### Quick Start (TL;DR)

1. Create venv and install dependencies:
   ```powershell
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. Start the server:
   ```powershell
   uvicorn app:app
   ```
   (Optional: add `--reload` for local development.)
3. Open **API docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
4. Open **Studio UI**: [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)

---

## 环境要求

- Windows + Python 3.11+
- 系统 PATH 中可用的 FFmpeg（用于 mp3 转码）
- FluidSynth（用于 midi → 音频合成）
- 建议使用 `venv` 虚拟环境

---

## 安装与启动（Windows）

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

启动服务：

```powershell
uvicorn app:app
```

（开发时可加 `--reload`。）

- API 文档（Swagger）：[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Studio UI：[http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)

---

## 契约 API（Frozen）

### 任务状态机
`queued → running → completed | failed`

### 时间格式
所有时间字段必须为 **UTC ISO8601**，并以 `Z` 结尾：
`2025-12-15T10:00:00Z`

### 1）创建任务

`POST /generate`  
Content-Type：`multipart/form-data`

Query：
- `output_format`：`mp3|wav`（默认：mp3）

示例：

```bash
curl -X POST "http://127.0.0.1:8000/generate?output_format=mp3" \
  -F "file=@./sample.wav"
```

响应：`202 Accepted`

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "poll_url": "/tasks/550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-12-15T10:00:00Z"
}
```

### 2）轮询任务状态

`GET /tasks/{task_id}`

```bash
curl "http://127.0.0.1:8000/tasks/550e8400-e29b-41d4-a716-446655440000"
```

响应：`200 OK`

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

完成态示例：

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

### 3）下载产物

`GET /tasks/{task_id}/download?file_type=audio|midi`

示例：

```bash
curl -L \
  "http://127.0.0.1:8000/tasks/550e8400-e29b-41d4-a716-446655440000/download?file_type=audio" \
  -o out.mp3
```

#### 错误码（契约 API）
- `400`：`file_type` 非法
- `404`：任务不存在 / 或产物文件在磁盘上丢失
- `409`：任务未完成 / 或请求的 file_type 尚不可用
- `413`：上传文件过大

---

## 旧版 API（临时兼容）

> 仅用于向后兼容旧测试/旧客户端，后续可能移除。

- `POST /api/v1/generate`
- `GET  /api/v1/tasks/{id}`
- `GET  /api/v1/tasks/{id}/download?kind=audio|midi`

---

## Gateway-first LLM setup

For the Studio LLM (Optimize) feature:

- **Recommended:** Use an OpenAI-compatible gateway endpoint (e.g. a local or self-hosted proxy). The frontend stores only **base URL**, **model**, and an optional **gateway auth token** — not the provider’s real API key.
- **Security:** Do not put provider API keys in the browser. For public deployments, use a gateway or backend proxy so keys stay server-side. Keep `.env` and `.env.local` out of version control.
- **Quickstart:** See [docs/LLM_GATEWAY_QUICKSTART.md](docs/LLM_GATEWAY_QUICKSTART.md) to run LLM v0 in ~5 minutes (LiteLLM, UI fields, smoke test).

---

## 测试

**Frontend（硬门禁）**：

```powershell
node scripts/run_frontend_all_tests.js
```

**Backend（可选）**：

```powershell
pytest -q
```

---

## 备注

- 可能会看到一些依赖警告（例如 `audioread` 在 Python 3.13 的弃用警告）。  
  这些 warning 不影响 MVP 功能正确性。
