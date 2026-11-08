const recordBtn = document.getElementById("recordBtn");
const recordLabel = document.getElementById("recordLabel");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("messageList");
const emptyEl = document.getElementById("empty");
const filterButtons = document.querySelectorAll(".filter");

const CATEGORY_META = {
  todo:     { icon: "✓",  color: "#f59e0b" },
  idea:     { icon: "💡", color: "#8b5cf6" },
  reminder: { icon: "⏰", color: "#ef4444" },
  note:     { icon: "📝", color: "#3b82f6" },
  question: { icon: "❓", color: "#10b981" },
};

let mediaRecorder = null;
let chunks = [];
let recording = false;
let activeFilter = "all";
let pollTimer = null;

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = mediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      await upload(blob, type);
    };
    mediaRecorder.start();
    recording = true;
    recordBtn.classList.add("recording");
    recordLabel.textContent = "Stop";
    statusEl.textContent = "Recording…";
  } catch (err) {
    statusEl.textContent = `Mic error: ${err.message}`;
  }
}

function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  recording = false;
  recordBtn.classList.remove("recording");
  recordLabel.textContent = "Record";
  statusEl.textContent = "Uploading…";
}

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
}

async function upload(blob, contentType) {
  try {
    const res = await fetch("/api/record", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!res.ok) throw new Error(await res.text());
    const { messageId } = await res.json();
    statusEl.textContent = `Processing ${messageId.slice(0, 8)}…`;
    startPolling(messageId);
  } catch (err) {
    statusEl.textContent = `Upload failed: ${err.message}`;
  }
}

function startPolling(targetId) {
  const started = Date.now();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await refresh();
    const row = document.querySelector(`[data-id="${targetId}"]`);
    if (row && row.dataset.status === "done") {
      statusEl.textContent = "Done.";
      clearInterval(pollTimer);
      pollTimer = null;
    } else if (Date.now() - started > 90_000) {
      statusEl.textContent = "Still processing — check back soon.";
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 1500);
}

async function refresh() {
  const res = await fetch("/api/messages");
  const { messages } = await res.json();
  render(messages);
}

function render(messages) {
  const filtered = activeFilter === "all"
    ? messages
    : messages.filter((m) => m.category === activeFilter);

  emptyEl.hidden = filtered.length > 0;
  listEl.innerHTML = filtered.map(renderRow).join("");
}

function renderRow(m) {
  const meta = CATEGORY_META[m.category] ?? { icon: "…", color: "#999" };
  const time = new Date(m.created_at).toLocaleString();
  const body = m.status === "processing"
    ? `<em class="processing">transcribing & classifying…</em>`
    : `<span class="cat" style="background:${meta.color}">${meta.icon} ${escapeHtml(m.category ?? "")}</span>
       <span class="text">${escapeHtml(m.transcript ?? "")}</span>`;
  return `
    <li data-id="${m.id}" data-status="${m.status}">
      <div class="row">${body}</div>
      <div class="meta">
        <span class="time">${time}</span>
        <button class="del" data-id="${m.id}" aria-label="Delete">✕</button>
      </div>
    </li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function deleteMessage(id) {
  await fetch(`/api/messages/${id}`, { method: "DELETE" });
  await refresh();
}

recordBtn.addEventListener("click", () => (recording ? stopRecording() : startRecording()));

listEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (btn) deleteMessage(btn.dataset.id);
});

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    refresh();
  });
});

refresh();
