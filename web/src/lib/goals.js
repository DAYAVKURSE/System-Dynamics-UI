/* ════════════════════════════════════════════════════════════════
   ЦЕЛЬ

   Цель ушла с ресурса. Прежде она была его полем — «сколько нужно», —
   и этим сама себя обедняла: у поля есть только число. А у цели, которую
   человек ставит на самом деле, есть ещё три вещи, и без них она не цель,
   а пожелание:

   · **темп** — «один клиент в неделю» это не то же самое, что «один
     клиент»: первое надо держать, второе — получить один раз;
   · **срок** — не «когда-нибудь», а через месяц или к названному числу.
     Причём срок относится к выходу НА темп, а не к первому результату:
     «хочу прийти к этому через месяц» значит, что через месяц темп должен
     держаться, а не что через месяц будет один клиент;
   · **цена** — сколько при этом уйдёт времени и других ресурсов. Цель без
     цены сравнивать не с чем: любая достижима, если не считать, чем.

   ─── что здесь считается ───

   Из темпа выходит, сколько ресурса нужно в месяц. Из модели (`solve`) —
   сколько для этого выполнений каких функций и сколько это человеко-часов.
   Из бюджета времени — сколько часов человек готов тратить. Дальше три
   вопроса, на которые расчёт обязан ответить прямо:

   · **влезает ли работа в бюджет** — и если нет, сколько часов не хватает;
   · **успевает ли к сроку** — календарный срок одной цепочки против того,
     сколько времени осталось;
   · **держится ли темп** — цикл длиннее периода означает, что «раз в
     неделю» не выйдет, сколько ни старайся: результат просто не успевает
     созреть.

   ─── дни недели ───

   Дни — не украшение. «Час в день» по будням это пять часов в неделю, а
   не семь: бюджет считается по выбранным дням. Пусто — значит все дни.

   ─── чего здесь нет ───

   Здесь не хранится ни одного вычисленного числа. Цель — это намерение
   («столько, такого ресурса, к такому сроку, такой ценой»), а всё
   остальное выводится из модели. Записать сюда «нужно 40 часов» значило бы
   завести вторую правду: модель поправили, а число осталось прежним.
   ════════════════════════════════════════════════════════════════ */
import { DUR_UNITS } from "./funcs.js";
import { MONTH_H, effect, scheduleOf, solveRange } from "./plan.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Темп: получить один раз или держать столько-то за период.
 *
 * `once` — разовая цель, у неё периода нет. Остальные — уровень, который
 * надо держать; в часах, чтобы приводить к месяцу.
 */
export const RATES = [
  { id: "once", name: "разово", hours: 0 },
  { id: "day", name: "в день", hours: DUR_UNITS["дн"] },
  { id: "week", name: "в неделю", hours: DUR_UNITS["нед"] },
  { id: "month", name: "в месяц", hours: DUR_UNITS["мес"] },
];
export const rateOf = (id) => RATES.find((r) => r.id === id) || RATES[0];

/** Дни недели с понедельника: неделя начинается с рабочего дня. */
export const WEEK = [
  { id: 1, short: "пн" }, { id: 2, short: "вт" }, { id: 3, short: "ср" },
  { id: 4, short: "чт" }, { id: 5, short: "пт" }, { id: 6, short: "сб" },
  { id: 0, short: "вс" },
];

/** Куда считать срок: через столько-то или к названному числу. */
export const DUE_IN = "in";
export const DUE_ON = "on";

/** Новая цель — пустая, но не сломанная: без ресурса и без количества. */
export const newGoal = (trait = "") => ({
  id: uid("g"),
  trait,
  qty: 1,
  rate: "week",
  dueKind: DUE_IN,
  dueIn: 1,
  dueUnit: "мес",
  dueOn: "",
  days: [],
  costs: [],
  hours: 0,
  hoursPer: "day",
  // Когда цель применили. Пока не применили — это черновик: он считается,
  // но ни на графики, ни на доску задач не влияет.
  appliedAt: null,
});

/**
 * Повтор цели — ОТДЕЛЬНАЯ цель, а не второе применение прежней.
 *
 * Два применения это два разных решения: у них свои сроки, своя работа и
 * свой результат. Одной строкой в списке они сливались в неразличимую кучу
 * задач, и спросить «что дала вот эта цель» становилось нельзя ни про одну
 * из них.
 *
 * Копия заводится неприменённой: применение — отдельный шаг, и повтор не
 * должен случаться молча, одним нажатием на прежнюю строку.
 */
export const copyGoal = (goal = {}) => ({ ...goal, id: uid("g"), appliedAt: null });

/** Затрата: столько-то другого ресурса на одну цель. */
export const newCost = (trait = "", qty = 1) => ({ id: uid("c"), trait, qty: num(qty) });

/** Чужая запись достраивается до нынешней — редактор не должен падать. */
export const normalizeGoal = (g = {}) => ({
  ...g,
  id: g.id ?? uid("g"),
  trait: g.trait ?? "",
  qty: num(g.qty),
  rate: rateOf(g.rate).id,
  dueKind: g.dueKind === DUE_ON ? DUE_ON : DUE_IN,
  dueIn: num(g.dueIn),
  dueUnit: DUR_UNITS[g.dueUnit] ? g.dueUnit : "мес",
  dueOn: g.dueOn ?? "",
  days: Array.isArray(g.days) ? g.days.filter((d) => WEEK.some((w) => w.id === d)) : [],
  costs: Array.isArray(g.costs)
    ? g.costs.map((c) => ({ id: c.id ?? uid("c"), trait: c.trait ?? "", qty: num(c.qty) }))
    : [],
  hours: num(g.hours),
  hoursPer: rateOf(g.hoursPer).id === "once" ? "day" : rateOf(g.hoursPer).id,
  appliedAt: g.appliedAt || null,
});
export const normalizeGoals = (list) => (Array.isArray(list) ? list.map(normalizeGoal) : []);

/**
 * Сколько ресурса нужно в месяц.
 *
 * Разовая цель месячного темпа не задаёт: её количество — это всё, что
 * нужно, а не «столько каждый месяц». Приводить её к месяцу значило бы
 * выдумать повторение, которого человек не просил.
 */
export function perMonth(goal) {
  const r = rateOf(goal.rate);
  if (!r.hours) return null;
  return num(goal.qty) * (MONTH_H / r.hours);
}

/** Сколько часов остаётся до срока. `null` — срок не задан. */
export function dueHours(goal, from = Date.now()) {
  if (goal.dueKind === DUE_ON) {
    if (!goal.dueOn) return null;
    const t = new Date(goal.dueOn).getTime();
    if (Number.isNaN(t)) return null;
    // Срок в прошлом — это ноль, а не отрицательное время: «уже вчера».
    return Math.max(0, (t - from) / 3600000);
  }
  const h = num(goal.dueIn) * (DUR_UNITS[goal.dueUnit] ?? 1);
  return h > 0 ? h : null;
}

/** Дата, к которой цель должна быть достигнута. `null` — срока нет. */
export function dueDate(goal, from = Date.now()) {
  const h = dueHours(goal, from);
  if (h == null) return null;
  return new Date(goal.dueKind === DUE_ON ? new Date(goal.dueOn).getTime()
    : from + h * 3600000);
}

/** Сколько дней в неделю человек работает по этой цели. */
export const workDays = (goal) => (goal.days?.length ? goal.days.length : 7);

/**
 * Бюджет времени в месяц. `null` — не задан.
 *
 * Дни недели тут и работают: «час в день» по будням — это пять часов в
 * неделю, а не семь. Считать все семь значило бы пообещать за человека
 * выходные, которых он не отдавал.
 */
export function budgetHours(goal) {
  const h = num(goal.hours);
  if (h <= 0) return null;
  if (goal.hoursPer === "day") {
    return h * workDays(goal) * (MONTH_H / DUR_UNITS["нед"]);
  }
  if (goal.hoursPer === "week") return h * (MONTH_H / DUR_UNITS["нед"]);
  return h;
}

/** Цель словами: «1 клиент в неделю · через 1 мес · 1 ч в день». */
export function goalText(goal, traitName) {
  const r = rateOf(goal.rate);
  const parts = [`${goal.qty} ${traitName ? traitName(goal.trait) : ""}`.trim()
    + (r.hours ? ` ${r.name}` : "")];
  if (goal.dueKind === DUE_ON && goal.dueOn) {
    parts.push(`к ${new Date(goal.dueOn).toLocaleDateString("ru-RU")}`);
  } else if (num(goal.dueIn) > 0) parts.push(`через ${goal.dueIn} ${goal.dueUnit}`);
  if (num(goal.hours) > 0) {
    parts.push(`${goal.hours} ч ${rateOf(goal.hoursPer).name}`
      + (goal.days?.length ? ` (${goal.days.length} дн/нед)` : ""));
  }
  return parts.join(" · ");
}

/** Годна ли запись цели: без ресурса и без количества считать нечего. */
export function checkGoal(goal, traits = []) {
  if (!goal?.trait || !traits.some((t) => t.id === goal.trait)) return false;
  if (!(num(goal.qty) > 0)) return false;
  return dueHours(goal) != null;
}

const scale = (plan, k) => ({
  ...plan,
  workHours: plan.workHours * k,
  runs: plan.steps.reduce((s, x) => s + x.runs, 0) * k,
});

/**
 * Что цель означает для модели: сколько работы, успеет ли, во что обойдётся.
 *
 * Возвращает и нижнюю, и верхнюю оценку — по обеим границам вилок функций.
 * Одно число здесь было бы обещанием, которого модель не даёт.
 */
export function planGoal(model, goal, { runsOf, now = Date.now() } = {}) {
  const r = rateOf(goal.rate);
  const traits = model.traits || [];
  const target = traits.find((t) => t.id === goal.trait) || null;
  const qty = num(goal.qty);
  /* Запас самой цели идёт в дело только у разовой цели: у неё цель это
     уровень, до которого надо дорасти. Темп — поток, и склад его не
     заменяет: «один клиент в неделю» надо выдавать каждую неделю, сколько
     бы их ни лежало сейчас. Запасы входов при этом считаются всегда — они
     настоящие и тратятся на самом деле. */
  const { lo, hi } = solveRange(model,
    { trait: goal.trait, want: qty, runsOf, useStock: !r.hours });
  // Разовая цель — это вся работа целиком; темп — работа за один период,
  // которую надо повторять. Приводим к месяцу, чтобы сравнить с бюджетом.
  const k = r.hours ? MONTH_H / r.hours : 1;
  const due = dueHours(goal, now);
  const budget = budgetHours(goal);
  // Разовая работа сравнивается с бюджетом за весь срок, темп — с месячным.
  const budgetAll = budget == null ? null
    : (r.hours ? budget : budget * ((due ?? 0) / MONTH_H));
  const ok = hi.ok || lo.ok;
  /* Считать по стороне, которая не сходится, нельзя: её ноль — это не «ноль
     работы», а «так цель не выходит вовсе». Когда сходится только одна
     сторона, обе границы берутся с неё, а про вторую сказано отдельно —
     см. `oneSided`. Показать её ноль как нижнюю границу значило бы
     пообещать, что работы может не быть совсем. */
  const best = hi.ok ? hi : lo;
  const sure = lo.ok ? lo : hi;
  const workAll = { lo: sure.workHours * k, hi: best.workHours * k };
  return {
    trait: target,
    qty,
    rate: r,
    perMonth: perMonth(goal),
    lo: scale(sure, k),
    hi: scale(best, k),
    ok,
    // Сошлась только одна сторона вилки — вторую показывать нечем.
    oneSided: ok && !(hi.ok && lo.ok),
    sureOk: lo.ok,
    missing: hi.missing.length ? hi.missing : lo.missing,
    looped: hi.looped && lo.looped,
    // Работа: за месяц для темпа, всего — для разовой цели.
    work: workAll,
    budget: budgetAll,
    // Влезает ли по самой щедрой оценке; не влезает совсем — по осторожной.
    fits: budgetAll == null ? null : workAll.hi <= budgetAll + 1e-9,
    fitsSure: budgetAll == null ? null : workAll.lo <= budgetAll + 1e-9,
    due,
    dueOn: dueDate(goal, now),
    // Успевает ли первый результат к сроку.
    ready: due == null ? null : best.criticalHours <= due + 1e-9,
    readyHours: best.criticalHours,
    // Держится ли темп: цикл длиннее периода — «раз в неделю» не выйдет.
    cycle: r.hours ? best.criticalHours <= r.hours + 1e-9 : null,
    // Заявленная цена против посчитанной по модели.
    costs: (goal.costs || []).map((c) => ({
      ...c,
      name: traits.find((t) => t.id === c.trait)?.l || "ресурс удалён",
      real: (best.spent?.[c.trait] ?? 0) * k,
    })),
    /* Что план сделает с ресурсами и во что превратится на доске задач.
       Считается по щедрой стороне, если она сходится: план ведут по той же
       стороне, по которой считают работу, иначе числа в одной форме
       говорили бы о разных мирах. */
    effect: effect(model, best.steps, { side: hi.ok ? "hi" : "lo", runsOf }),
    schedule: scheduleOf(best.steps, { from: now }),
    steps: best.steps,
    // Чего модель тратит сверх названного человеком.
    extra: Object.entries(best.spent || {})
      .filter(([id]) => id !== goal.trait && !(goal.costs || []).some((c) => c.trait === id))
      .map(([id, v]) => ({ trait: id, name: traits.find((t) => t.id === id)?.l || id,
        real: v * k }))
      .filter((x) => x.real > 1e-9),
  };
}


/**
 * Сколько выполнений какой функции требуют ПРИМЕНЁННЫЕ цели.
 *
 * Это и есть то, из чего теперь считается прогноз. Функция сама по себе не
 * повторяется — она работа; повторяется она ровно настолько, насколько её
 * просят цели, и не быстрее собственного потолка.
 *
 * Два вида нагрузки, и их нельзя складывать:
 *
 * · `perMonth` — цель с темпом: столько выполнений КАЖДЫЙ месяц, пока цель
 *   стоит;
 * · `once` — разовая цель: столько выполнений ВСЕГО, один раз.
 *
 * Неприменённые цели не считаются вовсе: пока цель не применена, это
 * прикидка, и двигать ею графики значило бы выдать намерение за решение.
 */
export function goalRuns(model, goals = [], { runsOf, side = "hi" } = {}) {
  const perMonth = {};
  const once = {};
  (goals || []).forEach((g) => {
    if (!g?.appliedAt) return;
    const r = rateOf(g.rate);
    const qty = num(g.qty);
    if (!(qty > 0) || !g.trait) return;
    const { lo, hi } = solveRange(model,
      { trait: g.trait, want: qty, runsOf, useStock: !r.hours });
    // Осторожная сторона требует больше выполнений: у неё функция выдаёт по
    // нижней границе. Берём ту, что сходится.
    const use = side === "lo" ? (lo.ok ? lo : hi) : (hi.ok ? hi : lo);
    if (!use.ok) return;
    const into = r.hours ? perMonth : once;
    const k = r.hours ? MONTH_H / r.hours : 1;
    use.steps.forEach((st) => {
      into[st.func] = (into[st.func] || 0) + st.runs * k;
    });
  });
  return { perMonth, once };
}


/**
 * Последовательность действий: что за чем придётся сделать.
 *
 * Шаги плана, разложенные по порядку начала. Функция не начинается раньше,
 * чем созреют её входы (`startHours`), поэтому порядок здесь — не список
 * дел вперемешку, а именно очередь: первое, второе, третье.
 *
 * Отдельной функцией, а не сортировкой на месте, потому что порядок нужен
 * в двух местах — в форме цели и в общем прогнозе, — и разъехаться они не
 * должны.
 */
export function actionsOf(plan) {
  return [...(plan?.steps || [])]
    .sort((a, b) => (a.startHours - b.startHours) || (b.runs - a.runs))
    .map((st, i) => ({ ...st, no: i + 1 }));
}

/**
 * Что будет с целевым ресурсом, если выполнить отмеченные шаги.
 *
 * Не прогноз во времени, а прямой ответ на вопрос «докуда дойдём, если
 * сделаем вот это»: сколько целевого ресурса прибавится и хватит ли этого.
 * Полезно ровно тем, что человек сам выбирает, во что верит: отмечает то,
 * что точно сделает, и видит, добирает ли до цели.
 */
export function ifDone(model, goal, plan, chosen = []) {
  const set = new Set(chosen);
  const funcs = model.funcs || [];
  const qty = num(goal?.qty);
  let add = 0;
  (plan?.steps || []).forEach((st) => {
    if (!set.has(st.func)) return;
    const f = funcs.find((x) => x.id === st.func);
    if (!f) return;
    f.gives.filter((g) => g.trait === goal.trait).forEach((g) => {
      add += ((num(g.hi) || num(g.lo)) * st.runs);
    });
  });
  const have = num((model.traits || []).find((t) => t.id === goal.trait)?.have);
  const rate = rateOf(goal.rate);
  return { add, have, after: have + add, want: qty, rate,
    enough: rate.hours ? add + 1e-9 >= qty : have + add + 1e-9 >= qty };
}
