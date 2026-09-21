/* ════════════════════════════════════════════════════════════════
   Планировщик напоминаний.

   Вся логика «что пора отправить» — чистые функции без обращения к диску,
   сети и текущему времени: время передаётся аргументом. Иначе поведение
   планировщика можно было бы проверить только вживую, ожидая нужной минуты.

   Времена задач хранятся так, как их ввёл пользователь («настенные»):
   datetime-local не несёт часового пояса. Поэтому клиент присылает
   tzOffset — то же, что возвращает getTimezoneOffset(): сколько минут
   нужно прибавить к местному времени, чтобы получить UTC.
   ════════════════════════════════════════════════════════════════ */

import { DEFERRABLE, setupKeyboard, taskKeyboard } from "./botTasks.js";

// Окно, внутри которого просроченное напоминание всё ещё отправляется.
// Нужно, чтобы перезапуск сервера или подвисший тик не съедали уведомление
// молча, но и чтобы после долгого простоя не прилетала пачка старых.
export const FIRE_WINDOW_MS = 10 * 60 * 1000;

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// «Настенное» время пользователя → UTC-метка.
export function wallToUtc(wall, tzOffset = 0) {
  if (!wall) return NaN;
  const ms = Date.parse(`${wall}:00Z`);
  return isNaN(ms) ? NaN : ms + tzOffset * MIN;
}

// UTC-метка → дата, у которой UTC-поля показывают местное время пользователя.
export function wallDate(ms, tzOffset = 0) {
  return new Date(ms - tzOffset * MIN);
}

const pad = (n) => String(n).padStart(2, "0");
const wallStamp = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
  `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

// Понедельник = 0, воскресенье = 6 — как в списке дней на клиенте.
const weekdayIndex = (d) => (d.getUTCDay() + 6) % 7;

/* Ближайшие к текущему моменту срабатывания задачи.
   Для повторяющихся смотрим вчера/сегодня/завтра: этого хватает, чтобы
   поймать и предупреждение «за сутки», и просроченное окно. */
export function occurrencesNear(task, nowMs, tzOffset = 0) {
  return [...plannedOccurrences(task, nowMs, tzOffset), ...deferredOccurrence(task)];
}

/* Отложенная задача получает НОВОЕ уведомление о начале в названный момент.

   Момент — UTC-метка (ISO), а не «настенное» время, как у `start`: его
   назвал не человек в поле формы, а сервер, сложив «на сколько отложить»
   с «сейчас». Ключ у срабатывания свой: отметка об отправленном исходном
   уведомлении не должна глушить повторное. */
function deferredOccurrence(task) {
  const until = task.deferredUntil ? Date.parse(task.deferredUntil) : NaN;
  if (!Number.isFinite(until)) return [];
  return [{ ms: until, key: `deferred:${task.deferredUntil}`, deferred: true }];
}

function plannedOccurrences(task, nowMs, tzOffset = 0) {
  const warnMs = Number.isFinite(Number(task.warn)) ? Number(task.warn) * MIN : 0;
  const lookBack = FIRE_WINDOW_MS;
  const lookAhead = warnMs + MIN;

  if (task.repeat === "once" || !task.repeat) {
    const ms = wallToUtc(task.start, tzOffset);
    return isNaN(ms) ? [] : [{ ms, key: task.start }];
  }

  if (!task.time) return [];
  const out = [];
  for (let shift = -1; shift <= 1; shift++) {
    const day = wallDate(nowMs + shift * DAY, tzOffset);
    if (task.repeat === "weekly") {
      const days = Array.isArray(task.days) ? task.days : [];
      if (!days.includes(weekdayIndex(day))) continue;
    }
    const stamp = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-` +
      `${pad(day.getUTCDate())}T${task.time}`;
    const ms = wallToUtc(stamp, tzOffset);
    if (isNaN(ms)) continue;
    if (ms < nowMs - lookBack - DAY || ms > nowMs + lookAhead + DAY) continue;
    out.push({ ms, key: stamp });
  }
  return out;
}

/* ─────── о чём напоминаем ───────

   Два вида. `task` — исполнителю: «пора начинать», по времени начала и с
   предупреждением заранее. `setup` — ПОСТАНОВЩИКУ: «нужно поставить
   задачу», и ждать тут нечего — задача уже висит непоставленной, поэтому
   напоминание уходит с первого же тика, как она появилась в расписании.

   Дальше оба повторяются раз в минуту, пока человек не нажмёт кнопку
   (`repeatDue`): владелец просил, чтобы напоминание не терялось между
   делами. Нажал «Отложить» — молчим до названного момента. */
export const SETUP_KEY = "setup";

/** Ещё в силе ли висящее напоминание — по нынешнему состоянию задач. */
export function reminderAlive(rem, tasks = []) {
  if (!rem || !rem.taskId) return false;
  const task = (Array.isArray(tasks) ? tasks : []).find((t) => String(t.id) === String(rem.taskId));
  if (!task || task.canceled === true) return false;
  /* О постановке напоминаем, пока задача ждёт постановки; о работе — пока
     она лежит (взятую и сданную начинать нечего). Нажатие на доске до бота
     не доходит — оно и гасит повтор здесь, когда доска пришлёт расписание. */
  return rem.kind === "setup" ? task.status === "wait"
    : task.status !== "done" && DEFERRABLE.includes(task.status);
}

/** Повторы, которым пора уйти снова: минута с прошлого раза и не отложено. */
export const REPEAT_MS = 60 * 1000;
export function repeatDue(schedule, nowMs) {
  const { tasks = [], reminders = {} } = schedule || {};
  return Object.entries(reminders)
    .filter(([, rem]) => reminderAlive(rem, tasks))
    .filter(([, rem]) => {
      const until = rem.deferredUntil ? Date.parse(rem.deferredUntil) : NaN;
      if (Number.isFinite(until) && nowMs < until) return false;
      return nowMs - (Number(rem.lastSentAt) || 0) >= REPEAT_MS;
    })
    .map(([id, rem]) => ({ id, ...rem }));
}

/* ─────── список напоминаний для человека ───────

   Владелец (2026-09-15): «в напоминаниях должен быть так же список
   напоминаний» — что и когда пришлёт бот. Считается по расписанию
   человека теми же правилами, что и отправка, но наперёд: у задачи
   исполнителю — ближайшее начало (отложенная — момент, до которого
   отложили) и предупреждение за `warn` минут; у задачи постановщику —
   «нужно поставить», оно без времени: уходит сразу и повторяется.
   Висящее (уже отправленное и повторяющееся каждую минуту) помечено
   отдельно — с «молчит до», если отложено. Времена — UTC-метки ISO;
   на экране их переводят в местное. */
function nextPlanned(task, nowMs, tzOffset = 0) {
  if (task.repeat === "once" || !task.repeat) {
    const ms = wallToUtc(task.start, tzOffset);
    return isNaN(ms) ? null : ms;
  }
  if (!task.time) return null;
  for (let shift = 0; shift <= 7; shift += 1) {
    const day = wallDate(nowMs + shift * DAY, tzOffset);
    if (task.repeat === "weekly") {
      const days = Array.isArray(task.days) ? task.days : [];
      if (!days.includes(weekdayIndex(day))) continue;
    }
    const stamp = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${task.time}`;
    const ms = wallToUtc(stamp, tzOffset);
    if (isNaN(ms)) continue;
    if (ms >= nowMs - FIRE_WINDOW_MS) return ms;
  }
  return null;
}
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
/* ─────── ЗАПИСИ НАПОМИНАНИЙ (владелец, 2026-09-20) ───────

   Напоминание — не вычисляемая строчка, а ЗАПИСЬ. Она заводится, когда
   задача появилась в бэклоге, и из списка никуда не девается, пока
   человек не удалит её сам: прежде список пересчитывался из задач, и
   взятая в работу задача исчезала из него вместе со своим напоминанием —
   «список напоминаний пуст», хотя работа была.

   Запись одна на задачу: `task:<id>` исполнителю, `setup:<id>`
   постановщику. В ней `at` — когда напоминание должно уйти, `sentAt` —
   когда ушло (пусто — значит ещё нет). Удалённая остаётся надгробием
   (`deleted`), чтобы не завестись заново на следующем же проходе.

   Отправленной запись становится один раз: дальше повторы ведёт
   «висящее» напоминание (`reminders`), как и прежде. */
export const noteKind = (t) => (t?.kind === "setup" ? "setup" : "task");
export const noteIdOf = (t) => `${noteKind(t)}:${t?.id}`;

/* Когда напоминание должно уйти. Постановщику — сразу, ждать нечего:
   задача уже висит непоставленной. Исполнителю — за `warn` до начала
   (или в само начало, если предупреждать не за сколько). */
export function noteAt(task, nowMs, tzOffset = 0) {
  if (noteKind(task) === "setup") return nowMs;
  const deferred = task.deferredUntil ? Date.parse(task.deferredUntil) : NaN;
  const base = Number.isFinite(deferred) ? deferred : nextPlanned(task, nowMs, tzOffset);
  if (base == null || !Number.isFinite(base)) return null;
  const warn = Number(task.warn) || 0;
  return warn > 0 ? base - warn * MIN : base;
}

/* Заводится ли запись. Постановщику — пока задача ждёт постановки,
   исполнителю — пока она лежит. Дальше запись живёт сама: статус задачи
   меняется, а напоминание остаётся в списке. */
export const noteWanted = (t) => !!t && t.canceled !== true
  && (noteKind(t) === "setup" ? t.status === "wait" : DEFERRABLE.includes(t.status));

/** «Взяли в работу» — состояние, в котором неотправленное уходит сразу. */
export const TAKEN = ["progress", "deadline"];

/**
 * Записи после этого прохода: заводит недостающие, обновляет время у тех,
 * что ещё не ушли. Чистая функция — на диск пишет вызывающий.
 */
export function syncNotes(schedule, nowMs = Date.now()) {
  const { tasks = [], notes = {}, tzOffset = 0 } = schedule || {};
  const out = { ...notes };
  let changed = false;
  tasks.forEach((t) => {
    const id = noteIdOf(t);
    const at = noteAt(t, nowMs, tzOffset);
    const prev = out[id];
    if (!prev) {
      if (!noteWanted(t)) return;
      out[id] = { id, kind: noteKind(t), taskId: String(t.id),
        title: t.title || "Задача", end: t.end || "",
        at: iso(at), createdAt: iso(nowMs), sentAt: null };
      changed = true;
      return;
    }
    if (prev.deleted) return;
    /* Пока не ушло — время может сдвинуться: постановщик поменял начало,
       человек отложил задачу. Ушедшее не трогаем: это уже история. */
    const nextAt = iso(at);
    const title = t.title || "Задача";
    if (!prev.sentAt && (prev.at !== nextAt || prev.title !== title)) {
      out[id] = { ...prev, at: nextAt, title, end: t.end || "" };
      changed = true;
    }
  });
  return { notes: out, changed };
}

/** Запись этой задачи — или null, если её нет вовсе. */
export const noteOf = (schedule, task) => (schedule?.notes || {})[noteIdOf(task)] || null;

/**
 * Что пора отправить ВПЕРВЫЕ. Запись уходит, когда настало её время —
 * или когда задачу взяли в работу раньше этого времени: напоминание,
 * которое не успело прийти, должно прийти тогда, когда станет ясно, что
 * оно уже опоздало (владелец, 2026-09-20).
 */
export function dueNotes(schedule, nowMs = Date.now()) {
  const { tasks = [], notes = {} } = schedule || {};
  const byId = new Map(tasks.map((t) => [noteIdOf(t), t]));
  return Object.values(notes).filter((n) => {
    if (!n || n.deleted || n.sentAt) return false;
    const task = byId.get(n.id);
    if (!task || task.canceled === true || task.status === "done") return false;
    if (n.kind === "setup") return task.status === "wait";
    if (TAKEN.includes(task.status)) return true;       // взяли раньше, чем напомнили
    if (!DEFERRABLE.includes(task.status)) return false;
    const at = n.at ? Date.parse(n.at) : NaN;
    return Number.isFinite(at) && at <= nowMs;
  });
}

/**
 * Список для человека: по форме на каждое напоминание. Статус выполнения
 * берётся у задачи прямо сейчас, статус напоминания — из самой записи.
 * Удалённые не показываются.
 */
const DOING = { wait: "ожидает постановки", backlog: "бэклог", deferred: "бэклог",
  deadline: "бэклог", progress: "в работе", review: "сдана", done: "сдана" };
export function listReminders(schedule, nowMs = Date.now()) {
  const { tasks = [], notes = {}, reminders = {} } = schedule || {};
  const byId = new Map(tasks.map((t) => [noteIdOf(t), t]));
  return Object.values(notes)
    .filter((n) => n && !n.deleted)
    .map((n) => {
      const task = byId.get(n.id) || null;
      const hang = reminders[n.id] || null;
      return {
        id: n.id, kind: n.kind, taskId: n.taskId,
        title: task?.title || n.title || "Задача",
        end: task?.end || n.end || "",
        at: n.at || null,
        sentAt: n.sentAt || null,
        // Чем задача занята сейчас: бэклог, в работе, сдана.
        doing: task ? (DOING[task.status] || "бэклог") : "задачи больше нет",
        canceled: task?.canceled === true,
        hanging: hang && reminderAlive(hang, tasks)
          ? { since: iso(Number(hang.lastSentAt) || null),
            deferredUntil: hang.deferredUntil || null }
          : null,
      };
    })
    // Сперва неотправленные и ближайшие; без времени — в конец.
    .sort((a, b) => (a.sentAt ? 1 : 0) - (b.sentAt ? 1 : 0)
      || (a.at == null ? 1 : 0) - (b.at == null ? 1 : 0)
      || String(a.at || "").localeCompare(String(b.at || "")));
}

/* Что пора отправить прямо сейчас. Возвращает список без побочных эффектов;
   отправку и отметку «уже отправлено» делает вызывающий код. */
export function dueNotifications(schedule, nowMs, sent = {}) {
  const { tzOffset = 0, tasks = [] } = schedule || {};
  const out = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    // Завершённые не напоминают о себе.
    if (task.status === "done") continue;
    /* Напоминание о постановке: срока у него нет — задача ждёт прямо
       сейчас. Уходит один раз, дальше повторяется (`repeatDue`). */
    if (task.kind === "setup") {
      if (task.status !== "wait" || task.canceled === true) continue;
      const key = `${task.id}:${SETUP_KEY}`;
      if (!sent[key]) {
        out.push({ key, kind: "setup", at: nowMs, occurrence: SETUP_KEY,
          taskId: task.id, title: task.title || "Задача", body: task.body || "",
          warn: null, deferred: false,
          setter: task.setter == null || task.setter === "" ? null : String(task.setter),
          end: task.end || "", startWall: "" });
      }
      continue;
    }
    /* Отменённые — тем более: напомнить о работе, которую решили не делать,
       значит позвать человека к делу, которого нет. */
    if (task.canceled === true) continue;
    /* Удалённое из списка напоминание молчит: человек убрал его руками
       (владелец, 2026-09-20). */
    if ((schedule?.notes || {})[noteIdOf(task)]?.deleted) continue;
    /* Плановое напоминание — пока задача лежит или её делают. Сданную
       звать «начинать» нечего: прежде это не мешало только потому, что
       опоздавшее на десять минут выбрасывалось. */
    if (!DEFERRABLE.includes(task.status) && !TAKEN.includes(task.status)) continue;
    /* «Отложить» под предупреждением значит «в назначенный час не начну,
       напомни позже»: плановые «через N минут» и «начинается», лежащие
       РАНЬШЕ названного момента, не шлются — иначе в назначенный час
       приходило бы «Начинается» с кнопками, и откладывать пришлось бы
       заново. Действует, пока задача лежит (DEFERRABLE): взятую отложение
       уже не касается, и `deferredUntil` у неё снимается при взятии. */
    const until = task.deferredUntil ? Date.parse(task.deferredUntil) : NaN;
    const deferredNow = Number.isFinite(until) && DEFERRABLE.includes(task.status);

    for (const occ of occurrencesNear(task, nowMs, tzOffset)) {
      // Отложенное напоминает о себе, только пока лежит: взятую или сданную
      // за это время задачу «начинать» второй раз нечего.
      if (occ.deferred && !DEFERRABLE.includes(task.status)) continue;
      const moments = [{ kind: "start", at: occ.ms }];
      const warn = Number(task.warn);
      // 0 означает «в момент начала» — отдельного предупреждения не нужно.
      // Отложенное не предупреждает вовсе: момент человек назвал сам,
      // минуту назад, и предупреждать его о собственном решении не за что.
      if (!occ.deferred && Number.isFinite(warn) && warn > 0) {
        moments.push({ kind: "warn", at: occ.ms - warn * MIN, warn });
      }

      for (const m of moments) {
        if (m.at > nowMs) continue;
        /* Опоздавшее у РАЗОВОЙ задачи не выбрасывается (владелец,
           2026-09-20: «если уведомление не пришло по каким-либо причинам
           в нужное время, то оно должно прийти, как только это станет
           возможным»). Прежде момент, попавший в перезапуск сервера
           длиннее десяти минут, пропадал молча, и напомнить было уже
           нечем: второго такого момента у разовой задачи нет.
           У ПОВТОРЯЮЩЕЙСЯ окно остаётся: пропущенное вчерашнее
           срабатывание заменяет сегодняшнее, и слать оба — значит звать
           к работе, которой уже нет. */
        const repeating = task.repeat && task.repeat !== "once";
        if (repeating && nowMs - m.at >= FIRE_WINDOW_MS) continue;
        /* Опоздавшее ПРЕДУПРЕЖДЕНИЕ не шлётся, если само начало уже
           настало: «через 10 минут начало» в момент начала — новость не о
           том. Его заменяет «пора начинать», которое уйдёт следом. */
        if (m.kind === "warn" && occ.ms <= nowMs) continue;
        if (!occ.deferred && deferredNow && m.at < until) continue;
        const key = `${task.id}:${occ.key}:${m.kind}`;
        if (sent[key]) continue;
        out.push({
          key, kind: m.kind, at: m.at, occurrence: occ.key,
          taskId: task.id, title: task.title || "Задача",
          body: task.body || "", warn: m.warn ?? null,
          deferred: Boolean(occ.deferred),
          /* undefined — поля в записи НЕТ (расписание сохранено до v1.1, когда
             исполнителя в него не писали); null — поле есть, исполнителя
             нет. Разница нужна кнопкам: старая запись считается записью
             того, у кого лежит, а «никому» — это «никому». */
          assignee: task.assignee === undefined ? undefined
            : task.assignee == null || task.assignee === "" ? null : String(task.assignee),
          startWall: occ.deferred ? wallStamp(wallDate(occ.ms, tzOffset))
            : task.repeat === "once" || !task.repeat ? task.start : occ.key,
        });
      }
    }

    /* ─── ДО ДЕДЛАЙНА — В ПРОЦЕНТАХ (владелец, 2026-09-21) ───

       «Пользователь должен предупреждаться за введённое количество
       процентов времени до момента сдачи». Отсчёт — от всего срока,
       отпущенного на задачу: от её начала до сдачи; начала нет — от
       момента, когда она появилась в напоминаниях (createdAt записи).
       Момент один, ключ — по сроку: сдвинули срок — предупредим снова.
       После самого срока не шлётся: «осталось 20 %» после сдачи — новость
       не о том. Кнопок нет: начинать или откладывать тут нечего. */
    const dead = Number(task.dead);
    if (task.end && Number.isFinite(dead) && dead > 0) {
      const endMs = wallToUtc(task.end, tzOffset);
      const note = (schedule?.notes || {})[noteIdOf(task)];
      const startMs = wallToUtc(task.start, tzOffset);
      const baseMs = Number.isFinite(startMs) ? startMs
        : (note?.createdAt ? Date.parse(note.createdAt) : NaN);
      if (Number.isFinite(endMs) && Number.isFinite(baseMs) && endMs > baseMs) {
        const atMs = endMs - ((endMs - baseMs) * dead) / 100;
        const key = `${task.id}:deadline:${task.end}`;
        if (atMs <= nowMs && nowMs < endMs && !sent[key]) {
          out.push({
            key, kind: "deadline", at: atMs, occurrence: `deadline:${task.end}`,
            taskId: task.id, title: task.title || "Задача", body: task.body || "",
            warn: null, dead, left: endMs - nowMs, deferred: false,
            end: task.end,
            assignee: task.assignee === undefined ? undefined
              : task.assignee == null || task.assignee === "" ? null : String(task.assignee),
            startWall: task.start || "",
          });
        }
      }
    }
  }
  return out;
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export function formatWarn(minutes) {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${plural(d, "сутки", "суток", "суток")}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} ${plural(h, "час", "часа", "часов")}`;
  }
  return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")}`;
}

/* ─────── две кнопки под уведомлением ───────

   Уведомление говорило «Начинается: …» и на этом заканчивалось — а человек
   в этот момент решает ровно одно: начинает он сейчас или нет. Без кнопок
   решение оставалось в голове: доска показывала задачу лежащей в бэклоге и
   тогда, когда за неё уже взялись, и тогда, когда её отложили, — по
   доске эти два случая были неразличимы.

   Кнопки ровно две, и обе про работу, а не про доску: «Начать» переводит
   задачу в работу, «Отложить» оставляет её в бэклоге, но помечает
   отложенной. Третьей — «удалить», «перенести» — здесь нет: срок и
   содержимое задачи меняет постановщик, а не тот, кого позвали.

   Сама клавиатура — «🔴 Отложить» слева, «🟢 Начать» справа — собирается в
   `botTasks.js` рядом с разбором нажатий: подпись и данные кнопки должны
   лежать в одном месте, иначе переименованная кнопка перестала бы
   узнаваться. Инлайн-кнопки Telegram красить нельзя (в Bot API нет поля
   цвета — он берётся из темы клиента), поэтому цвет передаётся эмодзи в
   подписи, и только им.

   Кнопки стоят и под предупреждением «через N минут», и под «пора
   начинать». В v1.1 предупреждение их не получало — «начинать раньше
   времени нечего», — но именно в момент предупреждения человек и решает,
   успевает ли он: «Отложить» здесь значит «в назначенный час не начну,
   напомни позже», а «Начать» — «готов, беру сейчас». Ждать второго
   уведомления ради того же решения — лишний шаг.

   Кнопки — только ИСПОЛНИТЕЛЮ. Уведомление о той же задаче приходит и
   владельцу (у него в расписании вся модель), и постановщику с
   проверяющим (у них — задачи, где они участвуют), но взять или отложить
   её может лишь тот, кому она поручена: у остальных кнопка отвечала бы
   отказом «не ваша». Задача без исполнителя (null) кнопок не получает
   вовсе. Запись БЕЗ поля исполнителя (undefined — сохранена до v1.1)
   считается записью того, у кого лежит: иначе после выката все старые
   напоминания приходили без кнопок, и человеку нечем было ответить,
   пока приложение не перешлёт расписание заново. */
export const forAssignee = (n, userId) => (n.kind === "start" || n.kind === "warn")
  && (n.assignee === undefined || (n.assignee != null && String(n.assignee) === String(userId)));
/* Напоминание о постановке — только тому, кто ставит: «Готово» проверяет,
   что задача и правда поставлена, и у остальных оно отказывало бы всегда. */
export const forSetter = (n, userId) => n.kind === "setup"
  && n.setter != null && String(n.setter) === String(userId);
export const keyboardFor = (n, userId) => (n.kind === "setup"
  ? (forSetter(n, userId) ? setupKeyboard(n.taskId) : null)
  : (forAssignee(n, userId) ? taskKeyboard(n.taskId) : null));

// Обычное текстовое сообщение — без разметки, чтобы произвольное название
// задачи не могло сломать парсер Telegram и не требовало экранирования.
// Абзац про кнопки — только там, где есть сами кнопки (см. keyboardFor).
export function formatMessage(n, userId = null) {
  if (n.kind === "setup") {
    const lines = [`Нужно поставить задачу: ${n.title}`];
    if (n.end) lines.push(`Срок: ${String(n.end).replace("T", " ")}`);
    if (n.body) lines.push("", n.body);
    if (forSetter(n, userId)) {
      lines.push("", "«✅ Готово» — проверю, что задача и правда поставлена:"
        + " названы исполнитель, проверяющий и срок, и ресурсов хватает."
        + " «🔴 Отложить» — напомню позже, через то время, что стоит у вас в"
        + " «Напоминаниях». Пока не нажмёте, повторю это сообщение через минуту.");
    }
    return lines.join("\n");
  }
  if (n.kind === "deadline") {
    const left = Math.max(1, Math.round((Number(n.left) || 0) / MIN));
    const lines = [`До сдачи осталось ${formatWarn(left)} — ${n.dead} % срока: ${n.title}`];
    if (n.end) lines.push(`Срок: ${String(n.end).replace("T", " ")}`);
    if (n.body) lines.push("", n.body);
    return lines.join("\n");
  }
  const time = n.startWall ? n.startWall.replace("T", " ") : "";
  const head = n.kind === "warn"
    ? `Через ${formatWarn(n.warn)}: ${n.title}`
    : n.deferred ? `Время вышло — начинается отложенная: ${n.title}`
      : `Начинается: ${n.title}`;
  const lines = [head];
  if (time) lines.push(`Начало: ${time}`);
  if (n.body) lines.push("", n.body);
  /* Сказано, что делают кнопки, и в том же порядке, что они стоят.
     «Отложить» не переносит срок — задача остаётся в бэклоге с отметкой,
     что за неё не взялись, а в названный момент уведомление приходит
     снова. Молчаливая кнопка обещала бы перенос. */
  if (forAssignee(n, userId)) {
    lines.push("", "«🔴 Отложить» — спрошу, на сколько: задача останется в бэклоге как"
      + " отложенная, срок не сдвинется, а когда время выйдет, напомню снова."
      + " «🟢 Начать» — задача уйдёт в работу"
      + (n.kind === "warn" ? " прямо сейчас, не дожидаясь начала," : "")
      + ", и под этим сообщением появится «Сдать отчёт»."
      + " Пока не нажмёте, повторю это сообщение через минуту.");
  }
  return lines.join("\n");
}

/* Один проход планировщика. store и send передаются снаружи — так тик
   проверяется на заглушках, без диска и без обращений к Telegram. */
export async function runTick({ store, send, now = Date.now(), log = () => {},
  tasksFor = null }) {
  const schedules = await store.all();
  let sentCount = 0;

  for (const { userId, schedule: saved } of schedules) {
    const chatId = saved?.chatId;
    if (!chatId) continue;
    /* Задачи берём из модели, а не только из присланного браузером
       (владелец, 2026-09-20): напоминание, которое приходит лишь после
       того, как открыли приложение, не нужно — за этим и идут к боту. */
    const schedule = tasksFor ? await tasksFor(userId, saved) : saved;

    /* Записи напоминаний — первым делом: они заводятся по задачам, и
       по ним же решается, что человеку ещё не сказали. */
    if (store.saveNotes) {
      const synced = syncNotes(schedule, now);
      if (synced.changed) await store.saveNotes(userId, synced.notes);
      schedule.notes = synced.notes;
    }

    const due = dueNotifications(schedule, now, schedule.sent || {});
    const told = new Set();
    for (const n of due) {
      const text = formatMessage(n, userId);
      const keyboard = keyboardFor(n, userId);
      try {
        await send(chatId, text, keyboard);
        await store.markSent(userId, n.key, now);
        /* Отправленное с кнопками становится «висящим»: пока человек не
           нажал, оно повторяется раз в минуту. Без кнопок повторять нечего
           — ответить на него всё равно нечем. */
        if (keyboard && store.openReminder) {
          await store.openReminder(userId,
            { kind: n.kind === "setup" ? "setup" : "task", taskId: n.taskId,
              occurrence: n.occurrence, text }, now);
        }
        // Запись этой задачи стала «отправлено» — так она и читается в списке.
        const noteId = `${n.kind === "setup" ? "setup" : "task"}:${n.taskId}`;
        told.add(noteId);
        if (store.markNoteSent) await store.markNoteSent(userId, noteId, now);
        sentCount++;
      } catch (e) {
        // Одна неудачная отправка не должна ронять весь проход: например,
        // пользователь не начал диалог с ботом. Отметку не ставим — попробуем
        // ещё раз на следующем тике, пока не вышли из окна.
        log(`не удалось отправить напоминание пользователю ${userId}: ${e.message}`);
      }
    }

    /* Напоминание, которое не успело прийти до того, как за задачу
       взялись (владелец, 2026-09-20): плановый путь его уже не даёт —
       момент ещё не настал, — а сказать надо сейчас. */
    for (const note of (store.markNoteSent ? dueNotes(schedule, now) : [])) {
      if (told.has(note.id)) continue;
      const task = (schedule.tasks || []).find((t) => noteIdOf(t) === note.id);
      if (!task) continue;
      const n = { kind: note.kind === "setup" ? "setup" : "start", at: now,
        taskId: task.id, title: task.title || "Задача", body: task.body || "",
        warn: null, deferred: false, end: task.end || "",
        assignee: task.assignee === undefined ? undefined
          : task.assignee == null || task.assignee === "" ? null : String(task.assignee),
        setter: task.setter == null || task.setter === "" ? null : String(task.setter),
        startWall: task.start || "" };
      const text = formatMessage(n, userId);
      try {
        await send(chatId, text, keyboardFor(n, userId));
        await store.markNoteSent(userId, note.id, now);
        sentCount++;
      } catch (e) {
        log(`не удалось отправить напоминание пользователю ${userId}: ${e.message}`);
      }
    }

    /* Повторы. Шлём ТО ЖЕ сообщение, слово в слово: человек уже читал его,
       и переписанное заставило бы читать заново. */
    for (const rem of (store.touchReminder ? repeatDue(schedule, now) : [])) {
      const keyboard = rem.kind === "setup"
        ? setupKeyboard(rem.taskId) : taskKeyboard(rem.taskId);
      try {
        await send(chatId, rem.text, keyboard);
        await store.touchReminder(userId, rem.id, now);
        sentCount++;
      } catch (e) {
        const r = await store.failReminder?.(userId, rem.id).catch(() => ({}));
        log(`повтор напоминания ${rem.id} не ушёл пользователю ${userId}: ${e.message}`
          + (r?.dropped ? " — снял напоминание" : ""));
      }
    }
  }
  return sentCount;
}
