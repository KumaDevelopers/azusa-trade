import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { readWorkspace, saveWorkspace, workspaceInput, workspaceReply as reply } from "../../../server/workspace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function accessKey(request: Request) {
  const key = request.headers.get("authorization")?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  return key ? createHash("sha256").update(key).digest("hex") : null;
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) return reply({ enabled: false });
  const key = accessKey(request);
  if (!key) return reply({ enabled: true });
  try {
    const row = await readWorkspace(neon(process.env.DATABASE_URL), key);
    return row ? reply(row) : reply({ error: "Backup belum ditemukan." }, 404);
  } catch {
    return reply({ error: "Sinkronisasi Neon tidak tersedia." }, 503);
  }
}

export async function PUT(request: Request) {
  if (!process.env.DATABASE_URL) return reply({ error: "Neon belum terhubung." }, 503);
  const key = accessKey(request);
  if (!key) return reply({ error: "Kunci pemulihan tidak valid." }, 401);
  const input = await workspaceInput(request);
  if (input instanceof Response) return input;
  try {
    const row = await saveWorkspace(neon(process.env.DATABASE_URL), key, input.revision, input.snapshot);
    return row ? reply(row) : reply({ error: "Backup cloud sudah berubah. Pulihkan revisi terbaru sebelum menyimpan lagi." }, 409);
  } catch {
    return reply({ error: "Sinkronisasi Neon tidak tersedia." }, 503);
  }
}
