import { test } from "node:test";
import assert from "node:assert/strict";
import { apiFetch, biquoteBars, cached, parseBls, parseRss } from "../server/api.mjs";
import { decodeSignalR, encodeSignalR } from "../lib/biquote-stream.mjs";
const req = path => new Request("https://azusa.test" + path);

test("AzusaTrade config exposes public biquote endpoint without API key", async () => {
  const response = await apiFetch(req("/api/config"));
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.forexProvider, "biquote");
  assert.equal(config.forexStream, "https://biquote.io/hubs/tick");
  assert.equal(config.forex, true);
  assert.equal((await apiFetch(req("/api/history?symbol=__proto__&frame=15m"))).status, 400);
  assert.equal((await apiFetch(req("/api/price?symbol=BTCUSDT"))).status, 400);
  assert.equal((await apiFetch(req("/api/history?symbol=US10Y&frame=15m"))).status, 400);
  assert.equal((await apiFetch(new Request("https://azusa.test/api/config", { method: "POST" }))).status, 405);
});

test("biquote XAUUSD historical OHLC sorting, open candle and no fake 420 bars", async t => {
  const rows = [
    { openTime: "2026-11-24T00:05:00Z", open: 3602, high: 3606, low: 3599, close: 3603, tickVolume: 30, isOpen: true },
    { openTime: "2026-11-24T00:00:00Z", open: 3600, high: 3604, low: 3598, close: 3602, tickVolume: 45, isOpen: false },
  ];
  const fetch = t.mock.method(globalThis, "fetch", async url => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "biquote.io");
    assert.equal(parsed.pathname, "/api/XAUUSD/ohlc");
    assert.equal(parsed.searchParams.get("interval"), "5m");
    return Response.json({ symbol: "XAUUSD", interval: "5m", bars: rows });
  });
  const response = await apiFetch(req("/api/history?symbol=XAUUSD&frame=5m&limit=420"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, "biquote MT5");
  assert.equal(data.bars.length, 2);
  assert.equal(data.bars[0].close, 3602);
  assert.equal(data.bars[0].closed, true);
  assert.equal(data.bars[1].closed, false);
  assert.equal(data.bars[1].volume, 30);
  assert.equal(fetch.mock.calls.length, 1);
});

test("biquote aggregated 3-minute candle retains high, low, close and known source", () => {
  const bars = [
    { openTime: "2026-11-24T00:02:00Z", open: 4, high: 8, low: 3, close: 7, isOpen: true },
    { openTime: "2026-11-24T00:01:00Z", open: 5, high: 6, low: 2, close: 4, isOpen: false },
    { openTime: "2026-11-24T00:00:00Z", open: 3, high: 5, low: 2, close: 5, isOpen: false },
  ];
  const result = biquoteBars({ bars }, "1m", "3m", 20);
  assert.equal(result.length, 1);
  assert.equal(result[0].open, 3);
  assert.equal(result[0].high, 8);
  assert.equal(result[0].low, 2);
  assert.equal(result[0].close, 7);
  assert.equal(result[0].closed, false);
});

test("biquote price snapshot uses mid, provider timestamp and stale flag", async t => {
  const fresh = new Date().toISOString();
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(new URL(url).pathname, "/api/XAGUSD");
    return Response.json({ mid: 39.51, last: 0, bid: 39.5, ask: 39.52, timestamp: fresh, marketState: "open", stale: false });
  });
  const response = await apiFetch(req("/api/price?symbol=XAGUSD"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.price, 39.51);
  assert.equal(result.source, "biquote MT5");
  assert.equal(result.quoteStale, false);
  assert.equal(result.realTimeTick, false);
  assert.ok(Math.abs(result.observedAt - Date.parse(fresh)/1000) < 1);
});

test("biquote closed/stale quotes are not labelled fresh or given a 24h change", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    mid: 3699.2, bid: 3699.1, ask: 3699.3, marketState: "closed", stale: true,
    dayDiffPercent: 2.5, timestamp: "2026-11-23T00:00:00Z",
  }));
  const price = await (await apiFetch(req("/api/price?symbol=EURUSD"))).json();
  assert.equal(price.quoteStale, true);
  const watch = await (await apiFetch(req("/api/quotes?symbols=EURUSD"))).json();
  assert.equal(watch.quotes.EURUSD.change, null);
});

test("biquote quote watchlist supports array response and multi-symbol request", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async url => {
    const p = new URL(url);
    assert.equal(p.pathname, "/api/latest");
    assert.deepEqual(p.searchParams.getAll("symbols"), ["GBPUSD", "XAUUSD"]);
    const timestamp = new Date().toISOString();
    return Response.json([
      { symbol: "GBPUSD", mid: 1.32, dayDiffPercent: 0.45, timestamp, marketState: "open", high: 1.33, low: 1.30 },
      { symbol: "XAUUSD", mid: 3702, dayDiffPercent: -0.21, timestamp, marketState: "open", high: 3715, low: 3670 },
    ]);
  });
  const data = await (await apiFetch(req("/api/quotes?symbols=GBPUSD,XAUUSD"))).json();
  assert.equal(data.quotes.GBPUSD.price, 1.32);
  assert.equal(data.quotes.XAUUSD.change, -0.21);
  assert.equal(fetch.mock.calls.length, 1);
});

test("SignalR JSON handshake + Subscribe frame parsing is lossless", () => {
  const subscription = encodeSignalR({ type: 1, target: "Subscribe", arguments: [["XAUUSD"]], invocationId: "sub-1" });
  assert.ok(subscription.endsWith("\x1e"));
  const read = [];
  let buffer = decodeSignalR('{}\x1e{"type":1,"target":"Rece', frame => read.push(frame));
  assert.equal(read.length, 1);
  buffer = decodeSignalR(buffer + 'iveTick","arguments":[{"symbol":"XAUUSD","mid":3600}]}\x1e', frame => read.push(frame));
  assert.equal(read[1].arguments[0].mid, 3600);
  assert.equal(buffer, "");
});

test("biquote unsupported seconds charts return explicit error, not fabricated data", async () => {
  const response = await apiFetch(req("/api/history?symbol=XAUUSD&frame=5s"));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "BIQUOTE_FRAME_UNAVAILABLE");
});

test("read-through cache coalesces requests and flags stale entry", async () => {
  let counter = 0;
  const result = await Promise.all([cached("biquote-cache-test", 60, () => { counter++; return ["quote"]; }), cached("biquote-cache-test", 60, () => { counter++; return ["quote"]; })]);
  assert.equal(counter, 1);
  assert.deepEqual(result[0].data, ["quote"]);
  assert.equal((await cached("biquote-cache-test", 0, () => { throw Error("offline"); })).stale, true);
});

test("BLS schedule DST and missing values preserved", () => {
  const rows = parseBls("BEGIN:VEVENT\nDTSTART;TZID=US-Eastern:20261110T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;TZID=US-Eastern:20260714T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\n");
  assert.equal(new Date(rows[0].date).toISOString(), "2026-11-10T13:30:00.000Z");
  assert.equal(rows[0].actual, null);
});

test("RSS sanitizes non-HTTPS article links", () => {
  const date = "Fri, 13 Nov 2026 13:30:00 GMT";
  const item = (title, url) => `<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
  const rows = parseRss(item("FOMC &amp; rates", "<![CDATA[https://example.com/a]]>") + item("Reject", "javascript:alert(1)"), "Federal Reserve");
  assert.equal(rows.length, 1);
});
