# Ollama fixtures

Recorded 2026-10-21 against **Ollama 0.40.4 on macOS** (see `docs/ai-helper-plan.md`, Phase 0). Tests replay these
from a fake `node:http` server, split into awkward chunks. They are data, not code.

| File | Where it came from |
|---|---|
| `chat-plain.ndjson` | Real. `qwen3:0.6b`, `think: false`, `num_ctx: 2048`. Ends with the stats object (`prompt_eval_count`, `eval_count`, durations). |
| `chat-thinking.ndjson` | Real. Same model with thinking on: `message.thinking` lines first (with `content: ""`), then `content` lines. A thinking model does this by default when `think` is omitted. |
| `chat-truncated-prompt.ndjson` | Real. A prompt of about 3,000 tokens sent with `num_ctx: 512`. HTTP 200, no error, and `prompt_eval_count` is 35: the oldest messages were silently dropped and the answer is wrong. |
| `chat-empty-messages.json` | Real. `messages: []` answers 200 with `done_reason: "load"` (it only loads the model). Never send empty messages. |
| `errors.json` | Real status codes and bodies for a missing model (404), invalid JSON (400), an embedding model asked to chat (400), and `think` on a model that cannot think (400). Content type is `application/json`, not NDJSON. |
| `show-*.json` | Real `POST /api/show`, trimmed to `capabilities`, `details`, `model_info`, `modified_at`. The context length is the `model_info` key ending `.context_length`. |
| `tags.json` | Real `GET /api/tags` entries for three models, **plus one synthetic cloud stub** (`example-model:cloud`, marked `_synthetic`) built from the fields Ollama documents and its source sets (`remote_model`, `remote_host`). No cloud model was available to record. |
| `chat-error-midstream.ndjson` | **Synthetic**, from `server/routes.go` `streamResponse` (v0.40.4): once bytes have been written, an error is sent as a final `{"error": "..."}` line inside the 200 response. Not provoked on a live server. |
