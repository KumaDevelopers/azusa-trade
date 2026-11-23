import { performance } from "node:perf_hooks";
import { computeBuiltin } from "../lib/indicators.mjs";
import { compileScript, runScript } from "../lib/scripts-engine.mjs";
import { backtest } from "../lib/trading.mjs";

const bars = Array.from({ length: 12000 }, (_, i) => {
  const open = 48000 + 560 * Math.sin(i / 12) + 300 * Math.sin(i / 7);
  const close = open + 30 * Math.cos(i);
  return { time: i * 300, close, open, low: Math.min(open, close) - 15, high: Math.max(open, close) + 15, volume: 12 + i % 40, closed: true };
});
const selected = ["ema", "sma", "bb", "stoch", "rsi", "macd", "dmi", "vwap", "supertrend", "volume"];
const custom = compileScript("pine", 'indicator("Benchmark")\nperiod = input.int(20)\nbase = ta.sma(close, period)\nplot(base)\nplot(ta.ema(base, period))');
const options = { type: "ema", fast: 20, slow: 50, fee: 10, size: 1, stopPercent: 1, targetPercent: 2, start: 0, end: Number.MAX_SAFE_INTEGER };
const tests = [
  ["10 indikator bawaan", () => selected.map(kind => computeBuiltin({ kind, color: "#76e4bc", length: 20 }, bars))],
  ["Pine subset", () => runScript(custom, bars)],
  ["EMA crossover backtest", () => backtest(bars, options)],
];
console.log("AzusaTrade · Node " + process.version + " · " + bars.length + " input sintetis untuk benchmark");
for (const [label, action] of tests) {
  for (let i = 0; i < 5; i++) action();
  const times = [];
  for (let i = 0; i < 24; i++) {
    const start = performance.now();
    action();
    times.push(performance.now() - start);
  }
  times.sort((a,b) => a - b);
  console.log(label + " · median " + times[12].toFixed(2) + " ms · p95 " + times[22].toFixed(2) + " ms");
}
console.log("Heap akhir proses: " + (process.memoryUsage().heapUsed / 1048576).toFixed(2) + " MiB");
