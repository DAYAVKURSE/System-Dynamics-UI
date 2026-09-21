/* ════════════════════════════════════════════════════════════════
   ПЛАНЫ И СПОСОБЫ ОПЛАТЫ

   Планы правит владелец в админ-панели (владелец, 2026-09-21): название,
   стоимость (в долларах в месяц-срок), срок в днях и ВКЛАДКИ — какие
   разделы приложения план открывает (владелец, 2026-09-21: «на планах
   должно выбираться, какие вкладки они открывают»). Список вкладок едет
   в токен и оттуда — в приложение. Уровень (free/pro/max) остаётся: он
   даёт вкладки по умолчанию новому плану и отличает бесплатный план.

   Способы оплаты — те, для которых не нужны ни юрлицо, ни проверка
   личности: Telegram Stars, TON и USDT (jetton на TON) на свой
   кошелёк. Цена плана в долларах пересчитывается в валюту способа:
   Stars — по курсу владельца («звёзд за доллар»), TON — по курсу рынка,
   USDT — один к одному.
   ════════════════════════════════════════════════════════════════ */
export const LEVELS = ["free", "pro", "max"];
/* Вкладки приложения — тот же список, что `server/src/lib/orgStore.js`
   TABS и `web/src/identity.js` ALL_TABS; расходиться им нельзя. */
export const TABS = ["market", "me", "tasks", "review",
  "scheme", "scheme:edit", "scheme:time", "scheme:sim",
  "reports",
  "tools", "tools:people", "tools:assistant", "tools:virtual", "tools:reminders",
  "tools:calls", "tools:issues", "tools:export"];
export const TAB_NAMES = {
  market: "Маркет", me: "Анкета",
  tasks: "Задачи", review: "Проверка", scheme: "Схема",
  "scheme:edit": "Управление", "scheme:time": "Деятельность", "scheme:sim": "Цели",
  reports: "Отчёты", tools: "Инструменты",
  "tools:people": "Роли", "tools:assistant": "Агенты",
  "tools:virtual": "Виртуальные сотрудники",
  "tools:reminders": "Напоминания", "tools:calls": "Звонки",
  "tools:issues": "Issues", "tools:export": "Выгрузка",
};
/* Что открывает уровень по умолчанию — для планов, у которых вкладки ещё
   не выбирали, и для новых. */
const inOrder = (list) => TABS.filter((t) => list.includes(t));
export const LEVEL_TABS = {
  free: inOrder(["me", "market", "tasks"]),
  pro: inOrder(["me", "market", "tasks", "review", "tools", "tools:calls", "tools:assistant"]),
  max: [...TABS],
};
/** Список вкладок в порядке приложения; неизвестные — вон; у вложенной
 *  («tools:calls») всегда есть родитель («tools») — иначе до неё не дойти.
 *  Не список — null: значит, вкладки не задавали. */
export function tabsOf(v) {
  if (!Array.isArray(v)) return null;
  const set = new Set(v.map(String).filter((t) => TABS.includes(t)));
  [...set].forEach((t) => { if (t.includes(":")) set.add(t.split(":")[0]); });
  return TABS.filter((t) => set.has(t));
}
export const DEFAULT_PLANS = [
  { id: "free", name: "Free", price: 0, days: 0, level: "free", tabs: [...LEVEL_TABS.free] },
  { id: "pro", name: "Pro", price: 10, days: 30, level: "pro", tabs: [...LEVEL_TABS.pro] },
  { id: "max", name: "Max", price: 30, days: 30, level: "max", tabs: [...LEVEL_TABS.max] },
];
export const METHODS = ["stars", "ton", "usdt"];
export const CURRENCY = { stars: "XTR", ton: "TON", usdt: "USDT" };
export const STARS_PER_USD_DEFAULT = 50;

export const levelOf = (v) => (LEVELS.includes(String(v)) ? String(v) : null);
export const methodOf = (v) => (METHODS.includes(String(v)) ? String(v) : null);

export const cleanPlan = (p = {}, was = {}) => {
  const price = Number(p.price);
  const days = Number(p.days);
  const level = levelOf(p.level) || was.level || "pro";
  return {
    id: String(was.id || p.id || ""),
    name: String(p.name ?? was.name ?? "").trim().slice(0, 60) || "новый план",
    price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : (was.price ?? 0),
    days: Number.isFinite(days) && days >= 0 ? Math.round(days) : (was.days ?? 30),
    level,
    tabs: tabsOf(p.tabs) || tabsOf(was.tabs) || [...LEVEL_TABS[level]],
  };
};
