import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { alignPlots, catalog, computeBuiltin, ema, sma, wma } from "../lib/indicators.mjs";
import { aggregateBars, bucketTime, mergeBars, parseBinanceRows, validBar } from "../lib/instruments.mjs";
import { compileScript, runScript } from "../lib/scripts-engine.mjs";
import { backtest, pnl, tradeExit } from "../lib/trading.mjs";

const bar = (time, value, closed = true, width = 60) => ({ time, open: value, high: value + 1, low: value - 1, close: value, volume: 2, end: time + width, closed });
const sample = Array.from({ length: 700 }, (_, index) => bar(index * 60, 100 + 8 * Math.sin(index * .13)));

test("market candles preserve provider timestamps and handle bad rows", () => {
  const rows = [[120000, "10", "13", "8", "12", "7", 179999], [180000, "10", "5", "8", "12", "7", 239999]];
  assert.deepEqual(parseBinanceRows(rows, 195000), [{ time: 120, open: 10, high: 13, low: 8, close: 12, volume: 7, end: 180, closed: true, updated: 179999 }]);
  assert.equal(validBar({ ...bar(0, 1), time: -4 }), false);
});
test("aggregation preserves OHLCV and does not fill time gaps", () => {
  const output = aggregateBars([bar(0, 2), bar(60, 5), bar(240, 4, false)], "3m");
  assert.deepEqual(output.map(item => [item.time, item.open, item.high, item.low, item.close, item.volume, item.closed]), [[0, 2, 6, 1, 5, 4, true], [180, 4, 5, 3, 4, 2, false]]);
  assert.equal(output[0].end, 180);
  assert.equal(output[1].end, 360);
  assert.equal(bucketTime(Date.UTC(2026, 9, 12) / 1000, "1M"), Date.UTC(2026, 9, 1) / 1000);
  assert.equal(bucketTime(Date.UTC(2026, 9, 13) / 1000, "1w"), Date.UTC(2026, 9, 12) / 1000);
});
test("out-of-order data cannot overwrite a confirmed candle", () => {
  const confirmed = { ...bar(60, 8), updated: 1000 };
  assert.deepEqual(mergeBars([confirmed], [{ ...bar(60, 5, false), updated: 1100 }, bar(0, 7)]), [bar(0, 7), confirmed]);
});
test("rolling averages match known input", () => {
  assert.deepEqual(sma([1,2,3,4], 3), [null,null,2,3]);
  assert.deepEqual(ema([1,2,3,4], 3), [1,1.5,2.25,3.125]);
  assert.deepEqual(wma([1,2,3,4], 3), [null,null,14/6,20/6]);
});
test("all 21 built-ins return finite or empty series on short and long data", () => {
  for (const { id, length } of catalog) for (const candidate of [sample.slice(0, 1), sample]) {
    const plots = computeBuiltin({ kind: id, length, multiplier: 2, color: "#ffffff" }, candidate);
    assert.ok(plots.length > 0, id);
    for (const plot of plots) {
      assert.equal(plot.values.length, candidate.length, id);
      assert.ok(plot.values.every(value => value === null || Number.isFinite(value)), id);
    }
  }
});
test("multi-timeframe alignment exposes closed values after the source close", () => {
  const source = [bar(0, 5, true, 120), bar(120, 6, false, 120)];
  const lower = [bar(0, 4), bar(60, 3), bar(120, 5), bar(180, 6)];
  assert.deepEqual(alignPlots([{ values: [5, 6] }], source, lower, time => time + 120)[0].values, [null, 5, 5, 5]);
});
test("declarative Pine, TypeScript, C/Wasm, and Java produce expected values", () => {
  const bars = [bar(0, 2), bar(60, 6), bar(120, 4)];
  const pine = compileScript("pine", '//@version=6\nindicator("EMA", overlay=true)\nlength = input.int(3, "Period")\nplot(ta.ema(close, length), title="EMA", color=color.orange)');
  assert.deepEqual(runScript(pine, bars)[0].values, [2, 4, 4]);
  const ts = compileScript("typescript", 'indicator("Test", true);const move: number = close - close[1];plot(move, "move");');
  assert.deepEqual(runScript(ts, bars)[0].values, [null, 4, -2]);
  const formula = "double indicator(double open, double high, double low, double close, double volume) { return (high + low) / 2.0; }";
  assert.deepEqual(runScript(compileScript("c", formula), bars)[0].values, [2, 6, 4]);
  assert.deepEqual(runScript(compileScript("java", "class Indicator { static " + formula + " }"), bars)[0].values, [2, 6, 4]);
});
test("script engine rejects network, code execution and unapproved Pine features", () => {
  for (const code of [
    'const x = fetch("https://example.com"); plot(x, "bad");',
    'while (true) {}', 'const x = close.constructor; plot(x, "bad");',
    'const x = new Function("return this"); plot(x, "bad");',
    'const x = globalThis; plot(x, "bad");',
  ]) assert.throws(() => compileScript("javascript", code));
  assert.throws(() => compileScript("pine", 'indicator("mtf")\nplot(request.security(close, 2))'));
  const gold = readFileSync(new URL("../indicators/GoldGuard.pine", import.meta.url));
  assert.equal(createHash("sha256").update(gold).digest("hex"), "1a241de8c54ae2695af94c526f5af92a67dbc8f84179ca72b79e7dd4c4567e1c");
  assert.throws(() => compileScript("pine", gold.toString()), error => error.features.some(item => item.name === "request.security_lower_tf"));
});
test("fills are causal and OHLC backtest gives SL priority at ambiguous prices", () => {
  const result = backtest(sample, { type: "ema", fast: 10, slow: 40, fee: 10, size: 1, stopPercent: 1, targetPercent: 2, start: 60, end: 41940 });
  assert.ok(result.trades.length > 0);
  for (const item of result.trades) {
    assert.equal(item.entry, sample.find(bar => bar.time === item.entryTime).open);
    assert.ok(item.exitTime >= item.entryTime);
  }
  const trade = { side: "buy", entry: 100, quantity: 1, fee: 10, stop: 98, target: 102 };
  assert.deepEqual(tradeExit(trade, { open: 95, close: 100, low: 94, high: 103 }), { price: 95, reason: "SL" });
  assert.equal(tradeExit({ ...trade, liveOnly: true }, { close: 100 }), null);
  assert.ok(Math.abs(pnl(trade, 110) - 9.79) < 0.000001);
});
