// Static source-integrity check; NOT a PineTS runtime validation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const original = readFileSync(new URL('../indicators/GoldGuard-Original-12000.pine', import.meta.url), 'utf8');
const optimized = readFileSync(new URL('../indicators/GoldGuard.pine', import.meta.url), 'utf8');

const substitutions = [
  ['calc_bars_count = 12000, dynamic_requests = true', 'calc_bars_count = 180, dynamic_requests = true', 1],
  ['nativeHistoryBars = input.int(6000, "Hist native (bar/TF)", minval = 600, maxval = 12000, step = 100, group = G12)', 'int nativeHistoryBars = 180 // Batas data native tetap; formula trading tidak diubah.', 1],
  ['calc_bars_count = 700', 'calc_bars_count = 180', 2],
  ['calc_bars_count = 400', 'calc_bars_count = 180', 4],
  ['calc_bars_count = 300', 'calc_bars_count = 180', 2],
];

let expected=original;
for (const [before, after, count] of substitutions) {
  assert.equal(expected.split(before).length - 1, count, `Batas asli berubah: ${before}`);
  expected=expected.replaceAll(before,after);
}
assert.equal(optimized,expected,'Perubahan di luar budget histori terdeteksi: jangan pakai versi ini.');
const requestBudgets=[...optimized.matchAll(/calc_bars_count\s*=\s*(\d+)/g)].map(match=>Number(match[1]));
assert.ok(requestBudgets.length===9);
assert.ok(requestBudgets.every(n=>n===180));
console.log(`[OK] GoldGuard: seluruh ${requestBudgets.length} batas histori = 180; rumus entry, exit, reverse signal dan visual tidak berubah.`);
console.log('[CATATAN] Ini hanya verifikasi perubahan kode, BUKAN bukti hasil sinyal maupun kompatibilitas PineTS.');
