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

import { factorChance, factorsOf, hoursOf, isFactor, parOf, portSpends } from "./funcs.js";
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
  { side = "hi", runsOf, qty = 1 } = {}) {
  const runs = (f) => (runsOf ? runsOf(f.id) : []);
  const inChain = new Set(chain.traits || []);
  const flow = { [chain.from]: num(qty) };
  const delta = {};
  const need = {};
  const startAt = {};             // когда функция может начаться, в часах
  /* Кто израсходовал ресурс. Нужно ровно для одного ответа: «не хватает
     контактов лида» без продолжения «их израсходовал созвон» оставляет
     человека гадать, куда они делись. */
  const spentBy = {};
  const ready = { [chain.from]: 0 };   // когда ресурс появится
  const steps = [];

  /* ─── порядок счёта: сперва то, что даёт, потом то, что берёт ───

     Цепочка собирается слоями и кладёт функцию в список, как только достигнут
     ХОТЬ ОДИН её вход. Но у функции входов бывает несколько, из разной
     глубины: «передать заказ разработчикам» берёт и договор, и контакты
     лида. Считать её в том порядке, в каком она попала в список, значит
     спросить о договоре раньше, чем его кто-то сделал, — и получить ноль
     выполнений.

     Поэтому здесь очередь строится заново: следующей считается та функция,
     все входы которой ИЗ ЦЕПОЧКИ уже кто-то выдал. Кольцо (ни один вход не
     готов) очередь не подвешивает — остаток считается как есть, и то, чего
     не хватило, будет названо вслух ниже. */
  const ready0 = new Set([chain.from]);
  const rest = [...(chain.steps || [])];
  const order = [];
  for (let guard = rest.length; rest.length && guard >= 0; guard -= 1) {
    const i = rest.findIndex((f) => (f.takes || []).every((p) => !p.trait
      || !inChain.has(p.trait) || ready0.has(p.trait)));
    if (i < 0) break;
    const [f] = rest.splice(i, 1);
    order.push(f);
    (f.gives || []).forEach((g) => { if (g.trait) ready0.add(g.trait); });
  }
  order.push(...rest);

  order.forEach((f) => {
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

    /* ─── шаг, который не выполнится, не исчезает ───

       Раньше такой шаг просто пропускался, и вместе с ним пропадало всё, что
       шло после него: отчёт про цепочку из четырёх звеньев показывал одну
       задачу и молчал о причине. Молчание тут хуже всего — человек видит
       обрубок и не знает, у него модель такая или программа врёт.

       Поэтому шаг остаётся в списке с нулём выполнений, и рядом названо, чего
       не хватило. Ресурсов он при этом не трогает: чего не было, то не
       израсходовано, и выдать он тоже ничего не мог. */
    if (!(n > 0)) {
      const short = takes
        .filter((p) => inChain.has(p.trait)
          && portQty(p, { kind: "takes", side, runs: rs }) > (flow[p.trait] || 0))
        .map((p) => p.trait);
      steps.push({
        func: f.id,
        name: f.name || "без названия",
        e: f.e,
        factor: isFactor(f),
        runs: 0,
        par: parOf(f),
        startHours: takes.reduce((m, p) => (inChain.has(p.trait)
          ? Math.max(m, ready[p.trait] ?? 0) : m), 0),
        calendarHours: 0,
        workHours: 0,
        takes: [],
        gives: [],
        // Чего не хватило, чтобы шаг случился. Пусто не бывает: без нехватки
        // шаг бы выполнился.
        short: (short.length ? short : takes.filter((p) => inChain.has(p.trait))
          .map((p) => p.trait)).map((id) => ({ trait: id, spentBy: spentBy[id] || "" })),
      });
      return;
    }

    // Начинается не раньше, чем созреют её входы из цепочки.
    const start = takes.reduce((m, p) => (inChain.has(p.trait)
      ? Math.max(m, ready[p.trait] ?? 0) : m), 0);
    const per = stepHours(f, rs, side);
    /* Выполнения идут волнами по `par` штук, а не строго друг за другом:
       восемь дел, которые ведут месяцами разом, занимают не восемь месяцев,
       а столько, сколько волн. Сама работа быстрее не делается — в
       человеко-часах ниже ничего не меняется. */
    const calendar = per * Math.ceil(n / parOf(f));
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
        spentBy[p.trait] = f.name || "без названия";
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
      par: parOf(f),
      short: [],
      startHours: start,
      calendarHours: calendar,
      // Часы фактора не человеко-часы: он происходит сам, и ничьё время
      // не тратит. Ждать его при этом всё равно приходится.
      /* Одно выполнение занимает 1/par времени воркера: он ведёт `par`
         таких дел разом. Считать их полными значило бы обвинить в
         восьмикратной перегрузке того, для кого настройку и завели. */
      workHours: isFactor(f) ? 0
        : (hoursOf(f, side === "hi" ? "lo" : "hi") * n) / parOf(f),
      takes: usedIn,
      gives: madeOut,
    });
  });

  return {
    steps,
    delta,
    need,
    // На сколько единиц дана оценка: без этого числа план читается как
    // «столько будет всего», и шаг с одним выполнением рядом с четырьмя
    // задачами выглядит противоречием, хотя противоречия нет.
    qty: num(qty),
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
export function estimateRange(model, chain, { runsOf, qty = 1 } = {}) {
  return {
    lo: estimate(model, chain, { side: "lo", runsOf, qty }),
    hi: estimate(model, chain, { side: "hi", runsOf, qty }),
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
  // Отменённая в факт не идёт: её результата в модели нет.
  const done = mine.filter((t) => t.status === "done" && t.canceled !== true);
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
