export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

type Status = "processing" | "done" | "error";

type Message = {
  id: string;
  transcript: string | null;
  category: Category | null;
  status: Status;
  error?: string;
  created_at: number;
};

const CATEGORIES = ["todo", "idea", "reminder", "note", "question"] as const;
type Category = (typeof CATEGORIES)[number];

const SYSTEM_PROMPT = `You classify short voice notes into exactly ONE category.
Allowed categories: todo, idea, reminder, note, question.

Definitions:
- todo: an actionable task the user wants to do
- reminder: time-bound ("tomorrow", "at 3pm", "next week")
- idea: a concept, hypothesis, or thing to explore
- question: something the user wants answered or looked up
- note: a general observation that fits none of the above

Respond with ONLY the single lowercase word. No punctuation, no explanation.`;

const messages = new Map<string, Message>();
seedFakeData(messages);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === "/api/record" && req.method === "POST") {
        return await handleRecord(req, env, ctx);
      }
      if (path === "/api/messages" && req.method === "GET") {
        return handleList();
      }
      const match = path.match(/^\/api\/messages\/([a-f0-9-]+)$/);
      if (match && req.method === "DELETE") {
        messages.delete(match[1]);
        return Response.json({ ok: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      return Response.json({ error: message }, { status: 500 });
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function handleRecord(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) {
    return Response.json({ error: "empty audio body" }, { status: 400 });
  }
  if (audio.byteLength > 20 * 1024 * 1024) {
    return Response.json({ error: "audio exceeds 20MB" }, { status: 413 });
  }

  const id = crypto.randomUUID();
  messages.set(id, {
    id,
    transcript: null,
    category: null,
    status: "processing",
    created_at: Date.now(),
  });

  ctx.waitUntil(processAudio(id, audio, env));

  return Response.json({ messageId: id });
}

function handleList(): Response {
  const sorted = Array.from(messages.values()).sort((a, b) => b.created_at - a.created_at);
  return Response.json({ messages: sorted });
}

async function processAudio(id: string, audio: ArrayBuffer, env: Env): Promise<void> {
  const entry = messages.get(id);
  if (!entry) return;

  try {
    const whisper = await env.AI.run("@cf/openai/whisper", {
      audio: [...new Uint8Array(audio)],
    });
    const transcript = (whisper as { text?: string }).text?.trim();
    if (!transcript) throw new Error("empty transcript from Whisper");

    const classify = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      temperature: 0,
      max_tokens: 8,
    });
    const raw = (classify as { response?: string }).response ?? "";
    const normalized = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
    const category: Category = (CATEGORIES as readonly string[]).includes(normalized)
      ? (normalized as Category)
      : "note";

    messages.set(id, { ...entry, transcript, category, status: "done" });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unknown error";
    messages.set(id, { ...entry, status: "error", error: errorMessage });
  }
}

function seedFakeData(store: Map<string, Message>): void {
  const now = Date.now();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const seed: Array<Omit<Message, "status"> & { status?: Status }> = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      transcript: "Pick up groceries after work — eggs, oat milk, and bread.",
      category: "todo",
      status: "done",
      created_at: now - 3 * minute,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      transcript: "Call the dentist tomorrow morning at nine to reschedule the cleaning.",
      category: "reminder",
      status: "done",
      created_at: now - 42 * minute,
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      transcript: "What if we used WebSockets to stream partial transcripts back to the client as Whisper runs?",
      category: "idea",
      status: "done",
      created_at: now - 2 * hour,
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      transcript: "How does Cloudflare Workers AI meter token usage for Llama 3.3 fp8-fast?",
      category: "question",
      status: "done",
      created_at: now - 5 * hour,
    },
    {
      id: "55555555-5555-5555-5555-555555555555",
      transcript: "Coffee in Shoreditch has gotten noticeably better in the last year.",
      category: "note",
      status: "done",
      created_at: now - 1 * day,
    },
    {
      id: "66666666-6666-6666-6666-666666666666",
      transcript: "Draft the quarterly deck by Friday — focus on retention metrics and the EU launch.",
      category: "todo",
      status: "done",
      created_at: now - 2 * day,
    },
    {
      id: "77777777-7777-7777-7777-777777777777",
      transcript: "Mom's birthday is next Saturday — book the restaurant and order flowers.",
      category: "reminder",
      status: "done",
      created_at: now - 3 * day,
    },
    {
      id: "88888888-8888-8888-8888-888888888888",
      transcript: "A voice-first inbox that batches by category each morning instead of real-time pings.",
      category: "idea",
      status: "done",
      created_at: now - 4 * day,
    },
  ];

  for (const m of seed) {
    store.set(m.id, {
      id: m.id,
      transcript: m.transcript,
      category: m.category,
      status: m.status ?? "done",
      created_at: m.created_at,
    });
  }
}
