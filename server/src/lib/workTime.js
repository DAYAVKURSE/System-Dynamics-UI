/* ════════════════════════════════════════════════════════════════
   РАБОЧЕЕ ВРЕМЯ ЧЕЛОВЕКА НА СЕРВЕРЕ

   «Принять автоматически в рабочее время» (владелец, 2026-09-20) должен
   решаться там же, где заводится сделка, — на сервере. Проверять это в
   интерфейсе нельзя: заказ приходит от заказчика, а часы — у исполнителя,
   и его браузер в этот момент может быть закрыт.

   График лежит в анкете (`days`, `from`, `to`, `perDay` в org.json), а
   часовой пояс — в расписании напоминаний (`tzOffset`, тот же, что даёт
   getTimezoneOffset в браузере: сколько минут прибавить к местному, чтобы
   получить UTC). Пояса нет — считаем по UTC: это единственное, что сервер
   знает наверняка.

   Правила повторяют `inWorkTime` в `web/src/lib/workers.js` слово в
   слово, включая смену через полночь. Дни — как их даёт `getDay()`:
   воскресенье 0.
   ════════════════════════════════════════════════════════════════ */

const MIN = 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");

/** Часы этого дня недели: свои, если названы, иначе общие. */
export function dayHours(sc = {}, day) {
  const own = (sc.perDay || {})[String(day)] || (sc.perDay || {})[day];
  if (own && (own.from || own.to)) return { from: own.from || "", to: own.to || "" };
  return { from: sc.from || "", to: sc.to || "" };
}

/**
 * Рабочее ли сейчас время у человека.
 *
 * `null` — сказать нечего: график не заполнен. Это НЕ «да»: обещать
 * автоматический приём от имени человека, который не сказал, когда
 * работает, значит обещать за него.
 */
export function inWorkTime(sc = {}, nowMs = Date.now(), tzOffset = 0) {
  const days = Array.isArray(sc.days) ? sc.days : [];
  if (!days.length) return null;
  // Местное время человека: сдвигаем UTC на его пояс и читаем UTC-поля.
  const local = new Date(nowMs - tzOffset * MIN);
  const day = local.getUTCDay();
  if (!days.includes(day)) return false;
  const h = dayHours(sc, day);
  if (!h.from && !h.to) return true;
  const t = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const from = h.from || "00:00";
  const to = h.to || "24:00";
  // Смена через полночь («22:00–06:00»): внутри, если после начала или до конца.
  return from <= to ? (t >= from && t < to) : (t >= from || t < to);
}

/* «Не работаю сегодня» сильнее графика: человек сказал о себе сам. */
export const OFF_STATUSES = ["off", "busy"];
export const worksNow = (user = {}, nowMs = Date.now(), tzOffset = 0) => {
  if (OFF_STATUSES.includes(String(user.status || ""))) return false;
  return inWorkTime(user, nowMs, tzOffset) === true;
};

/* ─────── СТАТУС ЧЕЛОВЕКА ПРЯМО СЕЙЧАС (владелец, 2026-09-20) ───────

   На «Рынке услуг» рядом с «Принимает заказ автоматически» стоит статус
   автора по графику — тем же правилом, что и в строке воркера
   (`liveStatus` в `web/src/lib/workers.js`), иначе один и тот же человек
   читался бы в двух местах по-разному.

   Правило: график молчит (дней нет) — верен выбранный статус. График
   говорит — верен он, КРОМЕ случая, когда человек выбрал статус ПОСЛЕ
   последней границы рабочего времени: свой выбор сильнее расписания до
   следующей границы. */
const MINUTE = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE;

/** Местная полночь того дня, на который приходится момент. */
const localMidnight = (ms, tzOffset) => {
  const local = new Date(ms - tzOffset * MINUTE);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
    + tzOffset * MINUTE;
};
const atTime = (midnightMs, hhmm, addDays = 0) => {
  const [hh, mm] = String(hhmm).split(":").map(Number);
  return midnightMs + addDays * DAY_MS + ((hh || 0) * 60 + (mm || 0)) * MINUTE;
};

/** Границы рабочего времени того дня: когда оно началось и когда кончится. */
function boundariesOn(sc, midnightMs, tzOffset) {
  const day = new Date(midnightMs - tzOffset * MINUTE).getUTCDay();
  if (!(Array.isArray(sc.days) ? sc.days : []).includes(day)) return [];
  const h = dayHours(sc, day);
  const from = h.from || "00:00";
  const to = h.to || "24:00";
  const start = atTime(midnightMs, from);
  const end = to === "24:00" ? atTime(midnightMs, "00:00", 1)
    : (to <= from ? atTime(midnightMs, to, 1) : atTime(midnightMs, to));
  return [start, end];
}

export function lastBoundary(sc = {}, nowMs = Date.now(), tzOffset = 0) {
  if (!(Array.isArray(sc.days) ? sc.days : []).length) return null;
  let best = null;
  const today = localMidnight(nowMs, tzOffset);
  for (let k = 0; k <= 8; k += 1) {
    boundariesOn(sc, today - k * DAY_MS, tzOffset).forEach((b) => {
      if (b <= nowMs && (best == null || b > best)) best = b;
    });
  }
  return best;
}

export const WORK_STATUSES = ["ready", "break", "off", "busy"];
export const statusIdOf = (v) => (WORK_STATUSES.includes(String(v || "")) ? String(v) : "ready");

/** Статус человека прямо сейчас: выбранный или по графику. */
export function liveStatus(user = {}, nowMs = Date.now(), tzOffset = 0) {
  const chosen = statusIdOf(user.status);
  const w = inWorkTime(user, nowMs, tzOffset);
  if (w == null) return chosen;
  const at = Date.parse(user.statusAt || "");
  const b = lastBoundary(user, nowMs, tzOffset);
  // Выбор после последней смены по графику — приоритетнее графика.
  if (Number.isFinite(at) && b != null && at >= b && at <= nowMs + MINUTE) return chosen;
  return w ? "ready" : "off";
}
