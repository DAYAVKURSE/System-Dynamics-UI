/* ═══════════════ ДВИЖОК МОДЕЛИ ═══════════════
   Чистые функции: состояние модели на входе, ряды по месяцам на выходе.
   Живут отдельно от интерфейса, чтобы проверять их числами, а не через
   отрисованные значения: расчёт — самое ценное в приложении, и ошибка в нём
   не видна глазом. */
import { evaluate, refsOf } from "./expr.js";

export const PER = { "час": 730, "день": 30, "нед": 4.33, "мес": 1, "квартал": 1 / 3, "год": 1 / 12 };

// Тип величины задаётся единицей измерения: слэш делает поток («ч/день»),
// без слэша — запас («шт.»).
export const isFlow = (t) => (t.flow != null ? !!t.flow : /\//.test(t.unit || ""));

/* ─────── условия ─────── */
// Условие: {left, mode, right} — сравнение двух величин, и каждая может быть
// формулой со ссылками на ресурсы ("{r5} * 2", "{u9} / 100 + 5").
// mode "min" — «не меньше»: чем больше левая часть относительно правой, тем
// сильнее эффект (линейно, без потолка). mode "max" — «не больше»: пока левая
// не выше правой, эффект полный; выше — насыщение, эффект слабеет обратно
// пропорционально.
export const Cond = (trait, mode, amt) => ({ left: `{${trait}}`, mode, right: String(amt) });

// Условия из сценариев, сохранённых до появления выражений, имеют вид
// {trait, mode, amt}. Читаем их как частный случай: слева ресурс, справа число.
export const condSides = (c) => ({
  left: c.left != null ? c.left : (c.trait ? `{${c.trait}}` : ""),
  right: c.right != null ? c.right : String(c.amt ?? ""),
  mode: c.mode || "min",
});

// Все ресурсы, от которых зависит условие — по ним строится граф зависимостей
// цели и чистятся ссылки при удалении ресурса.
export const condRefs = (c) => { const s = condSides(c); return [...refsOf(s.left), ...refsOf(s.right)]; };

// множитель одного условия: min — линейно растёт с показателем (без потолка),
// max — насыщение: пока показатель не выше порога множитель = 1, выше — падает
// обратно пропорционально (чем сильнее превышен потолок, тем слабее эффект)
export function condK(c, valueOf) {
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

/* ─────── симуляция ─────── */
/**
 * Метод Эйлера, шаг — месяц. Внутри шага порядок такой:
 *   1) считаем, сколько каждая стрелка хочет передать при нынешнем состоянии;
 *   2) смотрим, хватает ли этого у ресурсов-источников;
 *   3) разносим по ставкам — и в приход, и в расход.
 * Иначе одна и та же величина уходила бы сразу в несколько мест: час работы
 * нельзя потратить дважды.
 */
export function simulate(traits, edges, months, seedMod, giveMod) {
  const seed = (t) => Number((seedMod && seedMod[t.id] != null) ? seedMod[t.id] : (t.have ?? 0));
  const st = {}, series = {}, byId = {};
  traits.forEach((t) => { byId[t.id] = t; st[t.id] = isFlow(t) ? 0 : seed(t); series[t.id] = []; });
  const hasTrait = (id) => byId[id] !== undefined;

  for (let m = 0; m <= months; m++) {
    const rate = {}; traits.forEach((t) => { rate[t.id] = 0; });

    // 1. Намерения стрелок при нынешнем состоянии.
    const moves = [];
    for (const ed of edges) {
      if (rate[ed.to] === undefined) continue;
      const g = Number((giveMod && giveMod[ed.id] != null) ? giveMod[ed.id] : ed.gives) || 0;
      // линейная пропорция по каждому условию: если 1 в месяц даёт 1, то 5 дают 5,
      // без потолка в 100% (для условий-«не меньше»)
      const k = edgeK(ed, (tid) => st[tid]);
      moves.push({
        to: ed.to,
        src: sourceTrait(ed, hasTrait),
        moved: Number(ed.sign) * g * (PER[ed.per] ?? 1) * k,
      });
    }

    // 2. Сколько у источника просят и сколько он может отдать. Просят больше —
    //    каждый получает свою долю запроса: делить поровну было бы неверно
    //    (кто просил вдвое больше, вдвое больше и получит), а обслуживать по
    //    порядку — тем более: порядок стрелок в файле не значит приоритета.
    const demand = {};
    moves.forEach((f) => { if (f.src && f.moved > 0) demand[f.src] = (demand[f.src] || 0) + f.moved; });
    const share = {};
    Object.keys(demand).forEach((tid) => {
      // Запас отдаёт накопленное. Поток — то, что втекает в него за тот же
      // шаг: скорость нельзя потратить заранее, её ещё нет.
      let have = st[tid];
      if (isFlow(byId[tid])) {
        have = seed(byId[tid]);
        moves.forEach((f) => { if (f.to === tid && f.moved > 0) have += f.moved; });
      }
      have = Math.max(0, have);
      share[tid] = demand[tid] > have ? have / demand[tid] : 1;
    });

    // 3. Разносим: сколько пришло получателю, столько же ушло у источника.
    moves.forEach((f) => {
      const moved = f.moved * ((f.src && f.moved > 0) ? (share[f.src] ?? 1) : 1);
      rate[f.to] += moved;
      if (f.src) rate[f.src] -= moved;
    });

    traits.forEach((t) => {
      if (isFlow(t)) st[t.id] = Math.max(0, seed(t) + rate[t.id]);
      series[t.id].push(st[t.id]);
    });
    traits.forEach((t) => { if (!isFlow(t)) st[t.id] = Math.max(0, st[t.id] + rate[t.id]); });
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
      month: test({ [tid]: v }, null), label: t.l, unit: t.unit, e: t.e });
  });
  d.edges.forEach((eid) => {
    const ed = edges.find((x) => x.id === eid); if (!ed) return;
    const cur = Number(ed.gives) || 0, v = search((x) => [null, { [eid]: x }], cur);
    if (v != null && v > cur * 1.001) recs.push({ type: "edge", eid, from: cur, to: v,
      month: test(null, { [eid]: v }), label: ed.carrier,
      unit: traits.find((t) => t.id === ed.to)?.unit, per: ed.per, e: ed.from });
  });
  recs.sort((a, b) => (a.month ?? 99) - (b.month ?? 99));
  return { now, recs: recs.slice(0, 6) };
}
