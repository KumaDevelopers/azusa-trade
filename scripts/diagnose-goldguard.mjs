/**
 * Runs the user's unchanged GoldGuard through the installed PineTS runtime.
 * Fetches *real* bars from the user's published AzusaTrade API.
 * No source rewriting, synthetic OHLC, trading orders, or automatic uploads.
 * Diagnostic output is intentionally a text file with the original cause stack.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runAdvancedPine } from '../lib/pine-advanced.mjs';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = (process.argv[2] || 'https://azusa-trade.vercel.app').replace(/\/+$/, '');
const frame = process.argv[3] || '4h';
const allowed = new Set(['5m', '15m', '30m', '1h', '4h', '1d', '1w']);
if (!allowed.has(frame)) {
  console.error('Timeframe tidak valid. Gunakan 5m, 15m, 30m, 1h, 4h, 1d, 1w.');
  process.exit(2);
}
if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base)) {
  console.error('URL harus berupa origin HTTPS, contoh https://azusa-trade.vercel.app');
  process.exit(2);
}
const report = [];
const record = line => {
  const message = String(line);
  report.push(message);
  console.log(message);
};
const digest = str => createHash('sha256').update(str).digest('hex');
function describeCause(error) {
  const lines = [];
  const visited = new Set();
  for (let cause = error, depth = 0; cause && depth < 6 && !visited.has(cause); cause = cause.cause, depth++) {
    visited.add(cause);
    lines.push(`--- Error layer ${depth} ---`);
    lines.push(cause.stack || String(cause));
  }
  return lines.join('\n');
}
let requests = 0;
const requestsBySeries = new Map();
const failedRequests = [];
const realFetch = async (relative, init) => {
  const address = new URL(relative, base);
  if (address.origin !== base) throw Error('URL eksternal tidak diizinkan oleh diagnosis.');
  const symbol = address.searchParams.get('symbol') || '?';
  const dataFrame = address.searchParams.get('frame') || '?';
  const k = `${symbol}/${dataFrame}`;
  requests++;
  requestsBySeries.set(k, (requestsBySeries.get(k) || 0) + 1);
  try {
    const response = await fetch(address, { ...init, signal: init?.signal || AbortSignal.timeout(20000) });
    if (!response.ok) {
      const error = `HTTP ${response.status} ${k}`;
      failedRequests.push(error);
      record(`[API] ${error}`);
    }
    return response;
  } catch (error) {
    const reason = `[API] Network ${k}: ${error.cause?.message || error.message}`;
    failedRequests.push(reason);
    record(reason);
    throw error;
  }
};

try {
  const source = await readFile(resolve(project, 'indicators/GoldGuard.pine'), 'utf8');
  record('AzusaTrade GoldGuard PineTS diagnostic, no change to trading source.');
  record(`Date (UTC): ${new Date().toISOString()}`);
  record(`API: ${base}`);
  record(`Chart: XAUUSD ${frame}`);
  record(`GoldGuard SHA256: ${digest(source)}`);
  record(`GoldGuard calc_bars_count: ${source.match(/\bcalc_bars_count\s*=\s*(\d+)/)?.[1] || 'not found'}`);
  let pinetsVersion = 'unknown';
  try {
    const installed = JSON.parse(await readFile(resolve(project, 'node_modules/pinets/package.json'), 'utf8'));
    pinetsVersion = installed.version;
  } catch {}
  record(`Installed PineTS: ${pinetsVersion}`);
  const historyURL = `/api/history?symbol=XAUUSD&frame=${encodeURIComponent(frame)}&limit=180&provider=auto`;
  const res = await realFetch(historyURL);
  if (!res.ok) throw Error(`Data XAUUSD ${frame} tidak tersedia dari ${base} (HTTP ${res.status}).`);
  const payload = await res.json();
  if (!Array.isArray(payload.bars)) throw Error('Format /api/history bukan daftar candle.');
  if (payload.stale) throw Error('API menyatakan candle stale; tidak aman untuk pengujian sinyal.');
  const bars = payload.bars.filter(row => Number.isFinite(row?.time) &&
    [row.open, row.high, row.low, row.close].every(Number.isFinite));
  record(`Primary OHLC: ${bars.length} of ${payload.bars.length} valid, source=${payload.source || 'unknown'}`);
  if (bars.length) {
    record(`Primary range: ${new Date(bars[0].time * 1000).toISOString()} through ${new Date(bars.at(-1).time * 1000).toISOString()}`);
  }
  if (bars.length < 30) throw Error(`Candle XAUUSD ${frame} hanya ${bars.length}; tidak cukup untuk tes PineTS.`);
  record('[RUN] PineTS actual GoldGuard compile and evaluation...');
  const started = Date.now();
  const output = await runAdvancedPine(source, bars, { market: 'XAUUSD', frame, fetchImpl: realFetch });
  record(`[RUN] Complete in ${Date.now() - started} ms. Plots=${output.plots.length}, warnings=${output.warnings?.length || 0}, alerts=${output.alerts?.length || 0}`);
  record('WARNING: A passing PineTS run is not proof of TradingView signal equivalence or completed GG drawings.');
} catch (error) {
  record('[FAILED] ' + (error.message || String(error)));
  record(describeCause(error));
  process.exitCode = 1;
} finally {
  record(`[API] Total ${requests} calls`);
  for (const [series, count] of requestsBySeries) record(`[API] ${series}: ${count}`);
  if (failedRequests.length) record(`[API] Failed calls: ${failedRequests.slice(0, 30).join(' | ')}`);
  const destination = resolve(project, 'goldguard-diagnosis.txt');
  await writeFile(destination, report.join('\n') + '\n', 'utf8');
  console.log(`Report: ${destination}`);
}
