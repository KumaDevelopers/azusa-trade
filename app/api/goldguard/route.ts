import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development" && process.env.GOLDGUARD_SOURCE_PUBLIC !== "1") {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const source = await readFile(join(process.cwd(), "indicators", "GoldGuard.pine"), "utf8");
    return new Response(source, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
