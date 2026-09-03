/* ════════════════════════════════════════════════════════════════
   РАСЧЁТ ПО ФУНКЦИЯМ

   Прежний расчёт шёл по стрелкам «актив → ресурс»: у стрелки была
   интенсивность, период, знак и условия, а работа человека к ней не
   относилась никак. Его больше нет. Считает теперь то, что и делает дело:
   функции.

   ─── откуда берутся числа ───

   У функции есть время одного выполнения. За месяц она выполняется
   столько раз, сколько раз это время в месяц помещается: цикл в неделю —
   примерно четыре раза, цикл в полгода — одна шестая раза (результат,
   на который ушло полгода, не может появиться разом).

   На каждом выполнении функция берёт свои входы и выдаёт свои выходы — в
   пределах заложенной вилки. Отсюда и весь прогноз: уровень ресурса это
   его начальное значение плюс всё, что функции в него выдали, минус всё,
   что они из него взяли.

   ─── почему прогноз — это лента, а не линия ───

   Вилка входа и выхода — гипотеза. Значит и уровень ресурса не число, а
   промежуток:

   · нижняя граница — выдали по минимуму, взяли по максимуму;
   · верхняя — выдали по максимуму, взяли по минимуму.

   Одна линия здесь была бы обманом: она выглядела бы как знание, которого
   нет. Когда появляются фактические выполнения, рядом с лентой встаёт
   линия факта — по среднему арифметическому того, что вышло на самом деле.

   ─── чего не хватает, того не берут ───

   Функция не может взять больше, чем есть: ресурс не уходит в минус. Если
   за месяц спрос на ресурс больше остатка, все, кто его берёт, получают
   поровну — по своей доле спроса. Это не «кто раньше встал», потому что
   порядок функций в списке — случайность заведения, а не приоритет, и
   расчёт не должен от него зависеть.

   ─── чего расчёт НЕ делает ───

   Число исполнителей на скорость не влияет. Владелец описал исполнителей
   как тех, кто функцию выполняет и отвечает за неё, а не как множитель
   производительности; домножать на количество людей значило бы додумать
   за него, что двое делают вдвое быстрее.
   ════════════════════════════════════════════════════════════════ */
import { DUR_UNITS, hoursOf, runHours, runQty } from "./funcs.js";

/** Часов в месяце — шаг модели. */
export const MONTH_H = DUR_UNITS["мес"];

/** Стороны прогноза: осторожная, щедрая и фактическая. */
export const SIDES = ["lo", "hi", "fact"];

const num = (v) => Number(v) || 0;

/**
 * Сколько раз функция выполняется за месяц.
 *
 * По факту, если он есть: реальное время цикла честнее заложенного. Ноль
 * времени — не бесконечность, а «не считаем»: функция без срока ничего не
 * говорит о том, когда будет готово.
 */
export function cycles(f, runs = []) {
  const h = runHours(runs) ?? hoursOf(f);
  return h > 0 ? MONTH_H / h : 0;
}

/**
 * Сколько ресурса берёт (или выдаёт) порт на одном выполнении.
 *
 * Для нижней границы уровня берут по максимуму и выдают по минимуму, для
 * верхней — наоборот. Факт, когда он есть, вытесняет вилку с обеих сторон:
 * измеренное не нуждается в границах.
 */
export function portQty(p, { kind, side, runs = [] }) {
  const fact = runQty(runs, kind, p.trait);
  if (side === "fact" || fact != null) return fact ?? (num(p.lo) + num(p.hi)) / 2;
  const lo = num(p.lo);
  const hi = num(p.hi);
  const worst = kind === "takes" ? hi : lo;
  const best = kind === "takes" ? lo : hi;
  return side === "lo" ? worst : best;
}

/** Есть ли у функции хоть одно фактическое выполнение. */
export const hasFact = (runs = []) => runs.some((r) => Number(r?.hours) > 0);

/**
 * Прогон модели по месяцам — одна сторона прогноза.
 *
 * Возвращает по ряду значений на каждый ресурс: значение на конец каждого
 * месяца, начиная с нулевого (то, что есть сейчас).
 */
export function runSide(model, { span = 24, side = "hi", runsOf } = {}) {
  const { traits = [], funcs = [] } = model;
  const runs = (f) => (runsOf ? runsOf(f.id) : []);
  const level = {};
  const out = {};
  traits.forEach((t) => { level[t.id] = num(t.have); out[t.id] = [level[t.id]]; });

  for (let m = 0; m < span; m += 1) {
    const wave = funcs.map((f) => ({ f, n: cycles(f, runs(f)), k: 1 }));

    // Спрос на каждый ресурс за месяц — и доля, которая на самом деле
    // достанется, если спрос больше остатка.
    const demand = {};
    wave.forEach(({ f, n }) => f.takes.forEach((p) => {
      demand[p.trait] = (demand[p.trait] || 0)
        + portQty(p, { kind: "takes", side, runs: runs(f) }) * n;
    }));
    const share = {};
    Object.keys(demand).forEach((id) => {
      const have = level[id] ?? 0;
      share[id] = demand[id] > have ? (have > 0 ? have / demand[id] : 0) : 1;
    });
    // Функцию держит самый дефицитный её вход: наполовину сделанной работы
    // не бывает, но половина выполнений за месяц — бывает.
    wave.forEach((w) => {
      w.k = w.f.takes.reduce((k, p) => Math.min(k, share[p.trait] ?? 1), 1);
    });

    wave.forEach(({ f, n, k }) => {
      f.takes.forEach((p) => {
        if (level[p.trait] == null) return;
        level[p.trait] -= portQty(p, { kind: "takes", side, runs: runs(f) }) * n * k;
      });
      f.gives.forEach((g) => {
        if (level[g.trait] == null) return;
        level[g.trait] += portQty(g, { kind: "gives", side, runs: runs(f) }) * n * k;
      });
    });

    traits.forEach((t) => {
      // Ресурс не уходит в минус: взять больше, чем есть, нельзя — и то,
      // чего нет, не должно тянуть график под ноль.
      level[t.id] = Math.max(0, level[t.id]);
      out[t.id].push(level[t.id]);
    });
  }
  return out;
}

/**
 * Полный прогноз: лента гипотезы и линия факта.
 *
 * Линия факта появляется только тогда, когда хоть одна функция и правда
 * выполнялась. Без выполнений её нет вовсе — иначе план показался бы
 * измерением.
 */
export function forecast(model, { span = 24, runsOf } = {}) {
  const anyFact = (model.funcs || []).some((f) => hasFact(runsOf ? runsOf(f.id) : []));
  return {
    lo: runSide(model, { span, side: "lo", runsOf }),
    hi: runSide(model, { span, side: "hi", runsOf }),
    fact: anyFact ? runSide(model, { span, side: "fact", runsOf }) : null,
    span,
  };
}

/**
 * Когда цель ресурса будет достигнута.
 *
 * Два ответа, а не один: «в лучшем случае» — по верхней границе, «наверняка»
 * — по нижней. Одна дата здесь была бы обещанием, которого вилка не даёт.
 */
export function reach(fc, trait) {
  const want = trait?.want;
  if (want == null) return null;
  const first = (row) => {
    if (!row) return null;
    const at = row.findIndex((v) => v >= want);
    return at < 0 ? null : at;
  };
  return { best: first(fc.hi?.[trait.id]), sure: first(fc.lo?.[trait.id]),
    fact: first(fc.fact?.[trait.id]) };
}

/**
 * Что актив за месяц отдаёт и получает.
 *
 * Передача — это выход функции с указанным получателем. Здесь она
 * превращается в числа: сколько ресурса в месяц уезжает из актива и
 * сколько приезжает. Без этого «передаёт в другой актив» осталось бы
 * подписью на стрелке.
 */
export function transfers(model, { runsOf } = {}) {
  const { funcs = [], traits = [] } = model;
  const at = (id) => traits.find((t) => t.id === id);
  const out = [];
  funcs.forEach((f) => {
    const rs = runsOf ? runsOf(f.id) : [];
    const n = cycles(f, rs);
    f.gives.forEach((g) => {
      const to = g.to || f.e;
      if (to === f.e) return;
      out.push({
        id: `${f.id}-${g.id}`,
        func: f.id,
        from: f.e,
        to,
        trait: g.trait,
        name: at(g.trait)?.l || "",
        lo: portQty(g, { kind: "gives", side: "lo", runs: rs }) * n,
        hi: portQty(g, { kind: "gives", side: "hi", runs: rs }) * n,
      });
    });
  });
  return out;
}

/**
 * Нагрузка человека: сколько часов в месяц на нём висит.
 *
 * Часы берутся из функций, где он исполнитель, и делятся поровну между
 * исполнителями: если функцию делают двое, каждому достаётся половина
 * выполнений. Это не измерение занятости, а следствие модели, — но оно
 * показывает, на кого свалено больше, чем на других.
 */
export function load(model, { runsOf } = {}) {
  const by = {};
  (model.funcs || []).forEach((f) => {
    const rs = runsOf ? runsOf(f.id) : [];
    const hours = runHours(rs) ?? hoursOf(f);
    const n = cycles(f, rs);
    if (!f.owners.length || !(hours > 0)) return;
    const each = (hours * n) / f.owners.length;
    f.owners.forEach((p) => { by[p] = (by[p] || 0) + each; });
  });
  return by;
}
