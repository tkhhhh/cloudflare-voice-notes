# How this app works

A single Cloudflare Worker that serves a static web page, records audio from the browser, transcribes it with Whisper, classifies it with Llama, and files the result into an in-memory inbox.

Three files do all the real work:

- `public/index.html` + `public/app.js` — the UI (served as static assets by the Worker)
- `src/index.ts` — the Worker: HTTP routes + AI pipeline + in-memory store
- `wrangler.jsonc` — binds Workers AI (`AI`) and the static assets folder (`ASSETS`)

---

## 1. Request flow end-to-end

```
┌──────────┐                    ┌───────────────────────────────┐
│ Browser  │                    │          Worker               │
│          │                    │                               │
│ Record   │ ──POST /api/record──▶ handleRecord()                │
│ (webm)   │ ◀──{ messageId }──  │   1. put placeholder in Map  │
│          │                    │   2. ctx.waitUntil(pipeline)  │
│          │                    │   3. return messageId NOW     │
│          │                    │                               │
│ Poll     │ ──GET /api/messages─▶ handleList()                  │
│ every    │ ◀──messages[]────── │   returns Map as array       │
│ 1.5s     │                    │                               │
│          │                    │   (background, asynchronously)│
│          │                    │   Whisper → Llama → update Map│
└──────────┘                    └───────────────────────────────┘
```

Key idea: **the upload responds immediately** with an ID. The actual Whisper + Llama work happens in the background via `ctx.waitUntil`. The browser polls `/api/messages` until the row flips from `processing` to `done`.

This is a lightweight workflow pattern — you don't need Durable Objects or Workflows for a two-step pipeline. `ctx.waitUntil` keeps the Worker alive after the response is sent so the background work can finish.

---

## 2. Frontend (`public/app.js`)

### Recording
- `navigator.mediaDevices.getUserMedia({ audio: true })` asks for mic permission.
- `MediaRecorder` captures audio chunks into an array.
- On `stop`, chunks are glued into a single `Blob` (webm/opus, mp4, or ogg depending on browser support — see `pickMimeType()`).

### Upload
- `fetch("/api/record", { method: "POST", body: blob })` — the Blob goes as the raw request body, not multipart form data. Simpler than FormData and the Worker just reads `req.arrayBuffer()`.
- Response is `{ messageId: "<uuid>" }`.

### Polling
- After upload, `startPolling(messageId)` runs `setInterval` every 1500 ms.
- Each tick calls `refresh()` which re-fetches the full list and re-renders.
- When the target row's `data-status` attribute becomes `done`, the interval clears.
- Hard timeout at 90 s to avoid polling forever if something gets stuck.

### Rendering
- Rows show either `transcribing & classifying…` (status=processing) or `[category badge] [transcript text]` (status=done).
- Filter buttons change `activeFilter` and re-render client-side (no server-side filtering).
- Delete button hits `DELETE /api/messages/:id` and refreshes.

---

## 3. Worker (`src/index.ts`)

### State
```ts
const messages = new Map<string, Message>();
seedFakeData(messages);
```

A plain `Map` at module scope. Seeded with 8 fake messages on cold-start so the UI isn't empty on first load.

**Caveat (intentional, demo scope):** this state lives inside one isolate. Two users on different isolates see different data, and a cold start wipes everything. Real apps would swap this for D1 or a Durable Object.

### Routing
The `fetch` handler is a tiny manual router:

| Method + path | Handler |
| --- | --- |
| `POST /api/record` | `handleRecord` — accept audio, enqueue pipeline |
| `GET /api/messages` | `handleList` — return all messages, newest first |
| `DELETE /api/messages/:id` | inline — `messages.delete(id)` |
| anything else | `env.ASSETS.fetch(req)` — serves `public/` |

The fallback to `ASSETS` is what lets `/`, `/index.html`, `/app.js`, `/styles.css` all work without any explicit route. The static assets binding in `wrangler.jsonc` handles them.

### `handleRecord`
```ts
const audio = await req.arrayBuffer();
// size guards: reject empty, reject > 20 MB
const id = crypto.randomUUID();
messages.set(id, { id, transcript: null, category: null, status: "processing", created_at: Date.now() });
ctx.waitUntil(processAudio(id, audio, env));
return Response.json({ messageId: id });
```

Three things to notice:
1. The placeholder is written **before** the background job starts, so a `GET /api/messages` immediately after the upload will already show the processing row.
2. `ctx.waitUntil(...)` is fire-and-forget from the client's perspective but **tracked** by the Worker runtime — the isolate stays alive until the promise resolves.
3. The response returns in milliseconds; the client never waits for Whisper or Llama.

### `processAudio` — the actual AI pipeline

Step A — **Whisper transcription**:
```ts
const whisper = await env.AI.run("@cf/openai/whisper", {
  audio: [...new Uint8Array(audio)],  // model expects a number array
});
const transcript = whisper.text?.trim();
```

Step B — **Llama classification**:
```ts
const classify = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: transcript },
  ],
  temperature: 0,  // deterministic
  max_tokens: 8,   // we only want one word
});
```

The system prompt constrains output to one of five lowercase words (`todo`, `idea`, `reminder`, `note`, `question`). The response is then normalized (lowercase, strip non-letters) and validated against the allowed set. If the model hallucinates anything else, it falls back to `"note"`. This "closed-set" approach is the trick that makes LLM classification reliable without JSON mode or function calling.

Step C — **Commit result**:
```ts
messages.set(id, { ...entry, transcript, category, status: "done" });
```

On any error, status becomes `"error"` with the message attached. The browser will show either the finished row or (if we added UI for it) the error.

### Why two models?

Whisper is specialized for audio → text; Llama is specialized for text → labels. Running them sequentially — rather than hoping a single multimodal model does both — gives better accuracy for each step and lets you tune them independently (e.g. temperature=0 only matters for the classifier).

---

## 4. `wrangler.jsonc` — what's bound

```jsonc
{
  "name": "voice-notes",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "assets":  { "directory": "./public", "binding": "ASSETS" },
  "ai":      { "binding": "AI" },
  "observability": { "enabled": true }
}
```

- `assets` — Cloudflare serves `public/` directly from the edge; `env.ASSETS.fetch(req)` is the programmatic fallback the Worker uses for non-API routes.
- `ai` — enables `env.AI.run(model, input)` to hit Workers AI without any API keys in code.
- `workers_dev: true` — publishes to `voice-notes.<account>.workers.dev`; no custom domain needed.
- `observability` — surfaces logs/metrics in the dashboard.

No secrets, no D1, no R2, no KV. The whole thing runs on two bindings.

---

## 5. What's deliberately missing

| Missing piece | Why it's OK for the demo |
| --- | --- |
| Durable storage | Single-user demo; `Map` + seed data makes the UI feel alive |
| Auth | Single-user demo |
| Audio file storage (R2) | Classification happens inline; no need to keep the raw audio |
| Retry / dead-letter | If a Workers AI call fails, the row is marked `error` and that's visible to the user |
| Streaming partial transcripts | Nice-to-have — would need WebSockets or SSE |

If you were productionizing this, the first change would be: swap the `Map` for D1, keyed by user, and move `processAudio` into a Workflow or Durable Object so retries survive isolate restarts.
