"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startBiquoteStream } from "../lib/biquote-stream.mjs";
import { aggregateBars, binanceFrames, bucketTime, byId, frames, mergeBars, parseBinanceRows, validBar } from "../lib/instruments.mjs";
import type { Bar, FeedState, Market, Quote } from "../lib/types";

type History = { source: string; bars: Bar[]; observation?: boolean; delaySeconds?: number; stale?: boolean; updated?: number };
type MarketData = { key: string; seconds: number; bars: Bar[]; status: FeedState; source: string; message: string; updated?: number; bid?: number; ask?: number };
const memory = new Map<string, History>();
const map = frames as Record<string, number>;
const nativeBinance = binanceFrames as Record<string, string>;
const OKX_FRAMES: Record<string, string> = { "1s": "1s", "5s": "1s", "15s": "1s", "30s": "1s", "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "45m": "15m", "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6Hutc", "8h": "4H", "12h": "12Hutc", "1d": "1Dutc", "1w": "1Wutc", "1M": "1Mutc" };
const getKey = (market: Market, frame: string, provider: string) => market.id + ":" + frame + ":" + provider;

function remember(key: string, history: History) {
  if (memory.size >= 25) memory.delete(memory.keys().next().value!);
  memory.set(key, history);
}

async function fetchJSON(url: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(9500);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store" });
  if (response.headers.get("content-type")?.includes("json")) {
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || "HTTP " + response.status), { code: data.code });
    return data;
  }
  throw new Error("Feed tidak dapat dihubungi.");
}

export async function fetchHistory(market: Market, frame: string, provider = "auto", before?: number, signal?: AbortSignal): Promise<History> {
  const symbol = market.id;
  const query = new URLSearchParams({ symbol, frame, provider, limit: "420", ...(before ? { before: String(before) } : {}) });
  try {
    return await fetchJSON("/api/history?" + query, signal);
  } catch (error) {
    if (signal?.aborted || market.category !== "Crypto" || provider === "okx") throw error;
    const native = nativeBinance[frame];
    const span = map[frame] / map[native];
    const direct = new URLSearchParams({ symbol, interval: native, limit: String(Math.min(1000, 420 * span)), ...(before ? { endTime: String(before * 1000 - 1) } : {}) });
    try {
      const bars = parseBinanceRows(await fetchJSON("https://data-api.binance.vision/api/v3/klines?" + direct, signal));
      if (!bars.length) throw new Error("Data kosong.");
      return { source: "Binance Spot", bars: span > 1 ? aggregateBars(bars, frame) : bars, updated: Date.now() };
    } catch { throw error; }
  }
}

function withinForexSession() {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts();
  const day = time.find(part => part.type === "weekday")?.value;
  const hour = Number(time.find(part => part.type === "hour")?.value);
  return day !== "Sat" && !(day === "Sun" && hour < 17) && !(day === "Fri" && hour >= 17);
}

export function useMarket(market: Market, frame: string, provider: string, enabled: boolean) {
  const key = getKey(market, frame, provider);
  const initial = (): MarketData => ({ key, seconds: map[frame], bars: [], status: "connecting", source: "", message: "" });
  const [data, setData] = useState<MarketData>(initial);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [version, setVersion] = useState(0);
  const pagination = useRef<AbortController | null>(null);
  const refresh = useCallback(() => setVersion(value => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    const native = nativeBinance[frame];
    let sourceBars: Bar[] = [];
    let socket: WebSocket | null = null;
    let biquoteStream: { close(): void } | null = null;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let requested: Promise<void> | null = null;
    let activeSource = "";
    let lastEvent = 0;
    let connectedAt = 0;
    let lastPriceTime = 0;
    let latestFxBar: Bar | undefined;
    let forexPoll: ReturnType<typeof setTimeout> | undefined;
    let forexPollRunning = false;
    const forexPollSeconds = 15;
    let forexStreamHealthy = false;
    let forexFailures = 0;
    let lastStreamEvent = 0;
    let lastForexReload = 0;
    let lastFrameBar: Bar | undefined;
    let priming: Promise<void> | null = null;
    let latestAggregateEvent = 0;
    const historyProvider = () => activeSource === "OKX Spot" ? "okx" : activeSource === "Binance Spot" && provider !== "auto" ? "binance" : provider;
    setHistoryMessage("");
    setLoadingHistory(false);
    const saved = memory.get(key);
    if (saved) {
      activeSource = saved.source;
      setData({ ...initial(), bars: saved.bars, status: "historical", source: saved.source, updated: saved.updated });
    } else {
      setData(initial());
      if (market.category === "Crypto" && provider !== "okx") fetchJSON("/snapshots/" + market.id + "-" + frame + ".json", signal).then((snapshot: History) => {
        if (signal.aborted || activeSource) return;
        setData(previous => previous.key !== key || previous.bars.length ? previous : { ...previous, bars: snapshot.bars, source: snapshot.source, updated: snapshot.updated, status: "historical" });
      }).catch(() => {});
    }

    function status(next: FeedState, message = "") {
      if (!signal.aborted) setData(previous => previous.key === key
        ? { ...previous, status: previous.status === "polling" && next === "reconnecting" ? "polling" : next, message }
        : previous);
    }

    async function reload(selectedProvider = historyProvider()) {
      if (requested) return requested;
      requested = fetchHistory(market, frame, selectedProvider, undefined, signal).then(history => {
        if (signal.aborted) return;
        const sameSource = history.source === activeSource;
        if (activeSource && !sameSource) sourceBars = [];
        activeSource = history.source;
        const newest = history.bars.at(-1);
        if (market.category !== "Crypto" && (!latestFxBar || (newest?.time ?? 0) > latestFxBar.time)) latestFxBar = newest;
        if (!lastFrameBar || (newest?.time ?? 0) > lastFrameBar.time) lastFrameBar = newest;
        const recentCrypto = market.category === "Crypto" && !history.stale && newest && (newest.end ?? newest.time) >= Date.now() / 1000 - 30;
        const phase = history.delaySeconds ? "delayed"
          : market.category !== "Crypto" && !history.observation && !withinForexSession() ? "closed"
          : recentCrypto && connectedAt ? "polling" : "historical";
        setData(previous => {
          if (previous.key !== key) return previous;
          const bars = sameSource ? mergeBars(history.bars, previous.bars.filter(bar => bar.updated && bar.updated > (history.updated || 0))) : history.bars;
          const first = previous.bars[0]?.time;
          const older = sameSource && first < bars[0]?.time ? previous.bars.filter(bar => bar.time < bars[0].time) : [];
          const combined = older.length ? mergeBars(older, bars) : bars;
          remember(key, { ...history, bars: combined });
          return { ...previous, bars: combined, source: history.source,
            status: previous.status === "live" && sameSource && lastEvent > Date.now() - 25000 ? "live" : phase,
            message: history.stale ? "Riwayat dari cache penyedia." : "", updated: history.updated };
        });
      }).catch(error => {
        if (signal.aborted) return;
        if (!(lastEvent && Date.now() - lastEvent < 25000)) status("disconnected", error.message);
      }).finally(() => { requested = null; });
      return requested;
    }

    function ingest(bar: Bar, eventTime = Date.now(), partial: { bid?: number; ask?: number } = {}) {
      if (signal.aborted || !validBar(bar)) return;
      lastEvent = Date.now();
      attempts = 0;
      if (lastFrameBar?.end && bar.time > lastFrameBar.end && market.category === "Crypto") void reload(activeSource === "OKX Spot" ? "okx" : "binance");
      if (!lastFrameBar || lastFrameBar.time <= bar.time) lastFrameBar = bar;
      setData(previous => {
        if (previous.key !== key || previous.source && previous.source !== activeSource || !previous.bars.length) return previous;
        const last = previous.bars.at(-1);
        if (last?.time === bar.time && last.updated && eventTime < last.updated) return previous;
        if (last?.time === bar.time && last.closed && !bar.closed) return previous;
        if (last && bar.time < last.time) return previous;
        const nextBar = { ...bar, updated: eventTime };
        const bars = last?.time === bar.time ? [...previous.bars.slice(0, -1), nextBar] : [...previous.bars.slice(-11999), nextBar];
        return { ...previous, bars, status: "live", source: activeSource, updated: eventTime, message: "", ...partial };
      });
    }

    function connectCrypto() {
      if (signal.aborted || !activeSource) return;
      const okx = activeSource === "OKX Spot";
      const upstreamFrame = okx && frame === "8h" ? "4h" : native;
      try {
        const connection = new WebSocket(okx ? "wss://ws.okx.com:8443/ws/v5/business"
          : "wss://data-stream.binance.vision/ws/" + market.id.toLowerCase() + "@kline_" + native);
        socket = connection;
        connectedAt = Date.now();
        connection.addEventListener("open", () => {
          if (signal.aborted || connection !== socket) return;
          if (okx) connection.send(JSON.stringify({ op: "subscribe", args: [{ channel: "candle" + OKX_FRAMES[frame], instId: market.asset + "-" + market.quote }] }));
          if (attempts) void reload(okx ? "okx" : "binance");
        });
        connection.addEventListener("message", ({ data: raw }) => {
          if (signal.aborted || connection !== socket || raw === "pong") return;
          try {
            const packet = JSON.parse(raw);
            const k = packet.k;
            const received: Bar[] = okx ? (packet.data || []).map((row: string[]) => ({
              time: +row[0] / 1000, open: +row[1], high: +row[2], low: +row[3], close: +row[4],
              volume: +row[5], closed: row[8] === "1", end: +row[0] / 1000 + map[upstreamFrame] }))
              : k ? [{ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, closed: Boolean(k.x), end: (k.T + 1) / 1000 }] : [];
            for (const bar of received.sort((a,b) => a.time - b.time)) {
              const now = packet.E || Date.now();
              if (upstreamFrame === frame) {
                ingest(bar, now);
                continue;
              }
              const time = bucketTime(bar.time, frame);
              if (sourceBars.length && bucketTime(sourceBars.at(-1)!.time, frame) !== time) {
                const last = sourceBars.at(-1)!;
                if (bar.time < last.time) continue;
                sourceBars = [];
              }
              sourceBars = mergeBars(sourceBars, [{ ...bar, updated: now }], 64);
              latestAggregateEvent = Math.max(latestAggregateEvent, now);
              if (sourceBars[0]?.time !== time) {
                if (!priming) {
                  const currentProvider = okx ? "okx" : "binance";
                  priming = fetchHistory(market, upstreamFrame, currentProvider, undefined, signal).then(history => {
                    if (signal.aborted || history.source !== activeSource || connection !== socket) return;
                    const latestNative = sourceBars.at(-1);
                    if (!latestNative) return;
                    const start = bucketTime(latestNative.time, frame);
                    sourceBars = mergeBars(history.bars.filter(value => value.time >= start && value.time <= latestNative.time), sourceBars, 64);
                    const aggregate = aggregateBars(sourceBars, frame).at(-1);
                    if (aggregate && sourceBars[0]?.time === start) ingest(aggregate, latestAggregateEvent);
                  }).catch(() => {}).finally(() => { priming = null; });
                }
                continue;
              }
              const aggregate = aggregateBars(sourceBars, frame).at(-1);
              if (aggregate) ingest(aggregate, now);
            }
          } catch { /* Ignore malformed exchange messages. */ }
        });
        connection.addEventListener("error", () => connection.close());
        connection.addEventListener("close", () => {
          if (signal.aborted || connection !== socket) return;
          socket = null;
          status("reconnecting", "Koneksi streaming terputus.");
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
          retry = setTimeout(async () => {
            if (provider === "auto" && attempts === 2) await reload(okx ? "binance" : "okx");
            if (!activeSource) await reload();
            connectCrypto();
          }, delay);
        });
      } catch { status("disconnected", "WebSocket tidak tersedia di jaringan ini."); }
    }

    // Both SSE and REST snapshots share the same causal OHLC update path.
    // REST snapshots are explicitly marked polling, never LIVE.
    function applyForexPrice(price: number, time: number, realTimeTick: boolean, bid?: number, ask?: number) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(time) || time <= 0 || time < lastPriceTime) return;
      if (!withinForexSession()) { status("closed", "Sesi Forex sedang tutup."); return; }
      lastPriceTime = time;
      const bucket = bucketTime(time, frame);
      const previous = latestFxBar;
      if (previous && bucket < previous.time) return;
      const same = previous?.time === bucket;
      const open = same ? previous.open : price;
      const bar: Bar = {
        time: bucket, open,
        high: Math.max(same ? previous.high : price, price),
        low: Math.min(same ? previous.low : price, price),
        close: price, volume: null, closed: false,
        end: frame === "1M" ? Date.UTC(new Date(bucket * 1000).getUTCFullYear(), new Date(bucket * 1000).getUTCMonth() + 1, 1) / 1000 : bucket + map[frame],
      };
      latestFxBar = bar;
      // Never present REST observations as real-time ticks.
      ingest(bar, time * 1000, { bid, ask });
      if (!realTimeTick) status("polling", "Cadangan snapshot biquote; menunggu tick live.");
      if (previous && previous.time !== bucket && Date.now() - lastForexReload > 45000) {
        lastForexReload = Date.now();
        void reload();
      }
    }

    function scheduleForexPoll(delay: number) {
      clearTimeout(forexPoll);
      forexPoll = setTimeout(() => { forexPoll = undefined; void pollForex(); }, delay);
    }

    async function pollForex() {
      if (signal.aborted || forexPollRunning || market.id === "US10Y") return;
      if (forexStreamHealthy && Date.now() - lastStreamEvent < 45000) {
        scheduleForexPoll(forexPollSeconds * 1000);
        return;
      }
      if (!withinForexSession()) {
        status("closed", "Sesi Forex sedang tutup.");
        scheduleForexPoll(60000);
        return;
      }
      forexPollRunning = true;
      try {
        const snapshot = await fetchJSON("/api/price?symbol=" + encodeURIComponent(market.id), signal);
        if (signal.aborted) return;
        if (!snapshot.stale && snapshot.marketState === "closed") status("closed", "Pasar tutup; menampilkan harga terakhir.");
        else if (!snapshot.stale && !snapshot.quoteStale && Number.isFinite(snapshot.price) && Number.isFinite(snapshot.observedAt)) {
          applyForexPrice(snapshot.price, snapshot.observedAt, false, snapshot.bid, snapshot.ask);
        } else status("historical", "Snapshot biquote belum diperbarui.");
        forexFailures = 0;
      } catch (error) {
        if (signal.aborted) return;
        forexFailures++;
        const reason = error instanceof Error ? error.message : "Tidak dapat mengambil harga.";
        status("disconnected", reason);
      } finally {
        forexPollRunning = false;
        if (!signal.aborted) scheduleForexPoll(Math.max(forexPollSeconds * 1000, Math.min(120000, 10000 * 2 ** Math.min(forexFailures, 4))));
      }
    }

    function connectForex() {
      if (signal.aborted || market.id === "US10Y") return;
      // SignalR tick streaming uses biquote directly from the browser, not a Vercel serverless relay.
      scheduleForexPoll(1500);
      biquoteStream = startBiquoteStream({
        symbols: [market.id], signal,
        onState: (phase: string, message?: string) => {
          if (signal.aborted) return;
          if (phase === "connected") { forexStreamHealthy = true; return; }
          if (phase === "reconnecting" || phase === "unavailable") {
            forexStreamHealthy = false;
            if (phase === "unavailable") status("disconnected", message || "Langganan simbol tidak tersedia.");
            else status("reconnecting", message || "Mencoba tersambung ke biquote.");
            scheduleForexPoll(0);
          }
        },
        onTick: (tick: { symbol: string; mid?: number; bid?: number; ask?: number; timestamp?: string; marketState?: string; stale?: boolean }) => {
          if (signal.aborted || tick.stale || tick.marketState === "closed") return;
          const price = Number(tick.mid);
          const time = Date.parse(tick.timestamp ?? "") / 1000;
          if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0) return;
          if (Date.now() / 1000 - time > 120 || time > Date.now()/1000 + 10) return;
          forexStreamHealthy = true;
          lastStreamEvent = Date.now();
          applyForexPrice(price, time, true, tick.bid, tick.ask);
        },
      });
    }

    void reload().then(() => {
      if (signal.aborted) return;
      if (market.category === "Crypto") {
        connectCrypto();
        watchdog = setInterval(() => {
          if (!activeSource) { void reload().then(() => { if (!socket) connectCrypto(); }); return; }
          if (socket && Date.now() - Math.max(lastEvent, connectedAt) > 28_000) socket.close();
          if (activeSource === "OKX Spot" && socket?.readyState === 1) socket.send("ping");
          if (!socket || Date.now() - lastEvent > 25000) void reload();
        }, 10000);
      } else {
        connectForex();
        watchdog = setInterval(() => {
          // Quiet markets are not necessarily disconnected; check snapshot freshness instead.
          if ((!forexStreamHealthy || Date.now() - lastStreamEvent > 60000) && !forexPoll && !forexPollRunning) scheduleForexPoll(0);
          if (Date.now() - lastForexReload > 180000) {
            lastForexReload = Date.now();
            void reload();
          }
        }, 20000);
      }
    });
    return () => {
      controller.abort();
      socket?.close();
      biquoteStream?.close();
      clearInterval(watchdog);
      clearTimeout(retry);
      clearTimeout(forexPoll);
      pagination.current?.abort();
    };
    // key contains all market, timeframe, and provider inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, enabled]);

  const loadOlder = useCallback(async () => {
    const first = data.bars[0];
    if (!first || loadingHistory || data.bars.length >= 12000 || data.key !== key) return;
    const controller = new AbortController();
    pagination.current?.abort();
    pagination.current = controller;
    setLoadingHistory(true);
    setHistoryMessage("");
    try {
      const source = data.source === "OKX Spot" ? "okx" : data.source === "Binance Spot" ? "binance" : "auto";
      const history = await fetchHistory(market, frame, source, first.time, controller.signal);
      const older = history.bars.filter(bar => bar.time < first.time);
      if (!older.length) { setHistoryMessage("Riwayat tambahan belum tersedia."); return; }
      setData(previous => previous.key !== key || previous.source !== history.source ? previous
        : { ...previous, bars: mergeBars(older, previous.bars) });
    } catch (error) {
      if (!controller.signal.aborted) setHistoryMessage(error instanceof Error ? error.message : "Riwayat gagal dimuat.");
    } finally {
      if (!controller.signal.aborted) setLoadingHistory(false);
      if (pagination.current === controller) pagination.current = null;
    }
  }, [data, frame, key, loadingHistory, market]);

  return { ...(data.key === key ? data : initial()), refresh, loadOlder, loadingHistory, historyMessage };
}

export function useQuotes(ids: string[], enabled: boolean) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const key = ids.filter(id => byId[id] && byId[id].category !== "Bonds").sort().join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    const controller = new AbortController();
    async function update() {
      try {
        const data = await fetchJSON("/api/quotes?symbols=" + encodeURIComponent(key), controller.signal);
        if (!controller.signal.aborted && data.quotes) setQuotes(previous => ({ ...previous, ...data.quotes }));
      } catch { if (!controller.signal.aborted) setQuotes({}); }
    }
    void update();
    const timer = setInterval(update, 20000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [key, enabled]);
  return quotes;
}
