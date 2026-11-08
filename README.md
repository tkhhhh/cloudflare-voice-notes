# Voice Notes — Cloudflare AI Assignment

Record a short voice message in the browser. The app transcribes it with Whisper, classifies it into one of five fixed categories using Llama 3.3, and files it into an inbox — all on Cloudflare.

## Assignment component mapping

| Requirement | Choice |
| --- | --- |
| LLM | **Workers AI** — `@cf/openai/whisper` (transcription) + `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (classification) |
| Workflow / coordination | **Worker** chains the Whisper → Llama → store steps; the upload responds immediately and the pipeline runs via `ctx.waitUntil` |
| User input | **Browser `MediaRecorder`** served from the Worker's static assets |
| Memory / state | **In-memory `Map`** inside the Worker, seeded with fake messages on startup (demo scope — not durable across isolates) |

## Architecture

```
 ┌────────────┐   POST /api/record     ┌────────────────────────┐
 │  Browser   │ ────audio/webm─────▶   │        Worker          │
 │ MediaRec.  │ ◀───messageId──────    │  src/index.ts          │
 │            │                        │                        │
 │   polls    │ ── GET /api/messages ─▶│  Map<id, Message>      │
 │            │                        │                        │
 │            │                        │  ctx.waitUntil(        │
 │            │                        │    Whisper → Llama →   │
 │            │                        │    update Map)         │
 └────────────┘                        └────────────────────────┘
```

## Categories

Fixed set, chosen for coverage without overlap:

- **todo** — actionable task
- **reminder** — time-bound ("tomorrow", "at 3pm")
- **idea** — concept to explore
- **question** — something to look up
- **note** — fallback for general observations

## State caveat

The `Map` lives in the Worker's module scope. In production this means:

- State is lost on isolate restart / cold start.
- Different requests may hit different isolates and see different state.

Fine for the demo. For a real app, swap the `Map` for D1 or Durable Objects.

## Local dev

```bash
npm install
npm run dev
```

Open http://localhost:8787 and click **Record**. Seeded fake messages appear immediately in the inbox so the UI isn't empty.

## Deploy

```bash
npm run deploy
```

## File layout

```
cloudflare-voice-notes/
├── wrangler.jsonc        # AI + Assets bindings only
├── src/
│   └── index.ts          # Worker: HTTP routes + inline AI pipeline + in-memory Map
├── public/
│   ├── index.html
│   ├── app.js            # MediaRecorder + polling
│   └── styles.css
└── prompts.md            # AI prompt history for submission
```

## Submission notes

- `prompts.md` contains the full prompt history used while building this with Claude Code (Opus 4.7).
- Single-user demo — no auth, no persistent storage.
