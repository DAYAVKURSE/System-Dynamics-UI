import { describe, expect, it } from "vitest";
import { chanceOf, conversionOf, hoursOf, hoursRange, normalizeFunc, newFunc, parAssetOf,
  parOf, parWorkerOf, sameHours,
  shortage, takeQty, checkFunc } from "../lib/funcs.js";
import { cycles, forecast, load, runSide, scheduleOf, solve, stepHours } from "../lib/plan.js";
import { goalRuns, newGoal, normalizeGoal } from "../lib/goals.js";

/* Время выполнения — вилка, а «как часто может повторяться» — потолок, а не
   расписание. Сама по себе функция не повторяется: она работа и происходит
   тогда, когда её делают. Сколько раз её сделают, говорят применённые
   цели. */

const F = (over) => normalizeFunc({ id: "f1", e: "A", dur: 1, durHi: 1, durUnit: "мес",
  takes: [{ trait: "in", lo: 1, hi: 1 }], gives: [{ trait: "out", lo: 1, hi: 1 }],
  ...over });

describe("время — вилка", () => {
  it("новая функция заводится точным сроком: вилка «от 1 до 1»", () => {
    const f = newFunc("A");
    expect(sameHours(f)).toBe(true);
    expect(hoursRange(f)).toEqual({ lo: 24, hi: 24 });
  });

  it("прежние записи без верхней границы — это точный срок, а не поломка", () => {
    // Все модели, собранные до этого, называли одно число, и оно и есть обе
    // границы.
    expect(hoursRange(normalizeFunc({ dur: 2, durUnit: "ч" }))).toEqual({ lo: 2, hi: 2 });
  });

  it("сторона выбирает границу, без стороны берётся середина", () => {
    const f = { dur: 2, durHi: 6, durUnit: "ч" };
    expect(hoursOf(f, "lo")).toBe(2);
    expect(hoursOf(f, "hi")).toBe(6);
    expect(hoursOf(f)).toBe(4);
  });

  it("перевёрнутая вилка читается как вилка, а не как отрицательное время", () => {
    expect(hoursRange({ dur: 6, durHi: 2, durUnit: "ч" })).toEqual({ lo: 2, hi: 6 });
  });

  it("нулевая граница делает функцию негодной: «может быть, мгновенно» — не срок", () => {
    const m = { traits: [{ id: "in", e: "A" }, { id: "out", e: "A" }] };
    expect(checkFunc(F({ dur: 0, durHi: 4 }), m).ok).toBe(false);
    expect(checkFunc(F({ dur: 1, durHi: 0 }), m).ok).toBe(false);
    expect(checkFunc(F({ dur: 1, durHi: 4 }), m).ok).toBe(true);
  });
});

describe("потолок повторений", () => {
  it("щедрая сторона считает по быстрой работе, осторожная — по долгой", () => {
    const f = F({ dur: 1, durHi: 2, durUnit: "мес" });
    expect(stepHours(f, [], "hi")).toBeLessThan(stepHours(f, [], "lo"));
    expect(cycles(f, [], "hi")).toBeGreaterThan(cycles(f, [], "lo"));
  });

  it("«не чаще раза в…» опускает потолок, даже если работа быстрая", () => {
    const fast = F({ dur: 1, durHi: 1, durUnit: "дн" });
    const rare = F({ dur: 1, durHi: 1, durUnit: "дн", every: 1, everyUnit: "мес" });
    expect(cycles(rare)).toBeLessThan(cycles(fast));
    expect(cycles(rare)).toBeCloseTo(1);
  });
});

/* ─────── одновременные выполнения ───────

   Настройка про ДОЛГИЕ дела: юрист ведёт восемь дел месяцами разом, и они
   не выстраиваются в очередь. Работа от этого быстрее не делается — час
   работы остаётся часом; меняется только то, сколько дел помещается в
   календарь одновременно. */
describe("одновременные выполнения", () => {
  it("по умолчанию одно: обещать иное без слов человека нельзя", () => {
    expect(parOf(newFunc("A"))).toBe(1);
    expect(normalizeFunc({ id: "f" }).par).toBe(1);
  });

  it("меньше одного и дробей не бывает: полдела в работе не держат", () => {
    expect(parOf({ par: 0 })).toBe(1);
    expect(parOf({ par: -3 })).toBe(1);
    expect(parOf({ par: 2.7 })).toBe(2);
  });

  it("пределов два: на воркера и на актив — в счёт идёт меньший", () => {
    /* «На воркера» — сколько дел держит один человек; «на актив» —
       сколько их идёт в активе вообще. Людей мы не считаем (инвариант 6),
       поэтому умножать первое на их число нельзя; а потолок актива обязан
       работать — сказано «больше трёх разом не идёт», значит не идёт. */
    expect(parWorkerOf({ par: 8, parAll: 3 })).toBe(8);
    expect(parAssetOf({ par: 8, parAll: 3 })).toBe(3);
    expect(parOf({ par: 8, parAll: 3 })).toBe(3);
    expect(parOf({ par: 2, parAll: 9 })).toBe(2);
  });

  it("пустой предел актива — «не ограничено», а не «одно»", () => {
    /* Иначе всякая прежняя схема с восемью одновременными делами
       схлопнулась бы в очередь при первом же чтении. */
    expect(parAssetOf({})).toBe(0);
    expect(parAssetOf({ parAll: -5 })).toBe(0);
    expect(parOf({ par: 8 })).toBe(8);
    expect(normalizeFunc({ id: "f", par: 8 }).parAll).toBe(0);
    expect(normalizeFunc({ id: "f" }).parAll).toBe(0);
  });

  it("сколько дел ведут разом — столько и помещается в месяц", () => {
    const one = F({ dur: 1, durHi: 1, durUnit: "мес" });
    const eight = F({ dur: 1, durHi: 1, durUnit: "мес", par: 8 });
    expect(cycles(one)).toBeCloseTo(1);
    expect(cycles(eight)).toBeCloseTo(8);
  });

  it("одно дело занимает 1/par времени воркера, а не всё целиком", () => {
    /* Воркер ведёт четыре дела РАЗОМ — значит четыре дела по месяцу стоят
       ему месяца, а не четырёх. Считать их полными значило бы обвинить в
       четырёхкратной перегрузке того, для кого настройку и завели. */
    const one = { funcs: [F({ dur: 1, durHi: 1, durUnit: "мес",
      owners: ["p1"], kind: "task" })] };
    const four = { funcs: [F({ dur: 1, durHi: 1, durUnit: "мес", par: 4,
      owners: ["p1"], kind: "task" })] };
    // Без настройки за месяц успевается одно дело — месяц времени.
    expect(load(one, { plan: { perMonth: { f1: 1 }, once: {} } })).toEqual({ p1: 730 });
    // С четырьмя одновременными за тот же месяц успеваются четыре — и это
    // всё тот же месяц его времени.
    expect(load(four, { plan: { perMonth: { f1: 4 }, once: {} } })).toEqual({ p1: 730 });
  });

  it("измеренное на одновременность не делится: часы из сдач — это факт", () => {
    /* Поправлять измеренное допущением нельзя: если человек отчитался за
       десять часов, значит потрачено десять, сколько бы дел он ни вёл. */
    const model = { funcs: [F({ dur: 1, durHi: 1, durUnit: "мес", par: 4,
      owners: ["p1"], kind: "task" })] };
    const runs = [{ hours: 10 }, { hours: 10 }];
    expect(load(model, { runsOf: () => runs,
      plan: { perMonth: { f1: 2 }, once: {} } })).toEqual({ p1: 20 });
  });

  it("расписание ставит задачи волнами, а не очередью", () => {
    /* Восемь дел при четырёх одновременных — это две волны: первые четыре
       начинаются разом, вторые четыре ждут их. Восемь очередей означали бы
       восемь месяцев там, где выйдет два. */
    const from = new Date("2026-01-01T00:00:00Z").getTime();
    const rows = scheduleOf([{ func: "f1", name: "Дело", e: "A", runs: 8, par: 4,
      startHours: 0, calendarHours: 2 * 730 }], { from });
    expect(rows).toHaveLength(8);
    const starts = [...new Set(rows.map((r) => r.start.getTime()))];
    expect(starts).toHaveLength(2);
    // Каждое дело тянется месяц — столько, сколько само дело, а не волна.
    expect((rows[0].end - rows[0].start) / 3600000).toBeCloseTo(730);
  });

  it("прежние записи без поля читаются как «по одному»", () => {
    const rows = scheduleOf([{ func: "f1", name: "Дело", e: "A", runs: 2,
      startHours: 0, calendarHours: 2 }], { from: 0 });
    expect(rows[0].start.getTime()).not.toBe(rows[1].start.getTime());
  });
});

describe("сама по себе функция не повторяется", () => {
  const model = {
    traits: [{ id: "in", e: "A", have: 100 }, { id: "out", e: "A", have: 0 }],
    funcs: [F({})],
  };

  it("без применённых целей ресурсы стоят на месте", () => {
    /* Прежде прогноз крутил модель на полную мощность вечно и показывал
       будущее, которого никто не планировал. */
    const out = runSide(model, { span: 6, side: "hi", plan: { perMonth: {}, once: {} } });
    expect(out.out.every((v) => v === 0)).toBe(true);
    expect(out.in.every((v) => v === 100)).toBe(true);
  });

  it("цель с темпом даёт выполнения каждый месяц", () => {
    const plan = { perMonth: { f1: 1 }, once: {} };
    const out = runSide(model, { span: 3, side: "hi", plan });
    expect(out.out).toEqual([0, 1, 2, 3]);
  });

  it("разовая цель тратится и заканчивается, а не идёт вечно", () => {
    const plan = { perMonth: {}, once: { f1: 2 } };
    const out = runSide(model, { span: 4, side: "hi", plan });
    expect(out.out).toEqual([0, 1, 2, 2, 2]);
  });

  it("потолок держит: больше, чем помещается в месяц, не сделать", () => {
    // Функция делается месяц — значит больше одного раза в месяц никак.
    const plan = { perMonth: { f1: 5 }, once: {} };
    const out = runSide(model, { span: 2, side: "hi", plan });
    expect(out.out).toEqual([0, 1, 2]);
  });

  it("без плана вовсе считаем по потолку — «на что модель способна»", () => {
    const out = runSide(model, { span: 2, side: "hi" });
    expect(out.out[2]).toBeGreaterThan(0);
  });
});

describe("что требуют цели", () => {
  const model = {
    traits: [{ id: "in", e: "A", have: 1000 }, { id: "out", e: "A", have: 0 }],
    funcs: [F({})],
  };
  const G = (over) => normalizeGoal({ ...newGoal("out"), ...over });

  it("неприменённая цель не двигает ничего: это прикидка", () => {
    const g = G({ qty: 1, rate: "month", appliedAt: null });
    expect(goalRuns(model, [g], {})).toEqual({ perMonth: {}, once: {} });
  });

  it("применённая цель с темпом ложится в «каждый месяц»", () => {
    const g = G({ qty: 1, rate: "month", appliedAt: "2026-01-01T00:00:00.000Z" });
    const r = goalRuns(model, [g], {});
    expect(r.perMonth.f1).toBeCloseTo(1);
    expect(r.once).toEqual({});
  });

  it("разовая цель ложится в «всего», а не в «каждый месяц»", () => {
    // «Получить троих» и «получать по трое каждый месяц» — разные вещи.
    const g = G({ qty: 3, rate: "once", appliedAt: "2026-01-01T00:00:00.000Z" });
    const r = goalRuns(model, [g], {});
    expect(r.once.f1).toBe(3);
    expect(r.perMonth).toEqual({});
  });

  it("две цели складываются", () => {
    const a = G({ qty: 1, rate: "month", appliedAt: "2026-01-01T00:00:00.000Z" });
    const b = G({ qty: 2, rate: "month", appliedAt: "2026-01-01T00:00:00.000Z" });
    expect(goalRuns(model, [a, b], {}).perMonth.f1).toBeCloseTo(3);
  });
});

describe("нагрузка людей", () => {
  it("считается по тому же плану, а не по потолку", () => {
    // Иначе на человека была бы записана работа, которой никто не назначал.
    const m = { funcs: [F({ owners: ["p1"] })] };
    expect(load(m, { plan: { perMonth: {}, once: {} } })).toEqual({});
    expect(load(m, { plan: { perMonth: { f1: 1 }, once: {} } }).p1).toBeGreaterThan(0);
  });
});

describe("прогноз целиком", () => {
  it("лента и факт считаются по одному и тому же плану", () => {
    const model = {
      traits: [{ id: "in", e: "A", have: 100 }, { id: "out", e: "A", have: 0 }],
      funcs: [F({ dur: 1, durHi: 2, durUnit: "мес" })],
    };
    const fc = forecast(model, { span: 3, plan: { perMonth: { f1: 10 }, once: {} } });
    // Быстрая работа успевает больше — верхняя граница выше нижней.
    expect(fc.hi.out[3]).toBeGreaterThan(fc.lo.out[3]);
  });
});

describe("факторы — это конверсия", () => {
  /* Владелец: «функции без фактора имеют 100% конверсии, функции с
     факторами — процент по их факторам». Функция берёт свою порцию не
     единожды, а столько раз, сколько нужно на одну удачу: при 10% — вдесятеро
     больше входа. Жребия больше нет: одно число, а не «как выпадет». */
  const FX = (over) => normalizeFunc({ id: "x1", e: "A", factors: ["g1"],
    dur: 1, durHi: 1, durUnit: "мес",
    takes: [{ trait: "in", lo: 1, hi: 1 }], gives: [{ trait: "out", lo: 1, hi: 1 }],
    ...over });
  const model = (over, chance = 100) => ({
    traits: [{ id: "in", e: "A", have: 100 }, { id: "out", e: "A", have: 0 }],
    factors: [{ id: "g1", e: "A", name: "сезон", chance }],
    funcs: [FX(over)],
  });
  const run = (m, over = {}) => runSide(m,
    { span: 1, side: "hi", plan: { perMonth: { x1: 1 }, once: {} }, ...over });

  it("без факторов — 100%: сколько взяла, столько и выдала", () => {
    expect(conversionOf(normalizeFunc({ id: "f" }), [])).toBe(1);
    const m = model({ factors: [] });
    const out = run(m);
    expect(out.out[1]).toBeCloseTo(1);
    expect(out.in[1]).toBeCloseTo(99);          // взяла ровно одну порцию
  });

  it("фактор 10% — на одно выполнение уходит вдесятеро больше входа", () => {
    const m = model({}, 10);
    expect(conversionOf(m.funcs[0], m.factors)).toBeCloseTo(0.1);
    expect(takeQty(1, 0.1)).toBeCloseTo(10);
    const out = run(m);
    expect(out.out[1]).toBeCloseTo(1);
    expect(out.in[1]).toBeCloseTo(90);          // 10 входа на одну единицу выхода
  });

  it("конверсия ноль — не выйдет никогда, и это число, а не тихий ноль", () => {
    expect(takeQty(1, 0)).toBe(Infinity);
    const out = run(model({}, 0));
    expect(out.out[1]).toBe(0);
  });

  it("вероятность — свойство фактора, а не функции; несколько складываются как «или»", () => {
    const two = [{ id: "g1", e: "A", name: "реклама", chance: 50 },
      { id: "g2", e: "A", name: "сезон", chance: 40 }];
    expect(chanceOf(FX({}), two)).toBe(50);
    expect(chanceOf(FX({ factors: ["g1", "g2"] }), two)).toBeCloseTo(70, 6);
    // Фактор без записи — сто процентов, а не ноль: неизвестное не значит «никогда».
    expect(chanceOf(FX({ factors: ["нет-такого"] }), two)).toBe(100);
  });

  it("прогноз не гадает: одна и та же модель даёт одно и то же число", () => {
    const once = run(model({}, 50)).out[1];
    expect(run(model({}, 50)).out[1]).toBe(once);
  });

  it("функция с факторами — такая же работа: её делают и по ней заводятся задачи", () => {
    const m = model({}, 50);
    const p = solve(m, { trait: "out", want: 2 });
    expect(p.workHours).toBeGreaterThan(0);
    expect(scheduleOf(p.steps).length).toBeGreaterThan(0);
  });

  it("порог постановки: задача ждёт, пока входа не станет столько, сколько нужно на выполнение", () => {
    /* Владелец: «если фактор 10%, значит единиц забираемого ресурса должно
       стать 10, прежде чем задача уйдёт на постановку». */
    const f = FX({}, {});
    const factors = [{ id: "g1", e: "A", name: "сезон", chance: 10 }];
    const traits = (have) => [{ id: "in", e: "A", l: "вход", have }];
    expect(shortage(f, traits(9), {}, factors)).toHaveLength(1);
    expect(shortage(f, traits(9), {}, factors)[0]).toMatchObject({ need: 10, have: 9 });
    expect(shortage(f, traits(10), {}, factors)).toEqual([]);
    // Без факторов хватает одной единицы.
    expect(shortage(FX({ factors: [] }), traits(1), {}, factors)).toEqual([]);
  });
});
