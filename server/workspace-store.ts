import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;
const maxBytes = 3_700_000;

export function workspaceReply(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readWorkspace(sql: Sql, key: string, knownRevision: string | null = null) {
  const [row] = await sql`SELECT CASE WHEN revision::text = ${knownRevision} THEN NULL ELSE snapshot END AS snapshot, revision
    FROM azusa_workspace_snapshots WHERE key_hash = ${key}`;
  return row;
}

export async function saveWorkspace(sql: Sql, key: string, revision: number, snapshot: object) {
  const json = JSON.stringify(snapshot);
  const [row] = revision === 0
    ? await sql`INSERT INTO azusa_workspace_snapshots (key_hash, snapshot) VALUES (${key}, ${json}::jsonb)
        ON CONFLICT (key_hash) DO NOTHING RETURNING revision`
    : await sql`UPDATE azusa_workspace_snapshots SET snapshot = ${json}::jsonb, revision = revision + 1, updated_at = now()
        WHERE key_hash = ${key} AND revision = ${revision} RETURNING revision`;
  return row;
}

export async function workspaceInput(request: Request): Promise<Response | { revision: number; snapshot: object }> {
  if (Number(request.headers.get("content-length")) > maxBytes) return workspaceReply({ error: "Workspace melebihi batas transfer." }, 413);
  try {
    const input = await request.text();
    if (Buffer.byteLength(input) > maxBytes) return workspaceReply({ error: "Workspace melebihi batas transfer." }, 413);
    const payload = JSON.parse(input);
    if (payload?.snapshot?.version === 1 && Number.isSafeInteger(payload.revision)
      && payload.revision >= 0 && payload.revision < 2_147_483_647) {
      return { revision: payload.revision, snapshot: payload.snapshot };
    }
  } catch { /* Use the same validation reply for malformed bodies. */ }
  return workspaceReply({ error: "Format workspace tidak valid." }, 400);
}
