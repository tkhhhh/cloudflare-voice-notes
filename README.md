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
 │   polls    │ ── GET /api/messages ─▶│  KV<id, Message>      │
 │            │                        │                        │
 │            │                        │  ctx.waitUntil(        │
 │            │                        │    Whisper → Llama →   │
 │            │                        │    update KV)         │
 └────────────┘                        └────────────────────────┘
```

## Categories

Fixed set, chosen for coverage without overlap:

- **todo** — actionable task
- **reminder** — time-bound ("tomorrow", "at 3pm")
- **idea** — concept to explore
- **question** — something to look up
- **note** — fallback for general observations

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
├── wrangler.jsonc        # AI + Assets + KV bindings
├── src/
│   └── index.ts          # Worker: HTTP routes + inline AI pipeline, backed by KV
├── public/
│   ├── index.html
│   ├── app.js            # MediaRecorder + polling
│   └── styles.css
├── scripts/
│   └── deploy.mjs        # Substitutes $KV_ID into wrangler.jsonc, then `wrangler deploy`
├── ARCHITECTURE.md       # Design notes
└── prompts.md            # AI prompt history for submission
```

## Submission notes

- `prompts.md` contains the full prompt history used while building this with Claude Code (Opus 4.7).
- Single-user demo — no auth.
