import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxBytes = 3_700_000;
const reply = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });

function accessKey(request: Request) {
  const key = request.headers.get("authorization")?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  return key ? createHash("sha256").update(key).digest("hex") : null;
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) return reply({ enabled: false });
  const key = accessKey(request);
  if (!key) return reply({ enabled: true });
  try {
    const sql = neon(process.env.DATABASE_URL);
    const [row] = await sql`SELECT snapshot, revision FROM azusa_workspace_snapshots WHERE key_hash = ${key}`;
    return row ? reply(row) : reply({ error: "Backup belum ditemukan." }, 404);
  } catch {
    return reply({ error: "Sinkronisasi Neon tidak tersedia." }, 503);
  }
}

export async function PUT(request: Request) {
  if (!process.env.DATABASE_URL) return reply({ error: "Neon belum terhubung." }, 503);
  const key = accessKey(request);
  if (!key) return reply({ error: "Kunci pemulihan tidak valid." }, 401);
  if (Number(request.headers.get("content-length")) > maxBytes) return reply({ error: "Backup melebihi batas transfer." }, 413);
  let payload;
  try {
    const input = await request.text();
    if (Buffer.byteLength(input) > maxBytes) return reply({ error: "Backup melebihi batas transfer." }, 413);
    payload = JSON.parse(input);
    if (!payload || typeof payload.snapshot !== "object" || payload.snapshot?.version !== 1
      || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || payload.revision >= 2_147_483_647) throw Error();
  } catch {
    return reply({ error: "Format backup tidak valid." }, 400);
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    const snapshot = JSON.stringify(payload.snapshot);
    const [row] = payload.revision === 0
      ? await sql`INSERT INTO azusa_workspace_snapshots (key_hash, snapshot) VALUES (${key}, ${snapshot}::jsonb)
          ON CONFLICT (key_hash) DO NOTHING RETURNING revision`
      : await sql`UPDATE azusa_workspace_snapshots SET snapshot = ${snapshot}::jsonb, revision = revision + 1, updated_at = now()
          WHERE key_hash = ${key} AND revision = ${payload.revision} RETURNING revision`;
    return row ? reply(row) : reply({ error: "Backup cloud sudah berubah. Pulihkan revisi terbaru sebelum menyimpan lagi." }, 409);
  } catch {
    return reply({ error: "Sinkronisasi Neon tidak tersedia." }, 503);
  }
}
