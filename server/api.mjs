import { aggregateBars, binanceFrames, bucketTime, byId, frames, parseBinanceRows, twelveFrames, validBar, yieldFrames } from "../lib/instruments.mjs";

const mem = new Map();
const inFlight = new Map();
const BINANCE = "https://data-api.binance.vision";
const TD = "https://api.twelvedata.com";
const BLS = "https://www.bls.gov/schedule/news_release/bls.ics";
const rss = {
  "Federal Reserve": "https://www.federalreserve.gov/feeds/press_all.xml",
  "Bureau of Economic Analysis": "https://www.bea.gov/news/rss.xml",
  "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
};
const userAgent = "AzusaTrade/0.1 (market terminal)";
const json = (data, status = 200) => Response.json(data, { status, headers: { "x-content-type-options": "nosniff", "cache-control": "no-store" } });

export async function cached(key, ttl, get) {
  const previous = mem.get(key);
  if (previous && Date.now() - previous.updated < ttl) return { ...previous, stale: false };
  if (!inFlight.has(key)) {
    const promise = Promise.resolve().then(get).then(data => {
      const entry = { data, updated: Date.now() };
      if (mem.size >= 128) mem.delete(mem.keys().next().value);
      mem.set(key, entry);
      return { ...entry, stale: false };
    }).catch(error => {
      if (previous) return { ...previous, stale: true };
      throw error;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }
  return inFlight.get(key);
}

async function upstream(url, parse = "json") {
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": userAgent }, signal: AbortSignal.timeout(7000) });
  } catch {
    throw new Error("Sumber data tidak dapat dihubungi.");
  }
  if (!response.ok) throw new Error("Sumber data mengembalikan HTTP " + response.status + ".");
  return response[parse]();
}

const feedSymbol = market => market.quote ? market.asset + "/" + market.quote : market.asset;

async function binanceHistory(market, frame, limit, before) {
  const span = frames[frame] / (frames[binanceFrames[frame]] || frames[frame]);
  const url = new URL("/api/v3/klines", BINANCE);
  url.search = new URLSearchParams({
    symbol: market.id, interval: binanceFrames[frame], limit: String(Math.min(1000, Math.ceil(limit * span))),
    ...(before ? { endTime: String(before * 1000 - 1) } : {}),
  });
  const bars = parseBinanceRows(await upstream(url));
  if (!bars.length) throw new Error("Penyedia tidak mengembalikan candle.");
  return { source: "Binance Spot", bars: span === 1 ? bars : aggregateBars(bars, frame) };
}

async function okxHistory(market, frame, limit, before) {
  const native = { "1s": "1s", "5s": "1s", "15s": "1s", "30s": "1s", "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "45m": "15m", "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6Hutc", "8h": "4H", "12h": "12Hutc", "1d": "1Dutc", "1w": "1Wutc", "1M": "1Mutc" }[frame];
  const base = { "8h": "4h" }[frame] ?? binanceFrames[frame];
  const span = frames[frame] / frames[base];
  const url = new URL(before ? "/api/v5/market/history-candles" : "/api/v5/market/candles", "https://www.okx.com");
  url.search = new URLSearchParams({ instId: market.asset + "-" + market.quote, bar: native, limit: String(Math.min(300, Math.ceil(limit * span))), ...(before ? { after: String(before * 1000) } : {}) });
  const payload = await upstream(url);
  if (payload.code !== "0") throw new Error("Pasangan belum tersedia di OKX.");
  const bars = payload.data.reverse().map(row => ({
    time: +row[0] / 1000, open: +row[1], high: +row[2], low: +row[3], close: +row[4],
    volume: +row[5], closed: row[8] === "1", end: +row[0] / 1000 + frames[base],
  })).filter(validBar);
  if (!bars.length) throw new Error("OKX tidak mengembalikan candle.");
  return { source: "OKX Spot", bars: span === 1 ? bars : aggregateBars(bars, frame) };
}

async function twelveHistory(market, frame, limit, before, env) {
  if (!env.TWELVE_DATA_API_KEY) {
    const error = new Error("Hubungkan Twelve Data untuk membuka riwayat Forex, Metals, atau DXY.");
    error.status = 424;
    throw error;
  }
  const native = twelveFrames[frame];
  const nativeSeconds = { "1min": 60, "5min": 300, "15min": 900, "30min": 1800, "1h": 3600, "2h": 7200, "4h": 14400, "8h": 28800, "1day": 86400, "1week": 604800, "1month": 2592000 }[native];
  if (!nativeSeconds) throw Object.assign(new Error("Timeframe ini tidak tersedia dari penyedia."), { status: 400 });
  const span = frames[frame] / nativeSeconds;
  const symbol = market.id === "DXY" ? (env.TWELVE_DATA_DXY_SYMBOL || "DXY") : feedSymbol(market);
  const query = new URLSearchParams({
    symbol, interval: native, apikey: env.TWELVE_DATA_API_KEY,
    outputsize: String(Math.min(5000, Math.ceil(limit * span))), timezone: "UTC", order: "ASC",
    ...(before ? { end_date: new Date((before - 1) * 1000).toISOString().slice(0, 19).replace("T", " ") } : {}),
  });
  const data = await upstream(TD + "/time_series?" + query);
  if (data.status === "error" || !Array.isArray(data.values)) {
    throw new Error("Twelve Data tidak menyediakan data ini. Periksa cakupan simbol, kuota, dan paket.");
  }
  const bars = data.values.map(row => {
    const time = Date.parse(row.datetime.replace(" ", "T") + (row.datetime.includes(":") ? "Z" : "T00:00:00Z")) / 1000;
    const end = frame === "1M" ? Date.UTC(new Date(time * 1000).getUTCFullYear(), new Date(time * 1000).getUTCMonth() + 1, 1) / 1000 : time + nativeSeconds;
    return { time, open: +row.open, high: +row.high, low: +row.low, close: +row.close, volume: row.volume == null ? null : Number(row.volume), end, closed: end * 1000 <= Date.now() };
  }).filter(validBar).sort((a,b) => a.time - b.time);
  if (!bars.length) throw new Error("Twelve Data tidak mengembalikan candle.");
  return { source: "Twelve Data", delaySeconds: Number(env.TWELVE_DATA_DELAY_SECONDS || 0), bars: span === 1 ? bars : aggregateBars(bars, frame) };
}

async function yieldHistory(frame, limit, before, env) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.search = new URLSearchParams({ id: "DGS10", cosd: "2000-01-01", ...(before ? { coed: new Date((before - 1) * 1000).toISOString().slice(0, 10) } : {}) });
  const csv = await upstream(url, "text");
  const bars = csv.split(/\r?\n/).slice(1).filter(row => /^\d{4}-\d{2}-\d{2},/.test(row)).flatMap(row => {
    const [date, value] = row.split(",");
    const time = Date.parse(date) / 1000;
    const close = Number(value);
    return value.trim() && Number.isFinite(close) ? [{ time, open: close, high: close, low: close, close, volume: null, closed: true, end: time + 86400 }] : [];
  });
  if (!bars.length) throw new Error("FRED tidak mengembalikan observasi yield.");
  const output = frame === "1d" ? bars : aggregateBars(bars, frame);
  if (frame !== "1d" && output.length) output.at(-1).closed = bucketTime(Date.now() / 1000, frame) > output.at(-1).time;
  return { source: "FRED DGS10", bars: output.slice(-limit), observation: true };
}

export function xmlText(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      const values = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (entity[0] !== "#") return values[entity.toLowerCase()] ?? "";
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }).trim();
}
const field = (xml, tag) => xmlText(xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"))?.[1] ?? "");
const category = title => /\bgold\b|\bsilver\b|XAU|XAG/i.test(title) ? "Metals"
  : /\bforex\b|\bdollar\b|\beuro\b|\byen\b|\bsterling\b/i.test(title) ? "Forex"
  : /FOMC|monetary policy|federal funds|interest rate/i.test(title) ? "Moneter"
  : /inflation|consumer price|producer price/i.test(title) ? "Inflasi"
    : /employment|payroll|unemployment/i.test(title) ? "Tenaga kerja"
      : /GDP|gross domestic/i.test(title) ? "Pertumbuhan" : "Ekonomi";
const link = value => {
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
};
export function parseRss(xml, source) {
  return Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi), match => {
    const title = field(match[1], "title");
    const url = link(field(match[1], "link"));
    const date = Date.parse(field(match[1], "pubDate") || field(match[1], "dc:date"));
    return { id: url, title, url, date, source, category: source === "CoinDesk" ? "Crypto" : category(title) };
  }).filter(item => item.title && item.url && Number.isFinite(item.date));
}

function utcFromLocal(parts, timezone) {
  const nominal = Date.UTC(...parts);
  let stamp = nominal;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
  for (let step = 0; step < 2; step++) {
    const values = Object.fromEntries(format.formatToParts(stamp).map(part => [part.type, Number(part.value)]));
    stamp += nominal - Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  }
  return stamp;
}

export function parseBls(ics) {
  return Array.from(ics.replace(/\r?\n[ \t]/g, "").matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g), match => {
    const rows = match[1].split(/\r?\n/);
    const title = (rows.find(row => row.startsWith("SUMMARY:"))?.slice(8) ?? "").replace(/\\([,;\\])/g, "$1").trim();
    const startLine = rows.find(row => /^DTSTART[;:]/.test(row)) ?? "";
    const start = startLine.match(/:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!start || !title) return null;
    const parts = [+start[1], +start[2] - 1, +start[3], +(start[4] ?? 0), +(start[5] ?? 0), +(start[6] ?? 0)];
    const rawZone = startLine.match(/TZID=([^:;]+)/)?.[1]?.replaceAll('"', "");
    const tz = rawZone === "US-Eastern" ? "America/New_York" : rawZone;
    const date = start[7] ? Date.UTC(...parts) : utcFromLocal(parts, tz || "America/New_York");
    return { id: title + date, title, date, source: "BLS", country: "US", impact: /Employment Situation|Consumer Price Index|Producer Price Index/i.test(title) ? 3 : 2, actual: null, forecast: null, previous: null, url: link(rows.find(row => row.startsWith("URL:"))?.slice(4)) };
  }).filter(Boolean);
}

async function calendar(env) {
  if (env.TRADING_ECONOMICS_API_KEY) {
    const now = new Date(), end = new Date(+now + 7 * 86400000);
    const start = new Date(+now - 3 * 86400000);
    const url = new URL("https://api.tradingeconomics.com/calendar/country/All/" + start.toISOString().slice(0,10) + "/" + end.toISOString().slice(0,10));
    url.searchParams.set("c", env.TRADING_ECONOMICS_API_KEY);
    const data = await upstream(url);
    if (!Array.isArray(data)) throw new Error("Kalender Trading Economics tidak tersedia.");
    return data.map(row => ({ id: row.CalendarId, title: row.Event, date: Date.parse(row.Date + (/Z$|[+-]\d{2}:\d{2}$/.test(row.Date) ? "" : "Z")), source: "Trading Economics", country: row.Country, impact: Number(row.Importance), previous: row.Previous || null, forecast: row.Forecast || null, actual: row.Actual || null, url: link(row.SourceURL) })).filter(row => row.title && Number.isFinite(row.date)).sort((a,b) => a.date - b.date).slice(0, 200);
  }
  const outcomes = await Promise.allSettled([upstream(BLS, "text"), upstream("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", "text")]);
  const data = outcomes[0].status === "fulfilled" ? parseBls(outcomes[0].value) : [];
  if (outcomes[1].status === "fulfilled") {
    const text = outcomes[1].value;
    for (const yearBlock of text.matchAll(/<h4[^>]*>(?:\s*<a[^>]*>)?\s*(20\d\d) FOMC Meetings[\s\S]*?<\/h4>([\s\S]*?)(?=<h4|$)/gi)) {
      for (const meeting of yearBlock[2].matchAll(/fomc-meeting__month[^>]*>(?:\s*<strong[^>]*>)?\s*([^<]+)<[\s\S]*?fomc-meeting__date[^>]*>\s*([^<]+)</gi)) {
        const month = meeting[1].replace(/\s/g, "").split(/\/|–|-/).at(-1);
        const day = meeting[2].match(/\d+/g)?.at(-1);
        const timestamp = Date.parse(month + " " + day + ", " + yearBlock[1] + " UTC");
        if (!Number.isFinite(timestamp)) continue;
        const dt = new Date(timestamp);
        const date = utcFromLocal([dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 14, 0, 0], "America/New_York");
        data.push({ id: "fomc-" + date, title: "FOMC policy decision", date, source: "Federal Reserve", country: "US", impact: 3, actual: null, forecast: null, previous: null, url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" });
      }
    }
  }
  if (!data.length) throw new Error("Kalender resmi belum tersedia.");
  return data.filter(row => row.date >= Date.now() - 7 * 86400000).sort((a,b) => a.date - b.date).slice(0, 60);
}

function streamUrl(env) {
  if (!env.TWELVE_DATA_API_KEY || Number(env.TWELVE_DATA_DELAY_SECONDS || 0)) return null;
  try {
    const url = new URL(env.TWELVE_STREAM_URL);
    if (url.protocol === "https:" || (!env.VERCEL && url.protocol === "http:" && url.hostname === "localhost")) {
      if (!url.username && !url.password && !url.search && !url.hash) return url.href;
    }
  } catch { /* Streaming is optional until a relay is connected. */ }
  return null;
}

async function tradingEconomicsNews(key) {
  const url = new URL("https://api.tradingeconomics.com/news");
  url.searchParams.set("c", key);
  const rows = await upstream(url);
  if (!Array.isArray(rows)) throw new Error("Feed Trading Economics tidak tersedia.");
  return rows.flatMap(row => {
    const date = Date.parse(String(row.Date) + (/Z$|[+-]\d{2}:\d{2}$/.test(row.Date) ? "" : "Z"));
    if (!row.Title || !row.Url || !Number.isFinite(date)) return [];
    let article;
    try { article = link(new URL(row.Url, "https://tradingeconomics.com").href); } catch { return []; }
    return article ? [{ id: article + ":" + date, title: row.Title, url: article, date, source: "Trading Economics", category: category(row.Title) }] : [];
  });
}

export async function apiFetch(request, env = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  if (request.method !== "GET") return json({ error: "Metode tidak didukung." }, 405);
  try {
    if (url.pathname === "/api/config") return json({
      forex: Boolean(env.TWELVE_DATA_API_KEY), forexStream: streamUrl(env),
      economicCalendar: env.TRADING_ECONOMICS_API_KEY ? "Trading Economics" : "BLS / Federal Reserve",
    });
    if (url.pathname === "/api/history") {
      const symbol = url.searchParams.get("symbol");
      const frame = url.searchParams.get("frame");
      const provider = url.searchParams.get("provider") ?? "auto";
      const before = Number(url.searchParams.get("before")) || null;
      const limit = Math.min(1000, Math.max(10, Math.floor(Number(url.searchParams.get("limit")) || 300)));
      if (!Object.hasOwn(byId, symbol) || !Object.hasOwn(frames, frame) || !["auto", "binance", "okx"].includes(provider)
        || (before !== null && (!Number.isFinite(before) || before <= 0))) return json({ error: "Pasar atau timeframe tidak valid." }, 400);
      const market = byId[symbol];
      if (symbol === "US10Y" && !Object.hasOwn(yieldFrames, frame)) return json({ error: "Yield tersedia pada timeframe harian atau lebih tinggi." }, 400);
      const result = await cached("history:" + [symbol, frame, provider, before, limit].join(":"), before ? 300000 : 10000, async () => {
        if (symbol === "US10Y") return yieldHistory(frame, limit, before, env);
        if (market.category !== "Crypto") return twelveHistory(market, frame, limit, before, env);
        if (provider === "okx") return okxHistory(market, frame, limit, before);
        if (provider === "binance") return binanceHistory(market, frame, limit, before);
        try { return await binanceHistory(market, frame, limit, before); }
        catch { return okxHistory(market, frame, limit, before); }
      });
      return json({ ...result.data, updated: result.updated, stale: result.stale });
    }
    if (url.pathname === "/api/quotes") {
      const symbols = [...new Set((url.searchParams.get("symbols") ?? "").split(","))].filter(symbol => Object.hasOwn(byId, symbol) && byId[symbol].category === "Crypto").slice(0,14);
      if (!symbols.length) return json({ quotes: {} });
      const query = new URLSearchParams({ symbols: JSON.stringify(symbols) });
      const result = await cached("quotes:" + symbols.join(","), 12000, () => upstream(BINANCE + "/api/v3/ticker/24hr?" + query));
      return json({ quotes: Object.fromEntries(result.data.map(row => [row.symbol, { price: +row.lastPrice, change: +row.priceChangePercent, high: +row.highPrice, low: +row.lowPrice, volume: +row.quoteVolume }])), updated: result.updated, stale: result.stale });
    }
    if (url.pathname === "/api/news") {
      const feedsRequested = Object.entries(rss).map(async ([source, feed]) => {
        return cached("news:" + source, 90000, async () => {
          const articles = parseRss(await upstream(feed, "text"), source);
          if (!articles.length) throw new Error("Feed kosong.");
          return articles;
        });
      });
      if (env.TRADING_ECONOMICS_API_KEY) {
        feedsRequested.push(cached("news:Trading Economics", 45000, () => tradingEconomicsNews(env.TRADING_ECONOMICS_API_KEY)));
      }
      const settled = await Promise.allSettled(feedsRequested);
      const feeds = settled.filter(result => result.status === "fulfilled").map(result => result.value);
      if (!feeds.length) throw new Error("Semua feed berita sedang tidak dapat dihubungi.");
      const news = [...new Map(feeds.flatMap(result => result.data).map(item => [item.id, item])).values()]
        .sort((a,b) => b.date - a.date).slice(0, 90);
      return json({ news, updated: Math.max(...feeds.map(feed => feed.updated)), stale: feeds.some(feed => feed.stale), partial: feeds.length !== settled.length });
    }
    if (url.pathname === "/api/calendar") {
      const result = await cached("calendar", 60000, () => calendar(env));
      return json({ events: result.data, updated: result.updated, stale: result.stale });
    }
    return json({ error: "Endpoint tidak tersedia." }, 404);
  } catch (error) {
    return json({ error: error.message || "Sumber data sedang tidak tersedia." }, error.status || 502);
  }
}
