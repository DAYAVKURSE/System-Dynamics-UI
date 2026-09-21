import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { generateKeyPair } from "./token.js";

/* ════════════════════════════════════════════════════════════════
   ХРАНИЛИЩЕ СЕРВИСА КОДОВ

   Два файла в CODES_DIR: пара ключей сервиса (`keys.json`) и люди
   (`users.json`). Про человека здесь — только то, что нужно, чтобы
   узнать его по ключу и сказать, какой у него план: ни имени, ни
   Telegram. Сам ключ НЕ хранится — только его хэш: утечка файла не
   должна раздавать чужие ключи.
   ════════════════════════════════════════════════════════════════ */
const baseDir = () => (process.env.CODES_DIR
  ? path.resolve(process.env.CODES_DIR)
  : path.resolve(process.cwd(), "data", "codes"));
const keysFile = () => path.join(baseDir(), "keys.json");
const usersFile = () => path.join(baseDir(), "users.json");

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.mkdir(baseDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
}

let keys = null;
/** Пара ключей сервиса: заводится один раз и живёт, пока жив CODES_DIR. */
export async function serviceKeys() {
  if (keys) return keys;
  const saved = await readJson(keysFile(), null);
  if (saved?.publicKey && saved?.privateKey) { keys = saved; return keys; }
  keys = { ...generateKeyPair(), kid: crypto.randomBytes(4).toString("hex"),
    createdAt: new Date().toISOString() };
  await writeJson(keysFile(), keys);
  return keys;
}
export function resetKeys() { keys = null; }

/* Ключ человека: 160 случайных бит в Crockford-base32, по четыре знака
   через дефис — так его можно и переписать с бумажки, и прочитать вслух.
   uid — короткий, из тех же случайных бит, но других: по uid ключ не
   восстановить. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const base32 = (buf) => {
  let bits = 0, val = 0, out = "";
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31];
  return out;
};
export const newKey = () => base32(crypto.randomBytes(20)).match(/.{1,4}/g).join("-");
export const newUid = () => base32(crypto.randomBytes(10)).toLowerCase();
export const normKey = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
export const hashKey = (v) => crypto.createHash("sha256").update(normKey(v)).digest("hex");

const q = { p: Promise.resolve() };
/** Правка списка людей — по очереди, чтобы две регистрации не затёрли друг друга. */
export function withUsers(fn) {
  const run = q.p.then(async () => {
    const users = await readJson(usersFile(), []);
    const out = await fn(Array.isArray(users) ? users : []);
    if (out?.write) await writeJson(usersFile(), out.users);
    return out?.result;
  });
  q.p = run.catch(() => {});
  return run;
}
export const readUsers = async () => {
  const users = await readJson(usersFile(), []);
  return Array.isArray(users) ? users : [];
};
