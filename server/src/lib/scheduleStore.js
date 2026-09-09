import fs from "node:fs/promises";
import path from "node:path";

/* Расписания напоминаний — по файлу на пользователя Telegram.
   Хранятся отдельно от сценариев: планировщику нужен быстрый обход всех
   пользователей, а сценарии могут быть большими и их много на одного. */

const MAX_TASKS = 500;
// Отметки об отправленном чистим, иначе файл растёт бесконечно.
const SENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function baseDir() {
  return process.env.SCHEDULES_DIR
    ? path.resolve(process.env.SCHEDULES_DIR)
    : path.resolve(process.cwd(), "data", "schedules");
}

// Имя файла — только из безопасных символов: id приходит из проверенной
// подписи Telegram, но полагаться на это в работе с путями не стоит.
const fileFor = (userId) =>
  path.join(baseDir(), `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown"}.json`);

export async function readSchedule(userId) {
  try {
    return JSON.parse(await fs.readFile(fileFor(userId), "utf8"));
  } catch {
    return null;
  }
}

async function write(userId, data) {
  await fs.mkdir(baseDir(), { recursive: true });
  await fs.writeFile(fileFor(userId), JSON.stringify(data), "utf8");
}

// Из задачи в расписание попадает только то, что нужно для отправки:
// содержимое доски целиком тут не хранится.
function slimTask(t) {
  return {
    id: String(t.id),
    title: String(t.title ?? "").slice(0, 200),
    body: String(t.body ?? "").slice(0, 1000),
    status: String(t.status ?? "backlog"),
    start: t.start ? String(t.start) : "",
    repeat: String(t.repeat ?? "once"),
    days: Array.isArray(t.days) ? t.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
    time: t.time ? String(t.time) : "",
    warn: t.warn == null ? null : Number(t.warn),
    // Кому поручена: кнопки «Отложить»/«Начать» под уведомлением получает
    // только он — у владельца, постановщика и проверяющего по чужой задаче
    // они всегда отказывали бы («не ваша»).
    assignee: t.assignee == null || t.assignee === "" ? null : String(t.assignee),
    // До какого момента отложена (UTC-метка ISO): в этот момент планировщик
    // присылает уведомление о начале заново. Не дата — значит, не отложена.
    deferredUntil: isoOrNull(t.deferredUntil),
  };
}

const isoOrNull = (v) => {
  const ms = v ? Date.parse(String(v)) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/**
 * Переносит отметку «отложено до» в расписание сразу, не дожидаясь, пока
 * человек откроет приложение и оно пересохранит расписание с доски: бот
 * отложил задачу — и он же обязан напомнить в названный момент, даже если
 * приложение с тех пор никто не открывал. Задача, которой в расписании
 * нет, не заводится: напоминания идут только по тому, что доска прислала.
 */
export async function setDeferredUntil(userId, taskId, until) {
  const data = await readSchedule(userId);
  const task = (data?.tasks || []).find((t) => t.id === String(taskId));
  if (!task) return false;
  task.deferredUntil = isoOrNull(until);
  await write(userId, data);
  return true;
}

export async function saveSchedule(userId, { chatId, tzOffset, tasks }) {
  if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
  if (tasks.length > MAX_TASKS) throw new Error(`limit of ${MAX_TASKS} tasks reached`);

  const prev = (await readSchedule(userId)) || {};
  const data = {
    chatId: chatId != null ? String(chatId) : prev.chatId ?? null,
    tzOffset: Number.isFinite(Number(tzOffset)) ? Number(tzOffset) : prev.tzOffset ?? 0,
    tasks: tasks.map(slimTask),
    // Отметки об уже отправленном переносим, иначе после каждого сохранения
    // расписания заново прилетели бы те же напоминания.
    sent: prev.sent || {},
    updatedAt: new Date().toISOString(),
  };
  await write(userId, data);
  return { tasks: data.tasks.length, updatedAt: data.updatedAt };
}

export async function markSent(userId, key, now = Date.now()) {
  const data = (await readSchedule(userId)) || { sent: {} };
  data.sent = data.sent || {};
  data.sent[key] = now;
  for (const [k, ts] of Object.entries(data.sent)) {
    if (now - ts > SENT_TTL_MS) delete data.sent[k];
  }
  await write(userId, data);
}

export async function allSchedules() {
  let names = [];
  try {
    names = await fs.readdir(baseDir());
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const userId = name.slice(0, -5);
    const schedule = await readSchedule(userId);
    if (schedule) out.push({ userId, schedule });
  }
  return out;
}

export const store = { all: allSchedules, markSent, read: readSchedule, save: saveSchedule,
  setDeferredUntil };
