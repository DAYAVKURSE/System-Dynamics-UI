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
