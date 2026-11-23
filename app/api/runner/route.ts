import { createHash, timingSafeEqual } from "node:crypto";
import { validBar } from "../../../lib/instruments.mjs";
import type { Bar } from "../../../lib/types";

export const runtime = "nodejs";
export const maxDuration = 20;
export const dynamic = "force-dynamic";

const reply = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
const hash = (value: string) => createHash("sha256").update(value).digest();
const maxRequestBytes = 3_700_000;

function endpoint() {
  if (!process.env.RUNNER_ACCESS_KEY || !process.env.JUDGE0_AUTH_TOKEN) return null;
  try {
    const url = new URL(process.env.JUDGE0_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

export function GET() {
  return reply({
    c: Boolean(endpoint() && Number(process.env.JUDGE0_C_LANGUAGE_ID)),
    java: Boolean(endpoint() && Number(process.env.JUDGE0_JAVA_LANGUAGE_ID)),
  });
}

export async function POST(request: Request) {
  const base = endpoint();
  if (!base) return reply({ error: "Runner C/Java belum terhubung." }, 503);
  const token = request.headers.get("authorization")?.match(/^Bearer (.{24,250})$/)?.[1];
  if (!token || !timingSafeEqual(hash(token), hash(process.env.RUNNER_ACCESS_KEY!))) {
    return reply({ error: "Kunci akses runner tidak valid." }, 401);
  }
  if (Number(request.headers.get("content-length")) > maxRequestBytes) return reply({ error: "Request melebihi batas transfer." }, 413);
  let source, language, bars;
  try {
    const input = await request.text();
    if (Buffer.byteLength(input) > maxRequestBytes) return reply({ error: "Request melebihi batas transfer." }, 413);
    ({ source, language, bars } = JSON.parse(input));
    if (typeof source !== "string" || !source.trim() || !Array.isArray(bars) || !bars.length || bars.length > 12_000
      || !bars.every(bar => bar && validBar(bar) && Number.isSafeInteger(bar.time) && (bar.volume === null || Number.isFinite(bar.volume))) || (language !== "c" && language !== "java")) throw Error();
  } catch { return reply({ error: "Kode atau input OHLCV tidak valid." }, 400); }

  const languageId = Number(language === "c" ? process.env.JUDGE0_C_LANGUAGE_ID : process.env.JUDGE0_JAVA_LANGUAGE_ID);
  if (!Number.isSafeInteger(languageId) || languageId <= 0) return reply({ error: "Compiler bahasa ini belum terhubung." }, 503);
  const stdin = (bars as Bar[]).map(({ time, open, high, low, close, volume }) => [time, open, high, low, close, volume ?? "NaN"].join(",")).join("\n") + "\n";
  const url = new URL(base.href.replace(/\/$/, "") + "/submissions");
  url.search = new URLSearchParams({ base64_encoded: "true", wait: "true", fields: "status,stdout,stderr,compile_output,message,time,memory" }).toString();
  const encode = (value: string) => Buffer.from(value).toString("base64");
  const decode = (value: string | null) => value ? Buffer.from(value, "base64").toString("utf8") : "";
  try {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(16_000)]),
      headers: { "Content-Type": "application/json", "X-Auth-Token": process.env.JUDGE0_AUTH_TOKEN! },
      body: JSON.stringify({
        source_code: encode(source), stdin: encode(stdin), language_id: languageId,
        enable_network: false, cpu_time_limit: 2, cpu_extra_time: 0, wall_time_limit: 5,
        memory_limit: 262_144, stack_limit: 16_384, max_file_size: 256, max_processes_and_or_threads: 64,
      }),
    });
    if (!response.ok) return reply({ error: "Runner mengembalikan HTTP " + response.status + "." }, 502);
    const result = await response.json();
    if (result.status?.id !== 3) {
      return reply({ error: (decode(result.compile_output) || decode(result.stderr) || decode(result.message) || result.status?.description || "Eksekusi gagal.").slice(0, 800) }, 422);
    }
    const lines = decode(result.stdout).trim().split(/\r?\n/);
    const values = lines.map(line => /^null$/i.test(line.trim()) ? null : line.trim() ? Number(line.trim()) : NaN);
    if (values.length !== bars.length || values.some(value => value !== null && !Number.isFinite(value))) {
      return reply({ error: "Cetak satu angka atau null per candle pada stdout." }, 422);
    }
    return reply({ values, stderr: decode(result.stderr).slice(0, 400) });
  } catch {
    return reply({ error: "Runner tidak dapat dihubungi atau melewati batas waktu." }, 502);
  }
}
