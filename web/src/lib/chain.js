/* ════════════════════════════════════════════════════════════════
   ЦЕПОЧКА · что случится с этим ресурсом дальше

   Отчёт отвечает на вопрос, которого в модели до сих пор не было. Модель
   считает «куда придёт система вообще»; цель считает обратное — «что надо
   сделать, чтобы дойти». А здесь третий вопрос, и он про КОНКРЕТНУЮ ВЕЩЬ:

     вот это техническое задание — что с ним будет дальше, до какого звена,
     сколько это займёт, что при этом родится и что уже сделано.

   Поэтому счёт идёт ВПЕРЁД, от ресурса. Цель разворачивается назад, от
   желаемого к работе; здесь наоборот — от того, что уже лежит на столе, к
   тому, во что оно превратится. Взять для этого `solve()` было нельзя: он
   отвечает на другой вопрос и молчит о том, что случится с лишним.

   ─── что такое звено ───

   Цепочка чередуется: ресурс → функция → ресурс → функция. «Звено» — это
   место, на котором человек просит остановиться: либо ресурс («до готового
   сайта»), либо функция («до вёрстки»). Ресурс-звено закрывает цепочку на
   себе, функция-звено входит в неё последней. Без звена прослеживается всё,
   до чего цепочка дотягивается.

   ─── почему две оценки, а не одна ───

   ПРЕДВАРИТЕЛЬНАЯ считается по вилкам функций: сколько берут, сколько
   выдают, сколько времени уходит. Она вилка и сама — «от и до», потому что
   вилками задана. ФАКТИЧЕСКАЯ берётся из принятых сдач и ничего не
   предполагает. Держать их рядом и раздельно — единственный способ увидеть,
   где план разошёлся с делом; одно число вместо двух скрыло бы ровно это.
   ════════════════════════════════════════════════════════════════ */

import { factorChance, factorsOf, hoursOf, isFactor, portSpends } from "./funcs.js";
import { portQty, stepHours } from "./plan.js";

const num = (v) => Number(v) || 0;

/**
 * Цепочка от ресурса до звена.
 *
 * Идёт вперёд по слоям: ресурс → те функции, которые его берут → то, что
 * они выдают → и так дальше. Функция входит в цепочку один раз, сколько бы
 * её входов в ней ни оказалось: она одна и та же работа.
 *
 * @param from  ресурс, с которого начинаем
 * @param upto  звено, на котором останавливаемся: ресурс или функция.
 *              Пусто — до конца, докуда дотянется.
 */
export function chainOf(model = {}, { from, upto = "" } = {}) {
  const funcs = model.funcs || [];
  const out = { from: from || "", upto: upto || "", traits: [], steps: [], ok: false };
  if (!from || !funcs.length) return out;

  const traits = [from];
  const seen = new Set([from]);
  const stepIds = [];
  const queue = [from];
  let reached = !upto;

  while (queue.length) {
    const t = queue.shift();
    // Ресурс-звено закрывает цепочку на себе: дальше него не прослеживаем.
    if (t === upto) { reached = true; continue; }
    funcs.forEach((f) => {
      if (stepIds.includes(f.id)) return;
      if (!(f.takes || []).some((p) => p.trait === t)) return;
      stepIds.push(f.id);
      // Функция-звено входит в цепочку последней: её саму человек и просил.
      if (f.id === upto) { reached = true; return; }
      (f.gives || []).forEach((g) => {
        if (!g.trait || seen.has(g.trait)) return;
        seen.add(g.trait);
        traits.push(g.trait);
        queue.push(g.trait);
      });
    });
  }

  out.traits = traits;
  out.steps = stepIds.map((id) => funcs.find((f) => f.id === id)).filter(Boolean);
  // Дошли ли до звена вообще: не дошли — значит цепочка обрывается раньше,
  // и молчать об этом нельзя.
  out.ok = reached;
  return out;
}

/* ─────── правки вилок в отчёте ───────

   Отчёт нужен для ПРОГНОЗИРОВАНИЯ: «а если дизайн займёт не день, а три?
   а если из одного договора выйдет не один заказ, а два?». Ответ на такой
   вопрос требует поменять числа — но менять ради него саму модель нельзя:
   прикидка одного раздела стала бы правдой для всей схемы, и соседний
   отчёт, который её не просил, посчитался бы по чужому допущению.

   Поэтому правки живут в разделе (`tweaks`) и накладываются на функцию
   ЗДЕСЬ, при счёте. Не сказано ничего — функция берётся как есть; сказано
   про одну вилку — меняется только она. */
export function tweaked(f, tweak) {
  if (!f || !tweak) return f;
  const num2 = (v, dflt) => (v == null || v === "" ? dflt : num(v));
  const port = (p, over) => (over
    ? { ...p, lo: num2(over.lo, p.lo), hi: num2(over.hi, p.hi) } : p);
  return {
    ...f,
    dur: num2(tweak.dur, f.dur),
    durHi: num2(tweak.durHi, f.durHi),
    durUnit: tweak.durUnit || f.durUnit,
    takes: (f.takes || []).map((p) => port(p, tweak.takes?.[p.trait])),
    gives: (f.gives || []).map((p) => port(p, tweak.gives?.[p.trait])),
  };
}

/**
 * Предварительная оценка одной стороны вилки.
 *
 * Считает, сколько раз сработает каждая функция цепочки, если пустить в неё
 * `qty` единиц начального ресурса, — и что из этого выйдет по времени и по
 * ресурсам.
 *
 * Выполнение целое: половины выполнения не бывает, поэтому число выполнений
 * округляется вверх. Входы, которых в цепочке нет, работу не сдерживают —
 * они приходят со стороны; но и умалчивать о них нельзя, поэтому они
 * собираются в `need`.
 */
export function estimate(model = {}, chain = {},
  { side = "hi", runsOf, qty = 1, tweaks = {} } = {}) {
  const runs = (f) => (runsOf ? runsOf(f.id) : []);
  const inChain = new Set(chain.traits || []);
  const flow = { [chain.from]: num(qty) };
  const delta = {};
  const need = {};
  const startAt = {};             // когда функция может начаться, в часах
  const ready = { [chain.from]: 0 };   // когда ресурс появится
  const steps = [];

  (chain.steps || []).forEach((raw) => {
    // Правки раздела накладываются на функцию только для этого счёта:
    // сама модель остаётся такой, какой её собрали.
    const f = tweaked(raw, tweaks[raw.id]);
    const rs = runs(f);
    const takes = (f.takes || []).filter((p) => p.trait);
    /* Сколько раз функция сработает: столько, на сколько хватает самого
       дефицитного её входа ИЗ ЦЕПОЧКИ. Вход со стороны не ограничивает —
       он приходит не отсюда. */
    let n = Infinity;
    takes.forEach((p) => {
      const per = portQty(p, { kind: "takes", side, runs: rs });
      if (!(per > 0)) return;
      if (!inChain.has(p.trait)) return;
      n = Math.min(n, (flow[p.trait] || 0) / per);
    });
    n = n === Infinity ? num(qty) : n;
    n = Math.max(0, Math.ceil(n - 1e-9));
    if (!(n > 0)) return;

    // Начинается не раньше, чем созреют её входы из цепочки.
    const start = takes.reduce((m, p) => (inChain.has(p.trait)
      ? Math.max(m, ready[p.trait] ?? 0) : m), 0);
    const per = stepHours(f, rs, side);
    const calendar = per * n;
    startAt[f.id] = start;

    const usedIn = [];
    takes.forEach((p) => {
      const per1 = portQty(p, { kind: "takes", side, runs: rs });
      const all = per1 * n;
      usedIn.push({ trait: p.trait, qty: all, spend: portSpends(p),
        outside: !inChain.has(p.trait) });
      if (!inChain.has(p.trait)) { need[p.trait] = (need[p.trait] || 0) + all; return; }
      // Расходуемое исчезает; обработанное остаётся на месте.
      if (portSpends(p)) {
        flow[p.trait] = Math.max(0, (flow[p.trait] || 0) - all);
        delta[p.trait] = (delta[p.trait] || 0) - all;
      }
    });

    const madeOut = [];
    (f.gives || []).forEach((g) => {
      if (!g.trait) return;
      const all = portQty(g, { kind: "gives", side, runs: rs }) * n;
      madeOut.push({ trait: g.trait, qty: all });
      flow[g.trait] = (flow[g.trait] || 0) + all;
      delta[g.trait] = (delta[g.trait] || 0) + all;
      // Появится не раньше, чем функция закончит.
      ready[g.trait] = Math.max(ready[g.trait] ?? 0, start + calendar);
    });

    steps.push({
      func: f.id,
      name: f.name || "без названия",
      e: f.e,
      factor: isFactor(f),
      runs: n,
      startHours: start,
      calendarHours: calendar,
      // Часы фактора не человеко-часы: он происходит сам, и ничьё время
      // не тратит. Ждать его при этом всё равно приходится.
      workHours: isFactor(f) ? 0 : (hoursOf(f, side === "hi" ? "lo" : "hi") * n),
      takes: usedIn,
      gives: madeOut,
    });
  });

  return {
    steps,
    delta,
    need,
    workHours: steps.reduce((s, x) => s + x.workHours, 0),
    // Календарный срок — по самой длинной ветке, а не сумма: не связанные
    // друг с другом функции идут разом.
    calendarHours: steps.reduce((m, x) => Math.max(m, x.startHours + x.calendarHours), 0),
  };
}

/**
 * Предварительная оценка обеими сторонами вилки.
 *
 * Одно число здесь было бы обещанием, которого никто не давал: сколько
 * выйдет и сколько займёт, задано вилками — вилкой и остаётся.
 */
export function estimateRange(model, chain, { runsOf, qty = 1, tweaks = {} } = {}) {
  return {
    lo: estimate(model, chain, { side: "lo", runsOf, qty, tweaks }),
    hi: estimate(model, chain, { side: "hi", runsOf, qty, tweaks }),
  };
}

/**
 * Факторы, которые на цепочку влияют.
 *
 * Фактор — то, что меняет ресурсы без человека. Если он трогает хоть один
 * ресурс цепочки, он на неё влияет, и умолчать о нём — значит выдать
 * оценку за твёрдую там, где она зависит от погоды.
 */
export function factorsIn(model = {}, chain = {}) {
  const inChain = new Set(chain.traits || []);
  const list = model.factors || [];
  return (model.funcs || [])
    .filter((f) => isFactor(f))
    .map((f) => {
      const touches = [
        ...(f.takes || []).map((p) => p.trait),
        ...(f.gives || []).map((g) => g.trait),
      ].filter((t) => t && inChain.has(t));
      if (!touches.length) return null;
      const own = factorsOf(f).map((id) => list.find((x) => x.id === id))
        .filter(Boolean)
        .map((x) => ({ id: x.id, name: x.name || "без названия", chance: factorChance(x) }));
      return { func: f.id, name: f.name || "без названия", traits: [...new Set(touches)], factors: own };
    })
    .filter(Boolean);
}

/**
 * Фактическая оценка: что уже сделано по функциям цепочки.
 *
 * Только принятые сдачи идут в числа: непринятая — заявление исполнителя, а
 * не измерение. Но задачи, которые ещё в работе, из виду не пропадают: они
 * и есть ответ на вопрос «сколько осталось».
 */
export function actualOf({ tasks = [], funcs = [] } = {}, chain = {}, { only } = {}) {
  const ids = new Set((chain.steps || []).map((f) => f.id));
  /* `only` — задачи родословной выбранной единицы. Когда он задан, цепочка
     на отбор не влияет: единица — сама точка отсчёта, и работа, которая её
     СДЕЛАЛА, лежит до цепочки, а не в ней. Отсеять её по цепочке значило бы
     выбросить из отчёта о вещи ту работу, в которой вещь и родилась. */
  const mine = only
    ? tasks.filter((t) => only.has(t.id))
    : tasks.filter((t) => ids.has(t.funcId));
  const done = mine.filter((t) => t.status === "done");
  const last = (t) => {
    const s = t.submissions || [];
    return s.length ? s[s.length - 1] : null;
  };
  const delta = {};
  let hours = 0;
  done.forEach((t) => {
    const sb = last(t);
    if (!sb) return;
    hours += num(sb.hours);
    Object.entries(sb.takes || {}).forEach(([id, v]) => {
      // Вычитается только израсходованное: обработанное осталось на месте.
      const f = funcs.find((x) => x.id === t.funcId);
      const port = (f?.takes || []).find((p) => p.trait === id);
      if (port && !portSpends(port)) return;
      delta[id] = (delta[id] || 0) - num(v);
    });
    Object.entries(sb.gives || {}).forEach(([id, v]) => {
      delta[id] = (delta[id] || 0) + num(v);
    });
  });
  return {
    tasks: mine,
    done: done.length,
    total: mine.length,
    hours: Math.round(hours * 10) / 10,
    delta,
    // Есть ли вообще что показывать как факт: без принятых сдач числа
    // сложились бы в ноль, а ноль читался бы как «сделано и вышло ничего».
    any: done.length > 0,
  };
}
