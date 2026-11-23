import assert from "node:assert/strict";
import { test } from "node:test";
import { runJavaScript } from "../lib/sandbox-js.mjs";

const bars = [{ high: 14, low: 10 }, { high: 24, low: 20 }];

test("isolated JS/TS computes one value per candle without host globals", async () => {
  const code = `type Candle = { high: number; low: number };
    const overlay = false;
    function calculate(bars: Candle[]) {
      return [{ name: "Mid", values: bars.map(({ high, low }) => {
        if (typeof fetch !== "undefined" || typeof Worker !== "undefined" || typeof process !== "undefined") throw Error("host exposed");
        return (high + low) / 2;
      }) }];
    }`;
  const result = await runJavaScript("typescript", code, bars);
  assert.deepEqual(result.plots[0].values, [12, 22]);
  assert.equal(result.overlay, false);
});

test("sandbox interrupts infinite loops and checks output length", async () => {
  await assert.rejects(runJavaScript("javascript", "function calculate() { while (true) {} }", bars), /interrupt/i);
  await assert.rejects(runJavaScript("javascript", 'function calculate() { return [{ name: "X", values: [1] }]; }', bars), /per candle/);
});
