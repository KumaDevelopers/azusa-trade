import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_USERNAME, adminConfig, adminCookie, allowAdminLogin, closeAdminSession, hasAdminSession, openAdminSession, sameOrigin } from "../../../../server/admin-auth";
import { verifyAdminPassword } from "../../../../server/admin-credentials.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const config = adminConfig();
  if (!config) return reply({ enabled: false, user: null });
  try {
    return reply({ enabled: true, user: await hasAdminSession(request, config) ? ADMIN_USERNAME : null });
  } catch {
    return reply({ error: "Sesi admin belum dapat diperiksa." }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Asal permintaan tidak valid." }, 403);
  const config = adminConfig();
  if (!config) return reply({ error: "Login admin belum dikonfigurasi." }, 503);
  let login;
  try {
    if (Number(request.headers.get("content-length")) > 8192) throw Error();
    const input = await request.text();
    if (input.length > 8192) throw Error();
    login = JSON.parse(input);
    if (typeof login?.username !== "string" || typeof login.password !== "string" || !login.password || login.password.length > 512) throw Error();
  } catch {
    return reply({ error: "Format login tidak valid." }, 400);
  }
  try {
    if (!await allowAdminLogin(request, config)) return reply({ error: "Terlalu banyak percobaan. Coba lagi beberapa menit." }, 429);
    const matches = await verifyAdminPassword(login.password, config.passwordHash);
    if (login.username !== ADMIN_USERNAME || !matches) return reply({ error: "Username atau password salah." }, 401);
    await closeAdminSession(request, config);
    return adminCookie(reply({ enabled: true, user: ADMIN_USERNAME }), await openAdminSession(config));
  } catch {
    return reply({ error: "Login admin sedang tidak tersedia. Periksa koneksi dan skema Neon." }, 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Asal permintaan tidak valid." }, 403);
  const config = adminConfig();
  try {
    if (config) await closeAdminSession(request, config);
    return adminCookie(reply({ enabled: !!config, user: null }));
  } catch {
    return reply({ error: "Sesi belum dapat diakhiri. Coba lagi." }, 503);
  }
}
