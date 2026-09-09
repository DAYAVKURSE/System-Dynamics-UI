/* ════════════════════════════════════════════════════════════════
   СНИМОК БЛОКА КАРТЫ ОТЧЁТОВ

   То, что уходит по общей ссылке. Собирается здесь, а не на клиенте:
   клиент можно попросить показать что угодно, а наружу должно уходить
   ровно то, что владелец выбрал в блоке, — и ничего сверх того.

   Поэтому имена здесь уже развёрнуты: ресурс назван словом, человек —
   именем, функция — своим названием. Идентификаторы модели наружу не
   уходят: по ним нечего смотреть, а лишним они быть могут.

   ─── почему расчёт повторён здесь ───

   Цепочка и её оценка живут в `web/src/lib/chain.js`, и это же считается
   на экране. Здесь они повторены НАРОЧНО и в самом коротком виде: сервер
   отдаётся отдельным пакетом (деплой копирует только `server/src`), и
   тянуть в него код фронтенда нечем. Взять готовые числа у браузера
   нельзя — это ровно то, ради чего снимок и собирает сервер.

   Цена этого — два места, которые могут разойтись, и она отдана
   осознанно: расходиться им не даёт `reportsProd.test.js`, где числа
   сходятся с теми же, что проверены на фронтенде.
   ════════════════════════════════════════════════════════════════ */

const str = (v) => (v == null ? "" : String(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const childrenOf = (nodes, id) => nodes.filter((n) => n.parent === id);

/** Путь от корня до блока — по нему человек понимает, куда попал. */
export function pathOf(nodes = [], id) {
  const out = [];
  const seen = new Set();
  let cur = nodes.find((n) => n.id === id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = nodes.find((n) => n.id === cur.parent);
  }
  return out;
}

/* ─────── цепочка от ресурса до звена ─────── */

const takesTrait = (f, t) => (f.takes || []).some((p) => p.trait === t);
const spends = (p) => p.spend !== false;
const DUR = { "ч": 1, "дн": 24, "нед": 168, "мес": 730 };
const hours = (f) => {
  const k = DUR[f.durUnit] ?? 1;
  const lo = num(f.dur) * k;
  const hi = f.durHi == null ? lo : num(f.durHi) * k;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
};

/** Идёт вперёд по слоям: ресурс → те функции, что его берут → их выходы. */
function chainOf(model = {}, from, upto = "") {
  const funcs = model.funcs || [];
  if (!from || !funcs.length) return { traits: [], steps: [], ok: !upto };
  const traits = [from];
  const seen = new Set([from]);
  const ids = [];
  const queue = [from];
  let reached = !upto;
  while (queue.length) {
    const t = queue.shift();
    if (t === upto) { reached = true; continue; }
    funcs.forEach((f) => {
      if (ids.includes(f.id) || !takesTrait(f, t)) return;
      ids.push(f.id);
      if (f.id === upto) { reached = true; return; }
      (f.gives || []).forEach((g) => {
        if (!g.trait || seen.has(g.trait)) return;
        seen.add(g.trait); traits.push(g.trait); queue.push(g.trait);
      });
    });
  }
  return { traits, steps: ids.map((id) => funcs.find((f) => f.id === id)).filter(Boolean),
    ok: reached };
}

/** Имя ресурса словами: наружу уходят названия, а не идентификаторы. */
const traitLabel = (model, id) =>
  (model.traits || []).find((t) => t.id === id)?.l || "";

/** Предварительная оценка одной стороны вилки: шаги, время, изменения. */
function estimate(model, chain, side, qty) {
  const inChain = new Set(chain.traits);
  const flow = {};
  const delta = {};
  const ready = {};
  const steps = [];
  flow[chain.traits[0]] = num(qty) || 1;
  ready[chain.traits[0]] = 0;
  const per = (p, kind) => {
    const lo = num(p.lo);
    const hi = num(p.hi);
    const worst = kind === "takes" ? hi : lo;
    return side === "lo" ? worst : (kind === "takes" ? lo : hi);
  };
  /* Порядок счёта — как в приложении (`estimate` в `web/src/lib/chain.js`):
     следующей считается та функция, все входы которой ИЗ ЦЕПОЧКИ уже кто-то
     выдал. Цепочка кладёт функцию в список по первому достигнутому входу, а
     входов у неё бывает несколько из разной глубины — считать в том же
     порядке значило бы спросить о договоре раньше, чем его сделали. */
  const made = new Set([chain.traits[0]]);
  const rest = [...chain.steps];
  const order = [];
  for (let guard = rest.length; rest.length && guard >= 0; guard -= 1) {
    const i = rest.findIndex((f) => (f.takes || []).every((p) => !p.trait
      || !inChain.has(p.trait) || made.has(p.trait)));
    if (i < 0) break;
    const [f] = rest.splice(i, 1);
    order.push(f);
    (f.gives || []).forEach((g) => { if (g.trait) made.add(g.trait); });
  }
  order.push(...rest);
  const spentBy = {};

  order.forEach((f) => {
    const takes = (f.takes || []).filter((p) => p.trait);
    let n = Infinity;
    takes.forEach((p) => {
      const q = per(p, "takes");
      if (!(q > 0) || !inChain.has(p.trait)) return;
      n = Math.min(n, (flow[p.trait] || 0) / q);
    });
    n = Math.max(0, Math.ceil((n === Infinity ? (num(qty) || 1) : n) - 1e-9));
    /* Шаг, который не выполнится, из снимка не исчезает: вместе с ним
       пропадало бы и всё, что идёт за ним, и заказчик видел бы обрубок
       цепочки без единого слова о причине. */
    if (!(n > 0)) {
      steps.push({ func: f.id, name: str(f.name), runs: 0,
        factor: f.kind === "factor", par: 1, startHours: 0, calendarHours: 0,
        workHours: 0,
        short: takes.filter((p) => inChain.has(p.trait)
          && per(p, "takes") > (flow[p.trait] || 0))
          .map((p) => ({ trait: traitLabel(model, p.trait),
            spentBy: spentBy[p.trait] || "" })) });
      return;
    }
    const start = takes.reduce((m, p) => (inChain.has(p.trait)
      ? Math.max(m, ready[p.trait] ?? 0) : m), 0);
    const h = hours(f);
    const one = side === "lo" ? h.hi : h.lo;
    /* Выполнения идут волнами по `par` штук, а не строго друг за другом:
       восемь дел, которые ведут месяцами разом, занимают не восемь месяцев,
       а столько, сколько волн. Человеко-часы при этом те же — работа от
       одновременности быстрее не делается. Правило то же, что в
       приложении (`parOf` в `web/src/lib/funcs.js`): снимок обязан считать
       так же, как экран. */
    const par = Math.max(1, Math.floor(num(f.par)) || 1);
    const calendar = one * Math.ceil(n / par);
    /* Насколько двигает ресурсы САМ шаг. Раздел отчёта — это выполняемая
       функция, и набор данных у него тот же, что и у отчёта целиком: свой
       прогноз ресурсов. Из общей дельты его не достать — там сложены все
       шаги сразу. */
    const own = {};
    takes.forEach((p) => {
      if (!inChain.has(p.trait) || !spends(p)) return;
      const all = per(p, "takes") * n;
      flow[p.trait] = Math.max(0, (flow[p.trait] || 0) - all);
      delta[p.trait] = (delta[p.trait] || 0) - all;
      own[p.trait] = (own[p.trait] || 0) - all;
      spentBy[p.trait] = str(f.name);
    });
    (f.gives || []).forEach((g) => {
      if (!g.trait) return;
      const all = per(g, "gives") * n;
      flow[g.trait] = (flow[g.trait] || 0) + all;
      delta[g.trait] = (delta[g.trait] || 0) + all;
      own[g.trait] = (own[g.trait] || 0) + all;
      ready[g.trait] = Math.max(ready[g.trait] ?? 0, start + calendar);
    });
    steps.push({ func: f.id, name: str(f.name), runs: n, factor: f.kind === "factor",
      par, short: [], startHours: start, calendarHours: calendar, own,
      // Одно выполнение занимает 1/par времени воркера: он ведёт столько
      // таких дел разом. Правило то же, что в приложении.
      workHours: f.kind === "factor" ? 0 : (one * n) / par });
  });
  return { steps, delta,
    workHours: steps.reduce((a, x) => a + x.workHours, 0),
    calendarHours: steps.reduce((m, x) => Math.max(m, x.startHours + x.calendarHours), 0) };
}

/* ─────── номера единиц ───────

   Единица ресурса рождается сдачей задачи, и номер у неё — порядковый
   внутри своего ресурса, от старых к новым. Считается тем же правилом, что
   и в приложении (`web/src/lib/units.js`): снимок обязан называть вещь тем
   же номером, каким её зовут внутри, — иначе заказчик и исполнитель будут
   говорить про «задание №3» о разных заданиях. */
function unitRows(model = {}) {
  const rows = [];
  (model.tasks || []).forEach((t) => {
    const subs = t.submissions || [];
    const sb = subs.length ? subs[subs.length - 1] : null;
    if (!sb) return;
    const took = [...new Set(Object.values(sb.took || {}).flat().filter(Boolean))]
      .map(String);
    Object.entries(sb.gives || {}).forEach(([trait, v]) => {
      if (num(v) > 0) {
        rows.push({ id: `${sb.id}~${trait}`, trait, at: str(sb.at), task: t.id, took });
      }
    });
  });
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const seq = {};
  rows.forEach((r) => { seq[r.trait] = (seq[r.trait] || 0) + 1; r.no = seq[r.trait]; });
  return rows;
}

function unitNumbers(model = {}) {
  const no = {};
  unitRows(model).forEach((r) => { no[r.id] = r.no; });
  return no;
}

/** Она сама и всё, что из неё выросло. Кольцо не зацикливает. */
function familyOf(rows, id) {
  const out = [];
  const seen = new Set();
  const walk = (cur) => {
    if (!cur || seen.has(cur)) return;
    seen.add(cur);
    const self = rows.find((r) => r.id === cur);
    if (self) out.push(self);
    rows.forEach((r) => { if ((r.took || []).includes(cur)) walk(r.id); });
  };
  walk(id);
  return out;
}

/**
 * Что сделано по функциям цепочки — фактическая оценка.
 *
 * Только принятые сдачи: непринятая — это заявление исполнителя, а не
 * результат, и показывать её заказчику как сделанное нельзя.
 */
function actualOf(model, chain, only) {
  const { tasks = [], traits = [], people = [] } = model;
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "";
  const personName = (id) => people.find((p) => String(p.id) === String(id))?.name || "";
  const no = unitNumbers(model);
  /* Задачи родословной берутся как есть: единица — точка отсчёта, и
     работа, которая её сделала, лежит до цепочки, а не в ней.

     Выбраны конкретные вещи — только работа по ним: заказчик спросил про
     своё задание, и чужие выполнения тех же функций он прочитал бы как
     работу по нему. Не выбрано ничего — вопрос другой, «что вообще
     делается по этой цепочке», и отвечать на него пустотой нельзя. Правило
     то же, что в приложении (`reportOf` в `web/src/lib/reportDoc.js`):
     снимок обязан показывать ровно то же, что и экран. */
  /* Только работа по вещам этого блока. Прежде «иначе» отдавало наружу все
     выполнения функций цепочки — то есть работу над ЧУЖИМИ вещами, о
     которых заказчика никто не спрашивал: отслеживая ОДИН контакт лида, он
     видел четыре одинаковых «передать заказ разработчикам». Вещь не
     выбрана — раздел отвечает прогнозом, и работы в нём нет по существу. */
  const mine = tasks.filter((t) => only.has(t.id));
  const done = mine.filter((t) => t.status === "done");
  const delta = {};
  /* Факт по каждой функции отдельно: раздел отчёта — это функция, и рядом с
     её прогнозом ресурсов должен стоять её же факт, а не общий по цепочке. */
  const byFunc = {};
  const made = [];
  let spent = 0;
  done.forEach((t) => {
    const subs = t.submissions || [];
    const sb = subs.length ? subs[subs.length - 1] : null;
    if (!sb) return;
    spent += num(sb.hours);
    const f = (model.funcs || []).find((x) => x.id === t.funcId);
    const mineDelta = byFunc[str(t.funcId)] || (byFunc[str(t.funcId)] = {});
    Object.entries(sb.takes || {}).forEach(([id, v]) => {
      const port = (f?.takes || []).find((p) => p.trait === id);
      if (port && !spends(port)) return;
      delta[id] = (delta[id] || 0) - num(v);
      mineDelta[id] = (mineDelta[id] || 0) - num(v);
    });
    Object.entries(sb.gives || {}).forEach(([id, v]) => {
      if (!(num(v) > 0)) return;
      delta[id] = (delta[id] || 0) + num(v);
      mineDelta[id] = (mineDelta[id] || 0) + num(v);
      /* Файл ИМЕННО ЭТОЙ вещи: исполнитель прикладывает каждый выданный
         ресурс отдельно. Старый общий файл отчёта остаётся запасным — у
         сдач, сделанных до этого, других файлов нет. */
      const own = (sb.files || {})[id] || sb.file;
      made.push({ task: t.id, no: no[`${sb.id}~${id}`] ?? null, title: str(t.title),
        trait: traitName(id), qty: num(v), at: str(sb.at), by: personName(t.assignee),
        file: own && own.url
          ? { name: str(own.name), type: str(own.type), url: str(own.url) }
          : null });
    });
  });
  return {
    done: done.length,
    total: mine.length,
    hours: Math.round(spent * 10) / 10,
    delta,
    byFunc,
    made: made.sort((a, b) => (b.no || 0) - (a.no || 0)),
    tasks: mine.map((t) => {
      const subs = t.submissions || [];
      const sb = subs.length ? subs[subs.length - 1] : null;
      return { title: str(t.title), by: personName(t.assignee), func: str(t.funcId),
        start: str(t.start), end: str(t.end), status: str(t.status),
        // Часы — только у принятой работы: непринятая ещё не измерена.
        hours: t.status === "done" && sb ? num(sb.hours) : null,
        made: (made.filter((r) => r.task === t.id)) };
    }),
  };
}

export function snapshotOf(model = {}, nodeId) {
  const nodes = Array.isArray(model.reports) ? model.reports : [];
  const root = nodes.find((n) => n.id === nodeId);
  if (!root) return null;

  const traitName = (id) => (model.traits || []).find((t) => t.id === id)?.l || "";
  const funcName = (id) => (model.funcs || []).find((f) => f.id === id)?.name || "";

  /* Снаружи видно ровно то же, что и внутри: с какого ресурса раздел, до
     какого звена, предварительная оценка, шаги, созданные ресурсы и факт.
     Технического задания полем нет — его место занял сам ресурс. */
  const rows = unitRows(model);
  const block = (n) => {
    const chain = chainOf(model, n.trait, n.upto);
    /* Выбранные единицы читаются так же, как в приложении: прежняя запись с
       одной единицей — это список из одного. Сколько выбрано, на столько и
       оценка; не выбрано ничего — на заданное число гипотетических. */
    const picked = [...new Set([
      ...(Array.isArray(n.units) ? n.units.map(str) : []),
      ...(n.unit ? [str(n.unit)] : []),
    ].filter(Boolean))];
    const qty = picked.length || n.qty;
    const lo = estimate(model, chain, "lo", qty);
    const hi = estimate(model, chain, "hi", qty);
    /* Выбрана единица — наружу уходит отчёт по НЕЙ: она сама и то, что из
       неё выросло. Родословная берётся из сдач; где её не записали, там
       остаётся одна она — догадка по датам была бы выдумкой. */
    const only = new Set(picked.flatMap((id) => familyOf(rows, id))
      .map((r) => r.task).filter(Boolean));
    const act = actualOf(model, chain, only);
    const family = picked.flatMap((id) => familyOf(rows, id));
    const self = picked.length ? rows.find((r) => r.id === picked[0]) : null;
    const ids = [...new Set([...Object.keys(hi.delta), ...Object.keys(lo.delta),
      ...Object.keys(act.delta)])];
    return {
      name: str(n.name),
      unit: self ? { no: self.no, trait: traitName(self.trait) } : null,
      units: picked.map((id) => rows.find((r) => r.id === id)).filter(Boolean)
        .map((r) => ({ no: r.no, trait: traitName(r.trait) })),
      // Вещь ещё не заведена: оценка есть, работы по ней нет и быть не может.
      hypothetical: !self,
      traced: !self || family.length > 1 || (self.took || []).length > 0,
      from: traitName(n.trait),
      upto: n.upto ? (traitName(n.upto) || funcName(n.upto)) : "",
      file: n.file && n.file.url
        ? { name: str(n.file.name), type: str(n.file.type), url: str(n.file.url) }
        : null,
      broken: Boolean(n.trait && n.upto && !chain.ok),
      /* Шаг и его работа — одно место, как и на экране: два списка рядом
         человек сводил глазами, и первым вопросом было «почему шаг один, а
         задач четыре». Порядок часов — от меньшего: щедрая сторона оценки
         считается по быстрой работе, и без сортировки выходило «674–505». */
      plan: {
        workHours: [Math.min(lo.workHours, hi.workHours),
          Math.max(lo.workHours, hi.workHours)],
        calendarHours: [Math.min(lo.calendarHours, hi.calendarHours),
          Math.max(lo.calendarHours, hi.calendarHours)],
        steps: hi.steps.map((st) => {
          const low = lo.steps.find((x) => x.func === st.func);
          const mine = act.tasks.filter((t) => t.func === st.func);
          const stMade = mine.flatMap((t) => t.made || []);
          /* Прогноз ресурсов у самого шага: взятое со знаком минус, выданное
             с плюсом. Раздел отчёта — это функция, и набор данных у него тот
             же, что и у отчёта целиком. Считать из общей дельты нельзя: там
             сложены все шаги сразу. */
          const hiD = st.own || {};
          const loD = (low && low.own) || {};
          const factD = act.byFunc[str(st.func)] || null;
          const stKeys = [...new Set([...Object.keys(hiD), ...Object.keys(loD),
            ...Object.keys(factD || {})])];
          return { ...st,
            made: stMade,
            doneCount: mine.filter((t) => t.hours != null).length,
            factHours: Math.round(mine
              .reduce((a, t) => a + num(t.hours), 0) * 10) / 10,
            changes: stKeys.map((id) => ({ trait: traitLabel(model, id),
              lo: num(loD[id]), hi: num(hiD[id]),
              fact: factD ? num(factD[id]) : null })),
            /* Якорь шага — тот же, что и в приложении (`stepAnchor` в
               `web/src/lib/reports.js`): по ссылке снаружи человек должен
               попадать в то же место, что и владелец внутри. */
            anchor: `shag-${str(n.id)}-${str(st.func)}`,
            workLo: Math.min(num(low?.workHours), num(st.workHours)),
            workHi: Math.max(num(low?.workHours), num(st.workHours)),
            tasks: mine };
        }),
      },
      /* Работа, в которой прослеживаемые вещи родились, лежит ДО цепочки:
         без неё не ответить, откуда они взялись. */
      before: act.tasks.filter((t) => !hi.steps.some((st) => st.func === t.func)),
      changes: ids.map((id) => ({ trait: traitName(id),
        lo: num(lo.delta[id]), hi: num(hi.delta[id]),
        fact: act.done ? num(act.delta[id]) : null })),
      made: act.made,
      tasks: act.tasks,
      actual: { done: act.done, total: act.total, hours: act.hours },
      sections: childrenOf(nodes, n.id).map(block),
    };
  };

  return {
    at: new Date().toISOString(),
    path: pathOf(nodes, nodeId).map((n) => str(n.name)),
    block: block(root),
  };
}
