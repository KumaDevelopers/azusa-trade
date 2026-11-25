import type { NextRequest } from "next/server";
import { ADMIN_WORKSPACE_KEY, adminConfig, hasAdminSession, sameOrigin } from "../../../../server/admin-auth";
import { readWorkspace, saveWorkspace, workspaceInput, workspaceReply as reply } from "../../../../server/workspace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const config = adminConfig();
    if (!config || !await hasAdminSession(request, config)) return reply({ error: "Login sebagai admin dulu." }, 401);
    const row = await readWorkspace(config.sql, ADMIN_WORKSPACE_KEY, request.nextUrl.searchParams.get("revision"));
    return reply(row ?? { revision: 0, snapshot: null });
  } catch {
    return reply({ error: "Workspace Neon belum dapat dimuat." }, 503);
  }
}

export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Asal permintaan tidak valid." }, 403);
  try {
    const config = adminConfig();
    if (!config || !await hasAdminSession(request, config)) return reply({ error: "Login sebagai admin dulu." }, 401);
    const input = await workspaceInput(request);
    if (input instanceof Response) return input;
    const saved = await saveWorkspace(config.sql, ADMIN_WORKSPACE_KEY, input.revision, input.snapshot);
    return saved ? reply(saved) : reply({ error: "Workspace berubah di perangkat lain." }, 409);
  } catch {
    return reply({ error: "Workspace Neon belum dapat disimpan." }, 503);
  }
}
