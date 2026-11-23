import type { Bar, Plot, Script } from "../lib/types";

export const sampleCandle: Bar = { time: 1, open: 100, high: 104, low: 99, close: 102, volume: 10, closed: true };

export async function runNative(script: Pick<Script, "language" | "source"> & { name: string }, bars: Bar[], key: string, signal?: AbortSignal) {
  if (!key) throw Error("Masukkan kunci akses runner di Code Editor.");
  const timeout = AbortSignal.timeout(19_000);
  const response = await fetch("/api/runner", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ language: script.language, source: script.source, bars }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Kompilasi gagal.");
  const plot: Plot = { name: script.name, values: result.values, type: "line" };
  return { plots: [plot], log: String(result.stderr || "") };
}
