/* ════════════════════════════════════════════════════════════════
   ПЛАНЫ · что открывает каждый (владелец, 2026-09-21)

   free — анкета, рынок услуг, задачи;
   pro  — то же + проверка; в инструментах — звонки и агенты;
   max  — всё.

   Вкладки, которые есть у роли, но не у плана, не прячутся, а
   ГАСНУТ: человек видит, что есть, и что откроет следующий план. Тот
   же список — в `web/src/plans.js`; расходиться им нельзя.
   ════════════════════════════════════════════════════════════════ */
import { TABS } from "./orgStore.js";

export const PLANS = ["free", "pro", "max"];
/* В порядке вкладок приложения — как и список у плана в токене
   (codes/src/plans.js): сравнивать их можно как есть. */
const inOrder = (list) => TABS.filter((t) => list.includes(t));
export const PLAN_TABS = {
  free: inOrder(["me", "market", "tasks"]),
  pro: inOrder(["me", "market", "tasks", "review", "tools", "tools:calls", "tools:assistant"]),
  max: [...TABS],
};
export const planOf = (v) => (PLANS.includes(String(v)) ? String(v) : null);
/** Открывает ли план вкладку. Без плана (сервис кодов выключен) — всё. */
export const planAllows = (plan, tab) => {
  const p = planOf(plan);
  if (!p) return true;
  return PLAN_TABS[p].includes(String(tab));
};
