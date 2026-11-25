import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { makeAdminPasswordHash } from "../server/admin-credentials.mjs";

const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
const input = createInterface({ input: stdin, output: hidden, terminal: stdin.isTTY });

try {
  stdout.write("Password admin (input disembunyikan): ");
  const password = await input.question("");
  stdout.write("\n");
  const hash = await makeAdminPasswordHash(password);
  stdout.write("Salin nilai berikut ke AZUSA_ADMIN_PASSWORD_HASH di Vercel:\n" + hash + "\n");
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : "Pembuatan hash gagal.") + "\n");
  process.exitCode = 1;
} finally {
  input.close();
}
