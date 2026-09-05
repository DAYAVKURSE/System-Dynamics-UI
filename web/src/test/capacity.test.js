import { describe, expect, it } from "vitest";
import { chanceOf, hoursOf, hoursRange, normalizeFunc, newFunc, parOf, sameHours, checkFunc }
  from "../lib/funcs.js";
import { cycles, forecast, load, runSide, scheduleOf, stepHours } from "../lib/plan.js";
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

describe("фактор случается сам", () => {
  const FX = (over) => normalizeFunc({ id: "x1", e: "A", kind: "factor", factor: "g1",
    dur: 1, durHi: 1, durUnit: "мес",
    takes: [{ trait: "in", lo: 4, hi: 4 }], gives: [{ trait: "out", lo: 1, hi: 1 }],
    ...over });
  const model = (over, chance = 100) => ({
    traits: [{ id: "in", e: "A", have: 100 }, { id: "out", e: "A", have: 0 }],
    factors: [{ id: "g1", e: "A", name: "сезон", chance }],
    funcs: [FX(over)],
  });

  it("идёт своим чередом, даже когда ни одна цель не применена", () => {
    // Задачи ждут, что их поставят; фактор не спрашивает никого.
    const out = runSide(model({}), { span: 2, side: "hi", plan: { perMonth: {}, once: {} } });
    expect(out.out[2]).toBeCloseTo(2);
  });

  it("каждая попытка — свой жребий: за длинный срок выходит около доли", () => {
    /* Не «ровно половина», а как выпадет: ради этого вероятность и
       заводят — посмотреть, как одни и те же числа могут развиться
       по-разному. */
    // Ресурса вдоволь — иначе не жребий решает, сколько выйдет, а склад.
    const rich = () => { const m = model({}, 50); m.traits[0].have = 1e6; return m; };
    const run = (seed) => runSide(rich(),
      { span: 60, side: "hi", plan: { perMonth: {}, once: {} }, seed }).out[60];
    const a = run(1);
    expect(a).toBeGreaterThan(15);
    expect(a).toBeLessThan(45);
    // Другое семя — другой вариант развития.
    const seeds = [1, 2, 3, 4, 5].map(run);
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("одно и то же семя даёт один и тот же прогноз", () => {
    // Иначе подвинул мышь — и другое будущее: сравнить два варианта стало
    // бы не с чем.
    const run = () => runSide(model({}, 50),
      { span: 24, side: "hi", plan: { perMonth: {}, once: {} }, seed: 7 }).out[24];
    expect(run()).toBe(run());
  });

  it("сто процентов — удаётся каждая попытка, ноль — ни одна", () => {
    const all = runSide(model({}, 100),
      { span: 2, side: "hi", plan: { perMonth: {}, once: {} }, seed: 1 });
    expect(all.out[2]).toBeCloseTo(2);
    const never = runSide(model({}, 0),
      { span: 2, side: "hi", plan: { perMonth: {}, once: {} }, seed: 1 });
    expect(never.out[2]).toBe(0);
  });

  it("вероятность — свойство фактора, а не функции", () => {
    /* Сезон бывает удачным с одной и той же вероятностью, сколько бы
       функций от него ни зависело. */
    const factors = [{ id: "g1", e: "A", name: "сезон", chance: 40 }];
    expect(chanceOf(FX({}), factors)).toBe(40);
    // У задачи её не спрашивают вовсе.
    expect(chanceOf(normalizeFunc({ kind: "task" }), factors)).toBe(100);
    // Фактор без записи — сто процентов, а не ноль: неизвестное не значит
    // «никогда».
    expect(chanceOf(FX({ factor: "нет-такого" }), factors)).toBe(100);
  });

  it("ждёт полную порцию: на неполную не срабатывает, ресурс копится", () => {
    /* Фактор заранее знает, сколько ему нужно на одно срабатывание. Задача
       работу делит и делает частями, а фактор либо случился целиком, либо
       не случился вовсе. */
    const m = model({});
    m.traits[0].have = 3;                      // нужно 4 — не хватает
    const out = runSide(m, { span: 2, side: "hi", plan: { perMonth: {}, once: {} } });
    expect(out.out[2]).toBe(0);
    expect(out.in[2]).toBe(3);                 // и ничего не тронул
  });

  it("а задача на неполную порцию срабатывает частично — работу делят", () => {
    const m = model({ kind: "task", factor: "" });
    m.traits[0].have = 3;
    const out = runSide(m, { span: 1, side: "hi", plan: { perMonth: { x1: 1 }, once: {} } });
    expect(out.out[1]).toBeGreaterThan(0);
    expect(out.out[1]).toBeLessThan(1);
  });

  it("не чаще, чем позволяет срок попытки", () => {
    const rare = model({ dur: 1, durHi: 1, durUnit: "дн",
      every: 2, everyHi: 2, everyUnit: "мес" }, 100);
    rare.traits[0].have = 1000;
    const out = runSide(rare, { span: 4, side: "hi", plan: { perMonth: {}, once: {} }, seed: 1 });
    // Раз в два месяца — за четыре месяца примерно два срабатывания.
    expect(out.out[4]).toBeCloseTo(2, 1);
  });
});
