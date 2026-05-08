# Hum2Song

Hum2Song 把你的**哼唱或短音频**转成 **MIDI 与合成音频**：上传音频 → 流水线（预处理 → 转 MIDI → 合成）→ 下载结果。

本仓库包含：

| 组件 | 说明 |
|------|------|
| **后端 API** | 异步任务 REST API（`POST /generate`、轮询、下载）。 |
| **Hum2Song Studio** | 浏览器界面 `/ui`：录音/导入、钢琴卷帘编辑、可选 LLM 辅助优化。 |

**语言：** 本文为中文版。英文说明见 **[README.md](README.md)**。

---

## 快速开始（本地）

请在**仓库根目录**执行下列步骤，以保证模块导入路径正确。

### 1. 环境要求

| 要求 | 用途 |
|------|------|
| **Python 3.11+** | 运行 FastAPI 服务。 |
| **FFmpeg** 在 `PATH` 中 | MP3 输出及部分转码。 |
| **FluidSynth** 在 `PATH` 中（或在 `.env` 中设置 `FLUIDSYNTH_PATH`） | MIDI → 音频合成。 |
| **SoundFont（.sf2）** | MIDI 转音频必需。默认路径 **`assets/piano.sf2`**（仓库不包含；见 [`assets/README.txt`](assets/README.txt)）。 |

可选：复制 [`.env.example`](.env.example) 为 `.env`，按需配置 `SOUND_FONT_PATH`、`FLUIDSYNTH_PATH`、`PORT` 等。

**不会安装 FFmpeg / FluidSynth / SoundFont？** 请按 **[docs/BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md#manual-install-soundfont-fluidsynth-ffmpeg)** 中的 **Manual install** 小节逐步操作。

### 2.（可选）环境自检

只读检查，不安装任何依赖：

```powershell
python scripts/beginner_preflight.py
```

### 3. 虚拟环境与依赖

**Windows（PowerShell）：**

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

**macOS / Linux：**

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

首次安装可能较慢（体积较大的机器学习与音频依赖）。

### 4. 启动服务

**推荐方式**（先跑 preflight，再启动 Uvicorn，等待健康检查通过后打印链接）：

```powershell
python scripts/beginner_launch.py
```

常用参数：`--reload`（代码改动自动重载）、`--skip-preflight`、**`--open`**（就绪后在浏览器打开 Studio）。

**等价的手动命令：**

```powershell
uvicorn app:app
```

开发时可加 `--reload`。

### 5. 浏览器访问

| 页面 | 地址 |
|------|------|
| **健康检查 / 诊断** | [http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health) |
| **API 文档（Swagger）** | [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) |
| **Hum2Song Studio** | [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui) |

默认端口 **8000**；可在 `.env` 中修改 `PORT`。

**运行服务与 Studio 不需要 Node.js**；Node 仅用于前端测试脚本（`scripts/run_frontend_all_tests.js`）。

---

## 使用 Hum2Song Studio

1. 启动服务后打开 **[http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)**。
2. **录音**或**导入**音频；支持 WAV、MP3、M4A、OGG、FLAC 等。
3. 在 **钢琴卷帘**中按需编辑。
4. **Quick Optimize：** 选择预设与目标（如 Fix Pitch、Tighten Rhythm、Reduce Outliers），运行优化。
5. **Advanced**（默认折叠）：自定义 Prompt、重新生成、LLM 设置、调试。LLM 为可选项，见下文 [网关 LLM](#网关-llm可选)。

**快捷键：** **R** — 录音开关；**P** — 播放/暂停；**S** — 播放时停止并重置播放头（不停止录音）。

可选采样乐器（如钢琴采样）：[docs/INSTRUMENT_LIBRARY.md](docs/INSTRUMENT_LIBRARY.md)。

Studio 端到端验证清单：[docs/STUDIO_E2E_CHECKLIST.md](docs/STUDIO_E2E_CHECKLIST.md)。

---

## HTTP API 说明

当前提供 **两套** API：

| 类型 | 状态 | 说明 |
|------|------|------|
| **契约 API（已冻结）** | **推荐使用** | `/generate`、`/tasks/{id}`、`/tasks/{id}/download?file_type=...` |
| **旧版 API** | 兼容保留 | `/api/v1/...` — 将来可能移除 |

### 契约 API（摘要）

- **任务状态：** `queued` → `running` → `completed` | `failed`
- **时间字段：** UTC ISO-8601，以 `Z` 结尾（例：`2025-12-15T10:00:00Z`）

**创建任务**

```http
POST /generate?output_format=mp3
Content-Type: multipart/form-data
```

表单字段：`file` = 音频文件。

**查询状态**

```http
GET /tasks/{task_id}
```

**下载**

```http
GET /tasks/{task_id}/download?file_type=audio
GET /tasks/{task_id}/download?file_type=midi
```

**curl 示例（创建任务）：**

```bash
curl -X POST "http://127.0.0.1:8000/generate?output_format=mp3" \
  -F "file=@./sample.wav"
```

**响应示例（202 Accepted）：**

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "poll_url": "/tasks/550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-12-15T10:00:00Z"
}
```

**轮询示例（运行中）：**

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

**完成示例：**

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

**下载音频示例：**

```bash
curl -L \
  "http://127.0.0.1:8000/tasks/550e8400-e29b-41d4-a716-446655440000/download?file_type=audio" \
  -o out.mp3
```

**常见 HTTP 错误：** `400` — `file_type` 非法；`404` — 任务或文件不存在；`409` — 任务未完成或该类型尚不可用；`413` — 上传过大。

也可直接在 **`/docs`** 里交互调试。

### 旧版 API（临时兼容）

> 仅供旧客户端或测试兼容，后续可能移除。

- `POST /api/v1/generate`
- `GET  /api/v1/tasks/{id}`
- `GET  /api/v1/tasks/{id}/download?kind=audio|midi`

---

## 网关 LLM（可选）

Studio 的 **LLM 优化** 需要 **OpenAI 兼容** 的网关地址（本地代理、LiteLLM 等）。**不要把真实的厂商 API Key 放在浏览器里**；对外部署时请使用网关或后端代理保管密钥。

快速配置：**[docs/LLM_GATEWAY_QUICKSTART.md](docs/LLM_GATEWAY_QUICKSTART.md)**。

---

## Docker

根目录 [`Dockerfile`](Dockerfile) 会安装 FFmpeg、FluidSynth 与 Python 依赖；仍需自行提供 **SoundFont**（例如挂载到 `assets/`）。镜像使用 **Python 3.10**，本地开发建议 **3.11+**。本仓库未提供 `docker-compose`。

---

## 常见问题

| 现象 | 建议 |
|------|------|
| 健康检查显示缺少 SoundFont / FluidSynth / FFmpeg | 按 [BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md) 修正路径或安装工具。 |
| 导出 MIDI 相关路由返回 404 | 运行 `python scripts/check_export_routes.py`，修改代码后重启 Uvicorn。 |
| 依赖告警（如 Python 3.13 弃用提示） | 多数不影响 MVP 功能。 |

Tone.js 默认从本地加载（`/static/pianoroll/vendor/tone/Tone.js`）；仅当 `window.H2S_ALLOW_CDN_TONE === true` 时才尝试 CDN。**Full 模式**下若开启 Fix Pitch 或 Tighten Rhythm，纯 velocity 补丁可能被质量门禁拒绝并提示引导。

---

## 测试

**前端（仓库约定的检查）：**

```powershell
node scripts/run_frontend_all_tests.js
```

**后端（可选）：**

```powershell
pytest -q
```

---

## 文档配图说明（供维护者）

仓库内**暂未包含**界面截图。若要在 README 中展示配图，请新建目录 **`docs/images/`**，放入 PNG/WebP 后在本文件中插入 Markdown 图片。

建议截图与文件名（可自行调整）：

| 建议文件名 | 建议内容 |
|------------|----------|
| `docs/images/studio-overview.png` | 打开 `/ui` 后的 Hum2Song Studio 主界面。 |
| `docs/images/api-docs-swagger.png` | `/docs` 的 Swagger 界面（可选）。 |
| `docs/images/health-check.png` | `/api/v1/health` 返回的 JSON（可选）。 |

配图就绪后可插入例如：

```markdown
![Hum2Song Studio 概览](docs/images/studio-overview.png)
```

---

## 更多文档

| 文档 | 内容 |
|------|------|
| [docs/BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md) | 首次运行、手动安装依赖、验证 |
| [docs/LLM_GATEWAY_QUICKSTART.md](docs/LLM_GATEWAY_QUICKSTART.md) | Studio 用 LLM 网关 |
| [docs/INSTRUMENT_LIBRARY.md](docs/INSTRUMENT_LIBRARY.md) | 可选采样乐器 |
| [docs/STUDIO_E2E_CHECKLIST.md](docs/STUDIO_E2E_CHECKLIST.md) | Studio 端到端清单 |
