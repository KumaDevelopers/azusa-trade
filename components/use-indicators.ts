"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runNative } from "./native-runner";
import { alignPlots, byIndicator } from "../lib/indicators.mjs";
import type { Bar, Execution, Indicator, Market, RenderedIndicator, Script } from "../lib/types";
import { frames } from "../lib/instruments.mjs";
import { fetchHistory } from "./use-market";

const definitions = byIndicator as Record<string, { overlay: boolean }>;
const makeWorker = () => new Worker(new URL("../lib/indicator.worker.mjs", import.meta.url));
const bank = new Map<string, { bars: Bar[]; at: number }>();

export function useIndicators(configs: Indicator[], scripts: Script[], bars: Bar[], market: Market, frame: string, source: string, enabled: boolean, runnerKey: string) {
  const workers = useRef(new Map<string, Worker>());
  const [results, setResults] = useState<Record<string, RenderedIndicator>>({});
  const [stats, setStats] = useState<Record<string, Execution>>({});
  const latest = useRef({ bars, configs, scripts });
  latest.current = { bars, configs, scripts };
  const signature = useMemo(() => JSON.stringify(configs.map(config => [
    config, scripts.find(item => item.id === config.kind),
  ])), [configs, scripts]);
  const dataKey = market.id + ":" + frame + ":" + source;
  const [outputKey, setOutputKey] = useState("");
  const trigger = useRef<() => void>(() => {});
  const first = bars[0]?.time;
  const ready = bars.length > 0;
  const activeBar = bars.at(-1)?.time;
  const confirmed = bars.at(-1)?.closed;

  useEffect(() => {
    const controller = new AbortController();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const pending = new Set<string>();
    const disabled = new Set<string>();
    const lastRun = new Map<string, { bars: Bar[]; target?: Bar[]; timestamp: number }>();
    const inFlight = new Map<string, Promise<Bar[]>>();
    const store = workers.current;
    function destroy() { for (const worker of store.values()) worker.terminate(); store.clear(); }
    if (!enabled) return;
    setResults({});
    setStats({});
    setOutputKey(dataKey);
    function alternative(config: Indicator) {
      const key = dataKey + ":" + config.frame;
      const cached = bank.get(key);
      if (cached && Date.now() - cached.at < 20000) return Promise.resolve(cached.bars);
      let request = inFlight.get(key);
      if (!request) {
        const provider = source === "OKX Spot" ? "okx" : source === "Binance Spot" ? "binance" : "auto";
        request = fetchHistory(market, config.frame, provider, undefined, controller.signal).then(history => {
          if (history.source !== source || history.stale) throw new Error("Timeframe indikator belum tersedia dari feed chart.");
          if (bank.size > 28) bank.delete(bank.keys().next().value!);
          bank.set(key, { bars: history.bars, at: Date.now() });
          return history.bars;
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, request);
      }
      return request;
    }
    async function run(config: Indicator, chartBars: Bar[]) {
      const id = config.uid;
      if (disabled.has(id) || pending.has(id) || !chartBars.length) return;
      const script = latest.current.scripts.find(item => item.id === config.kind);
      if (script?.builtin) return;
      const prior = lastRun.get(id);
      const newBar = prior?.bars.at(-1)?.time !== chartBars.at(-1)?.time || prior?.bars.at(-1)?.closed !== chartBars.at(-1)?.closed;
      if (prior && prior.bars === chartBars && !config.frame) return;
      if (script?.remote && prior && prior.bars[0]?.time === chartBars[0]?.time
        && (!newBar || Date.now() - prior.timestamp < 10_000)) return;
      const incrementallyUpdated = ["ema", "sma", "wma", "volume", "obv", "bb", "donchian", "fib", "pivot"].includes(config.kind);
      if (prior && !newBar && chartBars.length > 3000 && !incrementallyUpdated && !config.frame) return;
      if (prior && !newBar && Date.now() - prior.timestamp < (chartBars.length > 3000 ? 3200 : 1100)) return;
      pending.add(id);
      try {
        const separate = config.frame && config.frame !== frame;
        const input = separate ? await alternative(config) : chartBars;
        if (controller.signal.aborted) return;
        if (prior?.bars === chartBars && prior.target === input) { pending.delete(id); return; }
        lastRun.set(id, { bars: chartBars, target: input, timestamp: Date.now() });
        if (script?.remote) {
          const started = performance.now();
          const result = await runNative(script, input, runnerKey, controller.signal);
          if (controller.signal.aborted) return;
          const plots = separate ? alignPlots(result.plots, input, chartBars, (time: number) => time + frames[config.frame as keyof typeof frames]) : result.plots;
          setStats(previous => ({ ...previous, [id]: { duration: performance.now() - started, timestamp: Date.now(), log: result.log } }));
          setResults(previous => ({ ...previous, [id]: { config, plots, bars: chartBars, overlay: script.overlay } }));
          pending.delete(id);
          return;
        }
        let worker = store.get(id);
        if (!worker) { worker = makeWorker(); store.set(id, worker); }
        worker.onmessage = ({ data }) => {
          if (controller.signal.aborted) return;
          clearTimeout(timers.get(id));
          pending.delete(id);
          if (data.error) disabled.add(id);
          setStats(previous => ({ ...previous, [id]: { duration: data.duration, bytes: data.bytes, error: data.error, log: data.log, timestamp: Date.now() } }));
          if (!data.error) setResults(previous => ({ ...previous, [id]: { config, plots: data.plots, bars: chartBars, overlay: script?.overlay ?? definitions[config.kind]?.overlay ?? true } }));
        };
        worker.onerror = () => fail("Runtime indikator berhenti.");
        function fail(error: string) {
          if (controller.signal.aborted) return;
          clearTimeout(timers.get(id));
          pending.delete(id);
          disabled.add(id);
          store.get(id)?.terminate();
          store.delete(id);
          setStats(previous => ({ ...previous, [id]: { error } }));
        }
        timers.set(id, setTimeout(() => fail("Indikator melampaui batas waktu eksekusi atau data MTF belum tersedia."),
          script?.language === "pine" && /\b(?:request\.|array\.|type\s+)/.test(script.source) ? 20_000 : 2200));
        worker.postMessage({ id, config, market: market.id, bars: input, target: separate ? chartBars : null, script,
          reset: !prior || input[0]?.time !== prior.target?.[0]?.time || input.at(-1)?.time !== prior.target?.at(-1)?.time });
      } catch (error) {
        pending.delete(id);
        if (!controller.signal.aborted) {
          if (script?.remote) disabled.add(id);
          lastRun.set(id, { bars: chartBars, timestamp: Date.now() });
          setStats(previous => ({ ...previous, [id]: { error: error instanceof Error ? error.message : "Indikator gagal dihitung." } }));
        }
      }
    }
    function dispatch() {
      if (!controller.signal.aborted) for (const config of latest.current.configs) {
        if (config.visible) void run(config, latest.current.bars);
      }
    }
    trigger.current = dispatch;
    dispatch();
    const timer = setInterval(dispatch, 1200);
    return () => {
      controller.abort();
      clearInterval(timer);
      for (const timeout of timers.values()) clearTimeout(timeout);
      trigger.current = () => {};
      destroy();
    };
    // The signature tracks settings and edits. Current bars are read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, dataKey, enabled, runnerKey]);

  useEffect(() => { trigger.current(); }, [first, activeBar, ready, confirmed]);
  const rendered = useMemo(() => outputKey === dataKey ? configs.map(config => results[config.uid]).filter(Boolean) : [], [outputKey, dataKey, configs, results]);
  return { rendered, stats: outputKey === dataKey ? stats : {} };
}

export function compileInWorker(language: string, source: string): Promise<{ name: string; overlay: boolean; plots: string[]; duration: number }> {
  return new Promise((resolve, reject) => {
    const worker = makeWorker();
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(Error("Waktu kompilasi habis.")); }, 2500);
    worker.onerror = () => { finish(); reject(Error("Worker tidak dapat memulai kompilasi.")); };
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(Object.assign(new Error(data.error), { features: data.features }));
      else resolve({ ...data.compile, duration: data.duration });
    };
    worker.postMessage({ action: "compile", language, source });
  });
}
