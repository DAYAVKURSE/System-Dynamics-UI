import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { scopedDir } from "./storages.js";

/* ════════════════════════════════════════════════════════════════
   ОБЩИЕ ССЫЛКИ НА БЛОКИ КАРТЫ ОТЧЁТОВ

   Отчёт нужен не себе. Заказчику показывают, что сделано по его заданию,
   и показывают ссылкой: он не заводит аккаунт, не ставит Telegram и не
   ждёт, пока его позовут в модель.

   Поэтому ссылка ведёт не в приложение, а на СНИМОК блока: имена, задание
   и уже сделанное — в том виде, в каком оно было в момент, когда ссылку
   создали или обновили. Пускать по ссылке в живую модель нельзя: тогда
   ссылка на один раздел открывала бы доступ ко всему, что в модели есть.

   ─── почему снимок, а не запрос в модель по требованию ───

   Живой запрос пришлось бы каждый раз проверять на то, что именно этому
   токену видно, и любая ошибка в такой проверке отдаёт наружу лишнее.
   Снимок содержит ровно то, что владелец решил показать, и больше в нём
   ничего нет — ни задач, ни людей, ни ресурсов, которых он не выбирал.

   ─── что владелец может ───

   Создать ссылку, обновить её (снимок пересобирается) и убрать. Убранная
   ссылка перестаёт открываться сразу: это и есть отзыв доступа.
   ════════════════════════════════════════════════════════════════ */

const MAX_SHARES = 500;

function baseDir() {
  return scopedDir(process.env.SHARES_DIR
    ? path.resolve(process.env.SHARES_DIR)
    : path.resolve(process.cwd(), "data", "shares"));
}

/* Токен — сама защита ссылки, поэтому он длинный и случайный: угадывать
   его должно быть не легче, чем пароль. 32 байта — 64 шестнадцатеричных
   знака. */
export const TOKEN_RE = /^[a-f0-9]{64}$/;
const newToken = () => crypto.randomBytes(32).toString("hex");

const fileFor = (token) => path.join(baseDir(), `${token}.json`);

async function readAll() {
  try {
    const names = await fs.readdir(baseDir());
    const out = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(baseDir(), n), "utf8")));
      } catch { /* битый файл — не повод уронить список */ }
    }
    return out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  } catch { return []; }
}

/** Все ссылки владельца — чтобы он видел, что вообще открыто наружу. */
export async function listShares() {
  return (await readAll()).map(({ token, node, name, at, by }) =>
    ({ token, node, name, at, by }));
}

/**
 * Завести или обновить ссылку на блок.
 *
 * На один блок — одна ссылка: вторая означала бы, что отозвать доступ
 * можно только угадав, какую из них кому отдали.
 */
export async function putShare({ node, name, by, snapshot }) {
  if (!node) throw new Error("node is required");
  await fs.mkdir(baseDir(), { recursive: true });
  const all = await readAll();
  const found = all.find((s) => s.node === node);
  if (!found && all.length >= MAX_SHARES) throw new Error("too many shares");
  const token = found?.token || newToken();
  const entry = {
    token,
    node: String(node),
    name: String(name || ""),
    by: by == null ? null : String(by),
    at: new Date().toISOString(),
    snapshot,
  };
  await fs.writeFile(fileFor(token), JSON.stringify(entry, null, 2), "utf8");
  return { token, node: entry.node, name: entry.name, at: entry.at };
}

/** Снимок по токену — то, что видит человек по ссылке. */
export async function getShare(token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  try {
    const raw = await fs.readFile(fileFor(token), "utf8");
    const entry = JSON.parse(raw);
    return { name: entry.name, at: entry.at, snapshot: entry.snapshot };
  } catch { return null; }
}

/** Убрать ссылку — и доступ по ней исчезает сразу. */
export async function dropShare(token) {
  if (!TOKEN_RE.test(String(token || ""))) return false;
  try { await fs.unlink(fileFor(token)); return true; }
  catch { return false; }
}
