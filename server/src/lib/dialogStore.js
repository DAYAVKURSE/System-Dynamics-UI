import fs from "node:fs/promises";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   ДИАЛОГИ БОТА С ЛЮДЬМИ (владелец, 2026-09-22)

   Каждый бот — основной (ассистент) и боты агентов — помнит, с кем
   говорил: это и есть «кому он может писать». Telegram истории не отдаёт,
   поэтому всё, что прошло через бота в личных чатах, ложится на диск:
   строка на сообщение (jsonl), файл на собеседника, рядом карточка
   собеседника (имя, username, забанен ли).

   Ключ бота — `<userId>_<agentId>`: у владельца сценария может быть
   несколько агентов со своими ботами, и у каждого свои диалоги.

   «Забанить» — бот перестаёт отвечать этому человеку (сообщения даже не
   записываются); «удалить» — стирает переписку и карточку.
   ════════════════════════════════════════════════════════════════ */

export const PAGE_SIZE = 10;
const TEXT_LIMIT = 4096;
const NAME_LIMIT = 120;

function baseDir() {
  return process.env.DIALOGS_DIR
    ? path.resolve(process.env.DIALOGS_DIR)
    : path.resolve(process.cwd(), "data", "dialogs");
}
const safe = (s) => String(s ?? "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
export const botKey = (userId, agentId = "assistant") => `${safe(userId)}_${safe(agentId)}`;
const safeChatId = (id) => (/^-?\d{1,20}$/.test(String(id ?? "")) ? String(id) : "");
const dirOf = (key) => path.join(baseDir(), safe(key));
const linesFile = (key, chatId) => path.join(dirOf(key), `${chatId}.jsonl`);
const metaFile = (key, chatId) => path.join(dirOf(key), `${chatId}.meta.json`);

const str = (v, n = TEXT_LIMIT) => String(v == null ? "" : v).trim().slice(0, n);

async function readMeta(key, chatId) {
  try { return JSON.parse(await fs.readFile(metaFile(key, chatId), "utf8")); }
  catch { return null; }
}
async function writeMeta(key, chatId, meta) {
  await fs.mkdir(dirOf(key), { recursive: true });
  await fs.writeFile(metaFile(key, chatId), JSON.stringify(meta), "utf8");
}

/**
 * Записать реплику. `from` — "user" (человек) или "bot" (сам бот).
 * Имя и username человека обновляют карточку: по ним его находят в списке.
 * Забаненному не пишем ничего — и не записываем: разговора с ним нет.
 */
export async function recordDialog(key, chatId, { from = "user", name = "", username = "", text = "", at = null } = {}) {
  const id = safeChatId(chatId);
  if (!id) return null;
  const meta = (await readMeta(key, id)) || { chatId: id, name: "", username: "", banned: false, at: null };
  if (meta.banned) return null;
  const line = { at: at || new Date().toISOString(), from: from === "bot" ? "bot" : "user", text: str(text) };
  if (!line.text) return null;
  await fs.mkdir(dirOf(key), { recursive: true });
  await fs.appendFile(linesFile(key, id), `${JSON.stringify(line)}\n`, "utf8");
  const next = { ...meta, at: line.at,
    ...(from !== "bot" && str(name, NAME_LIMIT) ? { name: str(name, NAME_LIMIT) } : {}),
    ...(from !== "bot" && str(username, NAME_LIMIT) ? { username: str(username, NAME_LIMIT) } : {}) };
  await writeMeta(key, id, next);
  return line;
}

export async function readDialog(key, chatId) {
  const id = safeChatId(chatId);
  if (!id) return null;
  const meta = await readMeta(key, id);
  if (!meta) return null;
  let raw = "";
  try { raw = await fs.readFile(linesFile(key, id), "utf8"); } catch { raw = ""; }
  const messages = [];
  raw.split("\n").forEach((s) => {
    if (!s.trim()) return;
    try { messages.push(JSON.parse(s)); } catch { /* оборванная строка */ }
  });
  return { ...meta, messages };
}

/** Собеседники бота — новые разговоры первыми. */
export async function listDialogs(key) {
  let files = [];
  try { files = await fs.readdir(dirOf(key)); } catch { return []; }
  const ids = files.filter((f) => f.endsWith(".meta.json")).map((f) => safeChatId(f.slice(0, -".meta.json".length))).filter(Boolean);
  const out = [];
  for (const id of ids) {
    const d = await readDialog(key, id);
    if (d) out.push({ chatId: d.chatId, name: d.name || "", username: d.username || "", banned: !!d.banned,
      count: d.messages.length, at: d.at || null });
  }
  return out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

/** Кому бот может писать: все, кто с ним говорил и не забанен. */
export async function contactsOf(key) {
  return (await listDialogs(key)).filter((d) => !d.banned);
}

export const titleOf = (d) => d?.name || (d?.username ? `@${d.username}` : "") || `id ${d?.chatId}`;

/** Найти собеседника по имени, username или id — без учёта регистра. */
export async function findContact(key, who) {
  const want = String(who || "").trim().toLowerCase().replace(/^@/, "");
  if (!want) return null;
  const list = await contactsOf(key);
  return list.find((d) => d.chatId === want)
    || list.find((d) => String(d.username || "").toLowerCase() === want)
    || list.find((d) => String(d.name || "").toLowerCase() === want)
    || list.find((d) => String(d.name || "").toLowerCase().includes(want))
    || null;
}

export async function isBanned(key, chatId) {
  const id = safeChatId(chatId);
  if (!id) return false;
  return Boolean((await readMeta(key, id))?.banned);
}

export async function setBanned(key, chatId, banned) {
  const id = safeChatId(chatId);
  if (!id) return null;
  const meta = (await readMeta(key, id)) || { chatId: id, name: "", username: "", at: null };
  const next = { ...meta, banned: !!banned };
  await writeMeta(key, id, next);
  return next;
}

export async function deleteDialog(key, chatId) {
  const id = safeChatId(chatId);
  if (!id) return false;
  const had = Boolean(await readMeta(key, id));
  await fs.rm(linesFile(key, id), { force: true });
  await fs.rm(metaFile(key, id), { force: true });
  return had;
}

/** Страница переписки: новые страницы — последними, нумерация с нуля. */
export function pageOf(messages = [], page = 0, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(messages.length / size));
  const p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  return { items: messages.slice(p * size, p * size + size), page: p, pages };
}

/** Последние реплики — словами, в подсказку модели. */
export function historyText(messages = [], { maxChars = 6000, botName = "бот" } = {}) {
  const lines = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const line = `${m.from === "bot" ? botName : "человек"}: ${m.text}`;
    if (used + line.length > maxChars) break;
    used += line.length;
    lines.unshift(line);
  }
  return lines.join("\n");
}
