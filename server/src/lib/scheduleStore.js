import fs from "node:fs/promises";
import path from "node:path";
import { reminderAlive } from "./scheduler.js";

/* Расписания напоминаний — по файлу на пользователя Telegram.
   Хранятся отдельно от сценариев: планировщику нужен быстрый обход всех
   пользователей, а сценарии могут быть большими и их много на одного.

   В файле три вещи: `tasks` — что доска прислала, `sent` — какие разовые
   срабатывания уже ушли, и `reminders` — «висящие» напоминания: те, на
   которые человек ещё не ответил кнопкой. Планировщик повторяет их раз в
   минуту (см. `repeatDue` в scheduler.js), и именно они, а не `sent`,
   помнят «отложено до» и «когда слали в последний раз». */

const MAX_TASKS = 500;
// Отметки об отправленном чистим, иначе файл растёт бесконечно.
const SENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/* Столько подряд неудачных повторов — и напоминание снимается: чат,
   который не принимает сообщения (бот заблокирован), не должен писать в
   журнал по строке в минуту до конца времён. */
export const REMINDER_MAX_FAILS = 10;

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
    // Отменённая работа напоминаний не шлёт: зовём к делу, которого нет.
    canceled: t.canceled === true,
    start: t.start ? String(t.start) : "",
    repeat: String(t.repeat ?? "once"),
    days: Array.isArray(t.days) ? t.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
    time: t.time ? String(t.time) : "",
    warn: t.warn == null ? null : Number(t.warn),
    // На сколько «Отложить» откладывает — из анкеты того, кому шлём: нужно
    // только тексту уведомления; само откладывание бот читает из анкеты.
    defer: t.defer == null ? null : Number(t.defer),
    /* Какое это напоминание: `task` — исполнителю «пора начинать», `setup`
       — постановщику «нужно поставить». У второго свои кнопки и своё
       условие «ещё в силе» (задача ждёт постановки), поэтому вид записан
       явно, а не угадывается по ролям. */
    kind: t.kind === "setup" ? "setup" : "task",
    // Кому поручена: кнопки «Отложить»/«Начать» под уведомлением получает
    // только он — у владельца, постановщика и проверяющего по чужой задаче
    // они всегда отказывали бы («не ваша»).
    assignee: t.assignee == null || t.assignee === "" ? null : String(t.assignee),
    // Кто ставит: кнопки «Отложить»/«Готово» под напоминанием о постановке
    // — только ему. Срок нужен тексту этого напоминания.
    setter: t.setter == null || t.setter === "" ? null : String(t.setter),
    end: t.end ? String(t.end) : "",
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
  const slim = tasks.map(slimTask);
  const data = {
    chatId: chatId != null ? String(chatId) : prev.chatId ?? null,
    tzOffset: Number.isFinite(Number(tzOffset)) ? Number(tzOffset) : prev.tzOffset ?? 0,
    tasks: slim,
    // Отметки об уже отправленном переносим, иначе после каждого сохранения
    // расписания заново прилетели бы те же напоминания.
    sent: prev.sent || {},
    /* Висящие напоминания тоже переносим — но только по задачам, которые
       ещё есть и ещё в том состоянии, о котором напоминают. Нажатие на
       доске («Взять», «Поставить») до бота не доходит; доска присылает
       расписание заново, и здесь повтор по такой задаче и гаснет. */
    reminders: Object.fromEntries(Object.entries(prev.reminders || {})
      .filter(([, rem]) => reminderAlive(rem, slim))),
    updatedAt: new Date().toISOString(),
  };
  await write(userId, data);
  return { tasks: data.tasks.length, updatedAt: data.updatedAt };
}

/* ─────── висящие напоминания ───────

   Ключ — `${kind}:${taskId}`: на задачу одно напоминание каждого вида.
   Запись: kind, taskId, firstAt (когда впервые ушло), lastSentAt (когда в
   последний раз), deferredUntil (до какого момента молчать; null — не
   отложено), occurrence (какое срабатывание его открыло), text (само
   сообщение — повтор шлёт ЕГО, слово в слово), fails (неудачи подряд). */
export const reminderId = (kind, taskId) => `${kind}:${taskId}`;

export async function getReminder(userId, id) {
  const data = await readSchedule(userId);
  return data?.reminders?.[id] || null;
}

/** Открыть (или переоткрыть — новое срабатывание той же задачи) напоминание. */
export async function openReminder(userId, { kind, taskId, occurrence, text }, now = Date.now()) {
  const data = (await readSchedule(userId)) || {};
  data.reminders = data.reminders || {};
  const id = reminderId(kind, taskId);
  const prev = data.reminders[id];
  data.reminders[id] = {
    kind, taskId: String(taskId),
    firstAt: prev?.firstAt ?? now,
    lastSentAt: now,
    /* Новое срабатывание значит, что отложенное время вышло (или его не
       было): с этого момента повторяем снова. */
    deferredUntil: null,
    occurrence: occurrence ?? null,
    text: String(text || ""),
    fails: 0,
  };
  await write(userId, data);
  return data.reminders[id];
}

/** Повтор ушёл: с этой минуты отсчитывается следующий. */
export async function touchReminder(userId, id, now = Date.now()) {
  const data = await readSchedule(userId);
  const rem = data?.reminders?.[id];
  if (!rem) return false;
  rem.lastSentAt = now;
  rem.fails = 0;
  await write(userId, data);
  return true;
}

/** Повтор не ушёл. После REMINDER_MAX_FAILS подряд напоминание снимается. */
export async function failReminder(userId, id) {
  const data = await readSchedule(userId);
  const rem = data?.reminders?.[id];
  if (!rem) return { dropped: false };
  rem.fails = (rem.fails || 0) + 1;
  const dropped = rem.fails >= REMINDER_MAX_FAILS;
  if (dropped) delete data.reminders[id];
  await write(userId, data);
  return { dropped, fails: rem.fails };
}

/** «Отложить»: молчать до названного момента, потом повторять снова. */
export async function deferReminder(userId, id, until) {
  const data = await readSchedule(userId);
  const rem = data?.reminders?.[id];
  if (!rem) return false;
  rem.deferredUntil = isoOrNull(until);
  await write(userId, data);
  return true;
}

/** Нажали — повтор гаснет. Возвращает, было ли что гасить. */
export async function ackReminder(userId, id) {
  const data = await readSchedule(userId);
  if (!data?.reminders?.[id]) return false;
  delete data.reminders[id];
  await write(userId, data);
  return true;
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
  setDeferredUntil, getReminder, openReminder, touchReminder, failReminder, deferReminder,
  ackReminder };
