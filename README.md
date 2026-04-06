# Hum2Song MVP（中文版）

Hum2Song 是一个“哼歌成曲”的 MVP 服务：
- 上传一段短音频（wav/mp3/m4a/ogg/flac）
- 运行流水线（预处理 → wav→midi → 合成）
- 下载生成的音频 / MIDI（取决于流水线产物）

本仓库目前同时提供 **两套 API**：
- **契约 API（已冻结，推荐使用）**：`/generate`、`/tasks/{id}`、`/tasks/{id}/download?file_type=...`
- **旧版 API（临时兼容）**：`/api/v1/...`（仅用于旧测试/旧客户端，未来可能移除）

This repo includes: **Backend API** + **Hum2Song Studio** (browser UI for clip editing, piano roll, LLM Optimize).

**First-time local setup:** use the compact checklist [docs/BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md) (prerequisites, SoundFont, health check).

**Quick machine check (optional):** from the project root, `python scripts/beginner_preflight.py` (read-only; does not install anything). See the checklist section *0. Quick preflight*.

### Quick Start (TL;DR)

1. **Prerequisites:** Python 3.11+, **FFmpeg** and **FluidSynth** on your PATH, and a **SoundFont** file at **`assets/piano.sf2`** (not bundled in git — see [`assets/README.txt`](assets/README.txt)). Optional: copy `.env.example` to `.env` and adjust paths.
2. Create venv and install dependencies (first install can take a while because `requirements.txt` includes larger ML/audio packages):
   ```powershell
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Start the server (from project root; required for correct app import):
   ```powershell
   uvicorn app:app
   ```
   (Optional: add `--reload` for local development.)
   - **Export MIDI 404?** Run `python scripts/check_export_routes.py` to verify routes; restart uvicorn to pick up changes.
4. **Verify environment:** open [http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health) and check `checks` — for full audio output you want `soundfont_exists`, `fluidsynth`, and `ffmpeg` to reflect a usable setup (see checklist for details).
5. Open **API docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
6. Open **Studio UI**: [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui)

**Note:** You do **not** need Node.js to run the server or Studio; Node is only for [frontend tests](#测试) (`scripts/run_frontend_all_tests.js`).

**Studio (Hum2Song Studio) — first run:**
- Open [http://127.0.0.1:8000/ui](http://127.0.0.1:8000/ui) to start.
- **Controls:** R = record toggle, P = play/pause (button), S = stop + reset playhead (S appears only while playing; does not stop recording).
- **Quick Optimize:** Choose Preset + Goals (Fix Pitch / Tighten Rhythm / Reduce Outliers) → Run Optimize.
- **Advanced** is collapsed by default and contains Prompt, Regenerate, LLM Settings, and Debug.
- **Quality gate:** In Full mode, if Fix Pitch or Tighten Rhythm is enabled, velocity-only patches are rejected once and you'll see actionable guidance.
- **Tone.js** loads locally by default (`/static/pianoroll/vendor/tone/Tone.js`); CDN fallback only if `window.H2S_ALLOW_CDN_TONE === true`.
- **Sampler instruments (e.g. Piano):** Optional; see [docs/INSTRUMENT_LIBRARY.md](docs/INSTRUMENT_LIBRARY.md) for sample asset setup.
- E2E validation: see [docs/STUDIO_E2E_CHECKLIST.md](docs/STUDIO_E2E_CHECKLIST.md). Phase C covers Recording/Import → auto-open editor → Quick Optimize.

---

## 环境要求

- **OS:** Windows is the primary documented path; macOS/Linux work with the same Python/venv flow (adjust paths and venv activation).
- **Python 3.11+**
- **FFmpeg** on PATH（mp3 转码等）
- **FluidSynth** on PATH（MIDI → 音频合成）；也可在 `.env` 中设置 `FLUIDSYNTH_PATH`
- **SoundFont（必需）：** 默认使用 **`assets/piano.sf2`**（仓库不附带；见 [`assets/README.txt`](assets/README.txt)，可用 `SOUND_FONT_PATH` / `SF2_PATH` 指向其他 `.sf2`）
- 建议使用 `venv` 虚拟环境

**Optional (secondary):** If you prefer containers, a root [`Dockerfile`](Dockerfile) installs FFmpeg, FluidSynth, and Python deps — you must still provide a SoundFont (e.g. mount or copy into `assets/`). The image uses **Python 3.10**; local dev above recommends **3.11+**. There is no `docker-compose` in this repo.

---

## 安装与启动（Windows）

1. 安装 FFmpeg、FluidSynth，并准备好 **`assets/piano.sf2`**（见上文与 [docs/BEGINNER_FIRST_RUN_CHECKLIST.md](docs/BEGINNER_FIRST_RUN_CHECKLIST.md)）。
2. 创建环境并安装依赖：

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

3. 启动服务（请在**项目根目录**执行）：

```powershell
uvicorn app:app
```

（开发时可加 `--reload`。）

4. 自检：打开 [http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health) 查看 `checks`。

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
