# LLM Gateway Quickstart

This guide helps you run the Studio **LLM v0** preset end-to-end in about 5 minutes using a local OpenAI-compatible gateway (e.g. LiteLLM Proxy). No provider API key is ever entered in the browser.

---

## 1. What "gateway-first" means (and why)

**Gateway-first** means the browser never sees or stores your provider’s API key. The frontend talks only to a **gateway/proxy** (e.g. LiteLLM) that you run locally or host. The gateway holds the provider key and forwards requests. The browser stores only: **Base URL**, **model name**, and optionally a **gateway auth token** — not the provider key. This keeps keys off the client and makes it easy to switch providers or models by reconfiguring the gateway.

---

## 2. LiteLLM Proxy quickstart

### 2.1 Docker method

**Prerequisite:** Docker installed.

Run a local proxy that accepts OpenAI-style requests and forwards to a provider (e.g. OpenAI). Set the provider key via an environment variable; the browser never sees it.

```bash
docker run -e OPENAI_API_KEY=sk-your-key-here -p 4000:4000 ghcr.io/berriai/litellm:main-latest --port 4000
```

The app will call `http://localhost:4000` (with or without `/v1` — see “Base URL” below). Use this URL and port in the Studio **Base URL** field.

### 2.2 pip method (optional)

**Prerequisite:** Python 3.8+.

```bash
pip install litellm
litellm --port 4000
```

Set the provider key via env (e.g. `OPENAI_API_KEY=sk-...`) before running. Same Base URL as above: `http://localhost:4000`.

---

## 3. Example commands to start a local gateway

**Copy-paste (Docker):** Replace `sk-your-key-here` with your real key. The key stays in the terminal/env, not in the app UI.

```bash
docker run -e OPENAI_API_KEY=sk-your-key-here -p 4000:4000 ghcr.io/berriai/litellm:main-latest --port 4000
```

Use the URL and port from this command (e.g. `http://localhost:4000`) in the Studio **Base URL** field below.

---

## 4. How to fill the UI fields

### 4.1 Where to find the UI

- Open the **Clip Editor** (double-click a clip on the timeline).
- In the right panel, expand **Advanced**.
- Under **LLM Settings (Scaffold)** you’ll see Base URL, Model, Auth Token, and Save / Reset / Test Connection.

**Important:** The **LLM v0** preset is selected in the **Clip Editor** modal — in the **Preset** dropdown next to the Optimize button (Edit → Preset), **not** in the Clip Library or any dropdown outside the modal.

### 4.2 Base URL

The app normalizes the URL: it strips trailing slashes and adds `/v1` if missing, then calls `POST {baseUrl}/v1/chat/completions`. All of these are valid:

- `http://localhost:4000`
- `http://localhost:4000/`
- `http://localhost:4000/v1`

**Base URL and Model are empty by default and are NOT auto-loaded from a repo `.env` file.** You must type (or paste) Base URL and Model in the UI and click **Save**. The frontend does not read `.env` unless your build injects it.

### 4.3 Model

Enter the model name your gateway expects. Examples (via LiteLLM):

- **OpenAI:** `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`
- **Anthropic:** `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`
- **Google:** `gemini/gemini-1.5-flash`, `gemini/gemini-1.5-pro`

Check LiteLLM docs for the exact model string if you use another provider.

### 4.4 Auth Token

- **Set a value** when your gateway requires a Bearer token (e.g. LiteLLM started with `--auth_token`). Use the **gateway** token, not the provider’s API key.
- **Leave blank** when the gateway has no auth (e.g. local Docker with no `--auth_token`).

Do not paste the provider’s API key here; the gateway already has it via env.

---

## 5. Smoke test steps

1. **Configure:** In Clip Editor → Advanced → LLM Settings, enter Base URL (e.g. `http://localhost:4000`) and Model (e.g. `gpt-4o-mini`). Add Auth Token only if your gateway requires it. Click **Save**.
2. **Test connection:** Click **Test Connection**. You should see **Connection OK**.
3. **Run Optimize:** In the same modal, set the **Preset** dropdown to **LLM v0**, then click **Optimize**. On success you’ll see a status like `ok, ops=…` and a new revision; on failure you’ll see a friendly message and **no** new revision.
4. **Verify request:** Open DevTools → Network, filter by “chat” or “completions”. Run Optimize again and confirm one `POST …/chat/completions` request.

**Expected:** Success = new clip revision and status “ok, ops=…”. Failure = status line with a clear message (e.g. “LLM response did not contain a valid JSON patch”) and no new revision.

---

## 6. Troubleshooting

| Symptom / Message | Cause | What to do |
|-------------------|--------|------------|
| **Unauthorized (401/403)** | Gateway rejected auth (wrong or missing token). | If the gateway uses auth, set the correct token in Auth Token and Save. Do not put the provider key there. |
| **404 / Endpoint not found** | Base URL or path wrong. | Check Base URL (e.g. `http://localhost:4000` with correct port). Ensure the gateway is running and exposes `/v1/chat/completions`. |
| **Timeout** | Gateway unreachable or slow. | Confirm gateway is running; check firewall/network. For remote gateways, increase timeout or use a closer host. |
| **LLM response did not contain a valid JSON patch** | Model returned text that wasn’t a valid JSON object (or in a ```json block). | Try another model or adjust the prompt; the app expects one JSON object with an `ops` array. |
| **Patch validation failed (LLM output not accepted)** | JSON was found but failed schema/validation (e.g. invalid op types or note ids). | Check gateway/logs; use a model that follows the patch format (setNote with noteId, before, after, etc.). |
| **Other errors** | Misconfiguration or gateway error. | Double-check Base URL, model name, and gateway logs. Use Test Connection first. |

---

## 7. Security notes

- **Do not** put provider API keys in the browser or in localStorage. Use a gateway; only the gateway holds the provider key.
- Store only **gateway Base URL**, **model**, and (if needed) a **gateway auth token** in the app.
- Keep `.env` and `.env.local` out of git; they are in `.gitignore` for a reason.

---

## 8. Next steps

For API and preset details, see [PR7b_NOTES.md](PR7b_NOTES.md).
