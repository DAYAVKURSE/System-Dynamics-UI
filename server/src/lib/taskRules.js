import { withStock } from "./stock.js";

/* ════════════════════════════════════════════════════════════════
   ЧЕГО НЕ ХВАТАЕТ, ЧТОБЫ ЗАДАЧУ ПОСТАВИТЬ

   Повторено из `web/src/components/TasksBoard.jsx` (`taskGaps`,
   `whyNotSet`) и `web/src/lib/funcs.js` (`shortage`, `groupsOf`,
   `portSpends`) НАРОЧНО, как `requiredGives` в `botTasks.js`: сервер
   отдаётся отдельным пакетом (деплой копирует только `server/src`), и
   тянуть в него код фронтенда нечем. Правило одно на оба места, и
   разойтись им не даёт `taskRules.test.js` — там те же случаи, что в
   тестах фронтенда.

   Зачем оно серверу: постановку теперь пишет не только владелец, а и
   позванный постановщик (`POST /api/workspace/tasks/:id/setup`). Проверять
   её только в его окне значило бы не проверять вовсе — ответ на POST
   пишется в модель, и модель видят все.
   ════════════════════════════════════════════════════════════════ */

const num = (v) => Number(v) || 0;

/* ─────── незаполненность ───────
   Три роли обязательны и срок обязателен — без них некому работать и не
   к чему успеть. Содержимое НЕ обязательно: что за работа, уже сказано
   описанием функции. Порядок слов — как в форме. */
const ROLES = [["setter", "постановщик"], ["assignee", "исполнитель"],
  ["reviewer", "проверяющий"]];
export function taskGaps(task = {}) {
  const gaps = ROLES.filter(([f]) => task[f] == null || task[f] === "").map(([, w]) => w);
  if (!task.end) gaps.push("срок");
  return gaps;
}

/* ─────── ресурсы ───────
   «И» между группами входов, «или» внутри группы (`group` у порта):
   требования не хватает, только если не хватает всех его вариантов. */
const groupsOf = (ports = []) => {
  const by = new Map();
  ports.forEach((p) => {
    if (!p) return;
    const g = p.group || p.id;
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(p);
  });
  return [...by.values()];
};
// Вход расходуется, пока не сказано обратное; `spend: false` — только
// обрабатывает: взятое остаётся на месте, но этой функции второй раз не даётся.
const portSpends = (p = {}) => p.spend !== false;

/* Сколько единиц каждого нерасходуемого входа функция УЖЕ обработала —
   по «взято» последней сдачи её принятых задач (`heldBy` в
   `web/src/lib/units.js`). Непринятая сдача — ещё не результат. */
export function heldBy(tasks = [], f) {
  if (!f) return {};
  const all = {};
  tasks.filter((t) => t.funcId === f.id && t.status === "done").forEach((t) => {
    const subs = t.submissions || [];
    const sb = subs.length ? subs[subs.length - 1] : null;
    Object.entries(sb?.takes || {}).forEach(([trait, v]) => {
      if (num(v) > 0) all[trait] = (all[trait] || 0) + num(v);
    });
  });
  const out = {};
  (f.takes || []).filter((p) => p && !portSpends(p)).forEach((p) => {
    if (all[p.trait] != null) out[p.trait] = all[p.trait];
  });
  return out;
}

/** Нехватки по верхней границе вилки: по одной на требование, которое нечем закрыть. */
export function shortage(f, traits = [], done = {}) {
  if (!f) return [];
  const have = (id) => num(traits.find((t) => t.id === id)?.have);
  const free = (p) => (portSpends(p) ? have(p.trait)
    : Math.max(0, have(p.trait) - num(done[p.trait])));
  const name = (id) => traits.find((t) => t.id === id)?.l || "(ресурс удалён)";
  return groupsOf(f.takes || []).map((g) => {
    if (g.some((p) => free(p) >= num(p.hi || p.lo))) return null;
    // Тот вариант, которого не хватает меньше всего: он и подскажет, чего добирать.
    const best = g.reduce((a, p) => {
      const gap = num(p.hi || p.lo) - free(p);
      return a && a.gap <= gap ? a : { p, gap };
    }, null);
    return best && {
      trait: best.p.trait, name: name(best.p.trait),
      need: num(best.p.hi || best.p.lo), have: free(best.p),
      done: portSpends(best.p) ? 0 : Math.min(num(done[best.p.trait]), have(best.p.trait)),
      spend: portSpends(best.p),
    };
  }).filter(Boolean);
}

/* Числа — как в интерфейсе (`nm` в `ui.jsx`): без хвоста нулей. */
const nm = (v) => String(Math.round(num(v) * 100) / 100);

/**
 * Почему задачу нельзя поставить — словами, а не пустым отказом.
 * Пустая строка — можно. Текст тот же, что видит постановщик в форме:
 * сервер не должен отказывать словами, которых форма не показывала.
 */
export function whyNotSet(task = {}, model = {}) {
  const gaps = taskGaps(task);
  if (gaps.length) return `Не хватает: ${gaps.join(", ")}`;
  const f = (model.funcs || []).find((x) => x.id === task.funcId);
  /* «Есть» — по материалам и сдачам, а не по числу в ресурсе: то же, что
     видит постановщик в форме (`withStock` на клиенте). */
  const miss = shortage(f, withStock(model), heldBy(model.tasks || [], f));
  if (!miss.length) return "";
  return "Не хватает ресурсов: " + miss.map((x) => (x.spend
    ? `${x.name} — есть ${nm(x.have)}, нужно ${nm(x.need)}`
    : `${x.name} — необработанного ${nm(x.have)}, нужно ${nm(x.need)}`
      + (x.done ? ` (${nm(x.done)} эта функция уже обработала)` : ""))).join("; ");
}

/**
 * Кого можно назначить на задачу: воркеров актива, которому принадлежит
 * её функция. Люди — свойство актива (`crewOf` в `web/src/lib/funcs.js`:
 * `crew` плюс те, кто назначен в роли — так читаются прежние модели), и
 * чужой человек в его работе означал бы, что список воркеров ни на что
 * не влияет. Назначенные на саму функцию — тоже её актива.
 */
/**
 * Кто может ВЫПОЛНЯТЬ задачу: те, у кого её функция отмечена «может
 * выполнять» (`funcs[].owners`). Строго они — так просил владелец: задача
 * назначается только выбранным воркерам, без запасного «все воркеры».
 */
export function funcExecutors(model = {}, task = {}) {
  const f = (model.funcs || []).find((x) => x.id === task.funcId) || null;
  return new Set((Array.isArray(f?.owners) ? f.owners : [])
    .filter((id) => id != null && id !== "").map(String));
}

export function assetWorkers(model = {}, task = {}) {
  const f = (model.funcs || []).find((x) => x.id === task.funcId) || null;
  const asset = f ? (model.entities || []).find((e) => e.id === f.e) || null : null;
  const out = new Set();
  const add = (list) => (Array.isArray(list) ? list : [])
    .forEach((id) => { if (id != null && id !== "") out.add(String(id)); });
  ["crew", "setters", "owners", "reviewers"].forEach((k) => {
    add(asset?.[k]);
    add(f?.[k]);
  });
  return out;
}
