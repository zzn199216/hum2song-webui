# PR-7b: LLM client (OpenAI-compatible)

## Gateway endpoint format

- **baseUrl** can be provided with or without a `/v1` path:
  - `https://api.openai.com/v1` → requests go to `https://api.openai.com/v1/chat/completions`
  - `https://my-gateway.com` → normalized to `https://my-gateway.com/v1`, then `.../v1/chat/completions`
- Trailing slashes are stripped before normalization. The client never double-appends `/v1`.

## OpenAI-compatible chat completions

The LLM client (`llm_client.js`) calls the standard **chat completions** endpoint:

- **POST** `{baseUrl}/v1/chat/completions`
- **Body:** `{ model, messages, temperature }` (OpenAI-style)
- **Headers:** `Content-Type: application/json`, optional `Authorization: Bearer <token>`
- Response: assistant text is read from `choices[0].message.content` (with fallback to `choices[0].text` where applicable).

Use a gateway or proxy that speaks this API (e.g. OpenAI, or local/self-hosted proxies that mimic it).
