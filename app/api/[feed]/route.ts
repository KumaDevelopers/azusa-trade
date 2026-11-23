import { apiFetch } from "../../../server/api.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: Request) {
  return await apiFetch(request, process.env)
    ?? Response.json({ error: "Endpoint tidak tersedia." }, { status: 404 });
}
