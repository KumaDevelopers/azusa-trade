export const markets = [
  { id: "BTCUSDT", name: "Bitcoin", category: "Crypto", asset: "BTC", quote: "USDT", precision: 2, color: "#f0a03d", mark: "₿" },
  { id: "ETHUSDT", name: "Ethereum", category: "Crypto", asset: "ETH", quote: "USDT", precision: 2, color: "#a9a6f2", mark: "◆" },
  { id: "SOLUSDT", name: "Solana", category: "Crypto", asset: "SOL", quote: "USDT", precision: 2, color: "#91e1bc", mark: "≋" },
  { id: "BNBUSDT", name: "BNB", category: "Crypto", asset: "BNB", quote: "USDT", precision: 2, color: "#f1c454", mark: "◇" },
  { id: "XRPUSDT", name: "XRP", category: "Crypto", asset: "XRP", quote: "USDT", precision: 4, color: "#d3dae4", mark: "×" },
  { id: "ADAUSDT", name: "Cardano", category: "Crypto", asset: "ADA", quote: "USDT", precision: 4, color: "#79aaff", mark: "✣" },
  { id: "DOGEUSDT", name: "Dogecoin", category: "Crypto", asset: "DOGE", quote: "USDT", precision: 5, color: "#eac46e", mark: "Ð" },
  { id: "XAUUSD", name: "Gold Spot", category: "Metals", asset: "XAU", quote: "USD", precision: 2, color: "#edc471", mark: "Au" },
  { id: "XAGUSD", name: "Silver Spot", category: "Metals", asset: "XAG", quote: "USD", precision: 3, color: "#acbed0", mark: "Ag" },
  ...[
    ["EUR", "USD", "Euro / US Dollar"], ["GBP", "USD", "British Pound / US Dollar"],
    ["USD", "JPY", "US Dollar / Japanese Yen"], ["AUD", "USD", "Australian Dollar / US Dollar"],
    ["USD", "CAD", "US Dollar / Canadian Dollar"], ["USD", "CHF", "US Dollar / Swiss Franc"],
    ["NZD", "USD", "New Zealand Dollar / US Dollar"], ["EUR", "JPY", "Euro / Japanese Yen"],
    ["GBP", "JPY", "British Pound / Japanese Yen"],
  ].map(([asset, quote, name]) => ({
    id: asset + quote, asset, quote, name, category: "Forex", precision: quote === "JPY" ? 3 : 5,
    color: "#85aafa", mark: asset === "EUR" ? "€" : asset === "GBP" ? "£" : asset === "USD" ? "$" : asset.slice(0, 2),
  })),
  { id: "DXY", name: "US Dollar Index", category: "Indices", asset: "DXY", quote: "", precision: 3, color: "#8eccb2", mark: "$" },
  { id: "US10Y", name: "US Treasury 10Y Yield", category: "Bonds", asset: "US10Y", quote: "", precision: 3, color: "#8eccb2", mark: "%" },
];
export const byId = Object.fromEntries(markets.map(market => [market.id, market]));
export const frames = {
  "1s": 1, "5s": 5, "15s": 15, "30s": 30, "1m": 60, "3m": 180, "5m": 300, "15m": 900,
  "30m": 1800, "45m": 2700, "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600,
  "8h": 28800, "12h": 43200, "1d": 86400, "1w": 604800, "1M": 2592000,
};
export const primaryFrames = ["5m", "15m", "30m", "1h", "4h", "1d", "1w"];
export const binanceFrames = {
  "1s": "1s", "5s": "1s", "15s": "1s", "30s": "1s", "1m": "1m", "3m": "3m", "5m": "5m",
  "15m": "15m", "30m": "30m", "45m": "15m", "1h": "1h", "2h": "2h", "4h": "4h",
  "6h": "6h", "8h": "8h", "12h": "12h", "1d": "1d", "1w": "1w", "1M": "1M",
};
export const twelveFrames = {
  "1m": "1min", "3m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "45m": "15min",
  "1h": "1h", "2h": "2h", "4h": "4h", "6h": "1h", "8h": "8h", "12h": "4h",
  "1d": "1day", "1w": "1week", "1M": "1month",
};
export const yieldFrames = { "1d": "1d", "1w": "1w", "1M": "1M" };

export function bucketTime(time, frame) {
  if (frame === "1M") {
    const date = new Date(time * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  }
  if (frame === "1w") {
    const monday = 345600;
    return Math.floor((time - monday) / frames[frame]) * frames[frame] + monday;
  }
  return Math.floor(time / frames[frame]) * frames[frame];
}

export function mergeBars(previous, incoming, maximum = 12000) {
  const indexed = new Map(previous.map(bar => [bar.time, bar]));
  for (const bar of incoming) {
    const current = indexed.get(bar.time);
    if (current?.closed && !bar.closed) continue;
    if (current?.updated && bar.updated && current.updated > bar.updated && !bar.closed) continue;
    indexed.set(bar.time, bar);
  }
  return Array.from(indexed.values()).sort((first, second) => first.time - second.time).slice(-maximum);
}

export function aggregateBars(bars, frame) {
  const result = [];
  for (const bar of bars) {
    const time = bucketTime(bar.time, frame);
    const last = result.at(-1);
    const date = new Date(time * 1000);
    const end = frame === "1M" ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000 : time + frames[frame];
    if (last?.time === time) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume = Number.isFinite(last.volume) && Number.isFinite(bar.volume) ? last.volume + bar.volume : null;
    } else {
      if (last) last.closed = true;
      result.push({ ...bar, time, end, closed: false });
    }
    const current = result.at(-1);
    current.updated = bar.updated;
    if (end) current.closed = Boolean(bar.closed && bar.end && bar.end >= end);
  }
  return result;
}

export function parseBinanceRows(rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw new Error("Format OHLC Binance tidak valid.");
  return rows.map(([time, open, high, low, close, volume, end]) => ({
    time: +time / 1000, open: +open, high: +high, low: +low, close: +close,
    volume: +volume, end: (+end + 1) / 1000, closed: +end < now, updated: Math.min(now, +end),
  })).filter(validBar);
}

export function validBar(bar) {
  return [bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    && bar.time >= 0 && bar.high >= Math.max(bar.open, bar.close)
    && bar.low <= Math.min(bar.open, bar.close) && bar.low <= bar.high;
}
