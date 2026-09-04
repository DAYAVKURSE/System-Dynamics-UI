import { describe, expect, it } from "vitest";
import { chanceOf, hoursOf, hoursRange, normalizeFunc, newFunc, sameHours, checkFunc }
  from "../lib/funcs.js";
import { cycles, forecast, load, runSide, stepHours } from "../lib/plan.js";
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
  const model = (over) => ({
    traits: [{ id: "in", e: "A", have: 100 }, { id: "out", e: "A", have: 0 }],
    funcs: [FX(over)],
  });

  it("идёт своим чередом, даже когда ни одна цель не применена", () => {
    // Задачи ждут, что их поставят; фактор не спрашивает никого.
    const out = runSide(model({}), { span: 2, side: "hi", plan: { perMonth: {}, once: {} } });
    expect(out.out[2]).toBeCloseTo(2);
  });

  it("вероятность меньше 100% — удаётся не каждая попытка", () => {
    const half = runSide(model({ chance: 50 }),
      { span: 2, side: "hi", plan: { perMonth: {}, once: {} } });
    expect(half.out[2]).toBeCloseTo(1);
    // Нулевая вероятность — не случается вовсе.
    const never = runSide(model({ chance: 0 }),
      { span: 2, side: "hi", plan: { perMonth: {}, once: {} } });
    expect(never.out[2]).toBe(0);
  });

  it("вероятность есть только у фактора: у задачи её не спрашивают", () => {
    // «Выйдет с вероятностью 60%» про работу человека сказать нельзя —
    // либо назначили, либо нет.
    expect(chanceOf(normalizeFunc({ kind: "task", chance: 50 }))).toBe(100);
    expect(chanceOf(FX({ chance: 50 }))).toBe(50);
    // Мусор за границами шкалы приводится к ней, а не ломает расчёт.
    expect(chanceOf(FX({ chance: 500 }))).toBe(100);
    expect(chanceOf(FX({ chance: -5 }))).toBe(0);
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
      every: 2, everyHi: 2, everyUnit: "мес" });
    rare.traits[0].have = 1000;
    const out = runSide(rare, { span: 4, side: "hi", plan: { perMonth: {}, once: {} } });
    // Раз в два месяца — за четыре месяца примерно два срабатывания.
    expect(out.out[4]).toBeCloseTo(2, 1);
  });
});
