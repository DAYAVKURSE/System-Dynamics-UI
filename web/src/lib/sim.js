/* ═══════════════ ДВИЖОК МОДЕЛИ ═══════════════
   Чистые функции: состояние модели на входе, ряды по месяцам на выходе.
   Живут отдельно от интерфейса, чтобы проверять их числами, а не через
   отрисованные значения: расчёт — самое ценное в приложении, и ошибка в нём
   не видна глазом. */
import { evaluate, refsOf, splitComparison } from "./expr.js";

export const PER = { "час": 730, "день": 30, "нед": 4.33, "мес": 1, "квартал": 1 / 3, "год": 1 / 12 };

// Тип величины задаётся явно. Слэш в единице — путь совместимости для
// сценариев, сохранённых до того, как появился отдельный переключатель.
export const isFlow = (t) => (t.flow != null ? !!t.flow : /\//.test(t.unit || ""));

/* Внутри модели все потоки живут в одной размерности — в месяц: иначе
   складывать приходящее по разным стрелкам было бы нельзя. Человеку же
   показываем в том периоде, который он выбрал у ресурса: «10 ч/день»
   понятнее, чем «300 ч/мес», хотя это одно и то же. */
export const perOf = (t) => (isFlow(t) ? (t.per || "мес") : null);
export const shown = (t, v) => (isFlow(t) ? Number(v) / (PER[t.per] ?? 1) : Number(v));
export const stored = (t, v) => (isFlow(t) ? Number(v) * (PER[t.per] ?? 1) : Number(v));
export const unitOf = (t) => (isFlow(t) && t.per ? `${t.unit}/${t.per}` : t.unit);

/* Разбор старой записи «чел./мес»: до слэша — единица, после — период.
   Хвост, которого нет среди периодов, не трогаем: «₽/ч» это «рублей на час
   труда», а не скорость, и разрезав такую единицу мы потеряли бы её смысл. */
export const normalizeTrait = (t) => {
  if (t.per || t.flow != null) return t;
  const s = String(t.unit ?? "");
  const i = s.indexOf("/");
  if (i === -1) return { ...t, flow: false };
  const head = s.slice(0, i).trim(), tail = s.slice(i + 1).trim();
  return PER[tail] != null
    ? { ...t, unit: head, per: tail, flow: true }
    : { ...t, flow: true };
};
export const normalizeTraits = (list) =>
  (Array.isArray(list) ? list.map(normalizeTrait) : list);

/* ─────── условия ─────── */
// Условие: {left, mode, right} — сравнение двух величин, и каждая может быть
// формулой со ссылками на ресурсы ("{r5} * 2", "{u9} / 100 + 5").
// mode "min" — «не меньше»: чем больше левая часть относительно правой, тем
// сильнее эффект (линейно, без потолка). mode "max" — «не больше»: пока левая
// не выше правой, эффект полный; выше — насыщение, эффект слабеет обратно
// пропорционально.
export const Cond = (trait, mode, amt) => ({ left: `{${trait}}`, mode, right: String(amt) });

/* Видов условий три, и они отвечают на разные вопросы.
   · "gate" — {expr}: одно выражение со сравнением, «10 - x > y + z».
     Верно — перенос идёт, неверно — не идёт. Множитель 1 или 0.
   · "min"  — пропорция: чем больше левая часть относительно правой, тем
     сильнее эффект, линейно и без потолка (усиливающий контур).
   · "max"  — насыщение: пока левая не выше правой, эффект полный; выше —
     слабеет обратно пропорционально (пределы роста).
   Пропорция и насыщение — это про «насколько сильно», сравнение — про
   «происходит ли вообще». Свести их в одно нельзя: множитель 0.4 и запрет
   переноса — разные утверждения о системе. */
export const condKind = (c) => (c && c.expr != null ? "gate" : (c && c.mode === "max" ? "max" : "min"));

// Условия из сценариев, сохранённых до появления выражений, имеют вид
// {trait, mode, amt}. Читаем их как частный случай: слева ресурс, справа число.
export const condSides = (c) => ({
  left: c.left != null ? c.left : (c.trait ? `{${c.trait}}` : ""),
  right: c.right != null ? c.right : String(c.amt ?? ""),
  mode: c.mode || "min",
});

// Все ресурсы, от которых зависит условие — по ним строится граф зависимостей
// цели и чистятся ссылки при удалении ресурса.
export const condRefs = (c) => {
  if (condKind(c) === "gate") return refsOf(c.expr || "");
  const s = condSides(c);
  return [...refsOf(s.left), ...refsOf(s.right)];
};

/* Перевод условия из вида в вид — при переключении в интерфейсе. Написанное
   не теряется: сравнение разбирается на стороны, стороны собираются в
   сравнение. Иначе смена вида стирала бы формулу, которую набирали руками. */
export const asGate = (c) => {
  if (condKind(c) === "gate") return c;
  const s = condSides(c);
  return { expr: `${s.left || "0"} ${s.mode === "max" ? "<=" : ">="} ${s.right || "0"}` };
};
export const asRatio = (c, mode) => {
  if (condKind(c) !== "gate") return { ...condSides(c), mode };
  const parts = splitComparison(c.expr || "");
  return parts
    ? { left: parts.left, mode, right: parts.right }
    : { left: c.expr || "", mode, right: "1" };
};

// множитель одного условия: min — линейно растёт с показателем (без потолка),
// max — насыщение: пока показатель не выше порога множитель = 1, выше — падает
// обратно пропорционально (чем сильнее превышен потолок, тем слабее эффект)
export function condK(c, valueOf) {
  if (condKind(c) === "gate") {
    const r = evaluate(c.expr, valueOf);
    // Пустое или сломанное условие не душит стрелку — тот же инвариант, что и
    // для остальных видов: обнуление схлопнуло бы прогноз без объяснения.
    if (r.error) return 1;
    return r.value > 0 ? 1 : 0;
  }
  const { left, right, mode } = condSides(c);
  const L = evaluate(left, valueOf), R = evaluate(right, valueOf);
  // Незаполненное или сломанное условие не душит стрелку: множитель 1,
  // то есть «не ограничивает». Обнулять было бы хуже — прогноз схлопнулся бы
  // без объяснения; сама ошибка показывается рядом с полем в интерфейсе.
  if (L.error || R.error) return 1;
  if (R.value <= 0) return 1;
  if (mode === "max") return L.value > R.value ? R.value / L.value : 1;
  return L.value / R.value;
}

// общий множитель стрелки — произведение множителей всех её условий
// (если условий несколько, каждое ограничивает независимо)
export function edgeK(ed, valueOf) {
  if (!ed.conds || !ed.conds.length) return 1;
  return ed.conds.reduce((acc, c) => acc * condK(c, valueOf), 1);
}

/* ─────── откуда стрелка берёт ─────── */
// Стрелка может не создавать величину из ниоткуда, а переносить её из ресурса
// актива-источника — тогда источник на столько же убывает. Поле необязательное:
// многие потоки в модели приходят извне (спрос, приход новых пользователей), и
// требовать для них источник значило бы заставлять придумывать несуществующий.
export const sourceTrait = (ed, hasTrait) => {
  const s = ed.fromTrait;
  // Сам себя ресурс не питает, и ссылка на удалённый ресурс не считается:
  // и то и другое молча обнулило бы стрелку.
  return (s && s !== ed.to && hasTrait(s)) ? s : null;
};

/* ─────── метрики задач как движение ─────── */
/* Задача говорит, что она тратит и что приносит. В модели это не отдельная
   бухгалтерия, а обычные стрелки: иначе появился бы второй механизм расчёта
   рядом с edges/conds, и «почему цифра такая» пришлось бы искать в двух
   местах. Стрелки не хранятся в сценарии — они выводятся из задач при
   каждом расчёте: так задача не может оставить после себя осиротевшую
   стрелку, а правка метрики не требует чинить edges.

   Часы не превращаются в рубли: «тратит 2 ч/день» и «приносит 5000 ₽/мес» —
   это две разные стрелки к двум разным ресурсам, а не одна. Связь между
   ними — сама задача. */
export const isTaskEdge = (ed) => !!(ed && ed.task);

// Метрика считается, пока задача не «готово»: доделанная разовая работа
// больше ничего не тратит и не приносит.
export const taskCounts = (t) => !!t && t.status !== "done";

export function taskEdges(tasks, traits) {
  const byId = {};
  (traits || []).forEach((t) => { byId[t.id] = t; });
  const out = [];
  (tasks || []).forEach((task) => {
    if (!taskCounts(task)) return;
    (task.effects || []).forEach((ef, i) => {
      const t = byId[ef.trait];
      const amount = Number(ef.amount);
      if (!t || !amount) return;
      out.push({
        id: `task:${task.id}:${ef.id || i}`,
        // Стрелка идёт от актива ресурса к нему же: задача меняет актив
        // изнутри, а не переносит величину откуда-то ещё.
        from: t.e, to: t.id,
        carrier: task.title,
        gives: Math.abs(amount),
        per: ef.per || "мес",
        sign: ef.dir === "spend" ? -1 : 1,
        conds: [], note: "", basis: ef.basis === "fact" ? "fact" : "hypo",
        task: task.id, effect: ef.id || String(i),
      });
    });
  });
  return out;
}

/** Полный набор стрелок модели: нарисованные плюс выведенные из задач. */
export const modelEdges = (edges, tasks, traits) =>
  [...(edges || []), ...taskEdges(tasks, traits)];

/* ─────── шаг модели: что стрелки реально передают ─────── */
/**
 * Значение потока — это сколько его В ЭТОМ месяце: стартовое значение плюс
 * всё, что в него втекает за шаг. НЕ остаток. Прежняя семантика («остаток
 * после трат») делала осмысленную модель бессмысленной: условие «времени не
 * меньше 150» в начале месяца видело ноль (время ещё «не натекло»), месяц 0
 * выходил мёртвым, а дальше модель качалась — потратили всё → остаток 0 →
 * месяц простоя. Человек же, говоря «у меня 300 часов», имеет в виду фонд
 * месяца, а не то, что осталось от прошлого.
 *
 * Раз потоки одного шага зависят друг от друга (А наполняет Б, В заперт
 * условием на Б), шаг разрешается итерациями до неподвижной точки — так
 * делают взрослые СД-пакеты, только у них топологическая сортировка, а у
 * нас простая итерация: цепочка глубины N сходится за N проходов. Циклы,
 * у которых неподвижной точки нет, обрываются по числу проходов.
 *
 * Расход при этом сохраняется по-разному:
 * · запас — хранилище: с него списывается ровно переданное;
 * · поток — скорость: списывать с неё нечего, но сумма забираемого не может
 *   превышать того, что втекает за шаг. Кто просил больше — получает свою
 *   долю запроса.
 *
 * Функция одна на симуляцию и интерфейс: карточка стрелки обязана объяснять
 * ровно те числа, которые показывает прогноз.
 */
/* Состояние, с которого начинается месяц 0: запасы — со стартовых значений,
   потоки считает resolveStep внутри шага. */
export const initialState = (traits, seedMod) => {
  const st = {};
  traits.forEach((t) => {
    const seed = Number((seedMod && seedMod[t.id] != null) ? seedMod[t.id] : (t.have ?? 0));
    st[t.id] = isFlow(t) ? 0 : seed;
  });
  return st;
};

const MAX_PASSES = 12;

/* Месяц состоит из попыток. Стрелка с периодом «день» делает 30 попыток, и
   условие проверяется НА КАЖДОЙ — по значениям на момент попытки, где
   ресурсы-источники уже убыли от предыдущих попыток. Одна проверка на месяц
   («сейчас 300 >= 5 — верно, значит переносим всё») была неправильной:
   она не замечала, что к середине месяца источник уже выбран и условие
   давно ложно.

   Разрешение попыток — не чаще суточного: попытки «каждый час» идут пачками
   по суткам. Иначе пересчёт (а рекомендации гоняют его сотнями) не влезал бы
   в интерактивное время, а точность внутри суток модели с шагом «месяц»
   ничего не даёт. */
const MAX_TICKS = 30;

function planOnce(traits, edges, byId, st, giveAt) {
  // Ресурсы, из которых кто-то берёт: их «осталось» убывает внутри месяца,
  // и условия видят именно остаток на момент попытки.
  const sourced = new Set();
  edges.forEach((ed) => {
    const src = sourceTrait(ed, (id) => byId[id] !== undefined);
    if (src) sourced.add(src);
  });
  const left = {};
  sourced.forEach((tid) => { left[tid] = Math.max(0, st[tid]); });
  const valueAt = (tid) => (sourced.has(tid) ? left[tid] : st[tid]);

  // Попытки нужны стрелке, только если внутри месяца для неё что-то меняется:
  // она сама берёт из источника или её условия смотрят на убывающий ресурс.
  // Остальным хватает одного расчёта — это и быстрее, и ровно прежний итог.
  const moves = [];
  const ticking = [];
  for (const ed of edges) {
    if (!byId[ed.to]) continue;
    const src = sourceTrait(ed, (id) => byId[id] !== undefined);
    const per = PER[ed.per] ?? 1;
    const f = { ed, to: ed.to, src, want: 0, moved: 0, asked: Math.abs(giveAt(ed)) * per,
      supply: src ? left[src] : null, demand: null };
    moves.push(f);
    const dynamic = src || (ed.conds || []).some((c) => condRefs(c).some((r) => sourced.has(r)));
    if (dynamic && per > 1) {
      const ticks = Math.min(MAX_TICKS, Math.ceil(per));
      ticking.push({ f, ticks, amount: giveAt(ed) * per / ticks, sign: Number(ed.sign) });
    } else {
      ticking.push({ f, ticks: 1, amount: giveAt(ed) * per, sign: Number(ed.sign) });
    }
  }

  // Идём по месяцу: на каждом шаге делают попытку те, чья очередь подошла.
  // Одновременные попытки делят остаток пропорционально запросу: порядок
  // стрелок в файле не значит приоритета.
  const maxTicks = Math.max(1, ...ticking.map((t) => t.ticks));
  for (let step = 0; step < maxTicks; step++) {
    const acting = [];
    for (const tk of ticking) {
      // Попытки стрелки распределены по месяцу равномерно.
      const due = Math.floor((step + 1) * tk.ticks / maxTicks)
        - Math.floor(step * tk.ticks / maxTicks);
      if (due <= 0) continue;
      const k = edgeK(tk.f.ed, valueAt);
      const want = tk.sign * tk.amount * due * k;
      acting.push({ tk, want });
      tk.f.want += want;
      if (tk.f.src && want > 0) tk.f.demand = (tk.f.demand || 0) + 0; // заполняется ниже
    }
    // Дележ остатка между одновременными попытками.
    const ask = {};
    acting.forEach((a) => { if (a.tk.f.src && a.want > 0) ask[a.tk.f.src] = (ask[a.tk.f.src] || 0) + a.want; });
    const share = {};
    Object.keys(ask).forEach((tid) => {
      const have = Math.max(0, left[tid]);
      share[tid] = ask[tid] > have ? have / ask[tid] : 1;
    });
    acting.forEach((a) => {
      const f = a.tk.f;
      const moved = a.want * ((f.src && a.want > 0) ? (share[f.src] ?? 1) : 1);
      f.moved += moved;
      if (f.src) left[f.src] = Math.max(0, left[f.src] - moved);
    });
  }

  moves.forEach((f) => {
    if (f.src) {
      f.demand = null; // суммарный запрос по источнику — считаем разом ниже
    }
    f.k = f.asked > 0 ? Math.abs(f.want) / f.asked : 1;
    f.share = f.want !== 0 ? f.moved / f.want : 1;
  });
  // Сколько всего просили у каждого источника за месяц — для сводки в карточке.
  const demand = {};
  moves.forEach((f) => { if (f.src && f.want > 0) demand[f.src] = (demand[f.src] || 0) + f.want; });
  moves.forEach((f) => { if (f.src) f.demand = demand[f.src] || 0; });
  return moves;
}

export function resolveStep(traits, edges, { stockAt, seedAt, giveAt }) {
  const byId = {};
  traits.forEach((t) => { byId[t.id] = t; });
  const st = {};
  traits.forEach((t) => {
    st[t.id] = isFlow(t) ? Math.max(0, seedAt(t)) : Number(stockAt(t.id)) || 0;
  });
  let moves = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    moves = planOnce(traits, edges, byId, st, giveAt);
    let delta = 0;
    traits.forEach((t) => {
      if (!isFlow(t)) return;
      let v = seedAt(t);
      moves.forEach((f) => { if (f.to === t.id) v += f.moved; });
      v = Math.max(0, v);
      delta = Math.max(delta, Math.abs(v - st[t.id]));
      st[t.id] = v;
    });
    if (delta <= 1e-9) break;
  }
  return { moves, state: st };
}

/* ─────── симуляция ─────── */
/** Метод Эйлера, шаг — месяц. Каждый шаг разрешается через resolveStep. */
export function simulate(traits, edges, months, seedMod, giveMod) {
  const seed = (t) => Number((seedMod && seedMod[t.id] != null) ? seedMod[t.id] : (t.have ?? 0));
  const giveAt = (ed) =>
    Number((giveMod && giveMod[ed.id] != null) ? giveMod[ed.id] : ed.gives) || 0;
  const stocks = initialState(traits, seedMod);
  const series = {};
  traits.forEach((t) => { series[t.id] = []; });

  for (let m = 0; m <= months; m++) {
    const { moves, state } = resolveStep(traits, edges,
      { stockAt: (id) => stocks[id], seedAt: seed, giveAt });
    // Потоки показывают значение этого шага; запасы — состояние на его начало.
    traits.forEach((t) => { series[t.id].push(state[t.id]); });
    // Шагают только запасы: приход прибавляется, взятое источником списывается.
    const rate = {};
    moves.forEach((f) => {
      rate[f.to] = (rate[f.to] || 0) + f.moved;
      if (f.src) rate[f.src] = (rate[f.src] || 0) - f.moved;
    });
    traits.forEach((t) => {
      if (!isFlow(t)) stocks[t.id] = Math.max(0, stocks[t.id] + (rate[t.id] || 0));
    });
  }
  return series;
}

export const reachMonth = (s, w) => {
  for (let i = 0; i < (s?.length || 0); i++) if (s[i] + 1e-9 >= w) return i;
  return null;
};

// гипотеза/факт — свойство самой стрелки: «10 реферов приведут 10 пользователей»
// это гипотеза (поведенческое допущение), а «10% от 100 тысяч — это 10 тысяч» — факт
// (точный расчёт). Поэтому считаем модель дважды: по всем стрелкам (гипотетический
// прогноз, оптимистичный) и только по стрелкам-фактам (гарантированный прогноз).
export const isFact = (e) => e.basis === "fact";
export const factEdges = (edges) => edges.filter(isFact);
export const frac = (v, w) => (w ? Math.max(0, Number(v) / Number(w)) : null);

// Граф зависимостей цели: от чего вообще может измениться её значение.
export const depsOf = (edges, tid) => {
  const seen = new Set(), arr = new Set();
  const go = (id, d) => {
    if (seen.has(id) || d > 6) return;
    seen.add(id);
    edges.filter((e) => e.to === id).forEach((ed) => {
      arr.add(ed.id);
      (ed.conds || []).forEach((c) => { condRefs(c).forEach((r) => go(r, d + 1)); });
      // Ресурс-источник тоже влияет: не хватит его — стрелка передаст меньше.
      if (ed.fromTrait && ed.fromTrait !== id) go(ed.fromTrait, d + 1);
    });
  };
  go(tid, 0);
  return { traits: [...seen], edges: [...arr] };
};

export function adviseFor(traits, edges, g, span) {
  const by = g.by ?? span, want = Number(g.want);
  const base = simulate(traits, edges, Math.max(span, by));
  const now = reachMonth(base[g.id], want);
  if (now != null && now <= by) return { now, recs: [] };
  const d = depsOf(edges, g.id), recs = [];
  const test = (sm, gm) => reachMonth(simulate(traits, edges, by, sm, gm)[g.id], want);
  const search = (mk, cur) => {
    let hi = Math.max(1, cur || 1, Math.abs(Number(g.want)) || 1);
    for (let i = 0; i < 40 && test(...mk(hi)) == null; i++) hi *= 2;
    if (test(...mk(hi)) == null) return null;
    let lo = cur || 0;
    for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; test(...mk(mid)) != null ? hi = mid : lo = mid; }
    return hi;
  };
  d.traits.forEach((tid) => {
    const t = traits.find((x) => x.id === tid); if (!t || isFlow(t)) return;
    const cur = Number(t.have ?? 0), v = search((x) => [{ [tid]: x }, null], cur);
    if (v != null && v > cur + 1e-6) recs.push({ type: "seed", tid, from: cur, to: v,
      month: test({ [tid]: v }, null), label: t.l, unit: unitOf(t), e: t.e });
  });
  d.edges.forEach((eid) => {
    const ed = edges.find((x) => x.id === eid);
    // Стрелку задачи крутить нельзя: она выводится из метрики задачи, и
    // записанное в неё значение стёрлось бы следующим пересчётом.
    if (!ed || isTaskEdge(ed)) return;
    const cur = Number(ed.gives) || 0, v = search((x) => [null, { [eid]: x }], cur);
    if (v != null && v > cur * 1.001) recs.push({ type: "edge", eid, from: cur, to: v,
      month: test(null, { [eid]: v }), label: ed.carrier,
      unit: traits.find((t) => t.id === ed.to)?.unit, per: ed.per, e: ed.from });
  });
  recs.sort((a, b) => (a.month ?? 99) - (b.month ?? 99));
  return { now, recs: recs.slice(0, 6) };
}
