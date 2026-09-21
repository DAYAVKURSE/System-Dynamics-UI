/* ════════════════════════════════════════════════════════════════
   ПЛАНЫ И СПОСОБЫ ОПЛАТЫ

   Планы правит владелец в админ-панели (владелец, 2026-09-21): название,
   стоимость (в долларах в месяц-срок), срок в днях. Что именно открывает
   план в приложении, решает его УРОВЕНЬ — free, pro или max (список
   вкладок — `web/src/plans.js`, `server/src/lib/plans.js`); новый план
   получает уровень при правке.

   Способы оплаты — те, для которых не нужны ни юрлицо, ни проверка
   личности: Telegram Stars, TON и USDT (jetton на TON) на свой
   кошелёк. Цена плана в долларах пересчитывается в валюту способа:
   Stars — по курсу владельца («звёзд за доллар»), TON — по курсу рынка,
   USDT — один к одному.
   ════════════════════════════════════════════════════════════════ */
export const LEVELS = ["free", "pro", "max"];
export const DEFAULT_PLANS = [
  { id: "free", name: "Free", price: 0, days: 0, level: "free" },
  { id: "pro", name: "Pro", price: 10, days: 30, level: "pro" },
  { id: "max", name: "Max", price: 30, days: 30, level: "max" },
];
export const METHODS = ["stars", "ton", "usdt"];
export const CURRENCY = { stars: "XTR", ton: "TON", usdt: "USDT" };
export const STARS_PER_USD_DEFAULT = 50;

export const levelOf = (v) => (LEVELS.includes(String(v)) ? String(v) : null);
export const methodOf = (v) => (METHODS.includes(String(v)) ? String(v) : null);

export const cleanPlan = (p = {}, was = {}) => {
  const price = Number(p.price);
  const days = Number(p.days);
  return {
    id: String(was.id || p.id || ""),
    name: String(p.name ?? was.name ?? "").trim().slice(0, 60) || "новый план",
    price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : (was.price ?? 0),
    days: Number.isFinite(days) && days >= 0 ? Math.round(days) : (was.days ?? 30),
    level: levelOf(p.level) || was.level || "pro",
  };
};
