import fs from "node:fs/promises";
import path from "node:path";
import { getChatMember } from "./telegram.js";

/* ════════════════════════════════════════════════════════════════
   СООБЩЕНИЯ ГРУПП, ГДЕ ЕСТЬ БОТ

   Telegram истории не отдаёт: бот видит только то, что пришло при нём.
   Поэтому всё, что бот получает в группах, ложится на диск сразу и без
   срока — иначе на вопрос «что решили в чате про X?» ответить было бы
   нечем. Для этого у бота в @BotFather выключен privacy mode (см.
   docs/DEPLOYMENT.md), и это надо помнить: он хранит ЧУЖИЕ разговоры.

   Файл на чат, строка на сообщение (jsonl): дописать строку — одна
   операция, и обрыв процесса на середине портит одну строку, а не файл.
   Правка сообщения — тоже новая строка с тем же id: то, что было сказано,
   остаётся, а при чтении последняя строка с этим id побеждает.

   Кому что видно — решается при КАЖДОМ обращении, а не при записи: чат
   попадает в контекст человека, только если он в нём состоит прямо
   сейчас (Bot API getChatMember). Человека выгнали — его помощник чат
   больше не видит, и хранить «кто когда состоял» для этого не нужно.
   ════════════════════════════════════════════════════════════════ */

/** Сколько знаков чатов уходит в контекст помощника — новые важнее старых. */
export const CHAT_CONTEXT_CHARS = 20000;
const TEXT_LIMIT = 4096;   // предел Telegram на одно сообщение
const NAME_LIMIT = 120;
const TITLE_LIMIT = 200;

function baseDir() {
  return process.env.CHATS_DIR
    ? path.resolve(process.env.CHATS_DIR)
    : path.resolve(process.cwd(), "data", "chats");
}

/* Id чата у Telegram — целое число (у групп отрицательное). Всё остальное
   в имя файла не попадает: id приходит из сети, а из него строится путь. */
const safeChatId = (id) => (/^-?\d{1,20}$/.test(String(id ?? "")) ? String(id) : "");
const linesFile = (chatId) => path.join(baseDir(), `${chatId}.jsonl`);
const metaFile = (chatId) => path.join(baseDir(), `${chatId}.meta.json`);

export const isGroupChat = (chat) => chat?.type === "group" || chat?.type === "supergroup";

const str = (v) => (v == null ? "" : String(v)).trim();

const nameOf = (from) => {
  if (!from) return "неизвестно";
  const full = [from.first_name, from.last_name].map(str).filter(Boolean).join(" ");
  return (full || (from.username ? `@${from.username}` : "") || str(from.title) || `id ${from.id}`)
    .slice(0, NAME_LIMIT);
};

/**
 * Что сказано в сообщении — словами, включая то, что текстом не было.
 * Фото, файл, голосовое и вход в чат — тоже события разговора: «после
 * этого Иван прислал файл» помощнику знать полезно, а содержимого файла
 * у нас всё равно нет, и выдумывать его нельзя.
 */
export function describeMessage(msg = {}) {
  const parts = [];
  const text = str(msg.text) || str(msg.caption);
  if (msg.photo) parts.push("[фото]");
  if (msg.document) parts.push(`[файл «${str(msg.document.file_name) || "без имени"}»]`);
  if (msg.voice) parts.push("[голосовое сообщение]");
  if (msg.video_note) parts.push("[видеосообщение]");
  if (msg.video) parts.push("[видео]");
  if (msg.audio) parts.push("[аудио]");
  if (msg.sticker) parts.push(`[стикер${msg.sticker.emoji ? ` ${msg.sticker.emoji}` : ""}]`);
  if (msg.location) parts.push("[геопозиция]");
  if (msg.poll) parts.push(`[опрос: ${str(msg.poll.question)}]`);
  if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length) {
    parts.push(`[в чат вошёл: ${msg.new_chat_members.map(nameOf).join(", ")}]`);
  }
  if (msg.left_chat_member) parts.push(`[из чата вышел: ${nameOf(msg.left_chat_member)}]`);
  if (msg.pinned_message) parts.push("[закрепил сообщение]");
  if (text) parts.push(text);
  return parts.join(" ").slice(0, TEXT_LIMIT);
}

const iso = (unix) => (Number.isFinite(Number(unix)) && Number(unix) > 0
  ? new Date(Number(unix) * 1000).toISOString()
  : new Date().toISOString());

async function readMeta(chatId) {
  try { return JSON.parse(await fs.readFile(metaFile(chatId), "utf8")); }
  catch { return null; }
}

/**
 * Кладёт сообщение группы на диск. Возвращает записанную строку или null,
 * когда записывать нечего: сообщение не из группы или в нём ни слова
 * (например, служебное «изменилась картинка чата»).
 *
 * Правка (`edited_message`) приходит тем же объектом с `edit_date` —
 * ложится новой строкой с тем же id; прежняя остаётся.
 */
export async function recordGroupMessage(msg) {
  if (!msg || !isGroupChat(msg.chat)) return null;
  const chatId = safeChatId(msg.chat.id);
  if (!chatId) return null;
  const text = describeMessage(msg);
  if (!text) return null;

  const sender = msg.from || msg.sender_chat || null;
  const line = {
    id: Number(msg.message_id),
    at: iso(msg.edit_date || msg.date),
    from: { id: sender?.id == null ? null : String(sender.id), name: nameOf(sender) },
    text,
    ...(msg.edit_date ? { edited: true } : {}),
  };
  await fs.mkdir(baseDir(), { recursive: true });
  await fs.appendFile(linesFile(chatId), `${JSON.stringify(line)}\n`, "utf8");

  // Название чата хранится отдельно и переписывается только когда
  // сменилось: класть его в каждую строку — тысячу раз одно и то же.
  const title = str(msg.chat.title).slice(0, TITLE_LIMIT);
  const meta = await readMeta(chatId);
  if (!meta || meta.title !== title) {
    await fs.writeFile(metaFile(chatId), JSON.stringify({ chatId, title }), "utf8");
  }
  return line;
}

/** Все сообщения чата в порядке записи; правка заменяет текст, не двигая
 *  сообщение с места и не меняя времени, когда оно прозвучало. */
export async function readChat(chatId) {
  const id = safeChatId(chatId);
  if (!id) return null;
  let raw = "";
  try { raw = await fs.readFile(linesFile(id), "utf8"); }
  catch { return null; }
  const messages = [];
  const index = new Map();
  raw.split("\n").forEach((s) => {
    if (!s.trim()) return;
    let line;
    // Оборванная строка (процесс упал на записи) — теряется одна строка,
    // а не весь чат.
    try { line = JSON.parse(s); } catch { return; }
    if (index.has(line.id)) {
      const prev = messages[index.get(line.id)];
      messages[index.get(line.id)] = { ...prev, text: line.text, edited: true };
      return;
    }
    index.set(line.id, messages.length);
    messages.push(line);
  });
  const meta = await readMeta(id);
  return { chatId: id, title: meta?.title || "", messages };
}

export async function listChatIds() {
  try {
    return (await fs.readdir(baseDir()))
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => safeChatId(f.slice(0, -".jsonl".length)))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/* Столько знаков «стоит» сообщение в контексте: сам текст, имя и время.
   Оценка, а не точная длина строки, — точную знает тот, кто рисует. */
const cost = (m) => String(m.text || "").length + String(m.from?.name || "").length + 24;

/**
 * Чаты для контекста одного человека — только те, где он состоит сейчас.
 *
 * `isMember(chatId, userId)` спрашивается на каждое обращение и для каждого
 * чата, потому что членство — не наша запись, а состояние группы, и
 * узнать его можно только у Telegram. Ошибка проверки = «не состоит»:
 * лишний чат в чужом контексте хуже, чем недостающий.
 *
 * Предел в знаках — общий на все чаты, и берётся новое: вчерашний разговор
 * важнее прошлогоднего, в каком бы чате он ни был. Сколько сообщений не
 * поместилось, сказано числом (`dropped`), чтобы помощник не думал, что
 * видит чат целиком.
 */
export async function chatsFor(userId, { isMember = getChatMember, maxChars = CHAT_CONTEXT_CHARS } = {}) {
  const ids = await listChatIds();
  const allowed = await Promise.all(ids.map(async (chatId) => {
    try { return (await isMember(chatId, String(userId))) === true; }
    catch { return false; }
  }));
  const chats = (await Promise.all(ids.filter((_, i) => allowed[i]).map(readChat)))
    .filter((c) => c && c.messages.length);

  // Новое важнее: перебираем все сообщения всех чатов от последних к
  // первым, пока хватает знаков; потом внутри чата — снова по порядку.
  const flat = chats.flatMap((c) => c.messages.map((m) => ({ chat: c.chatId, m })));
  flat.sort((a, b) => String(b.m.at).localeCompare(String(a.m.at)));
  const kept = new Map();
  let used = 0;
  for (const { chat, m } of flat) {
    const c = cost(m);
    if (used + c > maxChars) break;
    used += c;
    if (!kept.has(chat)) kept.set(chat, new Set());
    kept.get(chat).add(m.id);
  }

  return chats
    .map((c) => {
      const ids = kept.get(c.chatId) || new Set();
      const messages = c.messages.filter((m) => ids.has(m.id));
      return { chatId: c.chatId, title: c.title, messages,
        total: c.messages.length, dropped: c.messages.length - messages.length };
    })
    .filter((c) => c.messages.length)
    .sort((a, b) => String(b.messages.at(-1)?.at || "").localeCompare(String(a.messages.at(-1)?.at || "")));
}
