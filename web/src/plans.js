/* ════════════════════════════════════════════════════════════════
   ПЛАНЫ · что открывает каждый (владелец, 2026-09-21)

   free — анкета, рынок услуг, задачи;
   pro  — то же + проверка; в инструментах — звонки и агенты;
   max  — всё.

   Вкладки роли, которых нет в плане, не прячутся, а гаснут. Тот же
   список — на сервере (`server/src/lib/plans.js`).
   ════════════════════════════════════════════════════════════════ */
import { ALL_TABS } from "./identity.js";

export const PLANS = ["free", "pro", "max"];
export const PLAN_NAMES = { free: "Free", pro: "Pro", max: "Max" };
/* Цена в месяц, в долларах; в валюту способа оплаты пересчитывает сам
   способ. Та же таблица — в codes/src/plans.js. */
export const PRICE = { free: 0, pro: 10, max: 30 };
export const METHODS = ["usdt", "ton", "stars"];
export const METHOD_NAMES = { usdt: "USDT (TON)", ton: "TON", stars: "Telegram Stars" };
export const PLAN_TABS = {
  free: ["me", "market", "tasks"],
  pro: ["me", "market", "tasks", "review", "tools", "tools:calls", "tools:assistant"],
  max: [...ALL_TABS],
};
export const planOf = (v) => (PLANS.includes(String(v)) ? String(v) : null);
/** Открывает ли план вкладку. Без плана (сервис кодов выключен) — всё. */
export const planAllows = (plan, tab) => {
  const p = planOf(plan);
  if (!p) return true;
  return PLAN_TABS[p].includes(String(tab));
};
/** Погашена ли вкладка для этого человека: есть у роли, нет у плана. */
export const tabLocked = (me, tab) => !!me && !me.solo && !!me.plan && !planAllows(me.plan, tab);
