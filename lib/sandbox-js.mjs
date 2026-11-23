import { getQuickJS } from "quickjs-emscripten";
import { transform } from "sucrase";

export async function runJavaScript(language, source, candles) {
  const program = language === "typescript" ? transform(source, { transforms: ["typescript"] }).code : source;
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = performance.now() + 750;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const context = runtime.newContext();
  try {
    const code = `
      (function () {
        "use strict";
        const messages = [];
        const console = { log: (...parts) => {
          if (messages.length >= 8) return;
          messages.push(parts.map(part => String(part).slice(0, 120)).join(" ").slice(0, 200));
        } };
        console.info = console.log;
        console.warn = console.log;
        console.error = console.log;
        ${program}
        const output = calculate(${JSON.stringify(candles)});
        if (!Array.isArray(output) || output.length > 16) throw new Error("calculate() harus mengembalikan array hingga 16 plot.");
        const plots = output.map(plot => {
          if (typeof plot.name !== "string" || !Array.isArray(plot.values) || plot.values.length !== ${candles.length}) {
            throw new Error("Setiap plot membutuhkan nama dan satu nilai per candle.");
          }
          return {
            name: plot.name.slice(0, 80),
            color: typeof plot.color === "string" && /^#[a-f0-9]{6}$/i.test(plot.color) ? plot.color : undefined,
            type: plot.type === "histogram" ? "histogram" : "line",
            values: plot.values.map(value => Number.isFinite(value) ? value : null)
          };
        });
        return JSON.stringify({ name: typeof title === "string" ? title.slice(0, 80) : "Custom Indicator", overlay: typeof overlay === "boolean" ? overlay : true, plots, log: messages.join("\\n") });
      })()`;
    const result = context.evalCode(code, "indicator.js");
    if (result.error) {
      const error = context.getProp(result.error, "message");
      try { throw new Error(context.getString(error).slice(0, 300) || "Runtime JavaScript berhenti."); }
      finally { error.dispose(); result.error.dispose(); }
    }
    try {
      const data = JSON.parse(context.getString(result.value));
      if (typeof data?.name !== "string" || typeof data.overlay !== "boolean"
        || !Array.isArray(data.plots) || !data.plots.length || data.plots.length > 16) throw Error("Metadata plot tidak valid.");
      const plots = data.plots.map(plot => {
        if (typeof plot?.name !== "string" || !Array.isArray(plot.values) || plot.values.length !== candles.length) {
          throw Error("Output tidak cocok dengan jumlah candle.");
        }
        return {
          name: plot.name.slice(0, 80),
          color: typeof plot.color === "string" && /^#[a-f0-9]{6}$/i.test(plot.color) ? plot.color : undefined,
          type: plot.type === "histogram" ? "histogram" : "line",
          values: plot.values.map(value => Number.isFinite(value) ? value : null),
        };
      });
      return { name: data.name.slice(0, 80), overlay: data.overlay, plots, log: typeof data.log === "string" ? data.log.slice(0, 1200) : "" };
    } finally { result.value.dispose(); }
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
