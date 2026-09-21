/* ════════════════════════════════════════════════════════════════
   ПЛАНЫ · что открывает каждый (владелец, 2026-09-21)

   free — анкета, рынок услуг, задачи;
   pro  — то же + проверка; в инструментах — звонки и агенты;
   max  — всё.

   Вкладки роли, которых нет в плане, не прячутся, а гаснут. Тот же
   список — на сервере (`server/src/lib/plans.js`).
   ════════════════════════════════════════════════════════════════ */
import { ALL_TABS } from "./identity.js";

/* Уровни — что открывает план. Сами планы (название, цена, срок) —
   с сервера (`fetchPlans` в codes.js): их правит владелец; здесь — то,
   с чем приложение живёт до ответа сервера. */
export const PLANS = ["free", "pro", "max"];
export const PLAN_NAMES = { free: "Free", pro: "Pro", max: "Max" };
export const DEFAULT_PLANS = [
  { id: "free", name: "Free", price: 0, days: 0, level: "free" },
  { id: "pro", name: "Pro", price: 10, days: 30, level: "pro" },
  { id: "max", name: "Max", price: 30, days: 30, level: "max" },
];
export const PRICE = { free: 0, pro: 10, max: 30 };
export const METHODS = ["stars", "ton", "usdt"];
export const METHOD_NAMES = { usdt: "USDT (TON)", ton: "TON", stars: "Telegram Stars" };
const inOrder = (list) => ALL_TABS.filter((t) => list.includes(t));
export const PLAN_TABS = {
  free: inOrder(["me", "market", "tasks"]),
  pro: inOrder(["me", "market", "tasks", "review", "tools", "tools:calls", "tools:assistant"]),
  max: [...ALL_TABS],
};
export const planOf = (v) => (PLANS.includes(String(v)) ? String(v) : null);
/** Открывает ли план вкладку. Без плана (сервис кодов выключен) — всё. */
export const planAllows = (plan, tab) => {
  const p = planOf(plan);
  if (!p) return true;
  return PLAN_TABS[p].includes(String(tab));
};
/** Что открывает план: список вкладок, выбранный владельцем в панели, а
 *  без него — по уровню. */
export const planTabsOf = (p = {}) => (Array.isArray(p.tabs) ? p.tabs
  : (PLAN_TABS[p.level] || PLAN_TABS.free));
/** Погашена ли вкладка для этого человека: есть у роли, нет у плана.
 *  Сервер присылает `planTabs` из токена (вкладки плана, как их выбрал
 *  владелец); нет — по уровню. */
export const tabLocked = (me, tab) => {
  if (!me || me.solo || !me.plan) return false;
  if (Array.isArray(me.planTabs)) return !me.planTabs.includes(String(tab));
  return !planAllows(me.plan, tab);
};
