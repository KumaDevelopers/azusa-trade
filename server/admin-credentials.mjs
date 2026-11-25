import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const parse = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/;

export function isAdminPasswordHash(value) {
  return typeof value === "string" && parse.test(value);
}

export async function makeAdminPasswordHash(password) {
  if (typeof password !== "string" || !password.length || password.length > 512) throw Error("Password tidak valid.");
  const salt = randomBytes(16);
  const key = await derive(password, salt, 32, options);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyAdminPassword(password, hash) {
  const match = typeof hash === "string" ? parse.exec(hash) : null;
  if (!match || typeof password !== "string" || !password.length || password.length > 512) return false;
  const expected = Buffer.from(match[2], "hex");
  const actual = await derive(password, Buffer.from(match[1], "hex"), expected.length, options);
  return timingSafeEqual(expected, actual);
}
