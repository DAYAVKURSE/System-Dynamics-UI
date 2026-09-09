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

import { DEFERRABLE, taskKeyboard } from "./botTasks.js";

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

/* Что пора отправить прямо сейчас. Возвращает список без побочных эффектов;
   отправку и отметку «уже отправлено» делает вызывающий код. */
export function dueNotifications(schedule, nowMs, sent = {}) {
  const { tzOffset = 0, tasks = [] } = schedule || {};
  const out = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    // Завершённые не напоминают о себе.
    if (task.status === "done") continue;
    /* Отменённые — тем более: напомнить о работе, которую решили не делать,
       значит позвать человека к делу, которого нет. */
    if (task.canceled === true) continue;
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
        if (nowMs - m.at >= FIRE_WINDOW_MS) continue;
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
export const keyboardFor = (n, userId) => (forAssignee(n, userId) ? taskKeyboard(n.taskId) : null);

// Обычное текстовое сообщение — без разметки, чтобы произвольное название
// задачи не могло сломать парсер Telegram и не требовало экранирования.
// Абзац про кнопки — только там, где есть сами кнопки (см. keyboardFor).
export function formatMessage(n, userId = null) {
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
      + ", и под этим сообщением появится «Сдать отчёт».");
  }
  return lines.join("\n");
}

/* Один проход планировщика. store и send передаются снаружи — так тик
   проверяется на заглушках, без диска и без обращений к Telegram. */
export async function runTick({ store, send, now = Date.now(), log = () => {} }) {
  const schedules = await store.all();
  let sentCount = 0;

  for (const { userId, schedule } of schedules) {
    const chatId = schedule?.chatId;
    if (!chatId) continue;

    const due = dueNotifications(schedule, now, schedule.sent || {});
    if (!due.length) continue;

    for (const n of due) {
      try {
        await send(chatId, formatMessage(n, userId), keyboardFor(n, userId));
        await store.markSent(userId, n.key, now);
        sentCount++;
      } catch (e) {
        // Одна неудачная отправка не должна ронять весь проход: например,
        // пользователь не начал диалог с ботом. Отметку не ставим — попробуем
        // ещё раз на следующем тике, пока не вышли из окна.
        log(`не удалось отправить напоминание пользователю ${userId}: ${e.message}`);
      }
    }
  }
  return sentCount;
}
