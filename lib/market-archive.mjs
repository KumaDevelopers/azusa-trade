/** Authentic candle archives for PineTS. Never interpolate, repeat, or fabricate bars. */
export const MAX_ARCHIVE_BARS = 12000;
const SYMBOL = /^[A-Z0-9]{3,14}$/;
const FRAME = /^(1m|3m|5m|15m|30m|45m|1h|2h|4h|6h|8h|12h|1d|1w|1M)$/;

export const archivePath = (symbol, frame) => {
  if (!SYMBOL.test(symbol) || !FRAME.test(frame)) throw Error("Simbol/timeframe arsip tidak valid.");
  return `/historical/${symbol}-${frame}.json`;
};

export function readArchive(payload, symbol, frame) {
  if (payload?.version !== 1 || payload?.symbol !== symbol || payload?.frame !== frame ||
      payload?.source !== "Dukascopy BID" || !Array.isArray(payload.bars))
    throw Error(`Arsip ${symbol} ${frame} tidak valid atau berbeda instrumen.`);
  if (payload.bars.length > MAX_ARCHIVE_BARS) throw Error("Arsip melebihi batas 12000 candle.");
  let previous = -Infinity;
  const result = [];
  for (const row of payload.bars) {
    if (!Array.isArray(row) || row.length !== 6) throw Error("Format candle arsip tidak valid.");
    const [time, open, high, low, close, volume] = row;
    if (!Number.isSafeInteger(time) || ![open,high,low,close,volume].every(Number.isFinite)
      || time <= previous || open <= 0 || close <= 0 || low <= 0 || high < Math.max(open,close,low)
      || low > Math.min(open,close,high) || volume < 0) throw Error("Arsip mengandung data rusak atau tidak urut.");
    previous = time;
    result.push({ time, open, high, low, close, volume, closed: true });
  }
  return result;
}

/** Merge chronological source candles only; current broker feed overrides archive on overlap.
 * Fail closed on an unexplained interval gap or major price discontinuity.
 */
export function mergeArchive(archived, recent, seconds, { maxGapSeconds = 4 * 86400 } = {}) {
  if (!archived.length) return recent.slice();
  if (!recent.length) return archived.slice();
  const first = recent[0];
  const preceding = archived.filter(bar => bar.time < first.time);
  if (!preceding.length) return recent.slice();
  const last = preceding.at(-1);
  const gap = first.time - last.time;
  // Normal weekend/holiday gaps are allowed, but stale archives must not silently bridge weeks.
  if (gap > Math.max(maxGapSeconds, seconds * 4))
    throw Error(`HISTORI_BERJEDA: arsip berhenti ${Math.round(gap/3600)} jam sebelum feed terbaru. Perbarui arsip terlebih dahulu.`);
  // If the very next observed price jumps implausibly, do not splice two brokers' histories.
  if (gap <= Math.max(seconds * 2, 86400) && Math.abs(first.open - last.close) / last.close > 0.08)
    throw Error("HISTORI_BEDA_SUMBER: perbedaan harga Dukascopy dan biquote terlalu besar.");
  return [...preceding, ...recent].slice(-MAX_ARCHIVE_BARS);
}

export function frameSeconds(frame) {
  const unit = frame.slice(-1);
  const n = Number(frame.slice(0,-1));
  return Number.isFinite(n) ? n * (unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : unit === 'w' ? 604800 : 2592000) : 60;
}
