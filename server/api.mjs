import { aggregateBars, binanceFrames, bucketTime, byId, frames, parseBinanceRows, validBar, yieldFrames } from "../lib/instruments.mjs";

const mem = new Map();
const inFlight = new Map();
const BINANCE = "https://data-api.binance.vision";
const BIQUOTE = "https://biquote.io";
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

async function upstream(url, parse = "json", providerError, additionalHeaders = {}) {
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": userAgent, ...additionalHeaders }, signal: AbortSignal.timeout(7000) });
  } catch {
    throw new Error("Sumber data tidak dapat dihubungi.");
  }
  if (!response.ok) throw (providerError?.(response.status) ?? new Error("Sumber data mengembalikan HTTP " + response.status + "."));
  return response[parse]();
}


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

const providerIssue = (code, status, message) => Object.assign(new Error(message), { providerCode: code, status });

// biquote OHLC is broker mid-price, not a universal exchange price. The upstream
// stores a finite rolling window, so unavailable history must not be fabricated.
const biquoteFrames = {
  "1m": "1m", "3m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "45m": "15m",
  "1h": "1h", "2h": "1h", "4h": "4h", "6h": "1h", "8h": "4h", "12h": "4h",
  "1d": "1d", "1w": "1d", "1M": "1d",
};

function biquoteError(status) {
  if (status === 429) return providerIssue("BIQUOTE_RATE_LIMIT", 429, "Batas permintaan biquote tercapai. Coba lagi nanti.");
  if (status === 404) return providerIssue("BIQUOTE_SYMBOL_UNAVAILABLE", 424, "Simbol tidak tersedia di feed biquote saat ini.");
  return providerIssue("BIQUOTE_UNAVAILABLE", 502, "Feed biquote belum dapat dihubungi.");
}

export function biquoteBars(payload, native, frame, limit, before = null) {
  if (!Array.isArray(payload?.bars)) throw providerIssue("BIQUOTE_INVALID_OHLC", 502, "Format candle biquote tidak dikenali.");
  const seconds = frames[native];
  const bars = payload.bars.map(row => {
    const time = Date.parse(row.openTime) / 1000;
    return {
      time, open: +row.open, high: +row.high, low: +row.low, close: +row.close,
      volume: Number.isFinite(Number(row.tickVolume)) ? Number(row.tickVolume) : null,
      end: time + seconds, closed: !row.isOpen,
    };
  }).filter(validBar).filter(bar => !before || bar.time < before).sort((a,b) => a.time - b.time);
  const result = native === frame ? bars : aggregateBars(bars, frame);
  return result.slice(-limit);
}

async function biquoteHistory(market, frame, limit, before) {
  const native = biquoteFrames[frame];
  if (!native) throw providerIssue("BIQUOTE_FRAME_UNAVAILABLE", 422, "Histori Forex biquote tersedia mulai timeframe 1 menit.");
  const span = Math.ceil(frames[frame] / frames[native]);
  const url = new URL("/api/" + market.id + "/ohlc", BIQUOTE);
  url.searchParams.set("interval", native);
  url.searchParams.set("limit", String(Math.min(1000, Math.ceil(limit * span) + 4)));
  if (before) url.searchParams.set("to", new Date((before - 1) * 1000).toISOString());
  const result = biquoteBars(await upstream(url, "json", biquoteError), native, frame, limit, before);
  if (!result.length) throw providerIssue("BIQUOTE_NO_CANDLES", 424, "Belum ada candle biquote pada timeframe atau rentang ini.");
  return { source: "biquote MT5", bars: result };
}

async function biquotePrice(market) {
  const tick = await upstream(BIQUOTE + "/api/" + market.id, "json", biquoteError);
  const price = Number(tick?.mid);
  const observedAt = Date.parse(tick?.timestamp) / 1000;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(observedAt))
    throw providerIssue("BIQUOTE_EMPTY_PRICE", 502, "Harga atau timestamp biquote tidak valid.");
  const bid = Number(tick.bid), ask = Number(tick.ask);
  return {
    source: "biquote MT5", price, observedAt, realTimeTick: false,
    marketState: tick.marketState || "unknown", quoteStale: tick.stale === true || tick.marketState === "closed" || Date.now()/1000-observedAt>300,
    ...(Number.isFinite(bid) && bid > 0 ? { bid } : {}),
    ...(Number.isFinite(ask) && ask > 0 ? { ask } : {}),
  };
}

function biquoteQuote(tick) {
  const price = Number(tick?.mid);
  if (!Number.isFinite(price) || price <= 0) return null;
  const high = Number(tick.high), low = Number(tick.low), age = Date.parse(tick.timestamp);
  const stale = tick.stale === true || tick.marketState === "closed" || !Number.isFinite(age) || Date.now() - age > 300000;
  return {
    price, change: stale ? null : Number.isFinite(Number(tick.dayDiffPercent)) ? Number(tick.dayDiffPercent) : null,
    high: Number.isFinite(high) ? high : price, low: Number.isFinite(low) ? low : price, volume: 0,
  };
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
      forex: true, forexStream: "https://biquote.io/hubs/tick", forexProvider: "biquote",
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
        if (market.category !== "Crypto") return biquoteHistory(market, frame, limit, before);
        if (provider === "okx") return okxHistory(market, frame, limit, before);
        if (provider === "binance") return binanceHistory(market, frame, limit, before);
        try { return await binanceHistory(market, frame, limit, before); }
        catch { return okxHistory(market, frame, limit, before); }
      });
      return json({ ...result.data, updated: result.updated, stale: result.stale });
    }
    if (url.pathname === "/api/price") {
      const symbol = url.searchParams.get("symbol");
      if (!Object.hasOwn(byId, symbol) || byId[symbol].category === "Crypto" || symbol === "US10Y")
        return json({ error: "Simbol tidak mendukung snapshot harga ini." }, 400);
      const result = await cached("biquote:price:" + symbol, 8000, () => biquotePrice(byId[symbol]));
      return json({ ...result.data, updated: result.updated, stale: result.stale });
    }
    if (url.pathname === "/api/quotes") {
      const symbols = [...new Set((url.searchParams.get("symbols") ?? "").split(","))].filter(symbol => Object.hasOwn(byId, symbol)).slice(0, 30);
      if (!symbols.length) return json({ quotes: {} });
      const crypto = symbols.filter(symbol => byId[symbol].category === "Crypto");
      const forex = symbols.filter(symbol => !["Crypto", "Bonds"].includes(byId[symbol].category) && symbol !== "DXY");
      const tasks = [];
      if (crypto.length) tasks.push(cached("quotes:crypto:" + crypto.join(","), 12000, async () => {
        const query = new URLSearchParams({ symbols: JSON.stringify(crypto) });
        const data = await upstream(BINANCE + "/api/v3/ticker/24hr?" + query);
        return Object.fromEntries(data.map(row => [row.symbol, { price: +row.lastPrice, change: +row.priceChangePercent, high: +row.highPrice, low: +row.lowPrice, volume: +row.quoteVolume }]));
      }));
      if (forex.length) tasks.push(cached("quotes:biquote:" + forex.join(","), 12000, async () => {
        const query = new URLSearchParams();
        forex.forEach(symbol => query.append("symbols", symbol));
        const data = await upstream(BIQUOTE + "/api/latest?" + query, "json", biquoteError);
        const ticks = Array.isArray(data) ? data : data?.symbol ? [data] : forex.length === 1 && data?.mid !== undefined ? [{ ...data, symbol: forex[0] }] : Array.isArray(data?.quotes) ? data.quotes
          : Array.isArray(data?.items) ? data.items : Array.isArray(data?.ticks) ? data.ticks : Array.isArray(data?.results) ? data.results : Object.entries(data || {}).map(([symbol, quote]) => ({ ...quote, symbol }));
        return Object.fromEntries(ticks.flatMap(tick => {
          const symbol = tick.symbol || tick.name;
          const quote = biquoteQuote(tick);
          return symbol && forex.includes(symbol) && quote ? [[symbol, quote]] : [];
        }));
      }));
      const results = await Promise.allSettled(tasks);
      const fulfilled = results.filter(result => result.status === "fulfilled").map(result => result.value);
      if (!fulfilled.length) return json({ quotes: {}, partial: true, stale: true });
      return json({ quotes: Object.assign({}, ...fulfilled.map(entry => entry.data)),
        updated: Math.max(...fulfilled.map(entry => entry.updated)), stale: fulfilled.every(entry => entry.stale),
        partial: fulfilled.length !== tasks.length });
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
    return json({ error: error.message || "Sumber data sedang tidak tersedia.", ...(error.providerCode ? { code: error.providerCode } : {}) }, error.status || 502);
  }
}
