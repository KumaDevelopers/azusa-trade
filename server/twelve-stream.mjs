import { byId } from "../lib/instruments.mjs";

const listeners = new Map();
let socket;
let heartbeat;
let retry;
let failures = 0;
const idFor = market => market.quote ? market.asset + "/" + market.quote : market.asset;

function broadcast(data, symbols = listeners.keys()) {
  for (const symbol of symbols) {
    for (const response of listeners.get(symbol) ?? []) {
      if (response.writableLength > 65536) response.destroy();
      else response.write("data: " + JSON.stringify(data) + "\n\n");
    }
  }
}

function action(event, symbols) {
  if (socket?.readyState === 1 && symbols.length) socket.send(JSON.stringify({ action: event, params: { symbols: symbols.join(",") } }));
}

function connect(env) {
  if (socket || !listeners.size) return;
  const url = new URL("wss://ws.twelvedata.com/v1/quotes/price");
  url.searchParams.set("apikey", env.TWELVE_DATA_API_KEY);
  const connection = new WebSocket(url);
  socket = connection;
  connection.addEventListener("open", () => {
    if (socket !== connection) return;
    action("subscribe", [...listeners.keys()]);
    heartbeat = setInterval(() => connection.readyState === 1 && connection.send(JSON.stringify({ action: "heartbeat" })), 10000);
    heartbeat.unref();
  });
  connection.addEventListener("message", ({ data }) => {
    try {
      const message = JSON.parse(data);
      if (message.event === "subscribe-status" && message.fails?.length) {
        for (const entry of message.fails) broadcast({ state: "disconnected", error: "Paket Twelve Data tidak mengizinkan streaming pasar ini." }, [entry.symbol ?? entry]);
      }
      if (message.event === "price" && Number.isFinite(+message.timestamp) && Number.isFinite(+message.price)) {
        failures = 0;
        broadcast({ time: +message.timestamp, price: +message.price, bid: message.bid ?? null, ask: message.ask ?? null }, [message.symbol]);
      }
    } catch { /* Ignore malformed upstream events. */ }
  });
  connection.addEventListener("error", () => connection.close());
  connection.addEventListener("close", () => {
    if (socket !== connection) return;
    socket = undefined;
    clearInterval(heartbeat);
    if (!listeners.size) return;
    broadcast({ state: "reconnecting" });
    clearTimeout(retry);
    retry = setTimeout(() => connect(env), Math.min(30000, 1000 * 2 ** Math.min(5, failures++)));
    retry.unref();
  });
}

export function handleTwelveStream(request, response, env) {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname !== "/api/stream") return false;
  const id = url.searchParams.get("symbol");
  const market = Object.hasOwn(byId, id) ? byId[id] : null;
  if (!env.LOCAL_TWELVE_STREAM || !env.TWELVE_DATA_API_KEY || Number(env.TWELVE_DATA_DELAY_SECONDS || 0) || !market
    || !["Forex", "Metals"].includes(market.category)) {
    response.writeHead(424, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Streaming Twelve Data belum tersedia untuk pasar ini." }));
    return true;
  }
  const clients = [...listeners.values()].reduce((total, group) => total + group.size, 0);
  if (clients >= 40) { response.writeHead(429).end(); return true; }
  const symbol = idFor(market);
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" });
  response.write("retry: 3000\n\n");
  const group = listeners.get(symbol) ?? new Set();
  const fresh = !group.size;
  group.add(response);
  listeners.set(symbol, group);
  if (fresh) action("subscribe", [symbol]);
  connect(env);
  const keepalive = setInterval(() => response.write(": heartbeat\n\n"), 12000);
  response.on("close", () => {
    clearInterval(keepalive);
    group.delete(response);
    if (!group.size) { listeners.delete(symbol); action("unsubscribe", [symbol]); }
    if (!listeners.size) {
      clearTimeout(retry);
      clearInterval(heartbeat);
      const connection = socket;
      socket = undefined;
      connection?.close();
    }
  });
  return true;
}
