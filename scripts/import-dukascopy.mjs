#!/usr/bin/env node
/* Convert genuine Dukascopy candles into strict static Pine archives.
 * Usage: node scripts/import-dukascopy.mjs download/xauusd-h4.csv XAUUSD 4h
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ARCHIVE_BARS, readArchive, archivePath } from '../lib/market-archive.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2], symbol = String(process.argv[3] || '').toUpperCase();
const frame = process.argv[4];
function timeOf(value) {
  const text = String(value).replace(/^\uFEFF/, '').trim();
  if (/^\d{10,13}$/.test(text)) return Math.floor(Number(text) / (text.length === 13 ? 1000 : 1));
  // Dukascopy's manual export may use DD.MM.YYYY HH:mm:ss or YYYY.MM.DD.
  // Do not parse date strings using the machine's local timezone.
  const eu = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/.exec(text);
  const ymd = /^(\d{4})[.\/-](\d{2})[.\/-](\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/.exec(text);
  const iso = eu ? `${eu[3]}-${eu[2]}-${eu[1]}T${eu[4]}Z`
    : ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}T${ymd[4]}Z`
    : /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(text)
      ? text.replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(text) ? '' : 'Z') : text;
  const millis = Date.parse(iso);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : NaN;
}
export function parseRows(content) {
  const seen = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || /^timestamp\s*,/i.test(line) || /^date\s*,/i.test(line) || /^time\s*,/i.test(line)) continue;
    const cells = line.split(/[;,]/).map(cell => cell.trim());
    if (cells.length < 5) continue;
    const time = timeOf(cells[0]);
    const open = +cells[1], high = +cells[2], low = +cells[3], close = +cells[4];
    const volume = cells.length > 5 ? +cells[5] : 0;
    if (!Number.isSafeInteger(time) || ![open,high,low,close,volume].every(Number.isFinite) ||
      open <= 0 || low <= 0 || close <= 0 || high < Math.max(open,close,low) ||
      low > Math.min(open,close,high) || volume < 0) continue;
    seen.set(time, [time,open,high,low,close,volume]);
  }
  return [...seen.values()].sort((a,b) => a[0] - b[0]).slice(-MAX_ARCHIVE_BARS);
}
export async function importCsv({ path, symbol, frame }) {
  const entries = parseRows(await readFile(path, 'utf8'));
  if (!entries.length) throw Error('File CSV tidak mengandung candle yang valid.');
  const payload = { version: 1, symbol, frame, source: 'Dukascopy BID', bars: entries };
  readArchive(payload, symbol, frame);
  const base = resolve(root, 'public');
  const pathname = resolve(base, archivePath(symbol, frame).replace(/^\//,''));
  const rel = relative(base, pathname);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error('Invalid output path');
  await mkdir(dirname(pathname), { recursive: true });
  await writeFile(pathname, JSON.stringify(payload));
  let weeklyCount = 0;
  if (frame === '1d') {
    // Derive weekly OHLC directly from genuine daily candles, no gap filling.
    const weekly = new Map();
    for (const [time, open, high, low, close, volume] of entries) {
      const date = new Date(time * 1000);
      // Explicit Monday UTC anchor (independent of epoch week alignment).
      const midnight = Math.floor(time / 86400) * 86400;
      const weekTime = midnight - ((date.getUTCDay() + 6) % 7) * 86400;
      const prior = weekly.get(weekTime);
      if (!prior) weekly.set(weekTime, [weekTime, open, high, low, close, volume]);
      else { prior[2] = Math.max(prior[2], high); prior[3] = Math.min(prior[3], low); prior[4] = close; prior[5] += volume; }
    }
    const weeklyRows = [...weekly.values()].slice(-MAX_ARCHIVE_BARS);
    const weeklyPayload = { version:1, symbol, frame:'1w', source:'Dukascopy BID', bars:weeklyRows };
    readArchive(weeklyPayload,symbol,'1w');
    await writeFile(resolve(root,'public',archivePath(symbol,'1w').slice(1)),JSON.stringify(weeklyPayload));
    weeklyCount = weeklyRows.length;
  }
  return { path: pathname, count: entries.length, weeklyCount, first: entries[0][0], last: entries.at(-1)[0] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!input || !symbol || !frame) {
    console.error('Gunakan: node scripts/import-dukascopy.mjs <CSV> <XAUUSD> <4h>');
    process.exitCode = 2;
  } else {
    importCsv({path:input,symbol,frame}).then(result=>console.log('Arsip berhasil dibuat:',result))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
