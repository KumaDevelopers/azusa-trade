// Minimal SignalR JSON hub client (WebSocket transport only) for biquote.
// No CDN, API key, external runtime dependency, or Vercel persistent process.
// Wire format: https://learn.microsoft.com/aspnet/core/signalr/hubs
const RECORD = "\x1e";
const HUB = "https://biquote.io/hubs/tick";
export const encodeSignalR = message => JSON.stringify(message) + RECORD;
export function decodeSignalR(text, onFrame) {
  const parts = String(text).split(RECORD);
  for (const part of parts.slice(0, -1)) {
    if (!part) continue;
    try { onFrame(JSON.parse(part)); } catch { /* discard invalid SignalR frame */ }
  }
  return parts.at(-1) || "";
}

export function startBiquoteStream({ symbols, onTick, onState, signal }) {
  let ws = null;
  let retryTimer = null;
  let heartbeat = null;
  let attempts = 0;
  let closed = false;
  let buffer = "";
  let ready = false;
  const current = [...new Set(symbols)].filter(symbol => /^[A-Z0-9]{3,16}$/.test(symbol));
  const state = (next, error) => { if (!closed && !signal?.aborted) onState?.(next, error); };

  function stop() {
    closed = true;
    clearTimeout(retryTimer);
    clearInterval(heartbeat);
    try { ws?.close(1000); } catch { /* may be negotiating */ }
    ws = null;
  }
  signal?.addEventListener("abort", stop, { once: true });

  function reconnect(reason) {
    if (closed || signal?.aborted) return;
    clearTimeout(retryTimer);
    clearInterval(heartbeat);
    ready = false;
    ws = null;
    state("reconnecting", reason);
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
    retryTimer = setTimeout(() => { void connect(); }, delay);
  }

  async function connect() {
    if (closed || signal?.aborted || !current.length) return;
    buffer = "";
    ready = false;
    state("connecting");
    try {
      const negotiation = await fetch(HUB + "/negotiate?negotiateVersion=1", {
        method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: "",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      });
      if (!negotiation.ok) throw new Error("Negosiasi SignalR HTTP " + negotiation.status);
      const data = await negotiation.json();
      const token = data.connectionToken || data.connectionId;
      if (!token || !data.availableTransports?.some(item => item.transport === "WebSockets"))
        throw new Error("WebSocket biquote tidak tersedia.");
      if (closed || signal?.aborted) return;
      const endpoint = HUB.replace(/^https:/, "wss:") + "?id=" + encodeURIComponent(token);
      const connection = new WebSocket(endpoint);
      ws = connection;
      connection.onopen = () => {
        if (closed || connection !== ws) return;
        connection.send(encodeSignalR({ protocol: "json", version: 1 }));
      };
      connection.onmessage = event => {
        if (closed || connection !== ws || typeof event.data !== "string") return;
        buffer += event.data;
        if (buffer.length > 1024 * 1024) { connection.close(); return; }
        buffer = decodeSignalR(buffer, frame => {
          if (frame?.error) {
            state("unavailable", String(frame.error).slice(0, 160));
            stop();
            return;
          }
          // First empty frame is the SignalR handshake confirmation.
          if (!ready && frame && Object.keys(frame).length === 0) {
            ready = true;
            attempts = 0;
            state("connected");
            connection.send(encodeSignalR({ type: 1, target: "Subscribe", arguments: [current], invocationId: "sub-1" }));
            clearInterval(heartbeat);
            heartbeat = setInterval(() => {
              if (connection.readyState === WebSocket.OPEN) connection.send(encodeSignalR({ type: 6 }));
            }, 15000);
            return;
          }
          if (frame.type === 3 && frame.invocationId === "sub-1" && frame.error) {
            state("unavailable", "Langganan simbol ditolak oleh biquote.");
            stop();
          }
          if (frame.type === 1 && frame.target === "ReceiveTick" && frame.arguments?.length) {
            const tick = frame.arguments[0];
            if (tick && current.includes(tick.symbol)) onTick(tick);
          }
          if (frame.type === 7) connection.close();
        });
      };
      connection.onerror = () => { /* onclose handles retry */ };
      connection.onclose = () => {
        if (!closed && connection === ws) reconnect("Koneksi biquote terputus; memakai snapshot sementara.");
      };
    } catch (error) {
      if (!closed && !signal?.aborted) reconnect(error instanceof Error ? error.message : "Sambungan biquote gagal.");
    }
  }
  if (current.length) void connect();
  return { close: stop };
}
