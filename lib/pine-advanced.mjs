/** PineTS adapter. Original Pine sources are passed through, never rewritten. */
const TIMEFRAMES = {
  "1s": "1s", "5s": "5s", "15s": "15s", "30s": "30s",
  "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "45": "45m",
  "60": "1h", "120": "2h", "240": "4h", "360": "6h", "480": "8h", "720": "12h",
  "D": "1d", "1D": "1d", "W": "1w", "1W": "1w", "M": "1M", "1M": "1M",
};
export const nativeFrame = frame => {
  if (frame == null || frame === "") return null;
  const value = String(frame).trim();
  if (Object.hasOwn(TIMEFRAMES, value)) return TIMEFRAMES[value];
  if (["1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M"].includes(value)) return value;
  if (/^(1|3|5|15|30|45)m$/.test(value)) return value;
  if (/^\d+$/.test(value)) {
    const n = +value;
    if (n > 0 && n <= 1440 && n % 60 === 0) return n === 1440 ? "1d" : n / 60 + "h";
    if ([1, 3, 5, 15, 30, 45].includes(n)) return n + "m";
  }
  return null;
};
const tickerId = id => String(id || "").split(";")[0].split(":").at(-1).replace(/[\/_-]/g, "").toUpperCase();
const valid = bar => Number.isFinite(bar?.time) && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite);
export const toPineBars = (bars, seconds) => bars.filter(valid).map(bar => ({
  openTime: bar.time * 1000, closeTime: (bar.end ?? bar.time + seconds) * 1000,
  open: bar.open, high: bar.high, low: bar.low, close: bar.close,
  volume: Number.isFinite(bar.volume) ? bar.volume : 0,
}));

/**
 * A same-origin provider for secondary Pine requests. It deliberately fails closed
 * instead of substituting chart prices for an unavailable symbol/timeframe.
 */
export function makeMarketProvider({ market, frame, bars, fetchImpl = fetch }) {
  const key = tickerId(market);
  const primary = nativeFrame(frame) || frame;
  const local = toPineBars(bars, bars[1]?.time - bars[0]?.time || 60);
  const cache = new Map();
  return {
    configure() {},
    async getMarketData(ticker, timeframe, limit = 420, start, end, options = {}) {
      const symbol = tickerId(ticker);
      const normalized = nativeFrame(timeframe || frame);
      if (!normalized) throw Error(`Timeframe Pine ${String(timeframe ?? "(kosong)")} belum didukung; pilih timeframe yang tersedia.`);
      if (symbol === key && normalized === primary) return local.filter(row =>
        (!start || row.openTime >= start) && (!end || row.openTime <= end)).slice(-Math.max(1, limit || 420));
      const cacheKey = symbol + ":" + normalized + ":" + (end ?? "");
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const params = new URLSearchParams({ symbol, frame: normalized, limit: String(Math.min(420, Math.max(1, limit || 420))), provider: "auto" });
      if (end) params.set("before", String(Math.floor(end / 1000) + 1));
      const response = await fetchImpl("/api/history?" + params, {
        cache: "no-store", signal: options.signal ?? AbortSignal.timeout(9500),
      });
      if (!response.ok) {
        let detail = "";
        try { detail = (await response.json()).error || ""; } catch {}
        throw Error(`Data MTF ${symbol} ${normalized} tidak tersedia (${response.status})${detail ? ": " + detail : ""}.`);
      }
      const json = await response.json();
      if (!Array.isArray(json.bars) || !json.bars.length || json.stale) throw Error(`Data MTF ${symbol} ${normalized} kosong atau stale.`);
      const length = json.bars[1]?.time - json.bars[0]?.time || 60;
      const result = toPineBars(json.bars, length).filter(row =>
        (!start || row.openTime >= start) && (!end || row.openTime <= end));
      if (!result.length) throw Error(`Tidak ada candle ${symbol} ${normalized} pada periode diminta.`);
      cache.set(cacheKey, result);
      return result;
    },
    async getSymbolInfo(ticker) {
      const symbol = tickerId(ticker);
      const forex = /^(?:XAU|XAG|EUR|GBP|USD|AUD|CAD|CHF|NZD|JPY)/.test(symbol) && symbol.length === 6;
      const precision = symbol.startsWith("XAU") || symbol.startsWith("XAG") ? 0.001 : symbol.endsWith("JPY") ? 0.001 : 0.00001;
      const pricescale = Math.round(1 / precision);
      return {
        ticker: symbol, tickerid: symbol, main_tickerid: symbol, prefix: "AZUSA",
        root: symbol, description: symbol, current_contract: "", isin: "",
        type: forex ? "forex" : "crypto", basecurrency: symbol.slice(0, 3), currency: symbol.slice(3),
        country: "", timezone: "Etc/UTC", session: "0000-0000", volumetype: "tick",
        mincontract: 1, minmove: 1, mintick: precision, pointvalue: 1, pricescale,
        expiration_date: 0, employees: 0, industry: "", sector: "",
        shareholders: 0, shares_outstanding_float: 0, shares_outstanding_total: 0,
        recommendations_buy: 0, recommendations_buy_strong: 0, recommendations_date: 0,
        recommendations_hold: 0, recommendations_sell: 0, recommendations_sell_strong: 0,
        recommendations_total: 0, target_price_average: 0, target_price_date: 0,
        target_price_estimates: 0, target_price_high: 0, target_price_low: 0,
        target_price_median: 0,
      };
    },
  };
}

/**
 * Run a native Pine v5/v6 script using PineTS. This engine may expose drawings
 * and alerts, but the current AzusaTrade chart only renders numeric plots.
 */
export async function runAdvancedPine(source, bars, context = {}, runtime) {
  if (!/^\s*\/\/@version=[56]/m.test(source)) throw Error("PineTS memerlukan //@version=5 atau 6.");
  if (!Array.isArray(bars) || !bars.length) throw Error("Belum ada candle untuk menjalankan Pine v6.");
  const library = runtime ?? await import("pinets").catch(() => { throw Error("Library PineTS belum terpasang. Jalankan npm install pinets@0.13.1."); });
  const { PineTS, Indicator } = library;
  const symbol = context.market ?? "XAUUSD";
  const frame = context.frame || "1m";
  const timeframe = Object.entries(TIMEFRAMES).find(([pine, native]) => native === frame && !pine.endsWith("s"))?.[0] ?? frame;
  if (!nativeFrame(timeframe)) throw Error(`Timeframe chart ${frame} tidak didukung PineTS.`);
  const provider = makeMarketProvider({ market: symbol, frame, bars, fetchImpl: context.fetchImpl });
  const indicator = Indicator ? new Indicator(source) : source;
  const pine = new PineTS(provider, symbol, timeframe, Math.min(bars.length, 12000));
  const computed = await pine.run(indicator);
  const entries = Object.entries(computed.plots || {});
  const plots = entries.filter(([name, plot]) => !name.startsWith("GG_") && Array.isArray(plot?.data)).map(([name, plot]) => {
    const raw = plot.data.map(point => point?.value);
    const values = Array.from({ length: bars.length }, (_, i) => {
      const numeric = raw[i - (bars.length - raw.length)];
      return Number.isFinite(numeric) ? numeric : null;
    });
    return { name, type: "line", values };
  });
  return { plots, warnings: computed.warnings ?? [], alerts: computed.alerts ?? [], raw: computed };
}
