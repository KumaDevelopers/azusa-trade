import { readFile } from "node:fs/promises";

const priceFields = ["open", "high", "low", "close"];
const auditFields = ["GG_ENTRY_TIME", "GG_SIDE", "GG_ENTRY", "GG_INITIAL_SL", "GG_TP", "GG_METHOD", "GG_SKIP", "GG_SCORE", "GG_EXIT_BORN", "GG_EXIT_TIME", "GG_EXIT_PRICE", "GG_EXIT_CODE"];

function parseCsv(text) {
  const rows = [];
  let row = [], token = "", quoted = false;
  const stream = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < stream.length; index++) {
    const char = stream[index];
    if (char === '"' && quoted && stream[index + 1] === '"') { token += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(token.trim()); token = ""; }
    else if (!quoted && char === "\n") { rows.push([...row, token.trim()]); row = []; token = ""; }
    else token += char;
  }
  if (quoted) throw new Error("CSV memiliki kutipan yang belum ditutup.");
  if (row.length || token) rows.push([...row, token.trim()]);
  return rows.filter(fields => fields.some(Boolean));
}

function readLedger(csv, filename) {
  const [headers, ...rows] = parseCsv(csv);
  const timeAt = headers?.findIndex(label => /^(?:time|timestamp|date\/time)$/i.test(label));
  if (timeAt == null || timeAt < 0) throw new Error("Kolom time tidak tersedia di " + filename);
  const names = [...priceFields, ...auditFields];
  const positions = names.map(field => {
    const choices = headers.map((header, index) => {
      const matches = priceFields.includes(field) ? header.toLowerCase() === field : header === field || header.endsWith(": " + field);
      return matches ? index : -1;
    }).filter(index => index >= 0);
    if (choices.length !== 1) throw new Error("Kolom " + field + " harus muncul tepat satu kali di " + filename);
    return choices[0];
  });
  const index = new Map();
  for (const row of rows) {
    const raw = row[timeAt];
    const timestamp = /^\d+$/.test(raw) ? (Number(raw) >= 1e12 ? Number(raw) : Number(raw) * 1000) : Date.parse(raw);
    if (!Number.isFinite(timestamp) || index.has(timestamp)) throw new Error("Timestamp invalid atau berulang di " + filename);
    const values = positions.map((position, fieldIndex) => {
      const value = row[position] ?? "";
      if (!value || /^(?:na|nan|null|undefined)$/i.test(value)) {
        if (fieldIndex < priceFields.length) throw Error("OHLC tidak lengkap di " + filename);
        return null;
      }
      if (!Number.isFinite(Number(value))) throw new Error("Nilai audit nonnumerik di " + filename + ": " + value);
      return Number(value);
    });
    index.set(timestamp, values);
  }
  if (!index.size) throw new Error("Tidak ada bar untuk dibandingkan di " + filename);
  return index;
}

const [baseline, candidate, epsilonRaw = "0.00000001"] = process.argv.slice(2);
const epsilon = Number(epsilonRaw);
if (!baseline || !candidate || !Number.isFinite(epsilon) || epsilon < 0) {
  console.error("Gunakan: node scripts/goldguard-parity.mjs <tradingview.csv> <candidate.csv> [toleransi-harga-absolut]");
  process.exitCode = 2;
} else {
  try {
    const ledgers = await Promise.all([baseline, candidate].map(async filename => readLedger(await readFile(filename, "utf8"), filename)));
    const [reference, sample] = ledgers;
    let common = 0, missing = 0, extra = 0, different = 0, candleMismatches = 0;
    let auditRowsWithDirection = 0;
    const names = [...priceFields, ...auditFields];
    const examples = [];
    for (const [time, expected] of reference) {
      const actual = sample.get(time);
      if (!actual) { missing++; continue; }
      common++;
      const side = expected[names.indexOf("GG_SIDE")];
      if (side !== null && side !== 0) auditRowsWithDirection++;
      expected.forEach((value, fieldIndex) => {
        const name = names[fieldIndex];
        const tolerance = ["GG_ENTRY", "GG_INITIAL_SL", "GG_TP", "GG_EXIT_PRICE"].includes(name) ? epsilon : 0;
        if (value === actual[fieldIndex] || value !== null && actual[fieldIndex] !== null && Math.abs(value - actual[fieldIndex]) <= tolerance) return;
        if (fieldIndex < priceFields.length) candleMismatches++;
        different++;
        if (examples.length < 24) examples.push({ timestamp: new Date(time).toISOString(), field: name, expected: value, actual: actual[fieldIndex] });
      });
    }
    for (const time of sample.keys()) if (!reference.has(time)) extra++;
    const equal = common > 0 && !missing && !extra && !different;
    console.log(JSON.stringify({ equal, common, missing, extra, candleMismatches, different, auditRowsWithDirection, examples }, null, 2));
    if (!equal) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
