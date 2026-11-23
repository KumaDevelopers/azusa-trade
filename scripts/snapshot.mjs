import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseBinanceRows } from "../lib/instruments.mjs";
const execute = promisify(execFile);
const tasks = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"].flatMap(symbol =>
  ["5m", "15m", "1h", "4h", "1d"].map(frame => [symbol, frame]));
for (let start = 0; start < tasks.length; start += 5) {
  await Promise.allSettled(tasks.slice(start, start + 5).map(async ([symbol, frame]) => {
    try {
      const url = new URL("https://data-api.binance.vision/api/v3/klines");
      url.search = new URLSearchParams({ symbol, interval: frame, limit: "300" });
      const { stdout } = await execute("curl", ["-fsS", "--max-time", "15", url.href]);
      const updated = Date.now();
      const bars = parseBinanceRows(JSON.parse(stdout), updated).filter(bar => bar.closed);
      if (!bars.length) throw new Error("Empty history");
      await writeFile(new URL("../public/snapshots/" + symbol + "-" + frame + ".json", import.meta.url), JSON.stringify({ source: "Binance Spot", updated, bars }));
      console.log(symbol, frame, bars.length);
    } catch (error) {
      console.error(symbol, frame, error.message);
    }
  }));
}
