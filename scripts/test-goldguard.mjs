// Diagnose the ORIGINAL GoldGuard on real imported bars, without rewriting its logic.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readArchive, archivePath, frameSeconds } from '../lib/market-archive.mjs';
import { runAdvancedPine } from '../lib/pine-advanced.mjs';

const root = resolve(import.meta.dirname, '..');
const source = await readFile(resolve(root, 'indicators/GoldGuard.pine'), 'utf8');
const seedLoader = async (symbol, frame) => {
  try { return JSON.parse(await readFile(resolve(root, 'public', archivePath(symbol, frame).slice(1)), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const payload = await seedLoader('XAUUSD', '4h');
if (!payload) {
  console.error('Belum ada XAUUSD 4h. Jalankan SEED-HISTORY-GOLDGUARD.cmd sebelum pengujian.');
  process.exit(2);
}
const rows = readArchive(payload, 'XAUUSD', '4h');
if (rows.length < 500) {
  console.error(`Histori XAUUSD 4h baru ${rows.length} candle; unduh setidaknya 500 candle asli.`);
  process.exit(2);
}
const mockFetch = async () => ({ ok:false, status:424, json:async()=>({error:'Data belum tersedia offline'}) });
try {
  const result = await runAdvancedPine(source, rows.slice(-Math.min(rows.length, 900)).map(bar => ({
    ...bar, end: bar.time + frameSeconds('4h'), closed: true,
  })), { market:'XAUUSD', frame:'4h', seedLoader, fetchImpl:mockFetch });
  console.log('PineTS berhasil menghitung:', result.plots.map(plot=>plot.name).join(', '));
  console.warn('BELUM memvalidasi kesesuaian sinyal terhadap TradingView.');
} catch (error) {
  console.error('[GAGAL] GoldGuard original masih memerlukan kompatibilitas Pine/data MTF.');
  console.error(error.stack || error.message);
  if (error.cause) console.error('[CAUSE]', error.cause.stack || String(error.cause));
  process.exitCode = 1;
}
