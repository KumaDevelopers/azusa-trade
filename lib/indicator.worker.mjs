import { alignPlots, computeBuiltin } from "./indicators.mjs";
import { compileScript, runScript } from "./scripts-engine.mjs";
import { frames } from "./instruments.mjs";

const usesJavaScriptSandbox = (language, source) =>
  (language === "javascript" || language === "typescript") && /\bfunction\s+calculate\s*\(/.test(source);

async function runJavaScript(language, source, bars) {
  const sandbox = await import("./sandbox-js.mjs");
  return sandbox.runJavaScript(language, source, bars);
}

const incremental = new Set(["ema", "sma", "wma", "volume", "obv", "bb", "donchian", "fib", "pivot"]);
const tail = new Set(["sma", "wma", "bb", "donchian", "fib", "pivot"]);

function updateLast(config, bars, previousOutput) {
  const bar = bars.at(-1);
  const index = bars.length - 1;
  if (config.kind === "volume") previousOutput[0].values[index] = bar.volume;
  else if (config.kind === "ema") {
    const previous = previousOutput[0].values[index - 1];
    const alpha = 2 / (Math.max(1, Math.min(500, Math.round(config.length))) + 1);
    previousOutput[0].values[index] = Number.isFinite(previous) ? previous + alpha * (bar.close - previous) : bar.close;
  } else if (config.kind === "obv") {
    const offset = bars.at(-2);
    if (!Number.isFinite(bar.volume)) previousOutput[0].values[index] = null;
    else if (!offset) previousOutput[0].values[index] = 0;
    else if (Number.isFinite(previousOutput[0].values[index - 1])) previousOutput[0].values[index] = previousOutput[0].values[index - 1] + Math.sign(bar.close - offset.close) * bar.volume;
    else return computeBuiltin(config, bars);
  } else if (tail.has(config.kind)) {
    const subset = bars.slice(-Math.max(2, Math.min(500, Math.round(config.length) || 14)));
    const result = computeBuiltin(config, subset);
    result.forEach((plot, plotIndex) => { previousOutput[plotIndex].values[index] = plot.values.at(-1); });
  }
  return previousOutput;
}

let compiled;
let lastConfig;
let lastBars;
let lastOutput;
let lastLog = "";
self.onmessage = async ({ data }) => {
  const start = performance.now();
  try {
    if (data.action === "compile") {
      const result = usesJavaScriptSandbox(data.language, data.source)
        ? await runJavaScript(data.language, data.source, [{ time: 0, open: 1, high: 2, low: 1, close: 2, volume: 10, closed: true }])
        : compileScript(data.language, data.source);
      self.postMessage({ id: data.id, compile: { name: result.name, overlay: result.overlay, plots: result.plots.map(plot => plot.name) }, duration: performance.now() - start });
      return;
    }
    const { config, bars, target, revision, script } = data;
    const sameBar = !data.reset && lastBars?.length === bars.length && lastBars?.at(-1)?.time === bars.at(-1)?.time && lastBars?.at(-2)?.updated === bars.at(-2)?.updated;
    const nextConfig = JSON.stringify(config);
    if (nextConfig !== lastConfig || script?.source !== compiled?.source
      || lastBars?.length !== bars.length || lastBars?.at(0)?.time !== bars.at(0)?.time
      || lastBars?.at(-1)?.time !== bars.at(-1)?.time || lastBars?.at(-1)?.close !== bars.at(-1)?.close
      || lastBars?.at(-1)?.volume !== bars.at(-1)?.volume || lastBars?.at(-1)?.closed !== bars.at(-1)?.closed
      || lastBars?.at(-1)?.high !== bars.at(-1)?.high || lastBars?.at(-1)?.low !== bars.at(-1)?.low
      || data.reset) {
      lastLog = "";
      if (script && usesJavaScriptSandbox(script.language, script.source)) {
        const result = await runJavaScript(script.language, script.source, bars);
        lastOutput = result.plots;
        lastLog = result.log;
        compiled = { source: script.source, language: script.language };
      } else if (script) {
        if (script.source !== compiled?.source || script.language !== compiled?.language)
          compiled = { source: script.source, language: script.language, program: compileScript(script.language, script.source) };
        lastOutput = runScript(compiled.program, bars);
      } else {
        compiled = undefined;
        lastOutput = sameBar && lastOutput && lastConfig === nextConfig && incremental.has(config.kind)
          ? updateLast(config, bars, lastOutput) : computeBuiltin(config, bars);
      }
      lastBars = bars;
      lastConfig = nextConfig;
    }
    const plots = target ? alignPlots(lastOutput, bars, target, time => time + frames[config.frame]) : lastOutput;
    const outputBytes = plots.reduce((total, plot) => total + plot.values.length * 8, 0);
    self.postMessage({ id: data.id, revision, plots, log: lastLog, duration: performance.now() - start, bytes: bars.length * 64 + outputBytes });
  } catch (error) {
    self.postMessage({ id: data.id, revision: data.revision, error: error.message, features: error.features ?? [], duration: performance.now() - start });
  }
};
