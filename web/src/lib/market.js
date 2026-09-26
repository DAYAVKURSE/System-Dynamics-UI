/* ════════════════════════════════════════════════════════════════
   РЫНОК УСЛУГ · чистые правила (без сервера и React)

   Заказ и услуга берут слова из функции САМИ (владелец, 2026-09-13:
   «выкладываемые заказы и услуги должны брать информацию из функций
   автоматически, но её должно быть можно изменить»): название — имя
   функции, описание — её описание, ресурсы — её «берёт»/«выдаёт» по
   именам ресурсов, срок — верхняя граница её длительности в днях. Дальше
   запись правится руками и от функции не зависит.

   Подходящие услуги к заказу — по словам: общие слова в названии,
   описании и именах ресурсов. Без сервера и без умных моделей: заказчику
   нужно увидеть «вёрстка — Вёрстка», а не угадывание смысла.
   ════════════════════════════════════════════════════════════════ */

const HOURS_PER_DAY = 24;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Имя ресурса по id — или пусто, если ресурса уже нет. */
const traitName = (traits, id) => (traits || []).find((t) => t.id === id)?.l || "";

/** Порты функции → строки «что, сколько» по именам ресурсов. */
export function rowsOf(ports = [], traits = []) {
  return (ports || []).map((p) => ({ name: traitName(traits, p.trait),
    qty: num(p.hi ?? p.lo ?? p.qty) }))
    .filter((r) => r.name);
}

/** Срок функции в днях: верхняя граница, часы → дни, до десятых. */
export function daysOf(f = {}) {
  const h = num(f.durHi) ?? num(f.dur);
  if (h == null || h <= 0) return null;
  return Math.round((h / HOURS_PER_DAY) * 10) / 10;
}

/* Текст карточки — ОЖИДАЕМЫЙ РЕЗУЛЬТАТ функции (владелец, 2026-09-20: «у
   функции должен быть ожидаемый результат, и только у неё»). Описания у
   функции больше нет; результат подходит карточке даже лучше — заказчик
   покупает то, что выйдет, а не рассказ о работе. Это лишь заготовка
   текста: в форме его правят руками. */
const funcText = (f = {}) => String(f.chain?.result || "").trim();

/** Услуга из функции: что делает, что берёт, что выдаёт, за сколько. */
export function serviceFromFunc(f = {}, { traits = [] } = {}) {
  return {
    name: String(f.name || "").trim(),
    text: funcText(f),
    takes: rowsOf(f.takes, traits),
    gives: rowsOf(f.gives, traits),
    days: daysOf(f),
    dur: daysOf(f), durUnit: "day",
    funcId: f.id || null,
  };
}

/** Заказ из функции: заказчик хочет её результат и даёт то, что она берёт. */
export function orderFromFunc(f = {}, { traits = [] } = {}) {
  return {
    name: String(f.name || "").trim(),
    text: funcText(f),
    resources: rowsOf(f.takes, traits),
    funcId: f.id || null,
    serviceId: null,
  };
}

/* ─────── подходящие услуги ─────── */

const STOP = new Set(["для", "или", "как", "что", "это", "при", "под", "над", "без", "все", "его",
  "они", "она", "оно", "мой", "наш", "ваш", "чем", "так", "тот", "эта", "эти", "the", "and", "for"]);

/** Слова текста: буквы и цифры, не короче трёх знаков, без служебных. */
export function words(text = "") {
  const out = new Set();
  String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).forEach((w) => {
    if (w.length >= 3 && !STOP.has(w)) out.add(w.length > 6 ? w.slice(0, 6) : w);
  });
  return out;
}

const rowsText = (rows = []) => (rows || []).map((r) => r.name).join(" ");

/** Сколько общих слов у заказа и услуги; ноль — не подходит. */
export function matchScore(order = {}, service = {}) {
  const a = words(`${order.name || ""} ${order.text || ""} ${rowsText(order.resources)}`);
  const b = words(`${service.name || ""} ${service.text || ""} ${rowsText(service.takes)} ${rowsText(service.gives)}`);
  let n = 0;
  a.forEach((w) => { if (b.has(w)) n += 1; });
  // Общий источник — одна функция — важнее слов: это та же работа.
  if (order.funcId && service.funcId && order.funcId === service.funcId) n += 10;
  return n;
}

/** Подходящие услуги — от самой похожей; неподходящих в списке нет. */
export function matchServices(order = {}, services = []) {
  return (services || [])
    .map((s) => ({ service: s, score: matchScore(order, s) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.service);
}

/* ─────── подписи ─────── */

export const rowText = (r) => (!r ? "" : r.qty != null ? `${r.name} × ${r.qty}` : r.name);
export const rowsLine = (rows = []) => (rows || []).map(rowText).join(", ");

export const daysText = (d) => (d == null ? "срок не назван"
  : d === 1 ? "1 день" : `${d} дн`);

/* Срок услуги — число и единица (владелец, 2026-09-21): минуты, часы,
   дни, недели, месяцы. В днях (`days`) — для сравнения и срока задачи;
   то же на сервере (marketStore.daysFrom). */
export const DUR_UNITS = [["min", "минут"], ["hour", "часов"], ["day", "дней"], ["week", "недель"], ["month", "месяцев"]];
const DAYS_PER = { min: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30 };
export const daysFrom = (dur, unit) => {
  const n = Number(dur);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * (DAYS_PER[unit] || 1) * 1000) / 1000;
};
const UNIT_SHORT = { min: "мин", hour: "ч", day: "дн", week: "нед", month: "мес" };
export const durText = (s = {}) => {
  if (s.dur != null && s.dur !== "" && Number(s.dur) > 0) return `${s.dur} ${UNIT_SHORT[s.durUnit] || "дн"}`;
  return daysText(s.days);
};

/** Новая пустая строка ресурса для формы. */
export const emptyRow = () => ({ name: "", qty: "" });
