import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { deleteReport, saveReport } from "./reportStore.js";

/* ════════════════════════════════════════════════════════════════
   ПАМЯТЬ ПОМОЩНИКА · только своя

   Всё, что помощник знает, он знает из того, что человеку и так доступно.
   Память — единственное, что человек кладёт в него САМ: заметку, текст,
   файл. И доступна она только тому, кто положил: файл памяти лежит в
   каталоге на пользователя (`data/memory/<userId>.json`), а id берётся из
   подписи запроса, а не из его тела. Чужую память нельзя ни прочитать, ни
   стереть, даже зная id записи, — искать её просто негде.

   Файлы не дублируются: они ложатся в то же хранилище, что и файлы
   отчётов (`reportStore.saveReport`, kind: "memory"), а здесь остаётся
   ссылка. Второе файлохранилище означало бы второй набор правил про типы,
   размеры и ссылки-ключи — и они разошлись бы.

   Пределы названы числами здесь и только здесь: 200 записей, 20 000
   знаков текста. Память идёт в контекст каждого вопроса целиком, и
   бесконечная память означала бы бесконечный контекст.

   Память — у АГЕНТА (v1.3): у каждого агента человека своя, и в контекст
   идёт только память того, кто отвечает. Запись помнит, чья она, полем
   `agent`; прежние записи без поля — ассистента, встроенного агента: до
   агентов вся память была его. Пределы — на человека, а не на агента:
   файл один, и в контекст его читать всё равно целиком.
   ════════════════════════════════════════════════════════════════ */

/* Встроенный агент — тот же id, что в assistantSettings.js; сюда он не
   импортируется, чтобы память не зависела от настроек помощника. */
export const DEFAULT_AGENT = "assistant";
const agentOf = (m) => String(m?.agent || "").trim() || DEFAULT_AGENT;

export const MAX_MEMORY_ITEMS = 200;
export const MAX_MEMORY_TEXT = 20000;
export const MAX_TITLE = 200;
// Файл в память — документ, а не запись созвона: 20 МБ хватает на любой
// PDF и не даёт одной кнопке занять диск, общий с моделью.
export const MAX_MEMORY_FILE_BYTES = 20 * 1024 * 1024;

/* Текстовый файл читается в саму запись: помощник понимает слова, а не
   байты, и заметка, присланная файлом, должна работать так же, как
   набранная руками. Картинку и PDF так не прочитать — от них остаётся
   имя, и это говорится честно. */
const TEXT_TYPES = /^(text\/|application\/json$|application\/csv$)/;

function baseDir() {
  return process.env.MEMORY_DIR
    ? path.resolve(process.env.MEMORY_DIR)
    : path.resolve(process.cwd(), "data", "memory");
}

// id пользователя — через строгий whitelist, как у указателей файлов:
// подняться выше каталога памяти нельзя никаким вводом.
const fileFor = (userId) => path.join(baseDir(),
  `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown"}.json`);

async function readAll(userId) {
  try {
    const parsed = JSON.parse(await fs.readFile(fileFor(userId), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(userId, list) {
  await fs.mkdir(baseDir(), { recursive: true });
  // Через временный файл и переименование: читатель видит либо прежний
  // список, либо новый целиком, но никогда половину.
  const file = fileFor(userId);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/* Правки идут по очереди, по одной на человека: две записи подряд из
   бота и приложения затирали бы друг друга, и одна из них пропадала бы
   молча. Процесс один, поэтому цепочки обещаний в памяти достаточно. */
const queues = new Map();
function inOrder(key, job) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(job, job);
  queues.set(key, next.then(() => {}, () => {}));
  return next;
}

const clean = (s, limit) => String(s ?? "").replace(/\r\n/g, "\n").trim().slice(0, limit);

/** Наружу — без внутренних полей; ссылка на файл уже в записи. */
const view = (m) => ({
  id: m.id, title: m.title, text: m.text, at: m.at, agent: agentOf(m),
  file: m.file ? { name: m.file.name, type: m.file.type, size: m.file.size, url: m.file.url } : null,
});

/** Память одного агента человека; без агента — ассистента, как было всегда. */
export async function listMemory(userId, agent = DEFAULT_AGENT) {
  const who = agentOf({ agent });
  return (await readAll(userId)).filter((m) => agentOf(m) === who).map(view)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Кладёт запись: текст, файл или и то и другое. Название не обязательно —
 * без него берётся первая строка текста или имя файла: спрашивать
 * название у заметки в одну фразу значило бы спрашивать её дважды.
 */
export async function addMemory(userId, { title, text, file, agent } = {}) {
  let body = clean(text, MAX_MEMORY_TEXT + 1);
  let saved = null;

  if (file?.bytes?.length) {
    if (file.bytes.length > MAX_MEMORY_FILE_BYTES) {
      throw new Error(`file must be at most ${Math.round(MAX_MEMORY_FILE_BYTES / 1024 / 1024)} MB`);
    }
    const entry = await saveReport(userId, { name: file.name, type: file.type,
      bytes: file.bytes, kind: "memory" });
    saved = { id: entry.id, name: entry.name, type: entry.type, size: entry.size, url: entry.url };
    if (!body && TEXT_TYPES.test(String(file.type || "").split(";")[0].trim().toLowerCase())) {
      body = clean(file.bytes.toString("utf8"), MAX_MEMORY_TEXT + 1);
    }
  }

  if (body.length > MAX_MEMORY_TEXT) {
    // Обрезаем и говорим об этом в самой записи, а не молча: помощник
    // должен знать, что конца у текста нет.
    body = `${body.slice(0, MAX_MEMORY_TEXT)}\n[текст обрезан: в память помещается ${MAX_MEMORY_TEXT} знаков]`;
  }

  const head = clean(title, MAX_TITLE)
    || clean((body.split("\n").find((l) => l.trim()) || ""), 80)
    || saved?.name
    || "";
  if (!body && !saved) throw new Error("text or file is required");

  const item = {
    id: crypto.randomUUID(),
    title: head || "без названия",
    text: body,
    file: saved,
    agent: agentOf({ agent }),
    at: new Date().toISOString(),
  };

  return inOrder(String(userId), async () => {
    const list = await readAll(userId);
    if (list.length >= MAX_MEMORY_ITEMS) {
      // Файл уже на диске — убираем, иначе он остался бы без записи.
      if (saved) await deleteReport(userId, saved.id).catch(() => {});
      throw new Error(`limit of ${MAX_MEMORY_ITEMS} memory items reached`);
    }
    list.push(item);
    await writeAll(userId, list);
    return view(item);
  });
}

/** Стирает свою запись вместе с её файлом. Чужую — не найти. */
export async function removeMemory(userId, id) {
  const gone = await inOrder(String(userId), async () => {
    const list = await readAll(userId);
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const [item] = list.splice(idx, 1);
    await writeAll(userId, list);
    return item;
  });
  if (!gone) return false;
  if (gone.file?.id) await deleteReport(userId, gone.file.id).catch(() => {});
  return true;
}
