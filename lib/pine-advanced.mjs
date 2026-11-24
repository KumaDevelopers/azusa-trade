/** PineTS adapter. Original Pine sources are passed through, never rewritten. */
import { archivePath, readArchive, mergeArchive, frameSeconds, MAX_ARCHIVE_BARS } from "./market-archive.mjs";
import { withPineTSSlicingDisabled } from "./pinets-compat.mjs";

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
const primaryBackfillCache = new Map();

export function makeMarketProvider({ market, frame, bars, fetchImpl = fetch, seedLoader, limitPerSeries = Infinity } = {}) {
  const key = tickerId(market);
  const primary = nativeFrame(frame) || frame;
  let local = toPineBars(bars, frameSeconds(primary) || 60);
  const cache = new Map();
  const archivePromises = new Map();
  const archiveFetch = seedLoader || (fetchImpl === fetch ? async (symbol, native) => {
    const response = await fetchImpl(archivePath(symbol, native), { cache: "force-cache" });
    return response.ok ? await response.json() : null;
  } : async () => null);
  async function getArchive(symbol, native) {
    const archiveKey = symbol + ":" + native;
    if (!archivePromises.has(archiveKey)) {
      archivePromises.set(archiveKey, Promise.resolve().then(async () => {
        const raw = await archiveFetch(symbol, native);
        if (!raw) return [];
        return readArchive(raw, symbol, native);
      }).catch(error => {
        // Malformed or mismatched data must fail visibly; only genuine 404 is optional.
        archivePromises.delete(archiveKey);
        throw new Error(`Arsip histori ${symbol} ${native}: ${error.message}`, { cause: error });
      }));
    }
    return archivePromises.get(archiveKey);
  }
  function mergedWithArchive(archive, recent, native) {
    const combined = mergeArchive(archive, recent, frameSeconds(native));
    return toPineBars(combined, frameSeconds(native));
  }
  // PineTS needs more history than the visible chart for some MTF studies.
  // Fetch older real candles where the provider supports them; never synthesize prices.
  async function primePrimary(target = 420) {
    const capped = Math.max(1, Math.min(MAX_ARCHIVE_BARS, Math.floor(target)));
    if (!local.length || local.length >= capped) return local.length;
    // Prefer a real, already-published long archive. A finite biquote rolling
    // window cannot be paged backwards indefinitely by increasing `limit`.
    const seeded = await getArchive(key, primary);
    if (seeded.length) {
      const oldRecent = local.map(bar => ({
        time: Math.floor(bar.openTime / 1000), open: bar.open, high: bar.high,
        low: bar.low, close: bar.close, volume: bar.volume, closed: true,
      }));
      local = mergedWithArchive(seeded, oldRecent, primary);
      // Once a real long archive is loaded, biquote's rolling endpoint cannot
      // supply pre-archive bars. Avoid repeated futile backfill requests.
      return local.length;
    }
    const cacheKey = key + ":" + primary + ":" + local[0].openTime;
    const cached = primaryBackfillCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < 300000) {
      const known = new Set(local.map(row => row.openTime));
      local = [...cached.older.filter(row => !known.has(row.openTime)), ...local].sort((a,b) => a.openTime - b.openTime);
      return local.length;
    }
    const originalOldest = local[0].openTime;
    const seen = new Set(local.map(row => row.openTime));
    let oldest = Math.floor(local[0].openTime / 1000);
    for (let page = 0; page < 2 && local.length < capped; page++) {
      const params = new URLSearchParams({
        symbol: key, frame: primary, provider: "auto",
        limit: String(Math.min(1000, Math.max(10, capped - local.length + 8))),
        before: String(oldest),
      });
      let response;
      try {
        response = await fetchImpl("/api/history?" + params, {
          cache: "no-store", signal: AbortSignal.timeout(9500),
        });
      } catch { break; }
      if (!response?.ok) break;
      let payload;
      try { payload = await response.json(); } catch { break; }
      if (!Array.isArray(payload?.bars) || !payload.bars.length || payload.stale) break;
      const older = toPineBars(payload.bars, frameSeconds(primary)).filter(row => row.openTime < oldest * 1000 && !seen.has(row.openTime));
      if (!older.length) break;
      for (const row of older) seen.add(row.openTime);
      local = [...older, ...local].sort((a, b) => a.openTime - b.openTime);
      oldest = Math.floor(local[0].openTime / 1000);
    }
    // Keep the older snapshot for forming-bar recalculations (no network storm).
    if (primaryBackfillCache.size >= 20) primaryBackfillCache.delete(primaryBackfillCache.keys().next().value);
    primaryBackfillCache.set(cacheKey, { savedAt: Date.now(), older: local.filter(row => row.openTime < originalOldest) });
    return local.length;
  }
  return {
    configure() {},
    primePrimary,
    async getMarketData(ticker, timeframe, limit, start, end, options = {}) {
      const symbol = tickerId(ticker);
      const normalized = nativeFrame(timeframe || frame);
      const requested = Math.min(limitPerSeries, Number.isFinite(limit) && limit > 0 ? Math.floor(limit)
        : symbol === key && normalized === primary ? local.length : 420);
      if (!normalized) throw Error(`Timeframe Pine ${String(timeframe ?? "(kosong)")} belum didukung; pilih timeframe yang tersedia.`);
      if (symbol === key && normalized === primary) return local.filter(row =>
        (!start || row.openTime >= start) && (!end || row.openTime <= end)).slice(-Math.max(1, requested));
      const cacheKey = [symbol, normalized, requested, start ?? "", end ?? ""].join(":");
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      // Historical secondary requests may be older than biquote's finite window.
      // Use genuine archive bars for those requests, not manufactured chart prices.
      const seed = await getArchive(symbol, normalized);
      const params = new URLSearchParams({ symbol, frame: normalized, limit: String(Math.min(1000, Math.max(1, requested))), provider: "auto" });
      if (end) params.set("before", String(Math.floor(end / 1000) + 1));
      let recent = [];
      let errorDetail = "";
      try {
        const response = await fetchImpl("/api/history?" + params, {
          cache: "no-store", signal: options.signal ?? AbortSignal.timeout(9500),
        });
        if (!response.ok) {
          try { errorDetail = (await response.json()).error || `HTTP ${response.status}`; }
          catch { errorDetail = `HTTP ${response.status}`; }
        } else {
          const json = await response.json();
          if (Array.isArray(json.bars) && !json.stale) recent = json.bars;
        }
      } catch (error) { errorDetail = error.message; }
      if (!recent.length && !seed.length)
        throw Error(`Data MTF ${symbol} ${normalized} tidak tersedia${errorDetail ? ": " + errorDetail : ""}.`);
      const result = (seed.length ? mergedWithArchive(seed, recent, normalized)
        : toPineBars(recent, frameSeconds(normalized))).filter(row =>
        (!start || row.openTime >= start) && (!end || row.openTime <= end)).slice(-Math.max(1, requested));
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
  const declaredCount = Number(source.match(/\bcalc_bars_count\s*=\s*(\d+)/)?.[1] || 0);
  const limitedGoldGuard = /indicator\("GoldGuard v2\.0\.0 Stable Reload"/.test(source) && declaredCount === 180;
  // Treat the 180-candle limit as an input limit, not just a Pine header change.
  // Do not alter the trading source or manufacture higher-timeframe/secondary data.
  const primaryBars = limitedGoldGuard ? bars.slice(-180) : bars;
  const provider = makeMarketProvider({ market: symbol, frame, bars: primaryBars,
    fetchImpl: context.fetchImpl, seedLoader: context.seedLoader,
    limitPerSeries: limitedGoldGuard ? 180 : Infinity });
  const totalBars = declaredCount > primaryBars.length
    ? await provider.primePrimary(Math.min(MAX_ARCHIVE_BARS, declaredCount)) : primaryBars.length;
  const indicator = Indicator ? new Indicator(source) : source;
  const pine = new PineTS(provider, symbol, timeframe, Math.min(totalBars, 12000));
  let computed;
  try {
    // The 180-bar GoldGuard requires its full closure to be available in
    // nested request.security() contexts. PineTS 0.13.1's slice path crashed
    // on this exact source (TypeError reading '144'); the original full-script
    // path completed in the user's real runtime diagnostic.
    // Only the GoldGuard 180 execution uses this compatibility setting.
    computed = await withPineTSSlicingDisabled(limitedGoldGuard, () => pine.run(indicator));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const indexed = /Cannot read properties of undefined \(reading ['"](\d+)['"]\)/.exec(message);
    if (indexed) {
      const index = Number(indexed[1]);
      // An internal JS property name like 464 is NOT necessarily a Pine
      // bar-history offset. Avoid misdiagnosing a transpiler crash as missing bars.
      const reason = `PineTS gagal mengakses seri internal ${index}. Histori tersedia: ${totalBars} candle. `;
      throw new Error(`${reason}Perhitungan ${symbol} ${frame} dihentikan; ini bisa berasal dari kompatibilitas PineTS, bukan hanya panjang histori. `
        + `Periksa dukungan PineTS terhadap script ini serta kelengkapan MTF/makro; pembatasan 180 tidak otomatis menyelesaikan error runtime.`, { cause });
    }
    throw cause;
  }
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
